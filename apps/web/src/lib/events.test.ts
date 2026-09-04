import {describe,it,expect} from 'vitest';
import {consumeEvents} from './events.js';
import type {StreamEvent} from './events.js';

describe('consumeEvents (تحليل تيار SSE)',()=>{
 it('يفك حدثًا واحدًا مكتملًا',()=>{
  const {events,rest}=consumeEvents('event: status\ndata: {"stage":"planning"}\n\n');
  expect(rest).toBe('');
  expect(events).toEqual([{event:'status',data:{stage:'planning'}}]);
 });

 it('يفك عدة أحداث في دفعة واحدة',()=>{
  const {events,rest}=consumeEvents('event: status\ndata: {"a":1}\n\nevent: result\ndata: {"success":true}\n\nevent: done\ndata: {"success":true}\n\n');
  expect(events.map(event=>event.event)).toEqual(['status','result','done']);
  expect(events[1].data).toEqual({success:true});
  expect(rest).toBe('');
 });

 it('يُبقي الحدث الناقص في remainder ليُكمل لاحقًا',()=>{
  const first=consumeEvents('event: status\ndata: {"stage":"pla');
  expect(first.events).toEqual([]);
  expect(first.rest).toBe('event: status\ndata: {"stage":"pla');
  const second=consumeEvents(first.rest+'nning"}\n\n');
  expect(second.events).toEqual([{event:'status',data:{stage:'planning'}}]);
  expect(second.rest).toBe('');
 });

 it('يسمّي الحدث message عند غياب سطر event',()=>{
  const {events}=consumeEvents('data: {"hello":1}\n\n');
  expect(events).toEqual([{event:'message',data:{hello:1}}]);
 });

 it('يتجاهل مقطعًا بلا سطر بيانات',()=>{
  const {events,rest}=consumeEvents('event: status\n\nevent: done\ndata: {"success":false}\n\n');
  expect(events).toEqual([{event:'done',data:{success:false}}]);
  expect(rest).toBe('');
 });

 it('يتجاهل بيانات JSON غير صالحة ولا يوقف التيار',()=>{
  const {events}=consumeEvents('event: result\ndata: ليس JSON\n\nevent: done\ndata: {"success":true}\n\n');
  expect(events).toEqual([{event:'done',data:{success:true}}]);
 });

 it('يتعامل مع مخزن فارغ أو بلا أحداث',()=>{
  expect(consumeEvents('')).toEqual({events:[],rest:''});
  expect(consumeEvents('لا شيء مفيد')).toEqual({events:[],rest:'لا شيء مفيد'});
 });

 it('يحافظ على ترتيب الأحداث عند التراكم التدريجي',()=>{
  const chunks=['event: status\ndata: {"n":1}\n\n','event: result\ndata: {"n":2}\n\nevent: done\nd'];
  let buffer='';
  const collected:StreamEvent[]=[];
  for(const chunk of chunks){
   buffer+=chunk;
   const parsed=consumeEvents(buffer);
   buffer=parsed.rest;
   collected.push(...parsed.events);
  }
  expect(collected.map(event=>event.event)).toEqual(['status','result']);
  expect(buffer).toBe('event: done\nd');
 });

 it('يقبل قيمًا عربية داخل البيانات',()=>{
  const {events}=consumeEvents('event: status\ndata: {"message":"جاري التنفيذ عبر بوابة الموافقة"}\n\n');
  expect(events[0].data.message).toBe('جاري التنفيذ عبر بوابة الموافقة');
 });
});
