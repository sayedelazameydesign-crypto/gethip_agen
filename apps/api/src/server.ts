import Fastify from 'fastify';
import type {FastifyInstance} from 'fastify';
import cors from '@fastify/cors';
import {randomUUID} from 'node:crypto';
import {mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {CreateRunRequest} from '@agent/contracts';
import {createPlan,evidence,policySummary,initAgent} from '@agent/core';
import {ExamplePlugin} from '@agent/plugin-example';
import {createOrchestrator} from '@agent/orchestrator';
import {SQLiteApprovalStore,TursoApprovalStore} from '@agent/approval-store';
import type {ApprovalStore} from '@agent/approval-store';
import {jwtVerify} from 'jose';

export type ServerOptions={approvalStore?:ApprovalStore;logger?:boolean};

export type ServerBundle={
 app:FastifyInstance;
 agent:{taskRegistry:{getAll():Array<{id:string;requiredApprovalLevel?:1|2|3}>};policies:Record<string,unknown>};
 approvalStore:ApprovalStore;
 orchestrator:{run:(goal:{intent:string;parameters:Record<string,unknown>;context?:Record<string,unknown>})=>Promise<any>};
 runs:Map<string,any>;
};

export async function createServer(options:ServerOptions={}):Promise<ServerBundle>{
 const app=Fastify({logger:options.logger??true});
 await app.register(cors,{origin:true});
 const runs=new Map<string,any>();
 const dbPath=process.env.APPROVAL_DB_PATH||'./data/approvals.sqlite';
 mkdirSync(dirname(dbPath),{recursive:true});
 const approvalStore=options.approvalStore
  ??(process.env.TURSO_DATABASE_URL&&process.env.TURSO_AUTH_TOKEN?new TursoApprovalStore():new SQLiteApprovalStore(dbPath));
 const agent=await initAgent({plugins:[ExamplePlugin],policiesDir:process.env.AGENT_POLICIES_DIR||'./policies/approval',approvalStore});
 const orchestrator=await createOrchestrator([ExamplePlugin],process.env.GEMINI_API_KEY,approvalStore,process.env.AGENT_POLICIES_DIR);

 app.get('/health',async()=>({ok:true,service:'arabic-github-agent'}));
 app.get('/api/runs',async()=>Array.from(runs.values()));
 app.get('/api/tasks',async()=>agent.taskRegistry.getAll().map(t=>({id:t.id,requiredApprovalLevel:t.requiredApprovalLevel})));
 app.get('/api/policies',async()=>agent.policies);
 app.post('/api/approvals',async(req,reply)=>{const input=(req.body||{}) as {level?:1|2|3;payload?:Record<string,unknown>;ttlMs?:number};if(!input.level||!input.payload)return reply.code(400).send({error:'level and payload are required'});return reply.code(201).send(await approvalStore.createApproval({level:input.level,payload:input.payload,ttlMs:input.ttlMs}))});
 app.get('/api/approvals/:id',async(req,reply)=>{const record=await approvalStore.getApprovalStatus((req.params as any).id);return record||reply.code(404).send({error:'Approval not found'})});

 const authorize=async(req:any)=>{
  const auth=String(req.headers.authorization||'');
  if(!process.env.APPROVAL_JWT_SECRET||!auth.startsWith('Bearer '))return {status:401 as const,body:{error:'Manager JWT required'}};
  let claims:any;
  try{claims=(await jwtVerify(auth.slice(7),new TextEncoder().encode(process.env.APPROVAL_JWT_SECRET))).payload}
  catch{return {status:401 as const,body:{error:'Invalid manager JWT'}}};
  if(claims.scope!=='approvals:write'||typeof claims.sub!=='string'||typeof claims.role!=='string')return {status:403 as const,body:{error:'Insufficient approval scope'}};
  return {status:200 as const,approver:{id:claims.sub,role:claims.role}};
 };

 app.post('/api/approvals/:id/approve',async(req,reply)=>{const auth=await authorize(req);if(auth.status!==200)return reply.code(auth.status).send(auth.body);try{return await approvalStore.markApproved((req.params as any).id,auth.approver!)}catch(error){return reply.code(409).send({error:String(error)})}});
 app.post('/api/approvals/:id/reject',async(req,reply)=>{const auth=await authorize(req);if(auth.status!==200)return reply.code(auth.status).send(auth.body);try{return await approvalStore.markRejected((req.params as any).id,auth.approver!)}catch(error){return reply.code(409).send({error:String(error)})}});
 app.post('/agent/run',async(req,reply)=>{const goal=(req.body||{}) as {intent?:string;parameters?:Record<string,unknown>;context?:Record<string,unknown>};if(!goal.intent||!goal.parameters)return reply.code(400).send({error:'intent and parameters are required'});return orchestrator.run({intent:goal.intent,parameters:goal.parameters,context:goal.context})});
 app.post('/agent/run/stream',async(req,reply)=>{const goal=(req.body||{}) as {intent?:string;parameters?:Record<string,unknown>;context?:Record<string,unknown>};if(!goal.intent||!goal.parameters)return reply.code(400).send({error:'intent and parameters are required'});reply.hijack();reply.raw.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache, no-transform','Connection':'keep-alive'});const send=(event:string,data:unknown)=>reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);send('status',{stage:'planning',message:'جاري اختيار المهمة'});send('status',{stage:'executing',message:'جاري التنفيذ عبر بوابة الموافقة'});try{const report=await orchestrator.run({intent:goal.intent,parameters:goal.parameters,context:goal.context});send('result',report);send('done',{success:report.success})}catch(error){send('error',{message:String(error)})}reply.raw.end()});
 app.post('/api/runs',async(req,reply)=>{const parsed=CreateRunRequest.safeParse(req.body);if(!parsed.success)return reply.code(400).send({error:parsed.error.flatten()});const id=randomUUID();const plan=createPlan(parsed.data.request,parsed.data.repository);const run={id,...parsed.data,state:'WAITING_APPROVAL',plan,policy:policySummary(plan),evidence:evidence(id,parsed.data.request,plan,'WAITING_APPROVAL'),createdAt:new Date().toISOString()};runs.set(id,run);return reply.code(201).send(run)});
 app.post('/api/runs/:id/approve',async(req,reply)=>{const run=runs.get((req.params as any).id);if(!run)return reply.code(404).send({error:'Run not found'});run.state='EXECUTING';run.evidence.result='PENDING';return run});
 app.get('/api/runs/:id/evidence',async(req,reply)=>{const run=runs.get((req.params as any).id);return run?run.evidence:reply.code(404).send({error:'Run not found'})});

 return {app,agent,approvalStore,orchestrator,runs};
}

export default createServer;

const isMainModule=process.argv[1]!==undefined&&import.meta.url===pathToFileURL(process.argv[1]).href;
if(isMainModule){
 const {app}=await createServer();
 try{await app.listen({port:Number(process.env.PORT||3001),host:'0.0.0.0'})}
 catch(error){app.log.error(error);process.exit(1)}
}
