# تقرير الاختبارات الشاملة — gethip agent

تاريخ التقرير: 2026-09-04 · الفرع: `arena/01a06cb9-gethip-agen`

## 1. ملخص تنفيذي

| المؤشر | قبل هذه الجولة | بعدها |
|---|---|---|
| عدد الاختبارات | 13 | **206** |
| عدد ملفات الاختبار | 5 | **23** |
| حزم بلا أي اختبار | 5 (`contracts`، `security`، `apps/api`، `apps/web`، `plugins/example-task`) | **0** |
| قياس التغطية | لا يوجد | **96.59%** عبارات · **93.03%** فروع · 96.05% دوال |
| `pnpm build` | ناجح | ناجح |
| `pnpm typecheck` | ناجح | ناجح (0 خطأ) |

اكتُشفت أثناء الجولة **3 عيوب حقيقية** وأُصلحت، كلٌّ منها موثّق باختبار يمنع عودته (انظر §5).

## 2. كيفية التشغيل

```bash
pnpm install
pnpm build            # تبني الحزم (اختبارات الحزم تعتمد على dist للروابط الداخلية)
pnpm typecheck
pnpm test             # يشغّل اختبارات كل حزمة على حدة
pnpm test:coverage    # يشغّل كل الاختبارات مرة واحدة + تقرير تغطية في coverage/
```

- `pnpm test` = `pnpm -r test` (كل حزمة تشغّل vitest داخل مجلدها).
- `pnpm test:coverage` يستخدم `vitest.coverage.config.ts` في الجذر (اسم غير افتراضي كي لا تلتقطه vitest تلقائيًا عند التشغيل من مجلد حزمة).
- بيئة jsdom مفعّلة لملفات الواجهة عبر تعليق `// @vitest-environment jsdom`، و`apps/web/vitest.config.ts` يضيف ملحق React.

### ملاحظة بيئية (بناء `better-sqlite3`)

الاعتماد `better-sqlite3` أصلي. في بيئة ذات شبكة مقيدة (حجب `nodejs.org` و`release-assets.githubusercontent.com`) يفشل `prebuild-install`، ويُبنى يدويًا من المصدر باستخدام ترويسات Node المثبّتة محليًا:

```bash
NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt pnpm install
cd node_modules/.pnpm/better-sqlite3@11.10.0/node_modules/better-sqlite3
node "$(npm root -g)/../corepack/v1/pnpm/9.15.0/dist/node_modules/node-gyp/bin/node-gyp.js" \
  rebuild --release --nodedir=/usr/local --jobs=4
```

## 3. خريطة الاختبارات

| الحزمة | ملفات | اختبارات | أبرز ما يُغطّى |
|---|---:|---:|---|
| `packages/contracts` | 1 | 6 | عقود zod: الحالات، مستويات الخطورة، خطة/أداة، حدود `CreateRunRequest` |
| `packages/security` | 1 | 15 | `evaluateTool` (Level 0/1/مجهول)، `SecurityKernel` (نطاقات محظورة، المستوى 2+، سياسات تالفة) |
| `packages/extension-system` | 2 | 17 | تحميل سياسات JSON/YAML/YML، تجاهل الامتدادات الأخرى، منع التكرار، `initializePlugins` |
| `packages/approval-store` | 3 | 21 | SQLite: دورة الحياة، TTL، انتهاء الصلاحية، منع القرار المزدوج، الاستمرار على القرص + Turso بمخزن `@libsql/client` مُقلَّد |
| `packages/agent-core` | 4 | 36 | `initAgent`، حساب المستوى (1/2/3 و`overrideLevel`)، الرفض الآمن، السياق/الـtraceId، آلة الحالة، الأدلة |
| `packages/orchestrator` | 3 | 29 | المخطط الكلماتي، `AgentLoop` (نجاح/فشل/أدلة/أخطاء جامعي الأدلة)، مسار Gemini مع `fetch` مُقلَّد |
| `packages/llm-planner` | 4 | 26 | مزوّد Gemini (الرابط، الترميز، الأخطاء)، قوالب التلقين، استخراج JSON، العودة للبديل |
| `packages/plugins/example-task` | 1 | 10 | المخطط، `overrideLevel`، المعالج، استراتيجية الأدلة |
| `apps/api` | 1 | 25 | كل نقاط النهاية عبر `app.inject`، مصفوفة صلاحيات JWT، 400/404/409، وبثّ SSE على خادم حقيقي |
| `apps/web` | 3 | 21 | تحليل تيار SSE، عرض الواجهة RTL بالعربية، الإرسال/الخطأ/المسح، تركيب نقطة الدخول |
| **الإجمالي** | **23** | **206** | |

