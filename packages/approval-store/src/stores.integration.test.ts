// اختبارات تكامل حقيقية: تُشغَّل منظومة سلوك واحدة (conformance suite) على مخزنين
// فعليين: SQLite (better-sqlite3) وTurso/libSQL عبر @libsql/client الحقيقي على رابط file:.
// الهدف إثبات أن واجهة ApprovalStore تكافئ نفس السلوك فوق محركين مختلفين،
// دون أي مقلَّد لقاعدة البيانات.
import {describe,it,expect,beforeEach,afterEach} from 'vitest';
import {mkdtempSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createClient} from '@libsql/client';
import {SQLiteApprovalStore,TursoApprovalStore} from './index.js';
import type {ApprovalStore} from './index.js';

let dir:string;
let cleanup:Array<()=>void|Promise<void>>=[];

beforeEach(()=>{
 dir=mkdtempSync(join(tmpdir(),'approval-store-it-'));
 cleanup=[];
});
afterEach(async()=>{
 for(const close of cleanup) await close();
 cleanup=[];
 rmSync(dir,{recursive:true,force:true});
});

type Factory={
 name:string;
 create:()=>ApprovalStore;
 dispose?:()=>void|Promise<void>;
};

const factories:Factory[]=[
 {
  name:'SQLite (better-sqlite3 على ملف حقيقي)',
  create:()=>{
   const store=new SQLiteApprovalStore(join(dir,'approvals.sqlite'));
   cleanup.push(()=>store.close());
   return store;
  }
 },
 {
  name:'Turso/libSQL (@libsql/client حقيقي على file:)',
  create:()=>{
   // الرابط file: يستخدم نفس محرك libSQL محليًا، لذا التكامل حقيقي بلا شبكة.
   process.env.TURSO_DATABASE_URL=`file://${join(dir,'approvals.db')}`;
   process.env.TURSO_AUTH_TOKEN='local-file-token';
   const store=new TursoApprovalStore();
   cleanup.push(async()=>{
    delete process.env.TURSO_DATABASE_URL;
    delete process.env.TURSO_AUTH_TOKEN;
   });
   return store;
  }
 }
];

