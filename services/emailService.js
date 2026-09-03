// MatchHala — Email Service
// المصدر الوحيد لإرسال البريد في المشروع.
// utils/sendEmail.js غلاف رفيع فوقه (توافق مع النداءات القديمة).

const nodemailer = require('nodemailer');

let transporter = null;

// ── الهوية البصرية ──────────────────────────────────────────────
// الألوان مستخرجة من الشعار (سماوي) — لا من قيم عامة
const BRAND_NAME   = process.env.EMAIL_FROM_NAME || 'MatchHala';
const BRAND_COLOR  = process.env.EMAIL_BRAND_COLOR || '#1E7696';  // سماوي داكن — تباين كافٍ مع الأبيض
const BRAND_LIGHT  = process.env.EMAIL_BRAND_LIGHT || '#33CEEC';
const SITE_URL     = process.env.EMAIL_SITE_URL || 'https://www.chathala.com';
const LOGO_URL     = process.env.EMAIL_LOGO_URL || 'https://www.chathala.com/images/logo-192.png';
const SUPPORT_EMAIL = process.env.EMAIL_REPLY_TO || '';

function getTransporter() {
    if (transporter) return transporter;

    const host = process.env.EMAIL_HOST;
    const port = parseInt(process.env.EMAIL_PORT || '587');
    const user = process.env.EMAIL_USER;
    const pass = process.env.EMAIL_PASSWORD;

    if (!host || !user || !pass) {
        console.warn('⚠️ EmailService: بيانات SMTP غير كاملة في .env');
        return null;
    }

    transporter = nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth: { user, pass }
    });
    return transporter;
}

/**
 * الإرسال الأساسي — يرمي استثناءً عند الفشل.
 * @param {Object} opts
 * @param {string} opts.to
 * @param {string} opts.subject
 * @param {string} opts.html
 * @param {string} [opts.text] نسخة نصية (تحسّن تقييم مرشّحات السبام)
 * @returns {Promise<{messageId:string}>}
 */
async function deliver({ to, subject, html, text }) {
    const t = getTransporter();
    if (!t) throw new Error('إعدادات البريد غير مكتملة (EMAIL_HOST / EMAIL_USER / EMAIL_PASSWORD)');

    // مع Resend وSES يكون EMAIL_USER مفتاحاً لا عنواناً — لذلك العنوان منفصل
    const fromAddress = process.env.EMAIL_FROM_ADDRESS || process.env.EMAIL_USER;

    const message = {
        from: `"${BRAND_NAME}" <${fromAddress}>`,
        to,
        subject,
        html,
        // معرّف فريد يمنع Gmail من ضمّ رموز التحقق المتتالية في خيط واحد
        headers: { 'X-Entity-Ref-ID': `${Date.now()}-${Math.random().toString(36).slice(2, 10)}` }
    };
    if (text) message.text = text;
    if (SUPPORT_EMAIL) message.replyTo = SUPPORT_EMAIL;

    return t.sendMail(message);
}

/**
 * إرسال «هادئ» — يعيد true/false ولا يرمي. للمسارات التي لا يجوز أن يوقفها فشل بريد.
 */
async function sendEmail({ to, subject, html, text }) {
    try {
        await deliver({ to, subject, html, text });
        return true;
    } catch (error) {
        console.error('❌ EmailService error:', error.message);
        return false;
    }
}

// ── القالب الموحّد ──────────────────────────────────────────────

/**
 * غلاف HTML موحّد لكل رسائل المشروع — جداول لضمان العرض في Outlook.
 * @param {Object} opts
 * @param {string} opts.title العنوان في رأس البطاقة
 * @param {string} opts.body محتوى HTML جاهز
 * @param {string} [opts.preheader] سطر المعاينة في صندوق الوارد
 * @param {string} [opts.accent] لون الرأس
 * @param {string} [opts.recipient] يُذكر في التذييل: «أُرسلت إلى …»
 */
