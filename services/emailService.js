// MatchHala — Email Service
// خدمة إرسال emails باستخدام nodemailer
// تُستخدم حالياً لاستئنافات حظر الجهاز (المستخدم بدون login → push مستحيل)

const nodemailer = require('nodemailer');

let transporter = null;

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
 * إرسال email عام
 * @param {Object} opts
 * @param {string} opts.to
 * @param {string} opts.subject
 * @param {string} opts.html
 * @returns {Promise<boolean>} نجح أو لا
 */
async function sendEmail({ to, subject, html }) {
    try {
        const t = getTransporter();
        if (!t) return false;

        const fromName = process.env.EMAIL_FROM_NAME || 'Hala Chat';
        const fromAddress = process.env.EMAIL_USER;
        await t.sendMail({
            from: `"${fromName}" <${fromAddress}>`,
            to,
            subject,
            html
        });
        return true;
    } catch (error) {
        console.error('❌ EmailService error:', error.message);
        return false;
    }
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

    const color = status === 'approved' ? '#28a745' : status === 'rejected' ? '#dc3545' : '#007bff';

    const html = `
        <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;background:#f7f7fa;direction:rtl;text-align:right;">
            <div style="background:${color};color:#fff;padding:16px 20px;border-radius:10px 10px 0 0;">
                <h2 style="margin:0;font-size:18px;">${statusAr}</h2>
            </div>
            <div style="background:#fff;padding:20px;border-radius:0 0 10px 10px;box-shadow:0 2px 8px rgba(0,0,0,0.05);">
                ${adminMessage ? `<div style="background:#f0f4ff;border-inline-start:3px solid ${color};padding:12px 14px;margin:12px 0;border-radius:6px;">
                    <strong style="color:${color};display:block;margin-bottom:6px;">رسالة من الإدارة:</strong>
                    <p style="margin:0;color:#333;line-height:1.6;white-space:pre-wrap;">${escapeHtml(adminMessage)}</p>
                </div>` : ''}
                ${status === 'approved' ? `
                    <p style="color:#333;line-height:1.7;">تم فك الحظر عن جهازك. يمكنك الآن تسجيل الدخول عبر التطبيق واستخدامه بشكل طبيعي.</p>
                ` : status === 'rejected' ? `
                    <p style="color:#333;line-height:1.7;">للأسف، بعد مراجعة استئنافك تقرر عدم فك الحظر. إذا كان لديك معلومات إضافية، يمكنك التواصل مع الدعم.</p>
                ` : `
                    <p style="color:#333;line-height:1.7;">طلبك قيد المراجعة. إذا رغبت بالرد، افتح التطبيق واذهب إلى شاشة الاستئناف.</p>
                `}
                <hr style="border:none;border-top:1px solid #eee;margin:20px 0;">
                <p style="font-size:12px;color:#999;margin:0;">
                    معرّف الاستئناف: <code style="font-size:11px;">${appealId}</code>
                </p>
            </div>
            <p style="text-align:center;color:#999;font-size:11px;margin-top:16px;">
                Hala Chat — نظام الإدارة الآلي
            </p>
        </div>
    `;

    return sendEmail({
        to: email,
        subject: statusAr,
        html
    });
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

module.exports = { sendEmail, sendAppealUpdate };
