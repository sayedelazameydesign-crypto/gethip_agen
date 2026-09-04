import {describe,it,expect,beforeEach,afterEach,vi} from 'vitest';
import {createClient} from '@libsql/client';

const fake=vi.hoisted(()=>{
 const rows:any[]=[];
 const sqls:string[]=[];
 return {rows,sqls};
});

vi.mock('@libsql/client',()=>({
 createClient:vi.fn((config:any)=>({
  execute:async(query:any)=>{
   const sql:string=typeof query==='string'?query:query.sql;
   const args:any[]=typeof query==='string'?[]:(query.args??[]);
   fake.sqls.push(sql);
   if(sql.startsWith('CREATE TABLE'))return {rows:[]};
   if(sql.startsWith('INSERT')){
    const [id,status,level,payload,createdAt,expiresAt]=args;
    fake.rows.push({id,status,level,payload,created_at:createdAt,expires_at:expiresAt,approver_id:null,approver_role:null,decided_at:null});
    return {rows:[]};
   }
   if(sql.startsWith('SELECT')){
    const [id]=args;
    return {rows:fake.rows.filter(row=>row.id===id).map(row=>({...row}))};
   }
   if(sql.startsWith('UPDATE')){
    if(sql.includes("status='expired'")){
     const [id]=args;
     const row=fake.rows.find(r=>r.id===id);
     if(row&&row.status==='pending')row.status='expired';
     return {rows:[]};
    }
    const [status,approverId,approverRole,decidedAt,id,expectedStatus]=args;
    const row=fake.rows.find(r=>r.id===id);
    if(row&&row.status===expectedStatus){row.status=status;row.approver_id=approverId;row.approver_role=approverRole;row.decided_at=decidedAt}
    return {rows:[]};
   }
   throw new Error(`Unexpected SQL: ${sql}`);
  }
 }))
}));

const {TursoApprovalStore}=await import('./turso.js');

describe('TursoApprovalStore',()=>{
 beforeEach(()=>{
  fake.rows.length=0; fake.sqls.length=0; vi.clearAllMocks();
  process.env.TURSO_DATABASE_URL='libsql://demo.turso.io';
  process.env.TURSO_AUTH_TOKEN='token-123';
 });
 afterEach(()=>{delete process.env.TURSO_DATABASE_URL;delete process.env.TURSO_AUTH_TOKEN});

 it('يرفض الإنشاء دون بيانات اعتماد كاملة',()=>{
  delete process.env.TURSO_AUTH_TOKEN;
  expect(()=>new TursoApprovalStore()).toThrow('Turso credentials are required');
  process.env.TURSO_AUTH_TOKEN='token-123';
  delete process.env.TURSO_DATABASE_URL;
  expect(()=>new TursoApprovalStore()).toThrow('Turso credentials are required');
 });

 it('ينشئ العميل بالرابط والرمز من البيئة',async()=>{
  const store=new TursoApprovalStore();
  expect(createClient).toHaveBeenCalledWith({url:'libsql://demo.turso.io',authToken:'token-123'});
  await store.createApproval({level:1,payload:{}});
 });

 it('يهيئ الجدول مرة واحدة فقط',async()=>{
  const store=new TursoApprovalStore();
  await store.createApproval({level:1,payload:{}});
  await store.createApproval({level:2,payload:{}});
  expect(fake.sqls.filter(sql=>sql.startsWith('CREATE TABLE'))).toHaveLength(1);
 });

 it('ينشئ سجلًا معلقًا ويقرأه مع الحمولة',async()=>{
  const store=new TursoApprovalStore();
  const record=await store.createApproval({level:3,payload:{to:'a@b.com',meta:{n:1}}});
  expect(record.status).toBe('pending');
  const fetched=await store.getApprovalStatus(record.id);
  expect(fetched).toMatchObject({id:record.id,status:'pending',level:3,payload:{to:'a@b.com',meta:{n:1}}});
  expect(fetched?.approver).toBeUndefined();
  expect(Date.parse(record.expiresAt)-Date.parse(record.createdAt)).toBe(300_000);
 });

 it('يحترم ttl مخصصًا ويعلّم السجل منتهيًا',async()=>{
  const store=new TursoApprovalStore();
  const record=await store.createApproval({level:2,payload:{},ttlMs:1});
  await new Promise(r=>setTimeout(r,5));
  expect(await store.verifyApproved(record.id)).toBe(false);
  expect((await store.getApprovalStatus(record.id))?.status).toBe('expired');
 });

 it('يسجل بيانات المعتمِد ويتحقق من الاعتماد',async()=>{
  const store=new TursoApprovalStore();
  const record=await store.createApproval({level:2,payload:{to:'ok@example.com'}});
  expect(await store.verifyApproved(record.id)).toBe(false);
  const approved=await store.markApproved(record.id,{id:'manager-1',role:'manager'});
  expect(approved.status).toBe('approved');
  expect(approved.approver).toEqual({id:'manager-1',role:'manager'});
  expect(approved.decidedAt).toBeTypeOf('string');
  expect(await store.verifyApproved(record.id)).toBe(true);
 });

 it('يسجل الرفض ولا يعتبره اعتمادًا',async()=>{
  const store=new TursoApprovalStore();
  const record=await store.createApproval({level:2,payload:{}});
  const rejected=await store.markRejected(record.id,{id:'manager-2',role:'security'});
  expect(rejected.status).toBe('rejected');
  expect(rejected.approver).toEqual({id:'manager-2',role:'security'});
  expect(await store.verifyApproved(record.id)).toBe(false);
 });

 it('يمنع القرار المزدوج',async()=>{
  const store=new TursoApprovalStore();
  const record=await store.createApproval({level:2,payload:{}});
  await store.markApproved(record.id,{id:'m',role:'manager'});
  await expect(store.markApproved(record.id,{id:'m',role:'manager'})).rejects.toThrow('Approval cannot be approved: approved');
  await expect(store.markRejected(record.id,{id:'m',role:'manager'})).rejects.toThrow('Approval cannot be rejected: approved');
 });

 it('يرفض القرار على سجل غير موجود',async()=>{
  const store=new TursoApprovalStore();
  await expect(store.markApproved('missing',{id:'m',role:'manager'})).rejects.toThrow('Approval cannot be approved: not_found');
  expect(await store.getApprovalStatus('missing')).toBeNull();
  expect(await store.verifyApproved('missing')).toBe(false);
 });

 it('يعتبر الاعتماد منتهيًا بعد تجاوز expiresAt',async()=>{
  const store=new TursoApprovalStore();
  const record=await store.createApproval({level:2,payload:{},ttlMs:30});
  await store.markApproved(record.id,{id:'m',role:'manager'});
  expect(await store.verifyApproved(record.id)).toBe(true);
  await new Promise(r=>setTimeout(r,40));
  expect(await store.verifyApproved(record.id)).toBe(false);
 });
});
