# مراجعة هندسية لـ PR #1 — من الكود والـ diff (لا من الوصف)

المراجع: جلسة Arena · تاريخ: 2026-09-04
الفرع: `arena/01a06cb9-gethip-agen` → `main` · التزامان: `e001e23`, `7f36cf5`
النطاق: `git diff main...HEAD` = 35 ملفًا، +3,492 / −43

## المنهجية

| الخطوة | الأمر / الدليل |
|---|---|
| نطاق التغيير | `git diff --stat main...HEAD` |
| diff المصدري الكامل | `git diff main...HEAD -- apps/api/src/server.ts packages/agent-core/src/index.ts packages/orchestrator/src/index.ts packages/orchestrator/src/planner.ts` |
| فحص الأسرار | `git diff main...HEAD \| grep -Ei "GITHUB_PRIVATE_KEY\|GEMINI_API_KEY\|TURSO_AUTH_TOKEN\|APPROVAL_JWT_SECRET\|BEGIN ..."` |
| الملفات الحساسة المتتبَّعة | `git ls-files \| grep -E "^\.env$\|data/\|coverage/\|\.sqlite$\|\.db$"` |
| جودة الاختبارات | `git grep "setTimeout\|ttlMs" -- "*.test.ts"` · `git grep -E "\.(only\|skip\|todo)\("` |
| تجارب قابلة للتكرار | إعادة إنتاج «نجاح صامت بلا اختبارات» · فحص دعم `file:` في `@libsql/client` |

**الكود المُنتِج المتغيّر فعليًا = 6 ملفات فقط** (والباقي اختبارات/توثيق/تهيئة):
`apps/api/src/server.ts`، `apps/web/src/main.tsx`، `apps/web/src/lib/events.ts`، `packages/agent-core/src/index.ts`، `packages/orchestrator/src/index.ts`، `packages/orchestrator/src/planner.ts`.

---

## ✅ فحص الأسرار (أول بند طلبته)

- **لا توجد أي قيمة سر داخل الكود أو ملفات التهيئة.** النتائج الوحيدة جاءت من التوثيق فقط:
  - `docs/REPO_STATUS.md:188,256` — اسم المتغير `APPROVAL_JWT_SECRET` مع القيمة التجريبية `demo-secret` في مثال تشغيل.
  - `docs/TESTING.md` — ذكر `AGENT_POLICIES_DIR` و`APPROVAL_JWT_SECRET` كأسماء متغيرات.
- `git ls-files` لا يتضمن أي `.env` (المتتبَّع هو `.env.example` فقط)، ولا `data/`، ولا `*.sqlite`/`*.db`، ولا `coverage/` → `.gitignore` يغطيها:
  ```
  node_modules · dist · .env · *.db · coverage · data · *.sqlite
  ```
- لا وجود لأي مفتاح ثابت (hardcoded) في الاختبارات: مفاتيح JWT تُولَّد وقت التشغيل (`SignJWT` + سر من البيئة)، ومفتاح Gemini وهمي (`test-key`) مع `fetch` مُقلَّد.

**ملاحظة واحدة بسيطة** (مُصنَّفة NICE رقم 9 أدناه): استبدال القيمة الحرفية `demo-secret` في أمثلة التوثيق بعنصر مكان.

---

## الحكم النهائي

> **APPROVE with comments — موصى بالدمج**
> لا يوجد أي **BLOCKER**. التغييرات المصدريّة محدودة ومُغطّاة باختبارات، وسلوك الخادم تحُقّق منه حيًا (14 خطوة نهاية-بنهاية) وعلى CI.

---

## 🔴 BLOCKER — لا شيء

لا يوجد ما يمنع الدمج. أخطر تغيير (إعادة هيكلة `apps/api/src/server.ts`) تحُقّق منه بثلاث طبقات مستقلة: 25 اختبار API بمصفوفة صلاحيات كاملة، تشغيل حقيقي لـ `node apps/api/dist/server.js`، وCI أخضر.

---

## 🟠 IMPORTANT — يجب معالجتها (لا تمنع هذا الدمج)

