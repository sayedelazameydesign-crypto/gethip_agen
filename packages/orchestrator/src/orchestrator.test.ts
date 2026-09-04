import {fileURLToPath} from 'node:url';
import {describe,it,expect,vi,afterEach,beforeEach} from 'vitest';
import {createOrchestrator} from './index.js';
import {SQLiteApprovalStore} from '@agent/approval-store';
import type {IPlugin,TaskContext} from '@agent/contracts';
import {z} from 'zod';

const policiesDir=fileURLToPath(new URL('../../../policies/approval',import.meta.url));

let store:SQLiteApprovalStore;
beforeEach(()=>{store=new SQLiteApprovalStore();process.env.AGENT_POLICIES_DIR=policiesDir});
afterEach(()=>{store.close();vi.unstubAllGlobals();vi.restoreAllMocks();delete process.env.AGENT_POLICIES_DIR;delete process.env.GEMINI_MODEL});

async function approve(payload:Record<string,unknown>={}){
 const record=await store.createApproval({level:2,payload});
 await store.markApproved(record.id,{id:'manager-1',role:'manager'});
 return record.id;
}

function geminiReply(text:string){
 return vi.fn(async(_url:string,_init?:RequestInit)=>({
  ok:true,
  status:200,
  json:async()=>({candidates:[{content:{parts:[{text}]}}]})
 }));
}

describe('createOrchestrator — المسار الكلماتي',()=>{
 it('ينفذ مهمة معتمدة ويجمع الأدلة',async()=>{
  const approvalId=await approve({to:'valid@example.com'});
  const {run}=await createOrchestrator(undefined,undefined,store);
  const report=await run({intent:'send_email',parameters:{to:'valid@example.com',subject:'Test',body:'Hello',approvalId}});
  expect(report.success).toBe(true);
  expect(report.agentId).toBe('gethip-agent');
  expect(report.steps).toHaveLength(1);
  expect(report.steps[0]).toMatchObject({taskId:'send_email',status:'executed',approval:{level:0,approved:false}});
  expect(report.steps[0].input).toEqual({to:'valid@example.com',subject:'Test',body:'Hello',approvalId});
  expect(report.steps[0].evidence).toHaveProperty('email_logs');
  expect(report.finalOutput).toMatchObject({success:true});
  expect(report.summary).toContain('send_email');
  expect(report.totalTime).toBeGreaterThan(0);
  expect(report.goal.intent).toBe('send_email');
 });

 it('يمرر context كما هو إلى التقرير',async()=>{
  const approvalId=await approve();
  const {run}=await createOrchestrator(undefined,undefined,store);
  const report=await run({intent:'send_email',parameters:{to:'a@example.com',approvalId},context:{source:'test'}});
  expect(report.goal.context).toEqual({source:'test'});
 });

 it('يبلّغ عن فشل مخطط عند هدف غير معروف',async()=>{
  const {run}=await createOrchestrator(undefined,undefined,store);
  const report=await run({intent:'non_existent_task',parameters:{}});
  expect(report.success).toBe(false);
  expect(report.summary).toContain('No task matches');
  expect(report.finalOutput).toBeNull();
  expect(report.steps[0]).toMatchObject({status:'failed',taskId:'unknown'});
 });

 it('يبلّغ عن رفض بوابة الموافقة',async()=>{
  const {run}=await createOrchestrator(undefined,undefined,store);
  const report=await run({intent:'send_email',parameters:{to:'ok@example.com'}});
  expect(report.success).toBe(false);
  expect(report.summary).toContain('Level 2+ requires a valid approved approvalId.');
  expect(report.steps[0].status).toBe('failed');
  expect(report.steps[0].output).toEqual({error:'Approval denied: Level 2+ requires a valid approved approvalId.'});
 });

 it('يبلّغ عن رفض السياسة للنطاق المحظور',async()=>{
  const approvalId=await approve();
  const {run}=await createOrchestrator(undefined,undefined,store);
  const report=await run({intent:'send_email',parameters:{to:'spam@spam.com',approvalId}});
  expect(report.success).toBe(false);
  expect(report.summary).toContain('Domain spam.com is blocked by policy.');
 });

 it('يبلّغ عن مدخلات لا تطابق المخطط',async()=>{
  const {run}=await createOrchestrator(undefined,undefined,store);
  const report=await run({intent:'send_email',parameters:{to:'not-an-email'}});
  expect(report.success).toBe(false);
  expect(report.summary).toContain('Invalid input for task send_email');
 });

 it('يرفض موافقة صادرة عن مخزن آخر (فصل المخازن)',async()=>{
  const {agent}=await createOrchestrator(undefined,undefined,store);
  const other=new SQLiteApprovalStore();
  const record=await other.createApproval({level:2,payload:{}});
  await other.markApproved(record.id,{id:'m',role:'manager'});
  await expect(agent.executeTask('send_email',{to:'ok@example.com',approvalId:record.id})).rejects.toThrow('valid approved approvalId');
  other.close();
 });

 it('يحمّل السياسات عند تمرير مجلدها فيمنع النطاق المحظور داخل المنسّق',async()=>{
  const {agent}=await createOrchestrator(undefined,undefined,store,policiesDir);
  await expect(agent.executeTask('send_email',{to:'spam@spam.com'})).rejects.toThrow('Domain spam.com is blocked by policy.');
  expect(agent.policies).toHaveProperty('email');
 });
});

