# ضمانات الاختبار والتكامل (PR #2 — Regression hardening)

هذا المستند يوثّق **الضمانات المؤتمتة** التي تمنع تكرار الملاحظات I-1 وI-2 وI-4 من مراجعة PR #1،
مع دليل Regression قبل/بعد لكل منها.

---

## الأوامر الـcanonical

| الأمر | ما يفعله | متى يُستخدم |
|---|---|---|
| `pnpm test` | `pnpm build` ثم اختبارات كل حزمة | الأمر الوحيد الكافي محليًا (يبني أولًا) |
| `pnpm test:packages` | اختبارات كل حزمة بلا بناء | داخل CI بعد خطوة `pnpm build` |
| `pnpm test:coverage` | كل الاختبارات + حواجز المستودع + التغطية | CI وتقارير التغطية (يتطلب بناءً سابقًا) |
| `pnpm verify` | build + typecheck + test:packages + test:coverage | فحص كامل قبل الدمج |

CI هو المرجع النهائي، ويُنفّذ بالترتيب:
`install → build → typecheck → test:packages → test:coverage`

---

## I-1 · صفر الاختبارات يجب أن يكون فشلًا

**الآلية (ثلاث طبقات):**

1. **حذف `--passWithNoTests` من كل سكربت `test`** في الحزم العشر → vitest يخرج بالكود `1` عند عدم اكتشاف ملفات.
2. **عودة خطوة `pnpm test:packages` إلى CI** (بجانب خطوة التغطية) → الحاجز يُستدعى فعليًا في كل تشغيل.
3. **حاجز مستودع** `tests/no-empty-test-suites.test.ts` (22 اختبارًا) يتحقق من:
   - كل حزمة تحوي ≥1 ملف اختبار؛
   - كل حزمة تملك سكربت `test` **خالٍ** من `--passWithNoTests`؛
   - لا وجود لـ `vitest.config.{ts,js,mts,mjs}` في الجذر (التهيئة التي تطغى على أنماط الحزم).

### دليل Regression (تجربة مُحكمة بنفس السيناريو)

السيناريو: ملف `vitest.config.ts` باسم افتراضي في الجذر (يطغى على `include` الخاص بكل حزمة) مع `pnpm --filter @agent/security test`.

```
قبل (--passWithNoTests):
  No test files found, exiting with code 0
  exit=0                       ← ⚠️ نجاح زائف

بعد (بدون --passWithNoTests):
  No test files found, exiting with code 1
  exit=1                       ← ✅ فشل واضح
  ELIFECYCLE  Test failed.

الحالة الطبيعية (بدون التهيئة الطاغية):
  Tests  15 passed (15)
```

---

## I-2 · منع الاختبار على `dist` قديم

**المشكلة:** اختبارات الحزم تستورد الحزم التابعة من `dist` لا من `src`:
```
$ node -e "import.meta.resolve('@agent/core')"   # من داخل packages/orchestrator
file:///home/user/gethip_agen/packages/agent-core/dist/index.js
```

**الآلية:**

1. **بناء إلزامي في الأمر الـcanonical**: `pnpm test` = `pnpm build && pnpm -r test`
   (بناء واحد على مستوى الجذر — **لا** `pretest` متكرر لكل حزمة، تفاديًا لتكرار البناء في الـmonorepo).
2. **حاجز مستودع** `tests/build-freshness.test.ts` (11 اختبارًا): لكل وحدة قابلة للبناء، يجب أن يكون
   `dist` موجودًا وغير فارغ، وأن يكون أحدث ملف فيه **أحدث من أو يساوي** أحدث ملف مصدر؛ وإلا يفشل
   برسالة تحدّد الحزمة المُخالفة.
3. CI يبني قبل الاختبارات، وخطوة التغطية تُشغّل الحاجز.

### دليل Regression

```
$ touch packages/security/src/index.ts     # تعديل مصدر بلا إعادة بناء
$ pnpm test:coverage
  → dist في apps/api أقدم من المصدر — أعد البناء قبل الاختبار: pnpm build
  → dist في apps/web أقدم من المصدر — أعد البناء قبل الاختبار: pnpm build
  → dist في packages/security أقدم من المصدر — أعد البناء قبل الاختبار: pnpm build
  exit=1                                   ← ✅ فشل واضح

$ pnpm build && pnpm test:coverage
  Test Files  26 passed (26)
  Tests  258 passed (258)
  exit=0                                   ← ✅ يمر بعد البناء
```

> ملاحظة: الحاجز يعمل في التشغيل الشامل من الجذر (`test:coverage`)؛ أمّا `pnpm test:packages`
> فيعتمد على البناء الذي يسبقه (في CI وفي `pnpm test` الـcanonical).

---

## I-4 · تكامل libSQL/Turso حقيقي (مع فصل الوحدة عن التكامل)

**الفصل:**

| النوع | الملف | يستند إلى |
|---|---|---|
| وحدة (مقلَّد) | `packages/approval-store/src/turso.unit.test.ts` (6) | `vi.mock('@libsql/client')` — بناء العميل، التحقق من البيانات، التهيئة الكسولة للجدول، تحويل الصفوف |
| تكامل (حقيقي) | `packages/approval-store/src/stores.integration.test.ts` (23) | `@libsql/client` **حقيقي** على رابط `file:` + `better-sqlite3` |

**ما يثبته التكامل:**

1. **منظومة سلوك واحدة (conformance)** تُنفَّذ على المخزنين معًا — 11 سيناريو × 2 = 22 اختبارًا:
   إنشاء معلق/TTL افتراضي 5 دقائق · TTL مخصص · حمولة معقدة · عدم اعتماد المعلق · الاعتماد مع بيانات المعتمِد ·
   الرفض · منع القرار المزدوج · سجل غير موجود · انتهاء الصلاحية · اعتماد منتهٍ · استقلال السجلات.
2. **إثبات قاطع أن libSQL حقيقي** (ليس مقلَّدًا): بعد الكتابة عبر المهايئ، يُفتح **اتصال libsql مستقل**
   على نفس الملف ويُقرأ الصف والحقول، ويُتحقق من وجود جدول `approvals` في `sqlite_master`.

```
✓ packages/approval-store/src/stores.integration.test.ts (23 tests)
✓ packages/approval-store/src/turso.unit.test.ts (6 tests)
```

> `file:` يستخدم محرك libSQL نفسه محليًا، لذا التكامل حقيقي وقابل لإعادة الإنتاج بلا شبكة ولا أسرار.
> الاتصال بشبكة Turso المُدارة يبقى خطوة لاحقة تتطلّب بيانات اعتماد في بيئة مؤتمتة.

---

## الأثر على الأرقام (مُفسَّر)

| المؤشر | PR #1 | PR #2 |
|---|---:|---:|
| ملفات الاختبار | 23 | **26** |
| الاختبارات | 206 | **258** (+52) |
| التغطية (عبارات) | 96.59% | **96.59%** |
| التغطية (فروع) | 93.03% | **93.05%** |

الزيادة (+52) = +19 في `approval-store` (40 بدل 21 بعد فصل الوحدة عن التكامل الحقيقي)
+33 حاجزًا على مستوى المستودع (22 لاكتشاف صفر الاختبارات + 11 لِقدم `dist`).
**لم يتغيّر أي اختبار من الاختبارات الـ206 الأصلية.**
