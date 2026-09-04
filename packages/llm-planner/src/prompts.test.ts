import {describe,it,expect} from 'vitest';
import {buildSystemPrompt,buildUserPrompt} from './prompts/planner.prompt.js';
import {z} from 'zod';
import type {ITaskDefinition} from '@agent/contracts';

const task=(id:string,schema=z.object({})):ITaskDefinition=>({id,schema,handler:async()=>({})});

describe('buildSystemPrompt',()=>{
 it('يذكر كل معرفات المهام المسموحة مع مخططاتها',()=>{
  const prompt=buildSystemPrompt([task('send_email',z.object({to:z.string()})),task('open_pr')]);
  expect(prompt).toContain('taskId: send_email');
  expect(prompt).toContain('taskId: open_pr');
  expect(prompt).toContain('input schema');
 });

 it('يضمن قواعد الأمان في تعليمات النظام',()=>{
  const prompt=buildSystemPrompt([task('send_email')]);
  expect(prompt).toContain('never invent a task');
  expect(prompt).toContain('never make approval or execution decisions');
  expect(prompt).toContain('parameters must be validated by the runtime');
  expect(prompt).toContain('JSON only');
 });

 it('يعمل مع قائمة مهام فارغة',()=>{
  const prompt=buildSystemPrompt([]);
  expect(prompt).toContain('never invent a task');
 });
});

describe('buildUserPrompt',()=>{
 it('يضع نص طلب المستخدم في القالب',()=>{
  expect(buildUserPrompt('أرسل بريدًا للعميل')).toBe('User request: أرسل بريدًا للعميل');
  expect(buildUserPrompt('')).toBe('User request: ');
 });
});