describe('AgentLoop — جمع الأدلة',()=>{
 it('لا يفشل التشغيل عند رمي استراتيجية دليل خطأ',async()=>{
  const plugin:IPlugin={name:'evidence',version:'1.0.0',register(ctx){
   ctx.registerTask({id:'ok_task',schema:z.object({}),requiredApprovalLevel:1,handler:async()=>({fine:true})});
   ctx.registerEvidenceStrategy({id:'boom',collect:async()=>{throw new Error('collector exploded')}});
   ctx.registerEvidenceStrategy({id:'fine',collect:async data=>({received:data})});
  }};
  const {run}=await createOrchestrator([plugin],undefined,store);
  const report=await run({intent:'ok_task',parameters:{}});
  expect(report.success).toBe(true);
  expect(report.steps[0].evidence?.boom).toEqual({error:'Error: collector exploded'});
  expect(report.steps[0].evidence?.fine).toHaveProperty('received');
 });

 it('يجمع أدلة من كل الاستراتيجيات المسجلة',async()=>{
  const plugin:IPlugin={name:'multi',version:'1.0.0',register(ctx){
   ctx.registerTask({id:'ok_task',schema:z.object({}),requiredApprovalLevel:1,handler:async()=>({value:1})});
   ctx.registerEvidenceStrategy({id:'a',collect:async()=>({a:1})});
   ctx.registerEvidenceStrategy({id:'b',collect:async()=>({b:2})});
  }};
  const {run}=await createOrchestrator([plugin],undefined,store);
  const report=await run({intent:'ok_task',parameters:{}});
  expect(Object.keys(report.steps[0].evidence??{}).sort()).toEqual(['a','b']);
  expect(report.steps[0].evidence).toMatchObject({a:{a:1},b:{b:2}});
 });

 it('يمرر سياق التنفيذ إلى المهمة',async()=>{
  let captured:TaskContext|undefined;
  const plugin:IPlugin={name:'ctx',version:'1.0.0',register(ctx){
   ctx.registerTask({id:'ctx_task',schema:z.object({}),requiredApprovalLevel:1,handler:async(_input,context)=>{captured=context;return {}}});
  }};
  const {run}=await createOrchestrator([plugin],undefined,store);
  await run({intent:'ctx_task',parameters:{}});
  expect(captured?.agentId).toBe('gethip-agent');
  expect(captured?.traceId).toBeTypeOf('string');
 });
});

