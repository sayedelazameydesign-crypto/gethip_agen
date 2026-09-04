import {describe,it,expect,vi} from 'vitest';
import {LLMPlanner} from './llm-planner.js';
import {z} from 'zod';
import type {ITaskDefinition} from '@agent/contracts';

const task:ITaskDefinition={id:'send_email',schema:z.object({to:z.string().email()}),handler:async()=>({})};
const fallbackParameters={taskId:'send_email',parameters:{to:'fallback@example.com'}};
const fallback={plan:vi.fn(async()=>fallbackParameters)};

const plannerWith=(raw:string)=>new LLMPlanner([task],{generateResponse:async()=>raw},fallback);

describe('LLMPlanner — استخراج الرد والتحقق منه',()=>{
 it('يستخرج JSON من نص محاط بشرح أو أقواس كود',async()=>{
  const planner=plannerWith('إليك النتيجة:\n```json\n{"taskId":"send_email","parameters":{"to":"a@example.com"}}\n```\nتم.');
  await expect(planner.plan('أرسل')).resolves.toEqual({taskId:'send_email',parameters:{to:'a@example.com'}});
 });

 it('يقبل JSON بسيطًا بلا زوائد',async()=>{
  const planner=plannerWith('{"taskId":"send_email","parameters":{"to":"a@example.com"}}');
  await expect(planner.plan('أرسل')).resolves.toEqual({taskId:'send_email',parameters:{to:'a@example.com'}});
 });

 it('يزيل الخصائص غير المعلنة في المخطط',async()=>{
  const planner=plannerWith('{"taskId":"send_email","parameters":{"to":"a@example.com","danger":true}}');
  await expect(planner.plan('أرسل')).resolves.toEqual({taskId:'send_email',parameters:{to:'a@example.com'}});
 });

 it('يعود للبديل عند نص ليس JSON',async()=>{
  const planner=plannerWith('لا أستطيع المساعدة');
  await expect(planner.plan('أرسل')).resolves.toEqual(fallbackParameters);
  expect(fallback.plan).toHaveBeenCalledWith('أرسل');
 });

 it('يعود للبديل عند JSON ناقص أو بحقول مفقودة',async()=>{
  await expect(plannerWith('{"taskId":"send_email"}').plan('x')).resolves.toEqual(fallbackParameters);
  await expect(plannerWith('{"taskId":"send_email","parameters":{}}').plan('x')).resolves.toEqual(fallbackParameters);
  await expect(plannerWith('{"taskId":"send_email","parameters":{"to":"not-email"}}').plan('x')).resolves.toEqual(fallbackParameters);
  await expect(plannerWith('{"taskId":"send_email","parameters":"text"}').plan('x')).resolves.toEqual(fallbackParameters);
 });

 it('يعود للبديل عندما يختار النموذج مهمة غير موجودة',async()=>{
  await expect(plannerWith('{"taskId":"delete_everything","parameters":{}}').plan('x')).resolves.toEqual(fallbackParameters);
 });

 it('يعود للبديل عندما يرمي المزوّد خطأ',async()=>{
  const planner=new LLMPlanner([task],{generateResponse:async()=>{throw new Error('upstream 500')}},fallback);
  await expect(planner.plan('x')).resolves.toEqual(fallbackParameters);
 });

 it('يستخدم البديل مباشرة عند غياب المزوّد',async()=>{
  const planner=new LLMPlanner([task],null,fallback);
  await expect(planner.plan('send_email')).resolves.toEqual(fallbackParameters);
  expect(fallback.plan).toHaveBeenCalledWith('send_email');
 });

 it('يعود للبديل عندما يكون taskId فارغًا',async()=>{
  await expect(plannerWith('{"taskId":null,"parameters":{}}').plan('x')).resolves.toEqual(fallbackParameters);
 });

 it('لا ينفذ أي مهمة أثناء التخطيط',async()=>{
  let called=false;
  const spyTask:ITaskDefinition={id:'send_email',schema:z.object({to:z.string().email()}),handler:async()=>{called=true;return {}}};
  const planner=new LLMPlanner([spyTask],{generateResponse:async()=>'{"taskId":"send_email","parameters":{"to":"a@example.com"}}'},fallback);
  await planner.plan('أرسل');
  expect(called).toBe(false);
 });

 it('يقيّد الاختيار بالمهام الممرّرة فقط',async()=>{
  const other:ITaskDefinition={id:'other_task',schema:z.object({}),handler:async()=>({})};
  const planner=new LLMPlanner([],{generateResponse:async()=>'{"taskId":"other_task","parameters":{}}'},fallback);
  expect(other.id).toBe('other_task');
  await expect(planner.plan('x')).resolves.toEqual(fallbackParameters);
 });
});
