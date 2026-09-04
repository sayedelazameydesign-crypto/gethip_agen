import {describe,it,expect} from 'vitest';
import {evaluateTool,SecurityKernel} from './index.js';

const read={name:'file.read',input:{path:'README.md'}};
const write={name:'file.write',input:{path:'README.md'}};

describe('evaluateTool',()=>{
 it('يسمح تلقائيًا بأدوات القراءة (Level 0)',()=>{
  for(const name of ['repo.list','repo.get','file.read','search.code','git.status','git.diff','git.log','test.run','github.issue.list','github.pr.list','github.checks.get']){
   const decision=evaluateTool({name,input:{}});
   expect(decision,`tool: ${name}`).toEqual({allowed:true,requiresApproval:false,reason:'قراءة آمنة تلقائيًا'});
  }
 });

 it('يطلب موافقة صريحة لأدوات التعديل (Level 1)',()=>{
  for(const name of ['file.write','file.delete','git.branch.create','git.commit','command.run','github.pr.create','github.pr.comment']){
   const decision=evaluateTool({name,input:{}});
   expect(decision,`tool: ${name}`).toEqual({allowed:true,requiresApproval:true,reason:'يتطلب موافقة Level 1'});
  }
 });

 it('يرفض الأدوات غير المسجلة افتراضيًا (fail-closed)',()=>{
  for(const name of ['','rm -rf','github.pr.merge','secrets.read','git.push --force']){
   expect(evaluateTool({name,input:{}}).allowed).toBe(false);
  }
  expect(evaluateTool({name:'unknown.tool',input:{}})).toEqual({allowed:false,requiresApproval:false,reason:'الأداة غير مسجلة أو محظورة افتراضيًا'});
 });

 it('لا يسمح بتجاوز القواعد عبر حرف كبير المختلف',()=>{
  expect(evaluateTool({name:'File.Read',input:{}}).allowed).toBe(false);
  expect(evaluateTool({name:'file.read ',input:{}}).allowed).toBe(false);
 });

 it('يتجاهل حقل risk الذي يرسله المستدعي',()=>{
  expect(evaluateTool({name:'command.run',input:{},risk:0})).toEqual(evaluateTool({name:'command.run',input:{}}));
 });

 it('لا يمنع القراءة ولا يُخضعها لموافقة حتى مع مدخلات خطيرة',()=>{
  expect(evaluateTool({...read,input:{path:'../../etc/passwd'}}).requiresApproval).toBe(false);
  expect(evaluateTool(write).requiresApproval).toBe(true);
 });
});

describe('SecurityKernel',()=>{
 const kernel=new SecurityKernel();
 const emailPolicies={email:{blockedDomains:['spam.com','temp-mail.org'],requireSSL:true}};

 it('يوافق على حمولة نظيفة في المستوى 1',()=>{
  expect(kernel.evaluate({level:1,payload:{to:'user@example.com'},policies:emailPolicies})).toEqual({approved:true});
 });

 it('يرفض النطاقات المحظورة المذكورة في أي ملف سياسة',()=>{
  const decision=kernel.evaluate({level:1,payload:{to:'a@spam.com'},policies:emailPolicies});
  expect(decision.approved).toBe(false);
  expect(decision.reason).toContain('spam.com');
  expect(kernel.evaluate({level:1,payload:{to:'a@temp-mail.org'},policies:emailPolicies}).approved).toBe(false);
 });

 it('يطبّق الحظر بصرف النظر عن حالة الأحرف أو النطاق الفرعي الجزئي',()=>{
  expect(kernel.evaluate({level:1,payload:{to:'A@SPAM.COM'},policies:emailPolicies}).approved).toBe(false);
  expect(kernel.evaluate({level:1,payload:{to:'a@mail.spam.com.evil.net'},policies:emailPolicies}).approved).toBe(true);
 });

 it('يجمع النطاقات المحظورة من عدة ملفات سياسة',()=>{
  const policies={a:{blockedDomains:['a.com']},b:{blockedDomains:['b.com']}};
  expect(kernel.evaluate({level:1,payload:{to:'x@a.com'},policies}).approved).toBe(false);
  expect(kernel.evaluate({level:1,payload:{to:'x@b.com'},policies}).approved).toBe(false);
  expect(kernel.evaluate({level:1,payload:{to:'x@c.com'},policies}).approved).toBe(true);
 });

 it('يطلب بريد المدير في المستوى 2 و3 ويرفض غيابه',()=>{
  for(const level of [2,3] as const){
   expect(kernel.evaluate({level,payload:{to:'a@example.com'},policies:{}}).approved).toBe(false);
   expect(kernel.evaluate({level,payload:{to:'a@example.com'},policies:{}}).reason).toBe('Level 2+ requires manager approval flag.');
   expect(kernel.evaluate({level,payload:{to:'a@example.com',managerApproval:true},policies:{}}).approved).toBe(true);
  }
 });

 it('يرفض القيمة false أو النصية لعَلَم موافقة المدير',()=>{
  expect(kernel.evaluate({level:2,payload:{managerApproval:false},policies:{}}).approved).toBe(false);
  expect(kernel.evaluate({level:2,payload:{managerApproval:'true'},policies:{}}).approved).toBe(false);
 });

 it('يتجاهل السياسات غير الكائنية ولا ينهار',()=>{
  const policies={a:null,b:'text',c:42,d:{}};
  expect(kernel.evaluate({level:1,payload:{to:'a@example.com'},policies})).toEqual({approved:true});
 });

 it('يتجاهل حقل blockedDomains إن لم يكن مصفوفة',()=>{
  expect(kernel.evaluate({level:1,payload:{to:'a@spam.com'},policies:{email:{blockedDomains:'spam.com'}}}).approved).toBe(true);
 });

 it('يعمل بلا سياسات محمّلة ويوافق عند غياب حقل to',()=>{
  expect(kernel.evaluate({level:1,payload:{},policies:{}})).toEqual({approved:true});
  expect(kernel.evaluate({level:1,payload:{to:123},policies:emailPolicies}).approved).toBe(true);
 });
});
