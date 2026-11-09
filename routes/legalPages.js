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
        <p class="muted">Hala (ChatHala) — Contact / جهة التواصل: <!--email_off--><a href="mailto:kaebs19@gmail.com">kaebs19@gmail.com</a><!--/email_off--></p>
    </div>
</body>
</html>`;
}

// ============ /child-safety — معايير سلامة الأطفال (CSAE) ============
// ⚠️ جهة التواصل يجب أن تطابق بريد حساب المطوّر في Play Console وإقرار سلامة الأطفال
//    (رُفض التطبيق ٨ نوفمبر ٢٠٢٦: «Invalid Child Safety point of contact email»).
const CHILD_SAFETY_EMAIL = 'kaebs19@gmail.com';
// <!--email_off--> يمنع Cloudflare من استبدال البريد بـ «[email protected]» — كان مراجع Google لا يراه.
const csMail = (subject) =>
    `<!--email_off--><a href="mailto:${CHILD_SAFETY_EMAIL}?subject=${encodeURIComponent(subject)}">${CHILD_SAFETY_EMAIL}</a><!--/email_off-->`;
const PLAY_URL = 'https://play.google.com/store/apps/details?id=com.chathala.hala';

const childSafetyBody = `
    <div dir="ltr" lang="en" style="text-align:left">
        <h1>Child Safety Standards — Hala (ChatHala)</h1>
        <p class="sub">
            App: <strong>Hala – ChatHala</strong> · Package: <code>com.chathala.hala</code> ·
            <a href="${PLAY_URL}">Google Play listing</a><br>
            Developer: Abdulaziz Ahmed · Last updated: November 10, 2026
        </p>

        <h2>Zero tolerance for CSAE and CSAM</h2>
        <p>
            Hala <strong>strictly prohibits child sexual abuse and exploitation (CSAE)</strong> in any form,
            including child sexual abuse material (CSAM), grooming, sextortion, trafficking, and any
            sexualization of minors. Such content and behavior are not allowed anywhere in the app —
            profiles, photos, stories, messages, voice notes or videos. Any account involved is
            <strong>removed immediately and permanently banned</strong>, together with its device.
        </p>

        <h2>Adults only (18+)</h2>
        <p>
            Hala is a social and dating app for adults aged <strong>18 and over</strong>. Minors are not allowed
            to use the app. Users confirm their date of birth at sign-up, and any account found to belong
            to a minor is deleted immediately and blocked from returning.
        </p>

        <h2>Prevention and moderation</h2>
        <ul>
            <li>Automatic filtering of prohibited words, explicit images and external contact sharing.</li>
            <li>A human moderation team reviews every user report; child-safety reports get the highest priority.</li>
            <li>Permanent bans of violating accounts and their devices to prevent re-registration.</li>
            <li>In-app <strong>Block</strong> and <strong>Report</strong> on every user, message, photo and story.</li>
        </ul>

        <h2>How to report</h2>
        <div class="box">
            Use <strong>Report</strong> inside the app on any profile, message, photo or story, or email our
            child-safety point of contact: <strong>${csMail('Child Safety Report')}</strong>.
            If a child is in immediate danger, contact your local law enforcement right away.
        </div>

        <h2>What we do when we find a violation</h2>
        <ul>
            <li>Remove the content immediately and preserve evidence as required by law.</li>
            <li>Permanently ban the account and its device.</li>
            <li>Report confirmed CSAM to the <strong>National Center for Missing &amp; Exploited Children (NCMEC)</strong>
                and to the relevant regional and national authorities, in compliance with applicable child-safety laws.</li>
        </ul>

        <h2>Child Safety point of contact</h2>
        <p>
            Our designated child-safety point of contact can discuss our CSAM prevention practices and
            compliance at any time: <strong>${csMail('Child Safety')}</strong>
        </p>
    </div>

    <hr style="border:none;border-top:1px solid var(--line);margin:32px 0">

    <div dir="rtl" lang="ar">
        <h1>معايير سلامة الأطفال — تطبيق هلا (ChatHala)</h1>
        <p class="sub">التطبيق: <strong>هلا – ChatHala</strong> · الحزمة <code>com.chathala.hala</code> ·
            <a href="${PLAY_URL}">صفحة التطبيق على Google Play</a></p>

        <h2>عدم تسامح مطلق</h2>
        <p>
            يمنع تطبيق هلا منعاً باتاً <strong>أي شكل من أشكال الاستغلال والإساءة الجنسية للأطفال (CSAE)</strong>،
            بما فيها مواد الاعتداء الجنسي على الأطفال (CSAM) والاستدراج والابتزاز الجنسي والاتجار وأي إضفاء
            للطابع الجنسي على القاصرين — في الملفات والصور والقصص والرسائل والصوت والفيديو. أي حساب يرتبط بذلك
            يُزال فوراً ويُحظر نهائياً مع جهازه.
        </p>

        <h2>التطبيق للبالغين 18+ فقط</h2>
        <p>
            هلا مخصّص لمن بلغوا <strong>18 عاماً فأكثر</strong>. يُمنع استخدامه من القاصرين، ويؤكد المستخدم تاريخ
            ميلاده عند التسجيل، وأي حساب يتبيّن أنه لقاصر يُحذف فوراً ويُمنع من العودة.
        </p>

        <h2>إجراءات الوقاية والإشراف</h2>
        <ul>
            <li>فلترة تلقائية للكلمات المحظورة والصور الصريحة ومشاركة الحسابات الخارجية.</li>
            <li>فريق إشراف بشري يراجع كل البلاغات، وبلاغات سلامة الأطفال لها الأولوية القصوى.</li>
            <li>حظر دائم للحسابات المخالفة وأجهزتها لمنع إعادة التسجيل.</li>
            <li>خيارا <strong>الحظر</strong> و<strong>الإبلاغ</strong> داخل التطبيق على كل مستخدم ورسالة وصورة وقصة.</li>
        </ul>

        <h2>كيف تُبلّغ</h2>
        <div class="box">
            استخدم <strong>«إبلاغ»</strong> داخل التطبيق، أو راسل جهة التواصل لسلامة الأطفال:
            <strong>${csMail('بلاغ سلامة أطفال')}</strong>. وإن كان طفل في خطر داهم فتواصل مع الجهات الأمنية فوراً.
        </div>

        <h2>إجراؤنا عند المخالفة</h2>
        <ul>
            <li>إزالة فورية للمحتوى مع حفظ الأدلة وفق القانون.</li>
            <li>حظر دائم للحساب والجهاز.</li>
            <li>إبلاغ <strong>المركز الوطني للأطفال المفقودين والمستغَلّين (NCMEC)</strong> والسلطات الإقليمية
                والوطنية المختصة وفق قوانين حماية الأطفال.</li>
        </ul>

        <h2>جهة التواصل لسلامة الأطفال</h2>
        <p>جهة تواصل مخصّصة مستعدة لمناقشة ممارساتنا في منع CSAM والامتثال: <strong>${csMail('سلامة الأطفال')}</strong></p>
    </div>
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
            <li>الملف الشخصي: الاسم، البريد الإلكتروني، الصور (بما فيها معرض الصور)، النبذة، الاهتمامات.</li>
            <li>المطابقات والإعجابات والتمريرات وزيارات الملف الشخصي.</li>
            <li>الأصدقاء وطلبات الصداقة وقوائم الأصدقاء.</li>
            <li>الإشعارات المرسلة والمستلمة.</li>
            <li>إعدادات الحساب ورموز الإشعارات.</li>
        </ul>

        <h2>الرسائل والمحادثات</h2>
        <ul>
            <li>تُفصل رسائلك عن هويتك نهائياً — يُحذف اسمك وصورك وكل بيانات ملفك.</li>
            <li>قد تبقى نسخة المحادثة لدى الطرف الآخر (كما هو معتاد في تطبيقات المراسلة)
                دون أي ربط بهويتك المحذوفة.</li>
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
    res.send(renderPage('Child Safety Standards — Hala (ChatHala) | معايير سلامة الأطفال', childSafetyBody));
});

router.get('/delete-account', (req, res) => {
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.send(renderPage('حذف الحساب والبيانات — تطبيق هلا (ChatHala)', deleteAccountBody));
});

module.exports = router;
