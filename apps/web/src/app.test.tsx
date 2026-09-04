// @vitest-environment jsdom
import {describe,it,expect,vi,beforeEach,afterEach} from 'vitest';
import {render,screen,fireEvent,waitFor,cleanup} from '@testing-library/react';
import {App} from './main.jsx';

function sseResponse(chunks:string[],init:{ok?:boolean;status?:number}={}){
 const stream=new ReadableStream<Uint8Array>({start(controller){
  for(const chunk of chunks)controller.enqueue(new TextEncoder().encode(chunk));
  controller.close();
 }});
 return new Response(stream,{status:init.status??200,...(init.ok===false?{status:init.status??500}:{})});
}

const statusChunk='event: status\ndata: {"stage":"planning","message":"جاري اختيار المهمة"}\n\n';
const resultChunk=(success:boolean)=>`event: result\ndata: {"agentId":"gethip-agent","goal":{"intent":"send_email"},"steps":[{"taskId":"send_email","evidence":{"email_logs":{"status":"sent"}}}],"success":${success},"summary":"${success?'تم التنفيذ':'لا توجد موافقة صالحة'}"}\n\nevent: done\ndata: {"success":${success}}\n\n`;

let fetchMock:ReturnType<typeof vi.fn>;

beforeEach(()=>{fetchMock=vi.fn();vi.stubGlobal('fetch',fetchMock)});
afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.restoreAllMocks()});

const intentBox=()=>screen.getByPlaceholderText(/مثال: أرسل بريداً/) as HTMLTextAreaElement;
const emailBox=()=>screen.getByPlaceholderText('client@example.com') as HTMLInputElement;
const sendButton=()=>screen.getByRole('button',{name:/إرسال إلى الوكيل/}) as HTMLButtonElement;

function fill(){
 fireEvent.change(intentBox(),{target:{value:'أرسل بريدًا ترحيبيًا'}});
 fireEvent.change(emailBox(),{target:{value:'client@example.com'}});
}

describe('واجهة الوكيل (RTL)',()=>{
 it('تعرض الهيكل الأساسي بالعربية',()=>{
  render(<App/>);
  expect(screen.getByText('ماذا تريد أن تنجز؟')).toBeTruthy();
  expect(screen.getByText('طلب جديد')).toBeTruthy();
  expect(screen.getByText('سجل التشغيل')).toBeTruthy();
  expect(screen.getByText('جاهز للاستماع')).toBeTruthy();
  expect(document.querySelector('.app')?.getAttribute('dir')).toBe('rtl');
 });

 it('تبقي زر الإرسال معطّلًا حتى يكتمل الهدف والبريد',()=>{
  render(<App/>);
  expect(sendButton().disabled).toBe(true);
  fireEvent.change(intentBox(),{target:{value:'أرسل بريدًا'}});
  expect(sendButton().disabled).toBe(true);
  fireEvent.change(emailBox(),{target:{value:'client@example.com'}});
  expect(sendButton().disabled).toBe(false);
  fireEvent.change(emailBox(),{target:{value:'   '}});
  expect(sendButton().disabled).toBe(true);
 });

 it('ترسل الطلب إلى نقطة البثّ بالمعاملات الصحيحة',async()=>{
  fetchMock.mockResolvedValue(sseResponse([statusChunk,resultChunk(true)]));
  render(<App/>);
  fill();
  fireEvent.click(sendButton());
  await waitFor(()=>expect(screen.getByText('نجح التنفيذ')).toBeTruthy());
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url,init]=fetchMock.mock.calls[0] as [string,RequestInit];
  expect(url).toBe('http://localhost:3001/agent/run/stream');
  expect(init.method).toBe('POST');
  expect(JSON.parse(String(init.body))).toEqual({intent:'أرسل بريدًا ترحيبيًا',parameters:{to:'client@example.com',subject:'',body:'',managerApproval:false}});
 });

 it('تعرض مراحل التخطيط ثم النتيجة والأدلة',async()=>{
  fetchMock.mockResolvedValue(sseResponse([statusChunk,resultChunk(true)]));
  render(<App/>);
  fill();
  fireEvent.click(sendButton());
  await waitFor(()=>expect(screen.getByText('التخطيط')).toBeTruthy());
  await waitFor(()=>expect(screen.getByText('نجح التنفيذ')).toBeTruthy());
  expect(screen.getByText('الأدلة المجمعة')).toBeTruthy();
  expect(screen.getByText('email_logs')).toBeTruthy();
  expect(screen.getByText('sent')).toBeTruthy();
 });

 it('تعرض الفشل عندما يُبلغ التيار عن خطأ',async()=>{
  fetchMock.mockResolvedValue(sseResponse([statusChunk,resultChunk(false)]));
  render(<App/>);
  fill();
  fireEvent.click(sendButton());
  await waitFor(()=>expect(screen.getByText('فشل التنفيذ')).toBeTruthy());
 });

 it('تعرض رسالة الخطأ عند فشل الاتصال',async()=>{
  fetchMock.mockRejectedValue(new Error('تعذر الوصول للخادم'));
  render(<App/>);
  fill();
  fireEvent.click(sendButton());
  await waitFor(()=>expect(screen.getByText('تعذر تشغيل الطلب')).toBeTruthy());
  expect(screen.getByText('تعذر الوصول للخادم')).toBeTruthy();
 });

 it('تعرض خطأ HTTP عندما يرفض الخادم الطلب',async()=>{
  fetchMock.mockResolvedValue(new Response('nope',{status:500}));
  render(<App/>);
  fill();
  fireEvent.click(sendButton());
  await waitFor(()=>expect(screen.getByText('HTTP 500')).toBeTruthy());
 });

 it('تُظهر حالة التشغيل أثناء التدفق',async()=>{
  fetchMock.mockResolvedValue(sseResponse([statusChunk,resultChunk(true)]));
  render(<App/>);
  fill();
  fireEvent.click(sendButton());
  await waitFor(()=>expect(screen.getByText('SSE')).toBeTruthy());
  await waitFor(()=>expect(screen.getByText('نجح التنفيذ')).toBeTruthy());
 });

 it('تمسح الحقول والنتائج عند ضغط مسح',async()=>{
  fetchMock.mockResolvedValue(sseResponse([statusChunk,resultChunk(true)]));
  render(<App/>);
  fill();
  fireEvent.click(sendButton());
  await waitFor(()=>expect(screen.getByText('نجح التنفيذ')).toBeTruthy());
  fireEvent.click(screen.getByRole('button',{name:'مسح'}));
  expect(intentBox().value).toBe('');
  expect(emailBox().value).toBe('');
  expect(screen.getByText('جاهز للاستماع')).toBeTruthy();
 });

 it('تدرج عَلَم موافقة المدير عند تحديده',async()=>{
  fetchMock.mockResolvedValue(sseResponse([statusChunk,resultChunk(true)]));
  render(<App/>);
  fill();
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(sendButton());
  await waitFor(()=>expect(screen.getByText('نجح التنفيذ')).toBeTruthy());
  const [,init]=fetchMock.mock.calls[0] as [string,RequestInit];
  expect(JSON.parse(String(init.body)).parameters.managerApproval).toBe(true);
 });
});
