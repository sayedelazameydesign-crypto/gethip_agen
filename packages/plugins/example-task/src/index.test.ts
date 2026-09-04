import {describe,it,expect,vi} from 'vitest';
import {ExamplePlugin} from './index.js';
import type {IEvidenceStrategy,IPluginContext,ITaskDefinition} from '@agent/contracts';

function register(){
 const tasks=new Map<string,ITaskDefinition>();
 const strategies=new Map<string,IEvidenceStrategy>();
 const context:IPluginContext={
  registerTask:task=>{tasks.set(task.id,task)},
  registerEvidenceStrategy:strategy=>{strategies.set(strategy.id,strategy)},
  loadPolicies:async()=>({email:{blockedDomains:[]}})
 };
 ExamplePlugin.register(context);
 return {tasks,strategies,task:tasks.get('send_email')!,strategy:strategies.get('email_logs')!};
}

describe('ExamplePlugin — التسجيل',()=>{
 it('يسجل مهمة البريد واستراتيجية الأدلة',()=>{
  const {tasks,strategies,task,strategy}=register();
  expect(ExamplePlugin.name).toBe('example-plugin');
  expect(tasks.size).toBe(1);
  expect(strategies.size).toBe(1);
  expect(task.id).toBe('send_email');
  expect(strategy.id).toBe('email_logs');
 });
});

describe('ExamplePlugin — مخطط المدخلات',()=>{
 it('يطبق القيم الافتراضية على الحقول الاختيارية',()=>{
  const {task}=register();
  expect(task.schema.parse({to:'a@example.com'})).toEqual({to:'a@example.com',subject:'',body:''});
 });

 it('يرفض بريدًا غير صالح أو معرّف موافقة غير UUID',()=>{
  const {task}=register();
  for(const input of [{},{to:'not-an-email'},{to:'a@example.com',approvalId:'123'},{to:'a@example.com',recipients:-1},{to:'a@example.com',recipients:1.5}]){
   expect(task.schema.safeParse(input).success,JSON.stringify(input)).toBe(false);
  }
 });

 it('يقبل مدخلات كاملة صالحة',()=>{
  const {task}=register();
  const input={to:'a@example.com',subject:'مرحبا',body:'محتوى',bulk:true,recipients:50,managerApproval:true};
  expect(task.schema.safeParse(input).success).toBe(true);
 });
});

describe('ExamplePlugin — سياسة الموافقة',()=>{
 it('يبقى في المستوى 2 افتراضيًا',async()=>{
  const {task}=register();
  expect(task.approvalPolicy?.level).toBe(2);
  await expect(task.approvalPolicy!.overrideLevel!({to:'a@example.com'})).resolves.toBe(2);
  await expect(task.approvalPolicy!.overrideLevel!({bulk:true,recipients:100})).resolves.toBe(2);
  await expect(task.approvalPolicy!.overrideLevel!({bulk:true})).resolves.toBe(2);
 });

 it('يرفع إلى المستوى 3 للبريد الجماعي فوق 100 مستلم',async()=>{
  const {task}=register();
  await expect(task.approvalPolicy!.overrideLevel!({bulk:true,recipients:101})).resolves.toBe(3);
  await expect(task.approvalPolicy!.overrideLevel!({bulk:true,recipients:5000})).resolves.toBe(3);
 });
});

describe('ExamplePlugin — المعالج',()=>{
 const context=(approved:boolean)=>({agentId:'gethip-agent',traceId:'trace-1',approvalGateway:{request:vi.fn(async()=>({approved,reason:'denied'}))}});

 it('يطلب موافقة إضافية ثم ينجح',async()=>{
  const {task}=register();
  const ctx=context(true);
  const result=await task.handler({to:'a@example.com'},ctx) as {success:boolean;messageId:string};
  expect(ctx.approvalGateway.request).toHaveBeenCalledWith(1,{action:'log_email'});
  expect(result.success).toBe(true);
  expect(result.messageId).toBeTypeOf('string');
 });

 it('يرمي خطأ عند رفض الموافقة الداخلية',async()=>{
  const {task}=register();
  await expect(task.handler({to:'a@example.com'},context(false))).rejects.toThrow('Approval denied: denied');
 });

 it('لا ينفذ أي إرسال فعلي (نسخة تجريبية)',async()=>{
  const {task}=register();
  const result=await task.handler({to:'a@example.com'},context(true)) as Record<string,unknown>;
  expect(Object.keys(result).sort()).toEqual(['messageId','success']);
 });
});

describe('ExamplePlugin — استراتيجية الأدلة',()=>{
 it('تسجل الحالة بحسب نتيجة المهمة',async()=>{
  const {strategy}=register();
  const ok=await strategy.collect({success:true});
  expect(ok).toMatchObject({provider:'demo',status:'sent'});
  expect(ok.timestamp).toBeTypeOf('string');
  expect(await strategy.collect({})).toMatchObject({status:'failed'});
 });
});