function layout({ title, body, preheader = '', accent = BRAND_COLOR, recipient = '' }) {
    const FONT = "Tahoma,Arial,'Segoe UI','Helvetica Neue',sans-serif";
    const link = (href, label) =>
        `<a href="${href}" style="color:#7A8B93;text-decoration:none;font-size:12px;">${label}</a>`;

    return `<!DOCTYPE html>
<html dir="rtl" lang="ar" xmlns:v="urn:schemas-microsoft-com:vml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light only">
<title>${escapeHtml(title)}</title>
<style>
  @media only screen and (max-width:620px){
    .wrap{width:100% !important;}
    .pad{padding-left:20px !important;padding-right:20px !important;}
    .code{font-size:30px !important;letter-spacing:6px !important;}
  }
</style>
</head>
<body style="margin:0;padding:0;background-color:#EEF3F5;">
<div style="display:none;font-size:1px;color:#EEF3F5;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${escapeHtml(preheader)}&#8203;&nbsp;&#8203;&nbsp;&#8203;&nbsp;&#8203;&nbsp;&#8203;&nbsp;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#EEF3F5;">
 <tr><td align="center" style="padding:32px 12px;">

  <table role="presentation" class="wrap" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;background-color:#FFFFFF;border-radius:14px;border:1px solid #E1E9ED;overflow:hidden;">

   <!-- الرأس -->
   <tr><td align="center" bgcolor="${accent}" style="background-color:${accent};padding:26px 24px;">
     <img src="${LOGO_URL}" width="52" height="52" alt="${escapeHtml(BRAND_NAME)}" style="display:block;border:0;border-radius:12px;margin:0 auto 10px;">
     <div style="font-family:${FONT};font-size:19px;line-height:1.4;font-weight:bold;color:#FFFFFF;">${escapeHtml(title)}</div>
   </td></tr>

   <!-- المحتوى -->
   <tr><td class="pad" dir="rtl" align="right" style="padding:30px 34px 26px;font-family:${FONT};font-size:15px;line-height:1.75;color:#2C3A41;">
${body}
   </td></tr>

   <!-- التذييل -->
   <tr><td style="border-top:1px solid #EDF1F3;background-color:#FAFCFD;padding:0;">
     <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr><td align="center" style="padding:18px 24px 6px;font-family:${FONT};">
        ${link(SITE_URL, 'الموقع')}
        <span style="color:#CFD9DE;font-size:12px;">&nbsp;·&nbsp;</span>
        ${link(SITE_URL + '/support', 'الدعم')}
        <span style="color:#CFD9DE;font-size:12px;">&nbsp;·&nbsp;</span>
        ${link(SITE_URL + '/privacy', 'الخصوصية')}
        <span style="color:#CFD9DE;font-size:12px;">&nbsp;·&nbsp;</span>
        ${link(SITE_URL + '/terms', 'الشروط')}
      </td></tr>
      <tr><td align="center" style="padding:2px 24px 20px;font-family:${FONT};font-size:11px;line-height:1.7;color:#9AA9B1;">
        ${recipient ? `رسالة آلية أُرسلت إلى ${escapeHtml(recipient)} — لا تحتاج رداً.<br>` : 'رسالة آلية — لا تحتاج رداً.<br>'}
        ${SUPPORT_EMAIL ? `للاستفسار: <a href="mailto:${SUPPORT_EMAIL}" style="color:${accent};text-decoration:none;">${SUPPORT_EMAIL}</a><br>` : ''}
        &copy; ${new Date().getFullYear()} ${escapeHtml(BRAND_NAME)}
      </td></tr>
     </table>
   </td></tr>

  </table>
 </td></tr>
</table>
</body>
</html>`;
}

/**
 * زر مقاوم لعملاء البريد (جدول + خلفية على الخلية، لا div).
 */
