// @vitest-environment jsdom
import {describe,it,expect,afterEach} from 'vitest';
import {act} from 'react';

afterEach(()=>{document.body.innerHTML=''});

describe('نقطة دخول الواجهة',()=>{
 it('تركّب التطبيق داخل #root عند وجوده',async()=>{
  document.body.innerHTML='<div id="root"></div>';
  await act(async()=>{await import('./main.jsx')});
  const root=document.getElementById('root');
  expect(root?.querySelector('.app')).toBeTruthy();
  expect(root?.textContent).toContain('ماذا تريد أن تنجز؟');
 });

 it('لا تنهار عند غياب عنصر #root',async()=>{
  document.body.innerHTML='';
  await act(async()=>{await expect(import('./main.jsx')).resolves.toBeTruthy()});
  expect(document.querySelector('.app')).toBeNull();
 });
});
