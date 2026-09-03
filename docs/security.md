# الأمن

- النموذج لا يملك صلاحيات GitHub؛ runtime فقط يستدعي الأدوات.
- كل طلب أداة يمر عبر Zod ثم Policy Engine.
- القراءة Level 0، والتعديل/branch/install Level 1، والحذف الواسع وforce push وmerge وتغيير الأسرار ممنوعة افتراضيًا.
- مفاتيح GitHub وGemini في البيئة فقط.
- كل Run ينتج Evidence قابلًا للتدقيق.
