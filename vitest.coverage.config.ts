import {defineConfig} from 'vitest/config';

// إعداد موحّد على مستوى المستودع: يشغّل كل اختبارات الحزم من جذر واحد
// ويدعم بيئة jsdom لملفات الواجهة عبر تعليق @vitest-environment.
export default defineConfig({
 test:{
  include:[
   'tests/**/*.test.ts',
   'packages/*/src/**/*.test.ts',
   'packages/plugins/*/src/**/*.test.ts',
   'apps/api/src/**/*.test.ts',
   'apps/web/src/**/*.test.ts',
   'apps/web/src/**/*.test.tsx'
  ],
  exclude:['**/node_modules/**','**/dist/**'],
  environment:'node',
  coverage:{
   provider:'v8',
   reporter:['text','json-summary','html'],
   reportsDirectory:'coverage',
   thresholds:{
    // أرضية عامة (floor) أقل قليلًا من الأساس المثبت: 96.59 / 93.05
    statements:95,
    branches:90,
    functions:95,
    // حدود لكل حزمة مشتقّة من أدنى تغطية فعلية مقاسة لكل حزمة، لا من المتوسط الكلي،
    // حتى لا يفشل CI بسبب حزمة واحدة منخفضة قياسًا بطبيعتها:
    //   apps/api      90.48 / 81.36 / 100   (كتلة الإقلاع الذاتي خارج التغطية)
    //   apps/web     100.00 / 85.71 / 77.78 (معالجات JSX غير المُشغَّلة)
    //   llm-planner   85.71 / 96.97 / 87.50 (ملف الفهرسة barrel غير المستورد)
    'apps/api/**':{statements:90,branches:80,functions:100},
    'apps/web/**':{statements:95,branches:85,functions:75},
    'packages/llm-planner/**':{statements:85,branches:90,functions:85}
   },
   include:['packages/*/src/**/*.ts','packages/plugins/*/src/**/*.ts','apps/api/src/**/*.ts','apps/web/src/**/*.ts','apps/web/src/**/*.tsx'],
   exclude:['**/*.test.ts','**/*.test.tsx','**/dist/**','**/node_modules/**','**/*.d.ts']
  }
 }
});