## 4. التغطية

```
-------------------|---------|----------|---------|---------|-------------------
File               | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s
-------------------|---------|----------|---------|---------|-------------------
All files          |   96.59 |    93.03 |   96.05 |   96.59 |
 apps/api/src      |   90.47 |    81.35 |     100 |   90.47 | 69-72
 apps/web/src      |     100 |     82.6 |      75 |     100 | 11,13-14
 apps/web/src/lib  |     100 |      100 |     100 |     100 |
 ...agent-core/src |     100 |       98 |     100 |     100 | 10
 ...oval-store/src |     100 |    96.72 |     100 |     100 | 4
 .../contracts/src |     100 |      100 |     100 |     100 |
 ...ion-system/src |     100 |      100 |     100 |     100 |
 ...lm-planner/src |      75 |    94.44 |   66.66 |      75 |
 ...chestrator/src |     100 |    94.59 |     100 |     100 | 14
 ...ample-task/src |     100 |      100 |     100 |     100 |
 ...s/security/src |     100 |      100 |     100 |     100 |
-------------------|---------|----------|---------|---------|-------------------
```

ما تبقّى خارج التغطية:

1. **`apps/api/src/server.ts` (69-72)**: كتلة الإقلاع الذاتي (`isMainModule`). مُتحقَّق منها يدويًا بتشغيل `node apps/api/dist/server.js` واستدعاء كل النقاط (انظر §6).
2. **ملفات الفهرسة (barrels)** مثل `packages/llm-planner/src/index.ts` وملفات الأنواع الصرفة (`types.ts`، `plugin.types.ts`، `llm-provider.interface.ts`).
3. **مسار Turso داخل `apps/api`**: يحتاج `vi.mock('@libsql/client')` من داخل حزمة API (الاعتماد غير مباشر).

## 5. عيوب مكتشفة أثناء الاختبار

### 5.1 `initAgent` يعيد كائن السجلات بدل السياسات — **أُصلح**

`packages/agent-core/src/index.ts` كان يُعيد نتيجة `initializePlugins` كاملة (`{taskRegistry, strategyRegistry, policies}`) داخل حقل `policies`، فكان `GET /api/policies` يعيد كائنًا غير ذي معنى (الخرائط تُ序列化 إلى `{}`).

```ts
// قبل
const policies = options.plugins ? await initializePlugins(...) : {};
// بعد
const policies = options.plugins ? (await initializePlugins(...)).policies : {};
```

### 5.2 السياسات لا تُطبَّق في مسار المنسّق — **أُصلح**

`createOrchestrator` كان يستدعي `initAgent` دون `policiesDir`، فيُستخدم المسار النسبي `./policies/approval` (غير موجود عند التشغيل من مجلد الحزمة) وتُحمَّل **صفر سياسات**: أي بريد إلى نطاق محظور كان يمرّ بصمت في مسار `/agent/run`. أُضيف معامل رابع اختياري:

```ts
export async function createOrchestrator(plugins, geminiApiKey, approvalStore, policiesDir = process.env.AGENT_POLICIES_DIR)
```

