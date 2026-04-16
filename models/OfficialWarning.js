// MatchHala - Official Warning Model
// التنبيهات الرسمية من الإدارة للمستخدم
// تظهر كـ Modal إجباري داخل التطبيق عند الفتح + إشعار Push + إشعار داخلي
// المستخدم لازم "يؤكد/يوافق" قبل ما يقدر يكمل استخدام التطبيق

const mongoose = require('mongoose');

const officialWarningSchema = new mongoose.Schema({
    // المستخدم المستهدف
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },

    // نوع التنبيه (يقابل القوالب السبعة)
    type: {
        type: String,
        enum: [
            'photo_violation',       // صورة مخالفة
            'name_violation',        // اسم مخالف
            'inappropriate_content', // محتوى غير لائق
            'disruptive_behavior',   // سلوك مزعج
            'bio_violation',         // نبذة مخالفة
            'final_warning',         // تحذير أخير
            'custom'                 // رسالة مخصصة
        ],
        required: true,
        index: true
    },

    // العنوان والنص
    title: { type: String, required: true },
    body: { type: String, required: true },

    // المستوى (informational / warning / critical)
    severity: {
        type: String,
        enum: ['info', 'warning', 'critical'],
        default: 'warning'
    },

    // أيقونة/إيموجي (للعرض)
    icon: { type: String, default: '⚠️' },

    // هل هو blocking (يمنع استخدام التطبيق حتى التأكيد)
    isBlocking: { type: Boolean, default: true },

    // الأدمن الذي أرسل
    sentBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null
    },

    // تواريخ الحالات
    sentAt: { type: Date, default: Date.now, index: true },
    readAt: { type: Date, default: null },           // متى ظهر له
    acknowledgedAt: { type: Date, default: null },   // متى ضغط "فهمت"
    dismissedAt: { type: Date, default: null },      // متى أخفاه الأدمن

    // حالة التنبيه
    status: {
        type: String,
        enum: ['active', 'acknowledged', 'dismissed', 'expired'],
        default: 'active',
        index: true
    },

    // ربط المخالفة (إن كان التنبيه مرتبط بـ Violation)
    violation: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Violation',
        default: null
    },

    // ميتاداتا إضافية
    metadata: { type: mongoose.Schema.Types.Mixed, default: null }
}, {
    timestamps: true
});

// Indexes
officialWarningSchema.index({ user: 1, status: 1, sentAt: -1 });
officialWarningSchema.index({ status: 1, isBlocking: 1 });

module.exports = mongoose.model('OfficialWarning', officialWarningSchema);
