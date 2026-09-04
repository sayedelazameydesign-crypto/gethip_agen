export type StreamEvent={event:string;data:any};

/**
 * يفكّ ترميز تيار SSE التدريجي: يستهلك الأحداث المكتملة (مفصولة بسطرين جديدين)
 * ويعيد ما تبقى من بيانات ناقصة لتُكمل في الدفعة التالية.
 */
export function consumeEvents(buffer:string):{events:StreamEvent[];rest:string}{
 const chunks=buffer.split('\n\n');
 const rest=chunks.pop()||'';
 const events:StreamEvent[]=[];
 for(const chunk of chunks){
  const lines=chunk.split('\n');
  const event=lines.find(line=>line.startsWith('event:'))?.slice(6).trim()||'message';
  const dataLine=lines.find(line=>line.startsWith('data:'));
  if(!dataLine)continue;
  try{events.push({event,data:JSON.parse(dataLine.slice(5).trim())})}
  catch{/* يُتجاهل حدث ذو بيانات غير صالحة */}
 }
 return {events,rest};
}
