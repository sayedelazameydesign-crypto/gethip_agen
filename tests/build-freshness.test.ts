// حاجز I-2: يمنع تشغيل الاختبارات مقابل artifacts بناء قديمة (dist).
// اختبارات الحزم تستورد الحزم التابعة من `dist` لا من `src`، لذا أي تعديل في src
// دون إعادة البناء يجعل الاختبارات تتحقق من كود قديم (نجاح أو فشل زائف).
import {describe,it,expect} from 'vitest';
import {readdirSync,readFileSync,statSync} from 'node:fs';
import {join,relative} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('..',import.meta.url));
const workspaceGlobs=['apps','packages','packages/plugins'];

function isDirectory(path:string){
 try{return statSync(path).isDirectory()}catch{return false}
}

function listPackages():Array<{path:string;name:string;hasBuild:boolean}>{
 const found:Array<{path:string;name:string;hasBuild:boolean}>=[];
 for(const glob of workspaceGlobs){
  const base=join(root,glob);
  let entries;
  try{entries=readdirSync(base,{withFileTypes:true})}catch{continue}
  for(const entry of entries){
   if(!entry.isDirectory())continue;
   const packagePath=join(base,entry.name);
   const manifestPath=join(packagePath,'package.json');
   let manifest:{scripts?:Record<string,string>};
   try{manifest=JSON.parse(readFileSync(manifestPath,'utf8'))}catch{continue}
   if(!manifest.scripts?.build)continue;
   found.push({path:packagePath,name:relative(root,packagePath),hasBuild:true});
  }
 }
 return found.sort((a,b)=>a.name.localeCompare(b.name));
}

function walk(path:string,skip:Set<string>):string[]{
 const output:string[]=[];
 let entries;
 try{entries=readdirSync(path,{withFileTypes:true})}catch{return output}
 for(const entry of entries){
  if(skip.has(entry.name))continue;
  const entryPath=join(path,entry.name);
  if(entry.isDirectory())output.push(...walk(entryPath,skip));
  else output.push(entryPath);
 }
 return output;
}

const newest=(files:string[])=>files.reduce((latest,file)=>Math.max(latest,statSync(file).mtimeMs),Number.NEGATIVE_INFINITY);
const oldestNewest=(files:string[])=>files.length?newest(files):Number.NEGATIVE_INFINITY;

const packages=listPackages();

describe('حاجز: الاختبارات لا تعمل على dist قديم',()=>{
 it('يوجد على الأقل 10 وحدات قابلة للبناء',()=>{
  expect(packages.length).toBeGreaterThanOrEqual(10);
 });

 for(const pkg of packages){
  it(`${pkg.name}: dist موجود وأحدث من كل ملفات المصدر`,()=>{
   const distPath=join(pkg.path,'dist');
   const distFiles=isDirectory(distPath)?walk(distPath,new Set()):[];
   expect(distFiles.length,`مجلد dist مفقود أو فارغ في ${pkg.name} — شغّل: pnpm build`).toBeGreaterThan(0);

   const sourceFiles=walk(pkg.path,new Set(['node_modules','dist','coverage','.git','.turbo']))
    .filter(file=>/\.(ts|tsx|js|mjs|css|html|json)$/.test(file));
   const newestSource=oldestNewest(sourceFiles);
   const newestDist=newest(distFiles);

   expect(
    newestDist,
    `dist في ${pkg.name} أقدم من المصدر — أعد البناء قبل الاختبار: pnpm build`
   ).toBeGreaterThanOrEqual(newestSource);
  });
 }
});
