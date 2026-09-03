# Arabic GitHub Agent

وكيل GitHub عربي RTL يطبق دورة آمنة: فهم الطلب، التخطيط، فحص السياسة، الموافقة، التنفيذ، التحقق، وحفظ الأدلة. هذه نسخة v0.1 محلية تجريبية.

## التشغيل

```bash
pnpm install
pnpm dev
```

- الواجهة: `http://localhost:5173`
- API: `http://localhost:3001`

```bash
pnpm test
pnpm typecheck
```

لا تُحفظ الأسرار في Git. اربط GitHub App وGemini لاحقًا عبر متغيرات البيئة. مستوى Level 0 للقراءة تلقائي، وLevel 1 للتعديل يحتاج موافقة.
