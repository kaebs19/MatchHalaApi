// MatchHala — غلاف توافقي
// المنطق كله في services/emailService.js. هذا الملف يحفظ التوقيع القديم
// ({ email, subject, message, html }) الذي تستدعيه routes/auth.js.

const emailService = require('../services/emailService');

/**
 * @param {Object} options
 * @param {string} options.email المستقبِل
 * @param {string} options.subject
 * @param {string} [options.message] النسخة النصية
 * @param {string} [options.html]
 * @returns {Promise<{success:boolean, messageId:string}>} يرمي استثناءً عند الفشل
 */
const sendEmail = async (options) => {
    try {
        const info = await emailService.deliver({
            to: options.email,
            subject: options.subject,
            html: options.html || options.message,
            text: options.message
        });

        console.log('✅ تم إرسال البريد بنجاح:', info.messageId);
        return { success: true, messageId: info.messageId };

    } catch (error) {
        console.error('❌ خطأ في إرسال البريد:', error.message);

        let errorMessage = 'فشل إرسال البريد الإلكتروني';
        const msg = error.message || '';

        if (msg.includes('Invalid login') || msg.includes('authentication') || msg.includes('535')) {
            errorMessage = 'فشل المصادقة مع خادم البريد — تحقق من EMAIL_USER و EMAIL_PASSWORD';
        } else if (msg.includes('ECONNREFUSED')) {
            errorMessage = 'تم رفض الاتصال بخادم البريد. تحقق من EMAIL_HOST و EMAIL_PORT';
        } else if (msg.includes('ETIMEDOUT')) {
            errorMessage = 'انتهت مهلة الاتصال بخادم البريد';
        } else if (msg.includes('إعدادات البريد غير مكتملة')) {
            errorMessage = msg;
        }

        throw new Error(errorMessage);
    }
};

// اختبار الإعدادات — يُستخدم يدوياً عند تغيير المزوّد
const testEmailConfig = async () => {
    try {
        await emailService.deliver({
            to: process.env.EMAIL_REPLY_TO || process.env.EMAIL_FROM_ADDRESS,
            subject: 'اختبار إعدادات البريد',
            html: '<p>الإعدادات تعمل.</p>',
            text: 'الإعدادات تعمل.'
        });
        return { success: true, message: 'إعدادات البريد صحيحة' };
    } catch (error) {
        return { success: false, message: error.message };
    }
};

module.exports = sendEmail;
module.exports.testEmailConfig = testEmailConfig;