function button(href, label, accent = BRAND_COLOR) {
    const FONT = "Tahoma,Arial,'Segoe UI',sans-serif";
    return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto;">
       <tr><td align="center" bgcolor="${accent}" style="background-color:${accent};border-radius:9px;">
         <a href="${href}" style="display:inline-block;padding:13px 34px;font-family:${FONT};font-size:15px;font-weight:bold;color:#FFFFFF;text-decoration:none;border-radius:9px;">${escapeHtml(label)}</a>
       </td></tr>
      </table>`;
}

/**
 * رسالة رمز تحقق من ٦ أرقام.
 * @param {Object} opts
 * @param {string} opts.title
 * @param {string} opts.name اسم المستقبِل
 * @param {string} opts.intro سطر الشرح
 * @param {string} opts.code
 * @param {number} [opts.minutes] مدة الصلاحية
 * @param {string} [opts.warning] سطر «إن لم تطلب هذا…»
 * @param {string} [opts.recipient] البريد المستقبِل — يظهر في التذييل
 * @param {string} [opts.ctaUrl] وجهة الزر
 * @param {string} [opts.ctaText] نص الزر
 * @returns {{html:string, text:string}}
 */
function renderCodeEmail({ title, name, intro, code, minutes = 10, warning, recipient,
                           ctaUrl = SITE_URL + '/download', ctaText = 'فتح التطبيق' }) {
    const warn = warning || 'إذا لم تطلب هذا الرمز، تجاهل الرسالة ولا تشاركه مع أحد.';
    const FONT = "Tahoma,Arial,'Segoe UI',sans-serif";

    const body = `
      <p style="margin:0 0 10px;font-size:16px;color:#16232A;">مرحباً ${escapeHtml(name)},</p>
      <p style="margin:0 0 22px;color:#5A6C75;">${escapeHtml(intro)}</p>

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
       <tr><td align="center" bgcolor="#F4FAFC" style="background-color:#F4FAFC;border:1px solid #DCEBF1;border-radius:11px;padding:22px 16px;">
         <div style="font-family:${FONT};font-size:12px;letter-spacing:1px;color:#7C8E97;margin:0 0 12px;">رمز التحقق الخاص بك</div>
         <div dir="ltr" class="code" style="font-family:'SF Mono',Menlo,Consolas,'Courier New',monospace;font-size:36px;line-height:1.1;font-weight:bold;letter-spacing:9px;color:${BRAND_COLOR};">${escapeHtml(code)}</div>
         <div style="font-family:${FONT};font-size:12px;color:#8B9BA3;margin:14px 0 0;">صالح لمدة ${minutes} دقائق</div>
       </td></tr>
      </table>

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
       <tr><td align="center" style="padding:26px 0 6px;">
         ${button(ctaUrl, ctaText)}
       </td></tr>
      </table>

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
       <tr><td style="border-top:1px solid #EDF1F3;padding:20px 0 0;margin:22px 0 0;">
         <p style="margin:0;font-size:13px;line-height:1.7;color:#8B9BA3;">🔒 ${escapeHtml(warn)}</p>
       </td></tr>
      </table>
    `;

    const text = `مرحباً ${name},\n\n${intro}\n\nرمز التحقق الخاص بك: ${code}\nصالح لمدة ${minutes} دقائق.\n\n${warn}\n\n${BRAND_NAME} — ${SITE_URL}`;

    return {
        html: layout({ title, body, preheader: `رمزك ${code} — صالح ${minutes} دقائق`, recipient }),
        text
    };
}

/**
 * إرسال تحديث حالة استئناف (قبول/رفض/رد)
 */
async function sendAppealUpdate(email, { status, adminMessage, appealId }) {
    const statusAr = {
        approved: '✅ تمت الموافقة على استئنافك',
        rejected: '❌ تم رفض استئنافك',
        reply: '💬 رد جديد من الإدارة على استئنافك'
    }[status] || 'تحديث على استئنافك';

    const accent = status === 'approved' ? '#28a745' : status === 'rejected' ? '#dc3545' : BRAND_COLOR;

    const body = `
        ${adminMessage ? `<div style="background:#f0f4ff;border-inline-start:3px solid ${accent};padding:12px 14px;margin:0 0 16px;border-radius:6px;">
            <strong style="color:${accent};display:block;margin-bottom:6px;">رسالة من الإدارة:</strong>
            <p style="margin:0;color:#333333;line-height:1.6;white-space:pre-wrap;">${escapeHtml(adminMessage)}</p>
        </div>` : ''}
        ${status === 'approved'
            ? `<p style="margin:0;">تم فك الحظر عن جهازك. يمكنك الآن تسجيل الدخول عبر التطبيق واستخدامه بشكل طبيعي.</p>`
            : status === 'rejected'
            ? `<p style="margin:0;">للأسف، بعد مراجعة استئنافك تقرر عدم فك الحظر. إذا كان لديك معلومات إضافية، يمكنك التواصل مع الدعم.</p>`
            : `<p style="margin:0;">طلبك قيد المراجعة. إذا رغبت بالرد، افتح التطبيق واذهب إلى شاشة الاستئناف.</p>`}
        <hr style="border:none;border-top:1px solid #eeeeee;margin:20px 0 12px;">
        <p style="margin:0;font-size:12px;color:#999999;">معرّف الاستئناف: <code style="font-size:11px;">${escapeHtml(appealId)}</code></p>
    `;

    return sendEmail({
        to: email,
        subject: statusAr,
        html: layout({ title: statusAr, body, accent, preheader: 'تحديث على استئناف حظر جهازك', recipient: email })
    });
}

function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

module.exports = { deliver, sendEmail, sendAppealUpdate, layout, button, renderCodeEmail, escapeHtml };
