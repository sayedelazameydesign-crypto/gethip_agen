import {describe,it,expect,beforeEach,afterEach} from 'vitest';
import type {FastifyInstance} from 'fastify';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {SignJWT} from 'jose';
import {createServer} from './server.js';
import {SQLiteApprovalStore} from '@agent/approval-store';

const policiesDir=fileURLToPath(new URL('../../../policies/approval',import.meta.url));
const SECRET='test-secret-key-for-approvals';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let app:FastifyInstance;
let store:SQLiteApprovalStore;

beforeEach(async()=>{
 process.env.AGENT_POLICIES_DIR=policiesDir;
 process.env.APPROVAL_JWT_SECRET=SECRET;
 process.env.APPROVAL_DB_PATH=':memory:';
 delete process.env.GEMINI_API_KEY;
 store=new SQLiteApprovalStore();
 ({app}=await createServer({approvalStore:store,logger:false}));
});

afterEach(async()=>{
 await app.close();
 store.close();
 delete process.env.APPROVAL_JWT_SECRET;
 delete process.env.AGENT_POLICIES_DIR;
});

function token(claims:Record<string,unknown>,secret=SECRET){
 return new SignJWT(claims).setProtectedHeader({alg:'HS256'}).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(secret));
}
const managerToken=()=>token({sub:'manager-1',role:'manager',scope:'approvals:write'});

async function approvalId(level:1|2|3=2,payload:Record<string,unknown>={},mark=true){
 const record=await store.createApproval({level,payload});
 if(mark) await store.markApproved(record.id,{id:'manager-1',role:'manager'});
 return record.id;
}

describe('نقاط الصحة والبيانات الوصفية',()=>{
 it('GET /health يعيد حالة الخدمة',async()=>{
  const response=await app.inject({method:'GET',url:'/health'});
  expect(response.statusCode).toBe(200);
  expect(response.json()).toEqual({ok:true,service:'arabic-github-agent'});
 });

 it('GET /api/tasks يعرض المهام المسجلة',async()=>{
  const response=await app.inject({method:'GET',url:'/api/tasks'});
  expect(response.statusCode).toBe(200);
  expect(response.json()).toEqual([{id:'send_email',requiredApprovalLevel:undefined}]);
 });

 it('GET /api/policies يعرض السياسات المحمّلة',async()=>{
  const response=await app.inject({method:'GET',url:'/api/policies'});
  expect(response.statusCode).toBe(200);
  expect(response.json()).toEqual({email:{blockedDomains:['spam.com','temp-mail.org'],requireSSL:true}});
 });

 it('يضيف ترويسات CORS',async()=>{
  const response=await app.inject({method:'GET',url:'/health',headers:{origin:'https://example.com'}});
  expect(response.headers['access-control-allow-origin']).toBe('https://example.com');
 });

 it('ينشئ مخزنه الافتراضي (SQLite) عند عدم تمرير مخزن',async()=>{
  process.env.APPROVAL_DB_PATH=':memory:';
  const standalone=await createServer({logger:false});
  const created=await standalone.app.inject({method:'POST',url:'/api/approvals',payload:{level:2,payload:{to:'default@example.com'}}});
  expect(created.statusCode).toBe(201);
  const id=created.json().id;
  expect((await standalone.app.inject({method:'GET',url:`/api/approvals/${id}`})).json()).toMatchObject({id,status:'pending'});
  await standalone.app.close();
 });

 it('يعيد 404 لمسار غير معروف',async()=>{
  const response=await app.inject({method:'GET',url:'/not-here'});
  expect(response.statusCode).toBe(404);
 });
});

describe('دورة التشغيل /api/runs',()=>{
 it('ينشئ تشغيلًا بحالة انتظار الموافقة مع خطة وأدلة',async()=>{
  const response=await app.inject({method:'POST',url:'/api/runs',payload:{repository:'org/repo',request:'أصلح الاختبارات'}});
  expect(response.statusCode).toBe(201);
  const run=response.json();
  expect(run.id).toMatch(UUID);
  expect(run).toMatchObject({repository:'org/repo',request:'أصلح الاختبارات',state:'WAITING_APPROVAL'});
  expect(run.plan.tools.map((t:any)=>t.name)).toEqual(['repo.get','file.read','test.run']);
  expect(run.policy).toHaveLength(3);
  expect(run.policy.every((p:any)=>p.allowed)).toBe(true);
  expect(run.evidence).toMatchObject({runId:run.id,result:'PENDING',gitDiff:''});
  expect(run.createdAt).toBeTypeOf('string');
 });

 it('يرفض طلب تشغيل غير مستوفٍ للعقد',async()=>{
  for(const payload of [{},{repository:'',request:'أصلح'},{repository:'org/repo',request:'ab'},{request:'أصلح'},{repository:'org/repo'}]){
   const response=await app.inject({method:'POST',url:'/api/runs',payload});
   expect(response.statusCode,String(JSON.stringify(payload))).toBe(400);
   expect(response.json()).toHaveProperty('error');
  }
 });

 it('يعرض التشغيلات المنشأة ويسمح باعتمادها وقراءة أدلتها',async()=>{
  const created=await app.inject({method:'POST',url:'/api/runs',payload:{repository:'org/repo',request:'أصلح الاختبارات'}});
  const id=created.json().id;
  expect((await app.inject({method:'GET',url:'/api/runs'})).json()).toHaveLength(1);

  const approved=await app.inject({method:'POST',url:`/api/runs/${id}/approve`});
  expect(approved.statusCode).toBe(200);
  expect(approved.json()).toMatchObject({state:'EXECUTING'});
  expect(approved.json().evidence.result).toBe('PENDING');

  const evidence=await app.inject({method:'GET',url:`/api/runs/${id}/evidence`});
  expect(evidence.statusCode).toBe(200);
  expect(evidence.json()).toMatchObject({runId:id,tools:['repo.get','file.read','test.run']});
 });

 it('يعيد 404 لاعتماد أو أدلة تشغيل غير موجود',async()=>{
  expect((await app.inject({method:'POST',url:`/api/runs/${randomUUID()}/approve`})).statusCode).toBe(404);
  expect((await app.inject({method:'GET',url:`/api/runs/${randomUUID()}/evidence`})).statusCode).toBe(404);
 });
});

