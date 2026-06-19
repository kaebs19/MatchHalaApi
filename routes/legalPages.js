// routes/legalPages.js
// صفحات قانونية عامة مطلوبة من Google Play (HTML خام، عام عالمياً، غير قابل للتعديل).
// تُخدّم على المسارات الجذرية /child-safety و /delete-account (بلا بادئة /api)
// لأن nginx يوجّه هذين المسارين تحديداً إلى المنفذ 3000.

const express = require('express');
const router = express.Router();

// قالب صفحة مستقل بـ CSS داخلي بسيط (عربي RTL)
function renderPage(title, bodyHtml) {
    return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
    <meta name="robots" content="index, follow">
    <style>
        :root { --brand:#e0245e; --ink:#1a1a1a; --muted:#555; --line:#eee; --bg:#f7f7f9; }
        * { box-sizing:border-box; }
        body { margin:0; background:var(--bg); color:var(--ink);
            font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Tahoma,Arial,sans-serif;
            line-height:1.9; padding:24px; }
        .card { max-width:780px; margin:24px auto; background:#fff; border-radius:16px;
            padding:28px 32px; box-shadow:0 4px 24px rgba(0,0,0,.06); }
        h1 { font-size:24px; margin:0 0 6px; color:var(--ink); }
        h2 { font-size:19px; margin:26px 0 8px; color:var(--brand); }
        p.sub { color:var(--muted); margin:0 0 18px; }
        ol, ul { padding-inline-start:22px; }
        li { margin:6px 0; }
        .box { background:#fff5f8; border:1px solid #ffd6e3; border-radius:12px; padding:14px 18px; margin:14px 0; }
        a { color:var(--brand); text-decoration:none; }
        a:hover { text-decoration:underline; }
        .muted { color:var(--muted); font-size:14px; margin-top:28px; border-top:1px solid var(--line); padding-top:14px; }
        strong { color:var(--ink); }
    </style>
</head>
<body>
    <div class="card">
${bodyHtml}
        <p class="muted">تطبيق هلا (ChatHala) — جهة التواصل: <a href="mailto:kaebs19@gmail.com">kaebs19@gmail.com</a></p>
    </div>
</body>
</html>`;
}

// ============ /child-safety — معايير سلامة الأطفال (CSAE) ============
const childSafetyBody = `
        <h1>معايير سلامة الأطفال — تطبيق هلا (ChatHala)</h1>
        <p class="sub">التزامنا بحماية الأطفال ومكافحة الاستغلال والاعتداء الجنسي عليهم.</p>

        <h2>عدم تسامح مطلق</h2>
        <p>
            نلتزم في تطبيق هلا (ChatHala) بسياسة <strong>عدم تسامح مطلق</strong> تجاه أي شكل من أشكال
            الاستغلال والإساءة الجنسية للأطفال (CSAE)، وتجاه مواد الاعتداء الجنسي على الأطفال (CSAM).
            هذا المحتوى أو السلوك ممنوع منعاً باتاً، وأي حساب يرتبط به يُزال فوراً ويُحظر نهائياً.
        </p>

        <h2>التطبيق للبالغين 18+ فقط</h2>
        <p>
            تطبيق هلا مخصّص للبالغين ممّن بلغوا <strong>18 عاماً فأكثر</strong> فقط. يُمنع استخدام التطبيق
            من قِبل القاصرين، وعند اكتشاف أي حساب لقاصر يتم <strong>حذفه فوراً</strong> ومنعه من العودة.
        </p>

        <h2>إجراءات الوقاية</h2>
        <ul>
            <li>مراجعة جميع البلاغات الواردة من المستخدمين والتعامل معها بجدّية.</li>
            <li>فلترة وحجب المحتوى المسيء والكلمات والصور المخالفة.</li>
            <li>حظر دائم للحسابات المخالفة وللأجهزة المرتبطة بها لمنع إعادة التسجيل.</li>
            <li>إتاحة خيارَي <strong>الحظر</strong> و<strong>الإبلاغ</strong> داخل التطبيق على كل مستخدم ومحتوى.</li>
        </ul>

        <h2>كيف تُبلّغ عن إساءة</h2>
        <div class="box">
            استخدم خيار <strong>«إبلاغ»</strong> المتاح داخل التطبيق على أي مستخدم أو رسالة أو محتوى،
            أو راسلنا مباشرة على <strong><a href="mailto:kaebs19@gmail.com?subject=بلاغ%20سلامة%20أطفال">kaebs19@gmail.com</a></strong>.
            تُعامَل كل البلاغات المتعلقة بسلامة الأطفال بأعلى أولوية.
        </div>

        <h2>إجراؤنا عند المخالفة</h2>
        <ul>
            <li>إزالة فورية للمحتوى المخالف.</li>
            <li>حظر دائم للحساب والجهاز المرتبط به.</li>
            <li>الإبلاغ إلى <strong>المركز الوطني للأطفال المفقودين والمستغَلّين (NCMEC)</strong>
                وإلى السلطات الإقليمية والوطنية المختصة وفق ما يقتضيه القانون.</li>
        </ul>

        <h2>جهة التواصل لسلامة الأطفال</h2>
        <p>
            لأي بلاغ أو استفسار يخص سلامة الأطفال، تواصل معنا على:
            <strong><a href="mailto:kaebs19@gmail.com?subject=سلامة%20الأطفال">kaebs19@gmail.com</a></strong>
        </p>
`;

// ============ /delete-account — حذف الحساب والبيانات ============
const deleteAccountBody = `
        <h1>حذف الحساب والبيانات — تطبيق هلا (ChatHala)</h1>
        <p class="sub">كيف تطلب حذف حسابك وبياناتك المرتبطة به نهائياً.</p>

        <h2>طريقتا الحذف</h2>
        <ol>
            <li>
                <strong>من داخل التطبيق (فوري):</strong>
                افتح <strong>ملفي ← الإعدادات ← حذف الحساب</strong>، ثم أدخِل
                <strong>كلمة المرور</strong> (لمستخدمي البريد الإلكتروني)، ثم أكّد العملية.
                يتم الحذف فوراً ولا يمكن التراجع عنه.
            </li>
            <li>
                <strong>عبر البريد الإلكتروني:</strong>
                أرسل رسالة من <strong>بريدك المسجّل في الحساب</strong> إلى
                <strong><a href="mailto:kaebs19@gmail.com?subject=طلب%20حذف%20حساب">kaebs19@gmail.com</a></strong>
                بعنوان <strong>«طلب حذف حساب»</strong>. يُنفّذ الطلب خلال <strong>7 أيام عمل</strong>.
            </li>
        </ol>

        <h2>البيانات التي تُحذف نهائياً</h2>
        <ul>
            <li>الملف الشخصي: الاسم، البريد الإلكتروني، الصور، النبذة، الاهتمامات.</li>
            <li>الرسائل والمحادثات.</li>
            <li>المطابقات والإعجابات والتمريرات.</li>
            <li>إعدادات الحساب ورموز الإشعارات.</li>
        </ul>

        <h2>بيانات يُحتفظ بها مؤقتاً</h2>
        <ul>
            <li>سجلّات الأمان ومكافحة الاحتيال (مثل معرّف الجهاز للحسابات المخالفة، والبلاغات)
                لمدة تصل إلى <strong>90 يوماً</strong>.</li>
            <li>السجلّات المالية بالقدر الذي يفرضه القانون.</li>
            <li>تُمحى النسخ الاحتياطية خلال <strong>30 يوماً</strong>.</li>
        </ul>

        <h2>المدة الزمنية</h2>
        <ul>
            <li>الحذف من داخل التطبيق: <strong>فوري</strong>.</li>
            <li>الحذف عبر البريد: خلال <strong>7 أيام عمل</strong>.</li>
            <li>إزالة النسخ الاحتياطية: خلال <strong>30 يوماً</strong>.</li>
        </ul>
`;

router.get('/child-safety', (req, res) => {
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.send(renderPage('معايير سلامة الأطفال — تطبيق هلا (ChatHala)', childSafetyBody));
});

router.get('/delete-account', (req, res) => {
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.send(renderPage('حذف الحساب والبيانات — تطبيق هلا (ChatHala)', deleteAccountBody));
});

module.exports = router;