for(const factory of factories){
 describe(`ApprovalStore — تكامل حقيقي: ${factory.name}`,()=>{
  let store:ApprovalStore;

  beforeEach(()=>{
   if(factory.name.startsWith('Turso')){
    process.env.TURSO_DATABASE_URL=`file://${join(dir,'approvals.db')}`;
    process.env.TURSO_AUTH_TOKEN='local-file-token';
   }
   store=factory.create();
  });

  afterEach(async()=>{
   await factory.dispose?.();
   delete process.env.TURSO_DATABASE_URL;
   delete process.env.TURSO_AUTH_TOKEN;
  });

  it('ينشئ سجلًا معلقًا بمدة افتراضية 5 دقائق ويقرأه',async()=>{
   const before=Date.now();
   const record=await store.createApproval({level:2,payload:{to:'a@b.com'}});
   expect(record.status).toBe('pending');
   expect(record.level).toBe(2);
   const ttl=Date.parse(record.expiresAt)-before;
   expect(ttl).toBeGreaterThanOrEqual(299_000);
   expect(ttl).toBeLessThan(301_000);

   const fetched=await store.getApprovalStatus(record.id);
   expect(fetched).toMatchObject({id:record.id,status:'pending',level:2,payload:{to:'a@b.com'}});
   expect(fetched?.approver).toBeUndefined();
   expect(fetched?.decidedAt).toBeUndefined();
  });

  it('يحترم ttl مخصصًا ويحسب expiresAt بدقة',async()=>{
   const record=await store.createApproval({level:3,payload:{},ttlMs:10_000});
   expect(Date.parse(record.expiresAt)-Date.parse(record.createdAt)).toBe(10_000);
   expect((await store.getApprovalStatus(record.id))?.status).toBe('pending');
  });

  it('يحفظ حمولة معقدة نصيًا دون فقدان',async()=>{
   const payload={to:'a@b.com',meta:{tags:['x','y'],count:3},nested:{deep:{ok:true}}};
   const record=await store.createApproval({level:3,payload});
   expect((await store.getApprovalStatus(record.id))?.payload).toEqual(payload);
  });

  it('لا يعتبر السجل المعلق معتمدًا',async()=>{
   const record=await store.createApproval({level:2,payload:{}});
   expect(await store.verifyApproved(record.id)).toBe(false);
  });

  it('يعتمد السجل ويسجل بيانات المعتمِد (تدقيق)',async()=>{
   const record=await store.createApproval({level:2,payload:{to:'ok@example.com'}});
   const approved=await store.markApproved(record.id,{id:'manager-1',role:'manager'});
   expect(approved.status).toBe('approved');
   expect(approved.approver).toEqual({id:'manager-1',role:'manager'});
   expect(approved.decidedAt).toBeTypeOf('string');
   expect(Date.parse(approved.decidedAt!)).not.toBeNaN();
   expect(await store.verifyApproved(record.id)).toBe(true);
   expect((await store.getApprovalStatus(record.id))?.status).toBe('approved');
  });

  it('يرفض السجل ويسجل بيانات الرافض',async()=>{
   const record=await store.createApproval({level:2,payload:{}});
   const rejected=await store.markRejected(record.id,{id:'manager-2',role:'security'});
   expect(rejected.status).toBe('rejected');
   expect(rejected.approver).toEqual({id:'manager-2',role:'security'});
   expect(await store.verifyApproved(record.id)).toBe(false);
  });

  it('يمنع القرار المزدوج بأخطاء واضحة',async()=>{
   const record=await store.createApproval({level:2,payload:{}});
   await store.markApproved(record.id,{id:'m',role:'manager'});
   await expect(store.markApproved(record.id,{id:'m',role:'manager'})).rejects.toThrow('Approval cannot be approved: approved');
   await expect(store.markRejected(record.id,{id:'m',role:'manager'})).rejects.toThrow('Approval cannot be rejected: approved');
  });

  it('يرفض القرار على سجل غير موجود',async()=>{
   await expect(store.markApproved('missing-id',{id:'m',role:'manager'})).rejects.toThrow('Approval cannot be approved: not_found');
   await expect(store.markRejected('missing-id',{id:'m',role:'manager'})).rejects.toThrow('Approval cannot be rejected: not_found');
   expect(await store.getApprovalStatus('missing-id')).toBeNull();
   expect(await store.verifyApproved('missing-id')).toBe(false);
  });

  it('يعلّم السجل منتهيًا بعد تجاوز TTL ولا يعتمده',async()=>{
   const record=await store.createApproval({level:2,payload:{},ttlMs:50});
   await new Promise(resolve=>setTimeout(resolve,120));
   expect(await store.verifyApproved(record.id)).toBe(false);
   expect((await store.getApprovalStatus(record.id))?.status).toBe('expired');
   await expect(store.markApproved(record.id,{id:'m',role:'manager'})).rejects.toThrow('Approval cannot be approved: expired');
  });

  it('يعتبر الاعتماد منتهيًا بعد expiresAt وإن صدر قبل انتهائه',async()=>{
   const record=await store.createApproval({level:2,payload:{},ttlMs:120});
   await store.markApproved(record.id,{id:'m',role:'manager'});
   expect(await store.verifyApproved(record.id)).toBe(true);
   await new Promise(resolve=>setTimeout(resolve,150));
   expect(await store.verifyApproved(record.id)).toBe(false);
   expect((await store.getApprovalStatus(record.id))?.status).toBe('approved');
  });

  it('يتعامل مع عدة سجلات مستقلة في نفس المخزن',async()=>{
   const first=await store.createApproval({level:1,payload:{n:1}});
   const second=await store.createApproval({level:2,payload:{n:2}});
   await store.markApproved(second.id,{id:'m',role:'manager'});
   expect(await store.verifyApproved(first.id)).toBe(false);
   expect(await store.verifyApproved(second.id)).toBe(true);
   expect((await store.getApprovalStatus(first.id))?.payload).toEqual({n:1});
   expect((await store.getApprovalStatus(second.id))?.payload).toEqual({n:2});
  });
 });
}

// إثبات قاطع أن مهايئ Turso يستخدم libSQL حقيقيًا (لا مقلَّدًا):
// نكتب عبر المهايئ ثم نقرأ الصف من قاعدة البيانات نفسها عبر اتصال libsql مستقل تمامًا.
describe('Turso/libSQL — إثبات تكامل حقيقي',()=>{
 it('يكتب في ملف قاعدة بيانات فعلي مقروء من اتصال libsql آخر',async()=>{
  const dbPath=join(dir,'proof.db');
  process.env.TURSO_DATABASE_URL=`file://${dbPath}`;
  process.env.TURSO_AUTH_TOKEN='local-file-token';
  const store=new TursoApprovalStore();

  const record=await store.createApproval({level:2,payload:{to:'proof@example.com'}});
  await store.markApproved(record.id,{id:'manager-9',role:'manager'});

  // 1) الملف موجود فعليًا على القرص
  expect(existsSync(dbPath)).toBe(true);

  // 2) اتصال libsql مستقل يرى نفس الصف وبنفس الحقول
  const spy=createClient({url:`file://${dbPath}`});
  const result=await spy.execute({sql:'SELECT id,status,level,payload,approver_id,approver_role FROM approvals WHERE id=?',args:[record.id]});
  expect(result.rows).toHaveLength(1);
  const row=result.rows[0] as unknown as Record<string,unknown>;
  expect(String(row.id)).toBe(record.id);
  expect(String(row.status)).toBe('approved');
  expect(Number(row.level)).toBe(2);
  expect(JSON.parse(String(row.payload))).toEqual({to:'proof@example.com'});
  expect(String(row.approver_id)).toBe('manager-9');
  expect(String(row.approver_role)).toBe('manager');

  // 3) البنية مُصرَّح بها داخل libsql (الجدول أُنشئ فعليًا)
  const tables=await spy.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='approvals'");
  expect(tables.rows).toHaveLength(1);
 });
});