describe('createOrchestrator — المسار اللساني (Gemini)',()=>{
 it('يختار المهمة التي يقترحها النموذج بعد التحقق من المعاملات',async()=>{
  const approvalId=await approve();
  const fetchMock=geminiReply(JSON.stringify({taskId:'send_email',parameters:{to:'llm@example.com',subject:'من النموذج',approvalId}}));
  vi.stubGlobal('fetch',fetchMock);
  const {run}=await createOrchestrator(undefined,'test-key',store);
  const report=await run({intent:'أرسل بريدًا للعميل',parameters:{}});
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const url=String(fetchMock.mock.calls[0][0]);
  expect(url).toContain('generativelanguage.googleapis.com');
  expect(url).toContain('gemini-2.0-flash');
  expect(url).toContain('key=test-key');
  expect(report.success).toBe(true);
  expect(report.steps[0].taskId).toBe('send_email');
  expect(report.steps[0].input).toMatchObject({to:'llm@example.com',subject:'من النموذج',body:'',approvalId});
 });

 it('يستخدم الطراز المحدد عبر GEMINI_MODEL',async()=>{
  process.env.GEMINI_MODEL='gemini-1.5-pro';
  const approvalId=await approve();
  const fetchMock=geminiReply(JSON.stringify({taskId:'send_email',parameters:{to:'llm@example.com',approvalId}}));
  vi.stubGlobal('fetch',fetchMock);
  const {run}=await createOrchestrator(undefined,'test-key',store);
  await run({intent:'أرسل بريدًا',parameters:{}});
  expect(String(fetchMock.mock.calls[0][0])).toContain('gemini-1.5-pro');
 });

 it('يعود للمخطط الكلماتي عند فشل اتصال النموذج',async()=>{
  const fetchMock=vi.fn(async()=>{throw new Error('network down')});
  vi.stubGlobal('fetch',fetchMock);
  const {run}=await createOrchestrator(undefined,'test-key',store);
  const report=await run({intent:'send_email',parameters:{}});
  expect(report.success).toBe(false);
  expect(report.steps[0].taskId).toBe('send_email');
  expect(report.summary).toContain('Invalid input for task send_email');
 });

 it('يعود للمخطط الكلماتي عند رد نموذج غير صالح',async()=>{
  const fetchMock=geminiReply('ليس JSON');
  vi.stubGlobal('fetch',fetchMock);
  const {run}=await createOrchestrator(undefined,'test-key',store);
  const report=await run({intent:'send_email',parameters:{}});
  expect(report.steps[0].taskId).toBe('send_email');
  expect(report.success).toBe(false);
 });

 it('يعود للمخطط الكلماتي عند اقتراح مهمة غير موجودة',async()=>{
  const fetchMock=geminiReply(JSON.stringify({taskId:'rm_all',parameters:{}}));
  vi.stubGlobal('fetch',fetchMock);
  const {run}=await createOrchestrator(undefined,'test-key',store);
  const report=await run({intent:'send_email',parameters:{}});
  expect(report.steps[0].taskId).toBe('send_email');
 });

 it('يتجاهل معاملات المستخدم عندما يتولى النموذج التخطيط',async()=>{
  const approvalId=await approve();
  const fetchMock=geminiReply(JSON.stringify({taskId:'send_email',parameters:{to:'llm@example.com',approvalId}}));
  vi.stubGlobal('fetch',fetchMock);
  const {run}=await createOrchestrator(undefined,'test-key',store);
  const report=await run({intent:'send_email',parameters:{to:'ignored@example.com',subject:'تجاهلني'}});
  expect(report.success).toBe(true);
  expect(report.steps[0].input).toMatchObject({to:'llm@example.com',approvalId});
  expect(report.steps[0].input).not.toHaveProperty('subject','تجاهلني');
 });

 it('يعمل بدون مفتاح Gemini (مسار كلماتي فقط)',async()=>{
  const fetchMock=vi.fn();
  vi.stubGlobal('fetch',fetchMock);
  const approvalId=await approve();
  const {run}=await createOrchestrator(undefined,undefined,store);
  const report=await run({intent:'send_email',parameters:{to:'ok@example.com',approvalId}});
  expect(report.success).toBe(true);
  expect(fetchMock).not.toHaveBeenCalled();
 });
});
