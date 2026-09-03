// MatchHala — Email Service
// المصدر الوحيد لإرسال البريد في المشروع.
// utils/sendEmail.js غلاف رفيع فوقه (توافق مع النداءات القديمة).

const nodemailer = require('nodemailer');

let transporter = null;

// ── الهوية البصرية ──────────────────────────────────────────────
const BRAND_NAME = process.env.EMAIL_FROM_NAME || 'MatchHala';
const BRAND_COLOR = process.env.EMAIL_BRAND_COLOR || '#007bff';
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
 * غلاف HTML موحّد لكل رسائل المشروع.
 * @param {Object} opts
 * @param {string} opts.title عنوان الرسالة الظاهر في الرأس
 * @param {string} opts.body محتوى HTML جاهز
 * @param {string} [opts.preheader] سطر المعاينة في صندوق الوارد
 * @param {string} [opts.accent] لون الرأس
 */
function layout({ title, body, preheader = '', accent = BRAND_COLOR }) {
    return `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<title>${escapeHtml(title)}</title>
</head>
<body style="margin:0;padding:0;background:#f4f5f7;">
${preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preheader)}</div>` : ''}
<div dir="rtl" style="font-family:Tahoma,Arial,'Segoe UI',sans-serif;padding:24px 16px;background:#f4f5f7;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 10px rgba(0,0,0,0.06);">
    <div style="background:${accent};padding:18px 24px;">
      <h1 style="margin:0;font-size:18px;color:#ffffff;font-weight:bold;">${escapeHtml(title)}</h1>
    </div>
    <div style="padding:24px;text-align:right;color:#333333;line-height:1.7;font-size:15px;">
      ${body}
    </div>
    <div style="border-top:1px solid #eeeeee;padding:16px 24px;text-align:center;">
      <p style="margin:0;font-size:12px;color:#999999;">${escapeHtml(BRAND_NAME)}</p>
      ${SUPPORT_EMAIL ? `<p style="margin:6px 0 0;font-size:12px;color:#999999;">للاستفسار: <a href="mailto:${SUPPORT_EMAIL}" style="color:${accent};text-decoration:none;">${SUPPORT_EMAIL}</a></p>` : ''}
    </div>
  </div>
</div>
</body>
</html>`;
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
 * @returns {{html:string, text:string}}
 */
function renderCodeEmail({ title, name, intro, code, minutes = 10, warning }) {
    const body = `
      <p style="margin:0 0 12px;">مرحباً ${escapeHtml(name)},</p>
      <p style="margin:0 0 20px;color:#666666;">${escapeHtml(intro)}</p>
      <div style="background:#f7f8fa;border:1px solid #eeeeee;border-radius:8px;padding:20px;text-align:center;margin:0 0 20px;">
        <p style="margin:0 0 10px;color:#666666;font-size:14px;">رمز التحقق الخاص بك:</p>
        <div dir="ltr" style="font-size:34px;font-weight:bold;letter-spacing:8px;color:${BRAND_COLOR};font-family:'Courier New',monospace;">${escapeHtml(code)}</div>
      </div>
      <p style="margin:0 0 8px;color:#666666;font-size:14px;">هذا الرمز صالح لمدة ${minutes} دقائق فقط.</p>
      <p style="margin:0;color:#999999;font-size:13px;">${escapeHtml(warning || 'إذا لم تطلب هذا الرمز، تجاهل الرسالة ولا تشاركه مع أحد.')}</p>
    `;

    const text = `مرحباً ${name},\n\n${intro}\n\nرمز التحقق الخاص بك: ${code}\n\nصالح لمدة ${minutes} دقائق.\n${warning || 'إذا لم تطلب هذا الرمز، تجاهل الرسالة ولا تشاركه مع أحد.'}`;

    return { html: layout({ title, body, preheader: `رمز التحقق صالح ${minutes} دقائق` }), text };
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
        html: layout({ title: statusAr, body, accent, preheader: 'تحديث على استئناف حظر جهازك' })
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

module.exports = { deliver, sendEmail, sendAppealUpdate, layout, renderCodeEmail, escapeHtml };
