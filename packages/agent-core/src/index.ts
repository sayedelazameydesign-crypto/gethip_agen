import {evaluateTool} from '@agent/security';
import type {Evidence,Plan,RunState} from '@agent/contracts';
export function createPlan(request:string,repository:string):Plan { return {summary:`فحص ${repository}: ${request}`,steps:['قراءة بنية المستودع','تحليل سبب المشكلة','اقتراح التغيير','تشغيل الاختبارات','إعداد Evidence'],tools:[{name:'repo.get',input:{repository}},{name:'file.read',input:{repository}},{name:'test.run',input:{repository}}]};}
export function nextState(state:RunState,approval=false):RunState { if(state==='PLANNED') return 'RUNNING'; if(state==='RUNNING') return 'WAITING_APPROVAL'; if(state==='WAITING_APPROVAL') return approval?'EXECUTING':'CANCELLED'; if(state==='EXECUTING') return 'VERIFYING'; if(state==='VERIFYING') return 'COMPLETED'; return state; }
export function policySummary(plan:Plan){return plan.tools.map(t=>({tool:t.name,...evaluateTool(t)}));}
export function evidence(runId:string,request:string,plan:Plan,state:RunState):Evidence{return {runId,request,plan:plan.steps,tools:plan.tools.map(t=>t.name),filesChanged:[],commands:[],tests:[],gitDiff:'',result:state==='COMPLETED'?'SUCCESS':'PENDING'};}