وسياق `apps/api/src/server.ts` يمرّر `process.env.AGENT_POLICIES_DIR` نفسه للاثنين.

### 5.3 هدف فارغ يطابق أول مهمة في المخطط الكلماتي — **أُصلح**

`''.split(/\s+/)` ينتج `['']` و`''` جزء من أي نص، لذا كان intent فارغ يختار أول مهمة مسجّلة. أُضيف `.filter(Boolean)`.

### 5.4 ملاحظات سلوكية (لم تُغيَّر — مُوثّقة باختبارات)

- `ApprovalGateway` يمرّر `managerApproval: true` دائمًا إلى `SecurityKernel`، لذا فحص «المستوى 2+ يحتاج عَلَم المدير» داخل النواة **معطّل فعليًا**؛ الحاجز الحقيقي هو التحقق من سجل الموافقة في المخزن (وهو يعمل ويفشل بأمان).
- عند توفير مفتاح Gemini، يتجاهل المنسّق `parameters` القادمة من المستخدم ويستخدم ما ولّده النموذج؛ والبديل الكلماتي يعيد `parameters` فارغة دائمًا (فقدان معاملات المستخدم).
- `AgentLoop` يسجّل `approval:{level:0,approved:false}` ثابتًا في كل خطوة ولا يعكس المستوى الفعلي.
- `evidence()` لا تُنتج القيمة `'FAILED'` أبدًا (نجاح أو تعليق فقط).
- `POST /api/approvals` (الإنشاء) غير محمي بمصادقة؛ القرار (approve/reject) محمي بـ JWT ونطاق `approvals:write`.

## 6. تحقّق تشغيل شامل (خادم حقيقي)

بعد `pnpm build`، شُغّل `node apps/api/dist/server.js` on المنفذ 3101 مع `AGENT_POLICIES_DIR` و`APPROVAL_JWT_SECRET`، ونُفّذت السلسلة التالية بنجاح:

| الخطوة | النتيجة |
|---|---|
| `GET /health` | `{"ok":true,"service":"arabic-github-agent"}` |
| `GET /api/tasks` | `[{"id":"send_email"}]` |
| `GET /api/policies` | `{"email":{"blockedDomains":["spam.com","temp-mail.org"],"requireSSL":true}}` ✅ بعد إصلاح 5.1 |
| `POST /api/runs` (صالح/غير صالح) | 201 بانتظار الموافقة + خطة قراءة آمنة / 400 |
| `POST /api/approvals` | 201 pending |
| `POST /api/approvals/:id/approve` بلا JWT | 401 |
| `POST /api/approvals/:id/approve` بـ JWT صالح | 200 + بيانات المعتمِد |
| `POST /agent/run` بموافقة معتمدة | نجاح + دليل `email_logs` |
| `POST /agent/run` بنطاق محظور | رفض: `Domain spam.com is blocked by policy.` ✅ بعد إصلاح 5.2 |
| `POST /agent/run/stream` (SSE) | `event: status` ×2 ثم `result` و`done` |

## 7. توصيات للجولة القادمة

1. **اختبارات تكامل E2E**: تشغيل الخادم والواجهة معًا (Playwright) لتغطية المسار من الواجهة إلى بوابة الموافقة.
2. **إعادة تفعيل فحص المستوى 2 داخل `SecurityKernel`** بعد إيقاف حقن `managerApproval:true` من البوابة (دفاعًا على طبقتين).
3. **محواجز تغطية دنيا** (`coverage.thresholds`) تمنع هبوط التغطية عن 90% في CI.
4. **اختبارات عقود GitHub/Gemini حقيقية** عند إضافة المتكيّفات (حاليًا لا يوجد أي اختبار لطبقة GitHub).
5. **تحسين الواجهة للتطوير عن بَعد**: جعل `VITE_API_URL` نسبيًا مع proxy في Vite كي تعمل الواجهة في بيئات المعاينة السحابية.
