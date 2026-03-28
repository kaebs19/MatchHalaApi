// نموذج الإعدادات - Settings Model
const mongoose = require('mongoose');

const settingsSchema = new mongoose.Schema({
    // إعدادات التطبيق العامة
    appName: {
        type: String,
        default: 'HalaChat'
    },
    appVersion: {
        type: String,
        default: '1.0.0'
    },
    appLogo: {
        type: String,
        default: ''
    },

    // صفحات المحتوى القابلة للتعديل
    privacyPolicy: {
        type: String,
        default: '# سياسة الخصوصية\n\nمرحباً بك في HalaChat. نحن نحترم خصوصيتك...'
    },
    termsOfService: {
        type: String,
        default: '# شروط الاستخدام\n\nبإستخدامك لـ HalaChat، فإنك توافق على...'
    },
    aboutApp: {
        type: String,
        default: '# حول التطبيق\n\nHalaChat هو تطبيق محادثة فوري...'
    },
    contactUs: {
        type: String,
        default: '# اتصل بنا\n\nنحن سعداء بتواصلك معنا! يمكنك التواصل عبر:\n\n- البريد الإلكتروني: support@halachat.com\n- الهاتف: +966xxxxxxxxx'
    },

    // إعدادات الإشعارات
    notificationsEnabled: {
        type: Boolean,
        default: true
    },
    emailNotifications: {
        type: Boolean,
        default: true
    },

    // إعدادات المحادثات
    maxConversationParticipants: {
        type: Number,
        default: 100
    },
    maxMessageLength: {
        type: Number,
        default: 5000
    },
    allowFileUploads: {
        type: Boolean,
        default: true
    },
    maxFileSize: {
        type: Number,
        default: 10 // بالميجابايت
    },

    // إعدادات الأمان
    requireEmailVerification: {
        type: Boolean,
        default: false
    },
    allowUserRegistration: {
        type: Boolean,
        default: true
    },
    sessionTimeout: {
        type: Number,
        default: 30 // بالأيام
    },

    // معلومات الاتصال
    contactEmail: {
        type: String,
        default: 'support@halachat.com'
    },
    contactPhone: {
        type: String,
        default: ''
    },
    websiteUrl: {
        type: String,
        default: 'https://halachat.com'
    },

    // وسائل التواصل الاجتماعي
    socialMedia: {
        facebook: {
            type: String,
            default: ''
        },
        twitter: {
            type: String,
            default: ''
        },
        instagram: {
            type: String,
            default: ''
        },
        linkedin: {
            type: String,
            default: ''
        }
    },

    // ✅ الأسماء المحظورة
    bannedNames: [{
        name: { type: String, lowercase: true, trim: true },
        reason: { type: String, default: 'اسم غير لائق' },
        addedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        addedAt: { type: Date, default: Date.now }
    }],

    // ✅ حد المخالفات قبل الحظر التلقائي
    maxBannedWordViolations: {
        type: Number,
        default: 3
    },

    // آخر تحديث
    lastUpdated: {
        type: Date,
        default: Date.now
    },
    updatedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }
}, {
    timestamps: true
});

// Singleton pattern - نموذج واحد فقط للإعدادات
settingsSchema.statics.getSettings = async function() {
    let settings = await this.findOne();
    if (!settings) {
        settings = await this.create({});
    }
    return settings;
};

module.exports = mongoose.model('Settings', settingsSchema);