### I-1 · CI فقد حاجز «صفر اختبارات يمرّ بصمت»
**الدليل (تجربة مُعادة إنتاجها):**
```bash
$ cp <config باسم افتراضي> vitest.config.ts     # أي ملف باسم vitest.config.ts في الجذر
$ pnpm --filter @agent/security test
No test files found, exiting with code 0         # ⚠️ صفر اختبار...
$ echo $?
0                                                 # ⚠️ ...والبناء "ناجح"
$ rm vitest.config.ts && pnpm --filter @agent/security test
 Tests  15 passed (15)                            # ✅ عاد طبيعيًا
```
**السبب:** vitest تبحث صعودًا عن ملف تهيئة باسم افتراضي، ومع `--passWithNoTests` في سكربت كل حزمة يمرّ التشغيل بصمت.
**الأثر:** هذا الـPR استبدل خطوة `pnpm test` في CI بـ `pnpm test:coverage`، فلم يعد هناك ما يكتشف هذا الفخ.
**التوصية:** أعد خطوة `pnpm test` إلى CI (تكلفتها ~12 ثانية) بجانب خطوة التغطية — أو أزل `--passWithNoTests` من سكربتات الحزم (كل حزمة بات لديها اختبارات فعلًا).

### I-2 · اختبارات الحزم تعمل على `dist` لا على `src`
**الدليل:**
```bash
$ node -e "import.meta.resolve('@agent/core')"        # من داخل packages/orchestrator
file:///home/user/gethip_agen/packages/agent-core/dist/index.js
```
**الأثر:** أي تعديل في `packages/agent-core/src` لا يظهر في اختبارات `orchestrator`/`api` إلا بعد `pnpm build`. لُوحظ هذا فعليًا في هذه الجلسة: فشل اختبار المنسّق لأن `dist` كان قديمًا، واختفت المشكلة فور إعادة البناء. CI آمن (يبني أولًا)، لكن التطوير المحلي قد يُظهر نجاحًا زائفًا.
**التوصية:** أضف `pretest` على مستوى الجذر (`"pretest": "pnpm build"`) أو aliasing في vitest إلى `src`، أو وثّق المتطلب بوضوح في `docs/TESTING.md`.

### I-3 · لا مصادقة على نقاط التنفيذ (قائم مسبقًا — خارج نطاق هذا الـPR)
**الدليل:** `apps/api/src/server.ts:41` (`POST /api/approvals`) و`:56` (`POST /agent/run`) و`:57` (`POST /agent/run/stream`) بلا أي تحقّق هوية؛ الحماية تقتصر على قرار الموافقة (`:44` `authorize`).
**الأثر:** أي جهة تصل إلى الخادم تستطيع إنشاء طلبات موافقة وتشغيل الوكيل (وإن كان التنفيذ محكومًا بالموافقة). تزداد الخطورة فور إضافة أدوات حقيقية (GitHub).
**التوصية:** ضمن PR «الفجوات الإنتاجية»: مصادقة على `/agent/*` وإدارة معدّل (rate limit) على إنشاء الموافقات.

### I-4 · اختبارات `TursoApprovalStore` تُختبر مقابل مقلَّد يُعيد تنفيذ SQL
**الدليل:** `packages/approval-store/src/turso.test.ts:10-25` — `vi.mock('@libsql/client')` بمفسّر SQL مكتوب يدويًا (`if(sql.startsWith('INSERT'))…`).
**الأثر:** الاختبار يتحقق من دلالات المقلَّد أكثر مما يتحقق من سلوك libsql الحقيقي؛ أي انحراف في العميل الحقيقي لن يُكتشف.
**التوصية:** `@libsql/client` يدعم روابط `file:` محليًا — تحقّقت منه فعليًا:
```
libsql file: مدعوم ✅ rows= 1 {"id":"a"}
```
استبدل المقلَّد باختبار تكامل حقيقي على `file:///tmp/<tmpdir>.db` (مع الإبقاء على اختبار مصغّر للمقلَّد للتحقق من بناء الرابط/الرمز ورسالة الخطأ عند نقص البيانات).

---

## 🟡 NICE-TO-HAVE — تحسينات غير مانعة

