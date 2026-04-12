// HalaChat Dashboard - Email Service
// خدمة إرسال البريد الإلكتروني

const nodemailer = require('nodemailer');

// التحقق من إعدادات البريد
const checkEmailConfig = () => {
    const requiredVars = ['EMAIL_USER', 'EMAIL_PASSWORD'];
    const missing = requiredVars.filter(v => !process.env[v]);

    if (missing.length > 0) {
        console.warn('⚠️ متغيرات البريد الإلكتروني المفقودة:', missing.join(', '));
        return false;
    }
    return true;
};

// إنشاء transporter بناءً على الإعدادات المتاحة
const createTransporter = () => {
    // Gmail مع إعدادات محددة
    return nodemailer.createTransport({
        host: 'smtp.gmail.com',
        port: 587,
        secure: false, // true for 465, false for 587
        auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASSWORD // يجب أن يكون App Password
        },
        tls: {
            rejectUnauthorized: false
        }
    });
};

const sendEmail = async (options) => {
    try {
        // التحقق من الإعدادات
        if (!checkEmailConfig()) {
            console.log('📧 وضع التجربة: البريد لن يُرسل فعلياً');
            console.log(`   المستقبل: ${options.email}`);
            console.log(`   الموضوع: ${options.subject}`);
            console.log(`   المحتوى: ${options.message?.substring(0, 100)}...`);

            // في بيئة التطوير، أعد نتيجة ناجحة مزيفة
            if (process.env.NODE_ENV === 'development') {
                return {
                    success: true,
                    messageId: 'dev-mode-' + Date.now(),
                    mode: 'development'
                };
            }

            throw new Error('إعدادات البريد الإلكتروني غير مكتملة. يرجى إعداد EMAIL_USER و EMAIL_PASSWORD في ملف .env');
        }

        // إنشاء transporter
        const transporter = createTransporter();

        // التحقق من الاتصال
        try {
            await transporter.verify();
            console.log('✅ تم الاتصال بخادم البريد بنجاح');
        } catch (verifyError) {
            console.error('❌ فشل الاتصال بخادم البريد:', verifyError.message);

            // رسائل مساعدة للمشاكل الشائعة
            if (verifyError.message.includes('Invalid login')) {
                throw new Error('بيانات تسجيل الدخول للبريد غير صحيحة. إذا كنت تستخدم Gmail، تأكد من استخدام App Password وليس كلمة المرور العادية');
            }
            if (verifyError.message.includes('ETIMEDOUT')) {
                throw new Error('انتهت مهلة الاتصال بخادم البريد. تحقق من إعدادات الشبكة أو جدار الحماية');
            }

            throw new Error(`فشل الاتصال بخادم البريد: ${verifyError.message}`);
        }

        // إعدادات الرسالة
        const mailOptions = {
            from: `${process.env.EMAIL_FROM_NAME || 'HalaChat'} <${process.env.EMAIL_USER}>`,
            to: options.email,
            subject: options.subject,
            text: options.message,
            html: options.html || options.message
        };

        // إرسال البريد
        const info = await transporter.sendMail(mailOptions);

        console.log('✅ تم إرسال البريد بنجاح:', info.messageId);
        return {
            success: true,
            messageId: info.messageId
        };

    } catch (error) {
        console.error('❌ خطأ في إرسال البريد:', error.message);

        // تحسين رسالة الخطأ
        let errorMessage = 'فشل إرسال البريد الإلكتروني';

        if (error.message.includes('Invalid login') || error.message.includes('authentication')) {
            errorMessage = 'فشل المصادقة مع خادم البريد. إذا كنت تستخدم Gmail:\n' +
                '1. فعّل التحقق بخطوتين في حساب Google\n' +
                '2. أنشئ App Password من: https://myaccount.google.com/apppasswords\n' +
                '3. استخدم App Password في EMAIL_PASSWORD';
        } else if (error.message.includes('ECONNREFUSED')) {
            errorMessage = 'تم رفض الاتصال بخادم البريد. تحقق من إعدادات HOST و PORT';
        } else if (error.message.includes('ETIMEDOUT')) {
            errorMessage = 'انتهت مهلة الاتصال بخادم البريد';
        } else if (error.message.includes('self signed certificate')) {
            errorMessage = 'مشكلة في شهادة SSL. جرب تغيير PORT إلى 587';
        }

        throw new Error(errorMessage);
    }
};

// دالة لاختبار إعدادات البريد
const testEmailConfig = async () => {
    try {
        if (!checkEmailConfig()) {
            return { success: false, message: 'إعدادات البريد غير مكتملة' };
        }

        const transporter = createTransporter();
        await transporter.verify();

        return { success: true, message: 'إعدادات البريد صحيحة' };
    } catch (error) {
        return { success: false, message: error.message };
    }
};

module.exports = sendEmail;
module.exports.testEmailConfig = testEmailConfig;
