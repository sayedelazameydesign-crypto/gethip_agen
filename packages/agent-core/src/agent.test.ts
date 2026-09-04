import {fileURLToPath} from 'node:url';
import {describe,it,expect,afterEach,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {initAgent} from './index.js';
import {ExamplePlugin} from '@agent/plugin-example';
import {SQLiteApprovalStore} from '@agent/approval-store';
import type {ApprovalStore} from '@agent/approval-store';
import type {IPlugin,TaskContext} from '@agent/contracts';
import {SecurityKernel} from '@agent/security';
import {z} from 'zod';

const policiesDir=fileURLToPath(new URL('../../../policies/approval',import.meta.url));
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

afterEach(()=>{vi.restoreAllMocks()});

async function approve(store:SQLiteApprovalStore,level:1|2|3=2,payload:Record<string,unknown>={}){
 const record=await store.createApproval({level,payload});
 await store.markApproved(record.id,{id:'manager-1',role:'manager'});
 return record.id;
}

describe('initAgent — التوصيل والتحميل',()=>{
 it('يسجل مهام واستراتيجيات الإضافة ويحمّل السياسات',async()=>{
  const agent=await initAgent({plugins:[ExamplePlugin],policiesDir});
  expect(agent.taskRegistry.get('send_email')).toBeDefined();
  expect(agent.strategyRegistry.get('email_logs')).toBeDefined();
  expect(agent.policies).toHaveProperty('email');
  expect(agent.approvalGateway).toBeDefined();
 });

 it('يعيد سجلات وسياسات فارغة بدون إضافات',async()=>{
  const agent=await initAgent({policiesDir});
  expect(agent.taskRegistry.getAll()).toEqual([]);
  expect(agent.strategyRegistry.getAll()).toEqual([]);
  expect(agent.policies).toEqual({});
 });

 it('لا ينهار عندما يكون مجلد السياسات غير موجود',async()=>{
  const agent=await initAgent({plugins:[ExamplePlugin],policiesDir:'./not-there'});
  expect(agent.policies).toEqual({});
 });
});

describe('executeTask — التحقق من المدخلات',()=>{
 it('يرفض مهمة غير مسجلة',async()=>{
  const {executeTask}=await initAgent({plugins:[ExamplePlugin],policiesDir});
  await expect(executeTask('missing_task',{})).rejects.toThrow('Task missing_task not found');
 });

 it('يرفض مدخلات لا تطابق مخطط المهمة',async()=>{
  const {executeTask}=await initAgent({plugins:[ExamplePlugin],policiesDir});
  await expect(executeTask('send_email',{to:'not-an-email'})).rejects.toThrow('Invalid input for task send_email');
  await expect(executeTask('send_email',{})).rejects.toThrow('Invalid input for task send_email');
 });

 it('ينفذ المهمة عند وجود موافقة معتمدة مخزّنة',async()=>{
  const store=new SQLiteApprovalStore();
  const approvalId=await approve(store);
  const {executeTask}=await initAgent({plugins:[ExamplePlugin],policiesDir,approvalStore:store});
  const result=await executeTask('send_email',{to:'ok@example.com',subject:'مرحبا',body:'محتوى',approvalId}) as {success:boolean;messageId:string};
  expect(result.success).toBe(true);
  expect(result.messageId).toBeTypeOf('string');
  store.close();
 });

 it('يفشل بأمان عندما يرمي المعالج خطأ',async()=>{
  const plugin:IPlugin={name:'boom',version:'1.0.0',register(ctx){
   ctx.registerTask({id:'boom',schema:z.object({}),requiredApprovalLevel:1,handler:async()=>{throw new Error('exploded')}});
  }};
  const {executeTask}=await initAgent({plugins:[plugin],policiesDir:'./not-there'});
  await expect(executeTask('boom',{})).rejects.toThrow('exploded');
 });
});

describe('executeTask — مستويات الموافقة',()=>{
 it('يرفض المستوى 2 بلا approvalId حتى مع عَلَم المدير',async()=>{
  const store=new SQLiteApprovalStore();
  const {executeTask}=await initAgent({plugins:[ExamplePlugin],policiesDir,approvalStore:store});
  await expect(executeTask('send_email',{to:'ok@example.com',managerApproval:true})).rejects.toThrow('Level 2+ requires a valid approved approvalId.');
  store.close();
 });

 it('يرفض approvalId غير موجود أو غير معتمد',async()=>{
  const store=new SQLiteApprovalStore();
  const pending=await store.createApproval({level:2,payload:{}});
  const rejected=await store.createApproval({level:2,payload:{}});
  await store.markRejected(rejected.id,{id:'manager-1',role:'manager'});
  const {executeTask}=await initAgent({plugins:[ExamplePlugin],policiesDir,approvalStore:store});
  await expect(executeTask('send_email',{to:'ok@example.com',approvalId:'00000000-0000-4000-8000-000000000000'})).rejects.toThrow('valid approved approvalId');
  await expect(executeTask('send_email',{to:'ok@example.com',approvalId:pending.id})).rejects.toThrow('valid approved approvalId');
  await expect(executeTask('send_email',{to:'ok@example.com',approvalId:rejected.id})).rejects.toThrow('valid approved approvalId');
  store.close();
 });

 it('يرفض approvalId منتهي الصلاحية',async()=>{
  const store=new SQLiteApprovalStore();
  const record=await store.createApproval({level:2,payload:{},ttlMs:20});
  await store.markApproved(record.id,{id:'manager-1',role:'manager'});
  await new Promise(r=>setTimeout(r,30));
  const {executeTask}=await initAgent({plugins:[ExamplePlugin],policiesDir,approvalStore:store});
  await expect(executeTask('send_email',{to:'ok@example.com',approvalId:record.id})).rejects.toThrow('valid approved approvalId');
  store.close();
 });

 it('يبقى مغلقًا عند غياب المخزن كليًا',async()=>{
  const {executeTask}=await initAgent({plugins:[ExamplePlugin],policiesDir});
  await expect(executeTask('send_email',{to:'ok@example.com',approvalId:'00000000-0000-4000-8000-000000000000'})).rejects.toThrow('valid approved approvalId');
 });

 it('يرفع المستوى إلى 3 عبر overrideLevel للبريد الجماعي الكبير',async()=>{
  const store=new SQLiteApprovalStore();
  const approvalId=await approve(store,3);
  const spy=vi.spyOn(SecurityKernel.prototype,'evaluate');
  const {executeTask}=await initAgent({plugins:[ExamplePlugin],policiesDir,approvalStore:store});
  const result=await executeTask('send_email',{to:'ok@example.com',bulk:true,recipients:500,approvalId});
  expect(spy.mock.calls.map(call=>call[0].level)).toContain(3);
  expect(result).toMatchObject({success:true});
  store.close();
 });

 it('يبقى على المستوى 2 للبريد الجماعي الصغير',async()=>{
  const store=new SQLiteApprovalStore();
  const approvalId=await approve(store,2);
  const spy=vi.spyOn(SecurityKernel.prototype,'evaluate');
  const {executeTask}=await initAgent({plugins:[ExamplePlugin],policiesDir,approvalStore:store});
  await executeTask('send_email',{to:'ok@example.com',bulk:true,recipients:10,approvalId});
  expect(spy.mock.calls[0][0].level).toBe(2);
  store.close();
 });

 it('يستخدم requiredApprovalLevel عند غياب approvalPolicy',async()=>{
  const plugin:IPlugin={name:'lvl',version:'1.0.0',register(ctx){
   ctx.registerTask({id:'needs_three',schema:z.object({}),requiredApprovalLevel:3,handler:async()=>({done:true})});
  }};
  const spy=vi.spyOn(SecurityKernel.prototype,'evaluate');
  const {executeTask}=await initAgent({plugins:[plugin],policiesDir:'./not-there'});
  await expect(executeTask('needs_three',{})).rejects.toThrow('valid approved approvalId');
  expect(spy.mock.calls[0][0].level).toBe(3);
 });

 it('يفترض المستوى 1 عند غياب أي سياسة أو مستوى',async()=>{
  const plugin:IPlugin={name:'lvl1',version:'1.0.0',register(ctx){
   ctx.registerTask({id:'plain',schema:z.object({}),handler:async()=>({done:true})});
  }};
  const spy=vi.spyOn(SecurityKernel.prototype,'evaluate');
  const {executeTask}=await initAgent({plugins:[plugin],policiesDir:'./not-there'});
  await expect(executeTask('plain',{})).resolves.toEqual({done:true});
  expect(spy.mock.calls[0][0].level).toBe(1);
 });

 it('يرفض النطاق المحظور قبل أي فحص موافقة',async()=>{
  const store=new SQLiteApprovalStore();
  const approvalId=await approve(store);
  const verifySpy=vi.spyOn(store,'verifyApproved');
  const {executeTask}=await initAgent({plugins:[ExamplePlugin],policiesDir,approvalStore:store});
  await expect(executeTask('send_email',{to:'spam@spam.com',approvalId})).rejects.toThrow('Domain spam.com is blocked by policy.');
  expect(verifySpy).not.toHaveBeenCalled();
  store.close();
 });

 it('يمرر managerApproval=true دائمًا إلى نواة الأمن (ملاحظة سلوكية)',async()=>{
  const store=new SQLiteApprovalStore();
  const approvalId=await approve(store);
  const spy=vi.spyOn(SecurityKernel.prototype,'evaluate');
  const {executeTask}=await initAgent({plugins:[ExamplePlugin],policiesDir,approvalStore:store});
  await executeTask('send_email',{to:'ok@example.com',approvalId});
  expect(spy.mock.calls[0][0].payload.managerApproval).toBe(true);
  store.close();
 });
});

describe('executeTask — السياق والمدخلات المحوّلة',()=>{
 it('يزوّد المعالج بسياق يحوي agentId و traceId وبوابة موافقة',async()=>{
  let captured:TaskContext|undefined;
  const plugin:IPlugin={name:'ctx',version:'1.0.0',register(ctx){
   ctx.registerTask({id:'ctx',schema:z.object({}),requiredApprovalLevel:1,handler:async(_input,context)=>{captured=context;return {ok:true}}});
  }};
  const {executeTask}=await initAgent({plugins:[plugin],policiesDir:'./not-there'});
  await executeTask('ctx',{});
  expect(captured?.agentId).toBe('gethip-agent');
  expect(captured?.traceId).toMatch(UUID);
  expect(typeof captured?.approvalGateway.request).toBe('function');
  const approval=await captured!.approvalGateway.request(1,{action:'test'});
  expect(approval.approved).toBe(true);
 });

 it('يولّد traceId مختلفًا لكل تنفيذ',async()=>{
  const ids:string[]=[];
  const plugin:IPlugin={name:'trace',version:'1.0.0',register(ctx){
   ctx.registerTask({id:'trace',schema:z.object({}),requiredApprovalLevel:1,handler:async(_input,context)=>{ids.push(context.traceId);return {}}});
  }};
  const {executeTask}=await initAgent({plugins:[plugin],policiesDir:'./not-there'});
  await executeTask('trace',{});
  await executeTask('trace',{});
  expect(new Set(ids).size).toBe(2);
  expect(ids[0]).toMatch(UUID);
 });

 it('يمرر المدخلات بعد تحويلها وتطبيق القيم الافتراضية',async()=>{
  let received:unknown;
  const plugin:IPlugin={name:'transform',version:'1.0.0',register(ctx){
   ctx.registerTask({id:'transform',schema:z.object({count:z.coerce.number(),label:z.string().default('افتراضي')}),requiredApprovalLevel:1,handler:async input=>{received=input;return {}}});
  }};
  const {executeTask}=await initAgent({plugins:[plugin],policiesDir:'./not-there'});
  await executeTask('transform',{count:'7'});
  expect(received).toEqual({count:7,label:'افتراضي'});
 });

 it('يسمح للمعالج بطلب موافقة إضافية عبر البوابة',async()=>{
  const store=new SQLiteApprovalStore();
  const {executeTask}=await initAgent({plugins:[ExamplePlugin],policiesDir,approvalStore:store});
  const result=await executeTask('send_email',{to:'ok@example.com',approvalId:await approve(store)}) as {success:boolean};
  expect(result.success).toBe(true);
  store.close();
 });

 it('يقبل مخزن موافقات مخصّصًا يطبق واجهة ApprovalStore',async()=>{
  const trusted=randomUUID(); const untrusted=randomUUID();
  const seen:string[]=[];
  const store:ApprovalStore={createApproval:async()=>{throw new Error('unused')},getApprovalStatus:async()=>null,markApproved:async()=>{throw new Error('unused')},markRejected:async()=>{throw new Error('unused')},verifyApproved:async id=>{seen.push(id);return id===trusted}};
  const {executeTask}=await initAgent({plugins:[ExamplePlugin],policiesDir,approvalStore:store});
  await expect(executeTask('send_email',{to:'ok@example.com',approvalId:trusted})).resolves.toMatchObject({success:true});
  await expect(executeTask('send_email',{to:'ok@example.com',approvalId:untrusted})).rejects.toThrow('valid approved approvalId');
  expect(seen).toEqual([trusted,untrusted]);
 });
});
