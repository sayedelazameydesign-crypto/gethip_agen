import {defineConfig} from 'vitest/config';

// إعداد موحّد على مستوى المستودع: يشغّل كل اختبارات الحزم من جذر واحد
// ويدعم بيئة jsdom لملفات الواجهة عبر تعليق @vitest-environment.
export default defineConfig({
 test:{
  include:[
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
   include:['packages/*/src/**/*.ts','packages/plugins/*/src/**/*.ts','apps/api/src/**/*.ts','apps/web/src/**/*.ts','apps/web/src/**/*.tsx'],
   exclude:['**/*.test.ts','**/*.test.tsx','**/dist/**','**/node_modules/**','**/*.d.ts']
  }
 }
});
