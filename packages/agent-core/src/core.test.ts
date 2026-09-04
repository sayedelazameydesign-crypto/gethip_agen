import {describe,it,expect} from 'vitest';
import {createPlan,nextState,policySummary,evidence} from './index.js';
import type {RunState} from '@agent/contracts';

describe('createPlan',()=>{
 it('ينتج خطة قراءة آمنة تحمل اسم المستودع والطلب',()=>{
  const plan=createPlan('أصلح الاختبارات','org/repo');
  expect(plan.summary).toContain('org/repo');
  expect(plan.summary).toContain('أصلح الاختبارات');
  expect(plan.steps.length).toBeGreaterThan(0);
  expect(plan.tools.map(t=>t.name)).toEqual(['repo.get','file.read','test.run']);
  for(const tool of plan.tools) expect(tool.input).toEqual({repository:'org/repo'});
 });
});

describe('nextState',()=>{
 it('يسير في المسار السعيد خطوة بخطوة',()=>{
  const path:RunState[]=['PLANNED'];
  let state:RunState='PLANNED';
  state=nextState(state); path.push(state);            // RUNNING
  state=nextState(state); path.push(state);            // WAITING_APPROVAL
  state=nextState(state,true); path.push(state);       // EXECUTING
  state=nextState(state); path.push(state);            // VERIFYING
  state=nextState(state); path.push(state);            // COMPLETED
  expect(path).toEqual(['PLANNED','RUNNING','WAITING_APPROVAL','EXECUTING','VERIFYING','COMPLETED']);
 });

 it('يلغي التشغيل عند رفض الموافقة',()=>{
  expect(nextState('WAITING_APPROVAL')).toBe('CANCELLED');
  expect(nextState('WAITING_APPROVAL',false)).toBe('CANCELLED');
 });

 it('يتجاهل عَلَم الموافقة خارج مرحلة الانتظار',()=>{
  expect(nextState('PLANNED',true)).toBe('RUNNING');
  expect(nextState('RUNNING',true)).toBe('WAITING_APPROVAL');
  expect(nextState('EXECUTING',true)).toBe('VERIFYING');
  expect(nextState('VERIFYING',true)).toBe('COMPLETED');
 });

 it('يجعل الحالات النهائية ثابتة',()=>{
  for(const state of ['COMPLETED','FAILED','CANCELLED'] as RunState[]){
   expect(nextState(state)).toBe(state);
   expect(nextState(state,true)).toBe(state);
  }
 });
});

describe('policySummary',()=>{
 it('يصنّف أدوات الخطة المقترحة',()=>{
  const summary=policySummary(createPlan('x','org/repo'));
  expect(summary).toHaveLength(3);
  for(const entry of summary){
   expect(entry.allowed).toBe(true);
   expect(entry.requiresApproval).toBe(false);
   expect(entry.reason).toBe('قراءة آمنة تلقائيًا');
  }
  expect(summary.map(e=>e.tool)).toEqual(['repo.get','file.read','test.run']);
 });

 it('يعلّم أداة تعديل بأنها تحتاج موافقة',()=>{
  const [entry]=policySummary({summary:'s',steps:[],tools:[{name:'file.write',input:{}}]});
  expect(entry).toMatchObject({tool:'file.write',allowed:true,requiresApproval:true});
 });

 it('يرفض أداة غير مسجلة داخل الملخص',()=>{
  const [entry]=policySummary({summary:'s',steps:[],tools:[{name:'rm.everything',input:{}}]});
  expect(entry).toMatchObject({allowed:false,requiresApproval:false});
 });
});

describe('evidence',()=>{
 it('يبني دليلًا معلقًا للحالات غير المكتملة',()=>{
  const plan=createPlan('طلب','org/repo');
  for(const state of ['PLANNED','RUNNING','WAITING_APPROVAL','EXECUTING','VERIFYING','CANCELLED'] as RunState[]){
   const record=evidence('run-1','طلب',plan,state);
   expect(record).toMatchObject({runId:'run-1',request:'طلب',plan:plan.steps,tools:['repo.get','file.read','test.run'],filesChanged:[],commands:[],tests:[],gitDiff:'',result:'PENDING'});
  }
 });

 it('يعلّم الدليل ناجحًا عند اكتمال التشغيل',()=>{
  const plan=createPlan('طلب','org/repo');
  expect(evidence('run-2','طلب',plan,'COMPLETED').result).toBe('SUCCESS');
 });
});
