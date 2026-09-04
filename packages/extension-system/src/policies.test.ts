import {describe,it,expect,beforeEach,afterEach} from 'vitest';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {loadPoliciesFromDir,initializePlugins,TaskRegistry,StrategyRegistry} from './index.js';
import {z} from 'zod';
import type {IPlugin} from '@agent/contracts';

let dir:string;
beforeEach(()=>{dir=mkdtempSync(join(tmpdir(),'agent-policies-'))});
afterEach(()=>{rmSync(dir,{recursive:true,force:true})});

const task={id:'demo',schema:z.object({}),handler:async()=>({ok:true})};

describe('loadPoliciesFromDir',()=>{
 it('يحمّل ملفات JSON و YAML و YML ويتجاهل الأنواع الأخرى',async()=>{
  writeFileSync(join(dir,'email.json'),'{"blockedDomains":["spam.com"]}');
  writeFileSync(join(dir,'limits.yaml'),'maxRecipients: 10');
  writeFileSync(join(dir,'extra.yml'),'enabled: true');
  writeFileSync(join(dir,'README.md'),'not a policy');
  writeFileSync(join(dir,'notes.txt'),'not a policy');
  const policies=await loadPoliciesFromDir(dir);
  expect(Object.keys(policies).sort()).toEqual(['email','extra','limits']);
  expect(policies.email).toEqual({blockedDomains:['spam.com']});
  expect(policies.limits).toEqual({maxRecipients:10});
  expect(policies.extra).toEqual({enabled:true});
 });

 it('يعيد كائنًا فارغًا عند غياب المجلد',async()=>{
  expect(await loadPoliciesFromDir(join(dir,'missing','deep'))).toEqual({});
 });

 it('يعيد كائنًا فارغًا لمجلد فارغ',async()=>{
  expect(await loadPoliciesFromDir(dir)).toEqual({});
 });

 it('يعيد الخطأ عندما يكون المسار ملفًا لا مجلدًا',async()=>{
  const file=join(dir,'single.json'); writeFileSync(file,'{}');
  await expect(loadPoliciesFromDir(file)).rejects.toThrow();
 });

 it('ينشر خطأ JSON غير صالح بدل كتمه',async()=>{
  writeFileSync(join(dir,'broken.json'),'{not json');
  await expect(loadPoliciesFromDir(dir)).rejects.toThrow();
 });
});

describe('السجلات والتوصيل',()=>{
 it('يمنع تسجيل مهمة مكررة ويُبقي النسخة الأولى',()=>{
  const registry=new TaskRegistry();
  registry.register(task);
  expect(()=>registry.register({...task,handler:async()=>({other:true})})).toThrow('Task demo already registered.');
  expect(registry.get('demo')).toBe(task);
  expect(registry.getAll()).toHaveLength(1);
 });

 it('يمنع تسجيل استراتيجية مكررة',()=>{
  const registry=new StrategyRegistry();
  registry.register({id:'audit',collect:async()=>({})});
  expect(()=>registry.register({id:'audit',collect:async()=>({})})).toThrow('Strategy audit already registered.');
 });

 it('يعيد undefined لمعرف غير مسجل',()=>{
  expect(new TaskRegistry().get('nope')).toBeUndefined();
  expect(new StrategyRegistry().get('nope')).toBeUndefined();
 });
});

describe('initializePlugins',()=>{
 it('يسجل مهام واستراتيجيات الإضافات ويعيد السياسات',async()=>{
  writeFileSync(join(dir,'email.json'),'{"blockedDomains":["spam.com"]}');
  const plugin:IPlugin={name:'p',version:'1.0.0',register(ctx){
   ctx.registerTask({...task,requiredApprovalLevel:2});
   ctx.registerEvidenceStrategy({id:'audit',collect:async d=>({seen:true,data:d})});
  }};
  const tasks=new TaskRegistry(); const strategies=new StrategyRegistry();
  const {policies}=await initializePlugins([plugin],tasks,strategies,dir);
  expect(tasks.get('demo')?.requiredApprovalLevel).toBe(2);
  expect(strategies.get('audit')).toBeDefined();
  expect(policies).toEqual({email:{blockedDomains:['spam.com']}});
 });

 it('ينتظر التسجيل غير المتزامن',async()=>{
  const plugin:IPlugin={name:'async',version:'1.0.0',async register(ctx){await new Promise(r=>setTimeout(r,5));ctx.registerTask(task)}};
  const tasks=new TaskRegistry(); const strategies=new StrategyRegistry();
  await initializePlugins([plugin],tasks,strategies,dir);
  expect(tasks.getAll()).toHaveLength(1);
 });

 it('يعرّض loadPolicies داخل سياق الإضافة',async()=>{
  writeFileSync(join(dir,'limits.yaml'),'max: 5');
  let seen:Record<string,unknown>|undefined;
  const plugin:IPlugin={name:'ctx',version:'1.0.0',async register(ctx){seen=await ctx.loadPolicies(dir)}};
  await initializePlugins([plugin],new TaskRegistry(),new StrategyRegistry(),dir);
  expect(seen).toEqual({limits:{max:5}});
 });

 it('ينشر خطأ التكرار الناشئ داخل الإضافة',async()=>{
  const plugin:IPlugin={name:'dup',version:'1.0.0',register(ctx){ctx.registerTask(task);ctx.registerTask(task)}};
  await expect(initializePlugins([plugin],new TaskRegistry(),new StrategyRegistry(),dir)).rejects.toThrow('already registered');
 });

 it('يعيد سجلات فارغة وسياسات فارغة بدون إضافات',async()=>{
  const tasks=new TaskRegistry(); const strategies=new StrategyRegistry();
  const result=await initializePlugins([],tasks,strategies,join(dir,'missing'));
  expect(result.taskRegistry.getAll()).toEqual([]);
  expect(result.strategyRegistry.getAll()).toEqual([]);
  expect(result.policies).toEqual({});
 });

 it('يستخدم مجلد السياسات الافتراضي عند عدم تمرير مسار',async()=>{
  const result=await initializePlugins([],new TaskRegistry(),new StrategyRegistry());
  expect(result.policies).toEqual({});
 });
});
