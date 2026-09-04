// حاجز I-1: يمنع السيناريو الذي يمرّ فيه CI بصمت عندما لا تُكتشف أي اختبارات.
// كان السبب الجذري: `vitest run --passWithNoTests` + ملف تهيئة باسم افتراضي في الجذر
// يطغى على أنماط include الخاصة بكل حزمة → "No test files found, exiting with code 0".
import {describe,it,expect} from 'vitest';
import {readdirSync,readFileSync,statSync} from 'node:fs';
import {join,relative} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('..',import.meta.url));
const workspaceGlobs=['apps','packages','packages/plugins'];

function isDirectory(path:string){
 try{return statSync(path).isDirectory()}catch{return false}
}

function listPackages():string[]{
 const found:string[]=[];
 for(const glob of workspaceGlobs){
  const base=join(root,glob);
  let entries;
  try{entries=readdirSync(base,{withFileTypes:true})}catch{continue}
  for(const entry of entries){
   if(!entry.isDirectory())continue;
   const packagePath=join(base,entry.name);
   if(!isDirectory(join(packagePath,'src')))continue;
   const manifestPath=join(packagePath,'package.json');
   try{readFileSync(manifestPath,'utf8')}catch{continue}
   found.push(packagePath);
  }
 }
 return found.sort();
}

function walk(path:string,filter:(entryPath:string)=>boolean):string[]{
 const output:string[]=[];
 let entries;
 try{entries=readdirSync(path,{withFileTypes:true})}catch{return output}
 for(const entry of entries){
  if(entry.name==='node_modules'||entry.name==='.git')continue;
  const entryPath=join(path,entry.name);
  if(entry.isDirectory())output.push(...walk(entryPath,filter));
  else if(filter(entryPath))output.push(entryPath);
 }
 return output;
}

const packages=listPackages();
const testFilePattern=/\.test\.(ts|tsx)$/;

describe('حاجز: لا حزمة بلا اختبارات',()=>{
 it('يوجد على الأقل 10 حزم/تطبيقات في مساحة العمل',()=>{
  expect(packages.length).toBeGreaterThanOrEqual(10);
 });

 for(const packagePath of packages){
  const name=relative(root,packagePath);

  it(`${name}: يحوي ملف اختبار واحدًا على الأقل`,()=>{
   const tests=walk(join(packagePath,'src'),file=>testFilePattern.test(file));
   expect(tests.length,`لا ملفات اختبار في ${name}`).toBeGreaterThan(0);
  });

  it(`${name}: سكربت test موجود ولا يستخدم --passWithNoTests`,()=>{
   const manifest=JSON.parse(readFileSync(join(packagePath,'package.json'),'utf8')) as {scripts?:Record<string,string>};
   expect(manifest.scripts?.test,`لا سكربت test في ${name}`).toBeTruthy();
   expect(manifest.scripts?.test??'').not.toContain('--passWithNoTests');
  });
 }
});

describe('حاجز: لا تهيئة vitest باسم افتراضي في الجذر',()=>{
 it('لا يوجد vitest.config.{ts,js,mjs} في الجذر (يطغى على أنماط الحزم)',()=>{
  const offenders=['vitest.config.ts','vitest.config.js','vitest.config.mts','vitest.config.mjs']
   .filter(file=>{try{statSync(join(root,file));return true}catch{return false}});
  expect(offenders,`ملفات التهيئة ${offenders.join(', ')} تجعل اختبارات الحزم تكتشف صفر ملف وتنجح زورًا`) .toEqual([]);
 });
});
