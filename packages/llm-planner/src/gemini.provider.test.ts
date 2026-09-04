import {describe,it,expect,vi,afterEach,beforeEach} from 'vitest';
import {GeminiProvider} from './providers/gemini.provider.js';

afterEach(()=>{vi.unstubAllGlobals();delete process.env.GEMINI_MODEL});

function replyWith(payload:unknown,options:{ok?:boolean;status?:number}={}){
 return vi.fn(async(_url:string,_init?:RequestInit)=>({
  ok:options.ok??true,
  status:options.status??200,
  json:async()=>payload
 }));
}

const textPayload=(text:string)=>({candidates:[{content:{parts:[{text}]}}]});

describe('GeminiProvider',()=>{
 it('يرفض الإنشاء بمفتاح فارغ',()=>{
  expect(()=>new GeminiProvider('')).toThrow('Gemini API key is required');
 });

 it('يستخدم الطراز الافتراضي والطراز المخصص',async()=>{
  const fetchMock=replyWith(textPayload('{}'));
  vi.stubGlobal('fetch',fetchMock);
  await new GeminiProvider('k').generateResponse('s','u');
  expect(String(fetchMock.mock.calls[0][0])).toContain('models/gemini-2.0-flash:generateContent');
  await new GeminiProvider('k','gemini-9.0-ultra').generateResponse('s','u');
  expect(String(fetchMock.mock.calls[1][0])).toContain('models/gemini-9.0-ultra:generateContent');
 });

 it('يقرأ الطراز من متغير البيئة GEMINI_MODEL',async()=>{
  process.env.GEMINI_MODEL='gemini-1.5-flash';
  const fetchMock=replyWith(textPayload('{}'));
  vi.stubGlobal('fetch',fetchMock);
  await new GeminiProvider('k').generateResponse('s','u');
  expect(String(fetchMock.mock.calls[0][0])).toContain('gemini-1.5-flash');
 });

 it('يُرمّز المفتاح داخل الرابط',async()=>{
  const fetchMock=replyWith(textPayload('{}'));
  vi.stubGlobal('fetch',fetchMock);
  await new GeminiProvider('a b&c=d').generateResponse('s','u');
  const url=String(fetchMock.mock.calls[0][0]);
  expect(url).toContain('key=a%20b%26c%3Dd');
  expect(url).not.toContain('a b&c');
 });

 it('يرسل تعليمات النظام وطلب المستخدم وإعدادات التوليد',async()=>{
  const fetchMock=replyWith(textPayload('{}'));
  vi.stubGlobal('fetch',fetchMock);
  await new GeminiProvider('k').generateResponse('SYSTEM_TEXT','USER_TEXT');
  const init=fetchMock.mock.calls[0][1] as RequestInit;
  expect(init.method).toBe('POST');
  expect((init.headers as Record<string,string>)['content-type']).toBe('application/json');
  const body=JSON.parse(String(init.body));
  expect(body.systemInstruction.parts[0].text).toBe('SYSTEM_TEXT');
  expect(body.contents[0].role).toBe('user');
  expect(body.contents[0].parts[0].text).toBe('USER_TEXT');
  expect(body.generationConfig).toEqual({responseMimeType:'application/json',temperature:0});
 });

 it('يعيد نص الرد',async()=>{
  vi.stubGlobal('fetch',replyWith(textPayload('{"taskId":"x"}')));
  await expect(new GeminiProvider('k').generateResponse('s','u')).resolves.toBe('{"taskId":"x"}');
 });

 it('يرمي خطأ عند رد غير ناجح من الخدمة',async()=>{
  vi.stubGlobal('fetch',replyWith({}, {ok:false,status:500}));
  await expect(new GeminiProvider('k').generateResponse('s','u')).rejects.toThrow('Gemini request failed: 500');
 });

 it('يرمي خطأ عند رد فارغ أو بلا نص',async()=>{
  vi.stubGlobal('fetch',replyWith({candidates:[]}));
  await expect(new GeminiProvider('k').generateResponse('s','u')).rejects.toThrow('Gemini returned an empty response');
  vi.stubGlobal('fetch',replyWith({candidates:[{content:{parts:[{text:''}]}}]}));
  await expect(new GeminiProvider('k').generateResponse('s','u')).rejects.toThrow('Gemini returned an empty response');
  vi.stubGlobal('fetch',replyWith({candidates:[{}]}));
  await expect(new GeminiProvider('k').generateResponse('s','u')).rejects.toThrow('Gemini returned an empty response');
 });

 it('ينشر خطأ الشبكة كما هو',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>{throw new Error('offline')}));
  await expect(new GeminiProvider('k').generateResponse('s','u')).rejects.toThrow('offline');
 });
});
