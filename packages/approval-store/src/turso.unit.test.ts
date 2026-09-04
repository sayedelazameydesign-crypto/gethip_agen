// اختبارات وحدة لمهايئ Turso: مقلَّدات فقط، بلا أي قاعدة بيانات حقيقية.
// السلوك الحقيقي (قراءة/كتابة/تحديث) مكانه tests/stores.integration.test.ts في الجذر،
// ويُنفَّذ مقابل libSQL حقيقي (file:) وSQLite معًا.
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

describe('TursoApprovalStore — وحدة (مقلَّد)',()=>{
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

 it('يقبل رابطًا ورمزًا مُمرَّرين صراحةً',async()=>{
  delete process.env.TURSO_DATABASE_URL;
  delete process.env.TURSO_AUTH_TOKEN;
  const store=new TursoApprovalStore('libsql://explicit.turso.io','explicit-token');
  expect(createClient).toHaveBeenCalledWith({url:'libsql://explicit.turso.io',authToken:'explicit-token'});
  await store.createApproval({level:1,payload:{}});
 });

 it('يهيئ الجدول مرة واحدة فقط (تحميل كسول)',async()=>{
  const store=new TursoApprovalStore();
  await store.createApproval({level:1,payload:{}});
  await store.createApproval({level:2,payload:{}});
  expect(fake.sqls.filter(sql=>sql.startsWith('CREATE TABLE'))).toHaveLength(1);
 });

 it('يُسقط حقول المعتمِد عندما تكون فارغة (تحويل الصف)',async()=>{
  const store=new TursoApprovalStore();
  const record=await store.createApproval({level:2,payload:{to:'a@b.com'}});
  const fetched=await store.getApprovalStatus(record.id);
  expect(fetched).toMatchObject({id:record.id,status:'pending',level:2,payload:{to:'a@b.com'}});
  expect(fetched?.approver).toBeUndefined();
  expect(fetched?.decidedAt).toBeUndefined();
 });

 it('يعيد null ولا يعتبره معتمدًا عند غياب الصف',async()=>{
  const store=new TursoApprovalStore();
  expect(await store.getApprovalStatus('missing')).toBeNull();
  expect(await store.verifyApproved('missing')).toBe(false);
 });
});