describe('إدارة الموافقات /api/approvals',()=>{
 it('ينشئ سجل موافقة معلقًا',async()=>{
  const response=await app.inject({method:'POST',url:'/api/approvals',payload:{level:2,payload:{to:'ok@example.com'},ttlMs:60_000}});
  expect(response.statusCode).toBe(201);
  const record=response.json();
  expect(record).toMatchObject({status:'pending',level:2,payload:{to:'ok@example.com'}});
  expect(record.id).toMatch(UUID);
  expect(Date.parse(record.expiresAt)-Date.parse(record.createdAt)).toBe(60_000);
 });

 it('يرفض إنشاء موافقة بلا مستوى أو حمولة',async()=>{
  for(const payload of [{},{level:2},{payload:{}},{level:0,payload:{}}]){
   const response=await app.inject({method:'POST',url:'/api/approvals',payload});
   expect(response.statusCode,String(JSON.stringify(payload))).toBe(400);
   expect(response.json()).toEqual({error:'level and payload are required'});
  }
 });

 it('يقرأ حالة الموافقة ويعيد 404 لغير الموجود',async()=>{
  const id=await approvalId(2,{},false);
  const response=await app.inject({method:'GET',url:`/api/approvals/${id}`});
  expect(response.statusCode).toBe(200);
  expect(response.json()).toMatchObject({id,status:'pending'});
  expect((await app.inject({method:'GET',url:`/api/approvals/${randomUUID()}`})).statusCode).toBe(404);
 });

 it('يعتمد الموافقة برمز مدير صالح ويسجل المعتمِد',async()=>{
  const id=await approvalId(2,{},false);
  const response=await app.inject({method:'POST',url:`/api/approvals/${id}/approve`,headers:{authorization:`Bearer ${await managerToken()}`}});
  expect(response.statusCode).toBe(200);
  expect(response.json()).toMatchObject({id,status:'approved',approver:{id:'manager-1',role:'manager'}});
  expect((await app.inject({method:'GET',url:`/api/approvals/${id}`})).json().status).toBe('approved');
 });

 it('يرفض الموافقة برمز مدير صالح',async()=>{
  const id=await approvalId(2,{},false);
  const response=await app.inject({method:'POST',url:`/api/approvals/${id}/reject`,headers:{authorization:`Bearer ${await managerToken()}`}});
  expect(response.statusCode).toBe(200);
  expect(response.json()).toMatchObject({status:'rejected',approver:{id:'manager-1',role:'manager'}});
 });

 it('يحمي قرار الموافقة برمز JWT',async()=>{
  const id=await approvalId(2,{},false);
  const cases:Array<[string,Record<string,string>,number,string]>=[
   ['بلا ترويسة',{},401,'Manager JWT required'],
   ['ترويسة بلا Bearer',{authorization:'Basic abc'},401,'Manager JWT required'],
   ['رمز موقّع بمفتاح آخر',{authorization:`Bearer ${await token({sub:'m',role:'manager',scope:'approvals:write'},'wrong-secret')}`},401,'Invalid manager JWT'],
   ['رمز غير صالح',{authorization:'Bearer not.a.jwt'},401,'Invalid manager JWT'],
   ['بدون نطاق',{authorization:`Bearer ${await token({sub:'m',role:'manager'})}`},403,'Insufficient approval scope'],
   ['نطاق خاطئ',{authorization:`Bearer ${await token({sub:'m',role:'manager',scope:'read'})}`},403,'Insufficient approval scope'],
   ['بدون دور',{authorization:`Bearer ${await token({sub:'m',scope:'approvals:write'})}`},403,'Insufficient approval scope'],
   ['بدون معرّف',{authorization:`Bearer ${await token({role:'manager',scope:'approvals:write'})}`},403,'Insufficient approval scope']
  ];
  for(const [name,headers,status,error] of cases){
   const response=await app.inject({method:'POST',url:`/api/approvals/${id}/approve`,headers});
   expect(response.statusCode,name).toBe(status);
   expect(response.json(),name).toEqual({error});
  }
  expect((await app.inject({method:'GET',url:`/api/approvals/${id}`})).json().status).toBe('pending');
 });

 it('يرفض القرار عند غياب سر JWT في البيئة',async()=>{
  delete process.env.APPROVAL_JWT_SECRET;
  const id=await approvalId(2,{},false);
  const response=await app.inject({method:'POST',url:`/api/approvals/${id}/approve`,headers:{authorization:`Bearer ${await managerToken()}`}});
  expect(response.statusCode).toBe(401);
  expect(response.json()).toEqual({error:'Manager JWT required'});
 });

 it('يعيد 409 عند تكرار القرار أو عدم وجود السجل',async()=>{
  const id=await approvalId();
  const headers={authorization:`Bearer ${await managerToken()}`};
  expect((await app.inject({method:'POST',url:`/api/approvals/${id}/approve`,headers})).statusCode).toBe(409);
  expect((await app.inject({method:'POST',url:`/api/approvals/${randomUUID()}/approve`,headers})).statusCode).toBe(409);
  expect((await app.inject({method:'POST',url:`/api/approvals/${randomUUID()}/reject`,headers})).statusCode).toBe(409);
 });
});

