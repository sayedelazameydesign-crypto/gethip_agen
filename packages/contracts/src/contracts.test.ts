import {describe,it,expect} from 'vitest';
import {RunState,RiskLevel,ToolRequest,Plan,CreateRunRequest} from './index.js';

describe('عقود zod',()=>{
 it('يقبل حالات التشغيل المعروفة ويرفض ما عداها',()=>{
  for(const state of ['PLANNED','RUNNING','WAITING_APPROVAL','EXECUTING','VERIFYING','COMPLETED','FAILED','CANCELLED']){
   expect(RunState.parse(state)).toBe(state);
  }
  expect(RunState.safeParse('DONE').success).toBe(false);
  expect(RunState.safeParse('planned').success).toBe(false);
  expect(RunState.safeParse('').success).toBe(false);
 });

 it('يحصر مستوى الخطورة في 0 و1 و2 فقط',()=>{
  for(const level of [0,1,2]) expect(RiskLevel.parse(level)).toBe(level);
  for(const level of [3,-1,'1',null,1.5]) expect(RiskLevel.safeParse(level).success, String(level)).toBe(false);
 });

 it('يتحقق من بنية طلب الأداة',()=>{
  expect(ToolRequest.parse({name:'file.read',input:{}})).toEqual({name:'file.read',input:{}});
  expect(ToolRequest.safeParse({name:'file.read'}).success).toBe(false);
  expect(ToolRequest.safeParse({input:{}}).success).toBe(false);
  expect(ToolRequest.safeParse({name:'',input:{}}).success).toBe(true);
  expect(ToolRequest.parse({name:'git.commit',input:{message:'m'},risk:1}).risk).toBe(1);
 });

 it('يتحقق من بنية الخطة',()=>{
  const plan={summary:'ملخص',steps:['خطوة'],tools:[{name:'file.read',input:{}}]};
  expect(Plan.parse(plan)).toEqual(plan);
  expect(Plan.safeParse({...plan,tools:[{name:'file.read'}]}).success).toBe(false);
  expect(Plan.safeParse({...plan,steps:[]}).success).toBe(true);
  expect(Plan.safeParse({summary:'x',steps:['a']}).success).toBe(false);
 });

 it('يفرض الحدود الدنيا على طلب إنشاء تشغيل',()=>{
  expect(CreateRunRequest.parse({repository:'org/repo',request:'أصلح الاختبارات'})).toEqual({repository:'org/repo',request:'أصلح الاختبارات'});
  expect(CreateRunRequest.safeParse({repository:'',request:'أصلح'}).success).toBe(false);
  expect(CreateRunRequest.safeParse({repository:'org/repo',request:'ab'}).success).toBe(false);
  expect(CreateRunRequest.safeParse({repository:'org/repo'}).success).toBe(false);
  expect(CreateRunRequest.safeParse({request:'أصلح'}).success).toBe(false);
 });

 it('لا يسمح بخصائص زائدة غير معلنة في العقود',()=>{
  const parsed=CreateRunRequest.safeParse({repository:'org/repo',request:'أصلح',admin:true});
  expect(parsed.success).toBe(true);
  if(parsed.success) expect(parsed.data).not.toHaveProperty('admin');
 });
});
