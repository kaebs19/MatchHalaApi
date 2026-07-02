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

    // ✅ التحكم بإصدارات التطبيق
    appVersionControl: {
        // الحد الأدنى المطلوب — أقل من هذا = تحديث إجباري (426)
        // ⚠️ قيمة مشتركة (fallback) تُستخدم عندما لا يُضبط حدّ خاص بالمنصّة
        minRequiredVersion: { type: String, default: '1.0' },
        // أحدث إصدار متاح
        latestVersion: { type: String, default: '2.4' },
        // رابط المتجر
        iosStoreURL: { type: String, default: '' },
        // رسالة التحديث (عربي)
        updateMessageAr: { type: String, default: 'يجب تحديث التطبيق للاستمرار. النسخة الحالية لم تعد مدعومة.' },
        // رسالة التحديث (إنجليزي)
        updateMessageEn: { type: String, default: 'Please update the app to continue. Your current version is no longer supported.' },
        // المفتاح الرئيسي لتفعيل/تعطيل فحص الإصدار (master switch)
        enforceUpdate: { type: Boolean, default: false },

        // ✅ إعدادات خاصة بكل منصّة (تتجاوز القيمة المشتركة عند ضبطها)
        // أندرويد: معطّل افتراضياً + حدّ منخفض حتى يُضبط من اللوحة
        android: {
            // حدّ أندرويد الأدنى — فارغ = استخدم القيمة المشتركة
            minRequiredVersion: { type: String, default: '1.0' },
            // فرض التحديث على أندرويد (false = لا يُحجب أبداً حتى لو كان master مفعّلاً)
            enforceUpdate: { type: Boolean, default: false },
            // رابط متجر أندرويد (Google Play)
            storeURL: { type: String, default: '' }
        },
        // iOS: يحافظ على السلوك الحالي (يتبع القيمة المشتركة)
        ios: {
            // حدّ iOS الأدنى — فارغ = استخدم القيمة المشتركة
            minRequiredVersion: { type: String, default: '' },
            // فرض التحديث على iOS (مفعّل افتراضياً ليطابق السلوك الحالي)
            enforceUpdate: { type: Boolean, default: true },
            // رابط متجر iOS — فارغ = استخدم iosStoreURL المشترك
            storeURL: { type: String, default: '' }
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

    // ✅ Sensitive Content Feature (Phase 1) — التحكم العام للأدمن
    // default: featureEnabled = false (آمن — يجب على الأدمن تفعيلها بعد iOS deploy)
    sensitiveContent: {
        // الميزة مفعّلة على مستوى التطبيق كله؟ (kill switch)
        featureEnabled: { type: Boolean, default: false },
        // أي banned word categories تخضع للإعداد (الباقي يبقى محجوب نهائياً)
        affectedCategories: { type: [String], default: ['sexual'] },
        // الحد الأدنى للعمر (يجب أن يكون 18+)
        minAge: { type: Number, default: 18 },
        // طلب تأكيد مزدوج قبل تفعيل المستخدم للإعداد
        requireDoubleConfirm: { type: Boolean, default: true },
        // الحد الأدنى لإصدار التطبيق الذي يدعم الميزة (version gate)
        minClientVersion: { type: String, default: '6.3' }
    },

    // ✅ إعلانات مكافئة (Rewarded Ads) — يتحكّم بها الأدمن، يقرأها التطبيق عبر /api/mobile/config/ads
    ads: {
        // kill switch عام: false = التطبيق يخفي أزرار "شاهد إعلان"
        enabled: { type: Boolean, default: false },
        // مزوّد الإعلانات (حالياً AdMob)
        provider: { type: String, default: 'admob' },
        // استخدام معرّفات إعلانات Google الاختبارية (أثناء التطوير/TestFlight)
        useTestAds: { type: Boolean, default: false },
        // AdMob App IDs
        admobAppIdIOS: { type: String, default: '' },
        admobAppIdAndroid: { type: String, default: '' },
        // Rewarded Ad Unit IDs
        rewardedAdUnitIOS: { type: String, default: '' },
        rewardedAdUnitAndroid: { type: String, default: '' }
    },

    // ✅ عجلة الحظ (Lucky Wheel) — خادمية بالكامل، يديرها الأدمن
    luckyWheel: {
        enabled: { type: Boolean, default: true },
        // مدّة تبريد الدوران المجاني (بالساعات)
        freeSpinCooldownHours: { type: Number, default: 24 },
        // تكلفة الدوران بالجواهر + الحدّ اليومي له
        gemSpinCost: { type: Number, default: 10 },
        gemSpinDailyLimit: { type: Number, default: 3 },
        // الحدّ اليومي لدورانات الإعلان (0 = بلا حد)
        adSpinDailyLimit: { type: Number, default: 10 },
        // الجوائز — السيرفر يختار حسب الأوزان (weight). type: gems | points | extra_spin | nothing
        prizes: {
            type: [{
                label: { type: String, required: true },
                type: { type: String, enum: ['gems', 'points', 'extra_spin', 'nothing'], default: 'gems' },
                amount: { type: Number, default: 0 },
                weight: { type: Number, default: 1, min: 0 }
            }],
            default: [
                { label: '5 جواهر', type: 'gems', amount: 5, weight: 30 },
                { label: '10 جواهر', type: 'gems', amount: 10, weight: 22 },
                { label: '20 جوهرة', type: 'gems', amount: 20, weight: 12 },
                { label: '50 جوهرة', type: 'gems', amount: 50, weight: 4 },
                { label: '50 نقطة', type: 'points', amount: 50, weight: 15 },
                { label: 'دورة إضافية', type: 'extra_spin', amount: 0, weight: 7 },
                { label: 'حظ أفضل', type: 'nothing', amount: 0, weight: 10 }
            ]
        }
    },

    // ✅ وضع الصيانة (Maintenance Mode)
    maintenanceMode: {
        enabled: { type: Boolean, default: false },
        messageAr: { type: String, default: 'نقوم بصيانة دورية لتحسين الخدمة. سنعود قريباً!' },
        messageEn: { type: String, default: 'We are performing scheduled maintenance. We will be back soon!' },
        estimatedEndAt: { type: Date, default: null },
        startedAt: { type: Date, default: null },
        startedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
        // auto = تم التفعيل تلقائياً بسبب فشل، manual = من admin
        triggerType: { type: String, enum: ['manual', 'auto'], default: 'manual' },
        // السماح للأدمن بالاستمرار حتى في وضع الصيانة
        allowAdmin: { type: Boolean, default: true }
    },

    // ✅ أنماط الترويج الخارجي الديناميكية
    promoKeywords: [{
        pattern: { type: String, required: true },
        category: { type: String, required: true },
        isRegex: { type: Boolean, default: false }
    }],

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