describe('تشغيل الوكيل /agent/run',()=>{
 it('ينفذ مهمة معتمدة ويعيد تقريرًا',async()=>{
  const id=await approvalId(2,{to:'valid@example.com'});
  const response=await app.inject({method:'POST',url:'/agent/run',payload:{intent:'send_email',parameters:{to:'valid@example.com',subject:'مرحبا',body:'محتوى',approvalId:id}}});
  expect(response.statusCode).toBe(200);
  const report=response.json();
  expect(report.success).toBe(true);
  expect(report.agentId).toBe('gethip-agent');
  expect(report.steps[0]).toMatchObject({taskId:'send_email',status:'executed'});
  expect(report.steps[0].evidence).toHaveProperty('email_logs');
 });

 it('يبلّغ عن رفض بوابة الموافقة دون كشفه كنجاح',async()=>{
  const response=await app.inject({method:'POST',url:'/agent/run',payload:{intent:'send_email',parameters:{to:'valid@example.com'}}});
  expect(response.statusCode).toBe(200);
  const report=response.json();
  expect(report.success).toBe(false);
  expect(report.summary).toContain('Level 2+ requires a valid approved approvalId.');
 });

 it('يمنع النطاق المحظور بالسياسة',async()=>{
  const id=await approvalId();
  const response=await app.inject({method:'POST',url:'/agent/run',payload:{intent:'send_email',parameters:{to:'spam@spam.com',approvalId:id}}});
  expect(response.json().summary).toContain('Domain spam.com is blocked by policy.');
 });

 it('يرفض طلب تشغيل بلا هدف أو معاملات',async()=>{
  for(const payload of [{},{intent:'send_email'},{parameters:{to:'a@b.com'}}]){
   const response=await app.inject({method:'POST',url:'/agent/run',payload});
   expect(response.statusCode,String(JSON.stringify(payload))).toBe(400);
   expect(response.json()).toEqual({error:'intent and parameters are required'});
  }
 });
});

describe('بثّ التشغيل /agent/run/stream',()=>{
 async function stream(payload:unknown){
  await app.listen({port:0,host:'127.0.0.1'});
  const address=app.server.address();
  const port=typeof address==='object'&&address?address.port:0;
  try{
   const response=await fetch(`http://127.0.0.1:${port}/agent/run/stream`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});
   return {response,text:await response.text()};
  } finally{
   await app.close();
  }
 }

 it('يرسل أحداث حالة ثم النتيجة',async()=>{
  const id=await approvalId(2,{to:'valid@example.com'});
  const {response,text}=await stream({intent:'send_email',parameters:{to:'valid@example.com',subject:'بثّ',approvalId:id}});
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toContain('text/event-stream');
  expect(text).toContain('event: status');
  expect(text).toContain('جاري اختيار المهمة');
  expect(text).toContain('event: result');
  expect(text).toContain('event: done');
  expect(text).toContain('"success":true');
 });

 it('يرسل حدث نتيجة فاشلة عند رفض الموافقة',async()=>{
  const {text}=await stream({intent:'send_email',parameters:{to:'valid@example.com'}});
  expect(text).toContain('event: done');
  expect(text).toContain('"success":false');
  expect(text).toContain('Level 2+ requires a valid approved approvalId.');
 });

 it('يرسل 400 لبثّ بلا هدف أو معاملات',async()=>{
  const {response,text}=await stream({parameters:{to:'a@b.com'}});
  expect(response.status).toBe(400);
  expect(text).toContain('intent and parameters are required');
 });
});
