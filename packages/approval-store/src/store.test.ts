import {describe,it,expect,beforeEach,afterEach} from 'vitest';
import {mkdtempSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SQLiteApprovalStore} from './index.js';

let dir:string;
beforeEach(()=>{dir=mkdtempSync(join(tmpdir(),'approvals-'))});
afterEach(()=>{rmSync(dir,{recursive:true,force:true})});

describe('SQLiteApprovalStore — دورة حياة الموافقة',()=>{
 it('ينشئ سجلًا معلقًا بمدة افتراضية 5 دقائق',async()=>{
  const store=new SQLiteApprovalStore();
  const before=Date.now();
  const record=await store.createApproval({level:2,payload:{to:'a@b.com'}});
  expect(record.status).toBe('pending');
  expect(record.level).toBe(2);
  expect(record.payload).toEqual({to:'a@b.com'});
  expect('approver' in record).toBe(false);
  expect('decidedAt' in record).toBe(false);
  const ttl=Date.parse(record.expiresAt)-before;
  expect(ttl).toBeGreaterThanOrEqual(300_000);
  expect(ttl).toBeLessThan(301_000);
  store.close();
 });

 it('يحترم ttl مخصصًا ويعتبر السجل منتهيًا بعده',async()=>{
  const store=new SQLiteApprovalStore();
  const record=await store.createApproval({level:2,payload:{},ttlMs:10_000});
  expect(await store.verifyApproved(record.id)).toBe(false);
  expect(await store.getApprovalStatus(record.id)).toMatchObject({status:'pending',level:2});
  expect(Date.parse(record.expiresAt)-Date.parse(record.createdAt)).toBe(10_000);
  store.close();
 });

 it('يحفظ حمولة معقدة نصيًا ويعيدها كما هي',async()=>{
  const store=new SQLiteApprovalStore();
  const payload={to:'a@b.com',meta:{tags:['x','y'],count:3},nested:{deep:{ok:true}}};
  const record=await store.createApproval({level:3,payload});
  expect((await store.getApprovalStatus(record.id))?.payload).toEqual(payload);
  store.close();
 });

 it('يمنع القرار المزدوج بعد الموافقة أو الرفض',async()=>{
  const store=new SQLiteApprovalStore();
  const record=await store.createApproval({level:2,payload:{}});
  await store.markApproved(record.id,{id:'m1',role:'manager'});
  await expect(store.markApproved(record.id,{id:'m2',role:'manager'})).rejects.toThrow('Approval cannot be approved: approved');
  await expect(store.markRejected(record.id,{id:'m2',role:'manager'})).rejects.toThrow('Approval cannot be rejected: approved');

  const other=await store.createApproval({level:2,payload:{}});
  await store.markRejected(other.id,{id:'m1',role:'manager'});
  expect(await store.verifyApproved(other.id)).toBe(false);
  expect((await store.getApprovalStatus(other.id))?.approver).toEqual({id:'m1',role:'manager'});
  await expect(store.markApproved(other.id,{id:'m2',role:'manager'})).rejects.toThrow('Approval cannot be approved: rejected');
  store.close();
 });

 it('يرفض قرارًا على سجل منتهٍ أو غير موجود',async()=>{
  const store=new SQLiteApprovalStore();
  const record=await store.createApproval({level:2,payload:{},ttlMs:1});
  await new Promise(r=>setTimeout(r,5));
  await expect(store.markApproved(record.id,{id:'m1',role:'manager'})).rejects.toThrow('Approval cannot be approved: expired');
  await expect(store.markRejected('missing-id',{id:'m1',role:'manager'})).rejects.toThrow('Approval cannot be rejected: not_found');
  store.close();
 });

 it('يعتبر السجل المعتمد منتهيًا بعد تجاوز expiredAt',async()=>{
  const store=new SQLiteApprovalStore();
  const record=await store.createApproval({level:2,payload:{},ttlMs:30});
  await store.markApproved(record.id,{id:'m1',role:'manager'});
  expect(await store.verifyApproved(record.id)).toBe(true);
  await new Promise(r=>setTimeout(r,40));
  expect(await store.verifyApproved(record.id)).toBe(false);
  expect((await store.getApprovalStatus(record.id))?.status).toBe('approved');
  store.close();
 });

 it('يعيد null لسجل غير موجود ولا يعتبره معتمدًا',async()=>{
  const store=new SQLiteApprovalStore();
  expect(await store.getApprovalStatus('missing')).toBeNull();
  expect(await store.verifyApproved('missing')).toBe(false);
  store.close();
 });

 it('يستمر على ملف حقيقي على القرص',async()=>{
  const path=join(dir,'approvals.sqlite');
  const first=new SQLiteApprovalStore(path);
  const record=await first.createApproval({level:1,payload:{to:'disk@example.com'}});
  await first.markApproved(record.id,{id:'m1',role:'manager'});
  first.close();
  expect(existsSync(path)).toBe(true);
  const second=new SQLiteApprovalStore(path);
  expect(await second.verifyApproved(record.id)).toBe(true);
  second.close();
 });

 it('يعزل كل نسخة مخزن في الذاكرة عن الأخرى',async()=>{
  const a=new SQLiteApprovalStore();
  const b=new SQLiteApprovalStore();
  const record=await a.createApproval({level:2,payload:{}});
  await a.markApproved(record.id,{id:'m1',role:'manager'});
  expect(await b.verifyApproved(record.id)).toBe(false);
  a.close(); b.close();
 });
});
