import {describe,it,expect} from 'vitest';
import {Planner} from './planner.js';
import {TaskRegistry} from '@agent/extension-system';
import {z} from 'zod';

const task=(id:string)=>({id,schema:z.object({}),handler:async()=>({id})});

function registry(...ids:string[]){
 const registry=new TaskRegistry();
 for(const id of ids) registry.register(task(id));
 return registry;
}

describe('Planner (مخطط كلماتي)',()=>{
 it('يطابق المعرف تمامًا',async()=>{
  const planner=new Planner(registry('send_email','open_pr'));
  await expect(planner.plan({intent:'send_email',parameters:{}})).resolves.toBe('send_email');
 });

 it('يطابق جزئيًا عبر كلمة داخل المعرف',async()=>{
  const planner=new Planner(registry('send_email','open_pr'));
  await expect(planner.plan({intent:'email',parameters:{}})).resolves.toBe('send_email');
  await expect(planner.plan({intent:'أرسل email',parameters:{}})).resolves.toBe('send_email');
  await expect(planner.plan({intent:'pr',parameters:{}})).resolves.toBe('open_pr');
 });

 it('يتجاهل حالة الأحرف',async()=>{
  const planner=new Planner(registry('send_email'));
  await expect(planner.plan({intent:'Send_Email',parameters:{}})).resolves.toBe('send_email');
  await expect(planner.plan({intent:'EMAIL',parameters:{}})).resolves.toBe('send_email');
 });

 it('يطابق كلمة في الهدف يحتوي اسم المهمة',async()=>{
  const planner=new Planner(registry('pr'));
  await expect(planner.plan({intent:'افتح pr جديد',parameters:{}})).resolves.toBe('pr');
 });

 it('يقبل هدفًا بفراغات متعددة',async()=>{
  const planner=new Planner(registry('send_email'));
  await expect(planner.plan({intent:'send_email   الآن',parameters:{}})).resolves.toBe('send_email');
 });

 it('يختار أول مهمة مسجلة عند تعدد التطابقات',async()=>{
  const planner=new Planner(registry('email_draft','send_email'));
  await expect(planner.plan({intent:'email',parameters:{}})).resolves.toBe('email_draft');
 });

 it('يرمي خطأ واضحًا عند عدم وجود تطابق',async()=>{
  const planner=new Planner(registry('send_email'));
  await expect(planner.plan({intent:'non_existent_task',parameters:{}})).rejects.toThrow('No task matches intent: non_existent_task');
 });

 it('يرمي خطأ عندما يكون السجل فارغًا أو الهدف فارغًا',async()=>{
  await expect(new Planner(registry()).plan({intent:'anything',parameters:{}})).rejects.toThrow('No task matches intent: anything');
  await expect(new Planner(registry('send_email')).plan({intent:'',parameters:{}})).rejects.toThrow('No task matches intent:');
 });

 it('لا ينفذ أي مهمة أثناء التخطيط',async()=>{
  let called=false;
  const registry=new TaskRegistry();
  registry.register({id:'side_effect',schema:z.object({}),handler:async()=>{called=true;return {}}});
  await new Planner(registry).plan({intent:'side_effect',parameters:{}});
  expect(called).toBe(false);
 });
});