| # | الملف | الملاحظة | التوصية |
|---|---|---|---|
| 5 | `packages/llm-planner/src/llm-planner.behavior.test.ts:71` | `expect(other.id).toBe('other_task')` تأكيد تحصيل حاصل (يختبر قيمة كتبناها للتو) | احذفه؛ التأكيد المفيد هو السطر التالي (العودة للبديل عند مهمة غير مسجلة) |
| 6 | `store.test.ts:61-73`، `turso.test.ts:86-132`، `agent.test.ts:98-100`، `index.test.ts` | اختبارات زمنية بهوامش ضيقة (`ttlMs:1` + `sleep 5ms`، `ttlMs:20/30` + `sleep 30/40ms`) | `vi.useFakeTimers()` أو توسيع الهوامش لتفادي تقلّب CI |
| 7 | `vitest.coverage.config.ts` | لا توجد `coverage.thresholds` | أضف حدًا أدنى (مثلًا `statements: 90`) لمنع الهبوط التدريجي |
| 8 | `apps/api/src/server.ts:32` | المخزن الافتراضي (SQLite) لا يُغلق عند إغلاق الخادم، وواجهة `ApprovalStore` لا تعرف `close()` | أضف `close?()` للواجهة + `app.addHook('onClose')` |
| 9 | `docs/REPO_STATUS.md:188,256` | قيمة سر حرفية في مثال (`APPROVAL_JWT_SECRET=demo-secret`) | استبدلها بـ `<ضع-سرًا-قويًا>` (مستندات فقط، لا أثر في الكود) |
| 10 | `vercel.json`, `api/index.mjs` | `outputDirectory: apps/api/dist` مع دوال Serverless، و`api/index.mjs` بلا أي اختبار | راجعه ضمن «التحقق من النشر» في PR الفجوات |
| 11 | التغطية | ملفات الفهرسة (barrels) مثل `packages/llm-planner/src/index.ts` تُحسب 0% وتخفض الرقم الكلي | استثنها من `coverage.include` أو غطّها باختبار استيراد بسيط |
| 12 | `packages/approval-store/src/turso.ts` | المُنشئ يطلب `authToken` حتى مع روابط `file:` التي لا تحتاج رمزًا | اجعل الرمز اختياريًا عند المخطط `file:` |

---

## ما تم التحقق منه إيجابًا (نقاط قوة في الـPR)

1. **تكرار منطق المصادقة أُزيل بأمان**: استُبدل نسختان متطابقتان من فحص JWT (≈23 سطرًا مكررًا) بدالة `authorize` واحدة في `server.ts:44` — مع **نفس** رموز الاستجابة (401/401/403) ونفس بنية المعتمِد، وهذا مُثبت بمصفوفة حالات في `server.test.ts` (8 حالات).
2. **الإقلاع الذاتي محكوم بشرط آمن**: `server.ts:67` `isMainModule` — الخادم يستمع فقط عند التشغيل المباشر، ولا يستمع عند الاستيراد (وهذا ما جعل اختبار الـAPI ممكنًا أصلًا). تحُقّق منه حيًا عبر `node apps/api/dist/server.js` (وهو نفس أمر `Dockerfile`).
3. **الإصلاحات الثلاثة دقيقة وموضعية**: `(await initializePlugins(...)).policies` · تمرير `policiesDir` إلى `initAgent` · `.filter(Boolean)` في المخطط الكلماتي — كلها تغييرات سطرية بمفعول كبير، وكل واحدة مربوطة باختبار.
4. **استخراج `consumeEvents`** (`apps/web/src/lib/events.ts`) حوّل منطق SSE المتشابك في المكوّن إلى وحدة نقية قابلة للاختبار (9 اختبارات)، مع الحفاظ على السلوك.
5. **لا `.only` / `.skip` / `.todo`** في أي اختبار (`git grep` → لا نتائج).
6. **الاختبارات لا تلمس文件系统 خارج مجلدات مؤقتة** (tmpdir) وتستخدم `:memory:` في SQLite.
7. **الاعتمادات الجديدة مبرَّرة**: `@vitest/coverage-v8`, `jsdom`, `@testing-library/react`, `zod`(dev لـ agent-core) — كلها أدوات اختبار، ولا اعتماد إنتاجي جديد.

---

## التوصية الإجرائية

1. **ادمج هذا الـPR** (لا blockers؛ الملاحظات IMPORTANT لا تُغير صحة الأساس).
2. افتح PR تاليًا بعنوان واضح للفجوات الإنتاجية، يبدأ بـ: (1) إضافة `pnpm test` إلى CI + `pretest` build (I-1, I-2)، (2) مصادقة `/agent/*` (I-3)، (3) اختبار Turso الحقيقي على `file:` (I-4).
3. ثم PR ثالث لتكامل GitHub/Octokit، والحالة الدائمة، ومصادقة المستخدمين، والتحقق من Docker/Vercel.
