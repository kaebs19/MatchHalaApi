// MatchHala - Violation Model
// سجل مخالفات موحّد لكل المستخدمين
// يحفظ كل حالة مخالفة مع الدليل + نوعها + الإجراء المتخذ
// الأدلة: رسائل/صور/نصوص (bio, name) تُحفظ كـ snapshot ثابت حتى لو المحتوى تغيّر لاحقاً

const mongoose = require('mongoose');

const violationSchema = new mongoose.Schema({
    // المستخدم المُخالِف
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },

    // نوع المخالفة
    type: {
        type: String,
        enum: [
            'banned_word',      // كلمة محظورة في رسالة
            'photo',            // صورة مخالفة
            'name',             // اسم مخالف
            'bio',              // نبذة مخالفة
            'behavior',         // سلوك مزعج/مضايقات
            'inappropriate',    // محتوى غير لائق (عام)
            'spam',             // سبام
            'report',           // بلاغ من مستخدم تم قبوله
            'external_promo',   // ✅ ترويج خارجي (Snap/Insta/زنجي/واتس/رقم/...)
            'other'
        ],
        required: true,
        index: true
    },

    // السبب (نص حر، مثل "كس" أو "اسم غير لائق")
    reason: { type: String, default: null },

    // الإجراء المتخذ
    action: {
        type: String,
        enum: ['warning', 'restricted', 'suspended', 'banned', 'photo_removed', 'name_reset', 'bio_reset', 'none'],
        default: 'warning'
    },

    // مستوى التصعيد الذي وصل إليه المستخدم بعد هذه المخالفة (0-7)
    escalationLevel: { type: Number, default: 0, min: 0, max: 7 },

    // المصدر
    source: {
        type: String,
        enum: ['auto', 'admin', 'user_report', 'banned_words_filter', 'spam_filter', 'external_promo_filter'],
        default: 'admin'
    },

    // الأدمن الذي اتخذ الإجراء (إن وجد)
    admin: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null
    },

    // ========== الدليل (Evidence) ==========
    evidence: {
        // نوع الدليل
        kind: {
            type: String,
            enum: ['text', 'message', 'photo', 'name', 'bio', 'report', 'none'],
            default: 'none'
        },
        // نص الدليل (لرسائل/أسماء/نبذات)
        text: { type: String, default: null },
        // المسار المحفوظ للصورة (بعد نقلها لـ /uploads/violations/)
        // مثال: /uploads/violations/USERID/1234567890_original.jpg
        photoPath: { type: String, default: null },
        // المسار الأصلي قبل النقل (للمرجع)
        originalPhotoPath: { type: String, default: null },
        // معرّف الرسالة (إن كان الدليل رسالة)
        messageId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Message',
            default: null
        },
        // معرّف المحادثة
        conversationId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Conversation',
            default: null
        },
        // معرّف البلاغ (إن وجد)
        reportId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Report',
            default: null
        },
        // ميتاداتا إضافية (حسب النوع)
        metadata: { type: mongoose.Schema.Types.Mixed, default: null }
    },

    // ربط بتنبيه رسمي أُرسل للمستخدم
    officialWarning: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'OfficialWarning',
        default: null
    },

    // ملاحظات إدارية داخلية
    adminNotes: { type: String, default: null }
}, {
    timestamps: true
});

// Indexes للأداء
violationSchema.index({ user: 1, createdAt: -1 });
violationSchema.index({ type: 1, createdAt: -1 });
violationSchema.index({ 'evidence.conversationId': 1 });
violationSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Violation', violationSchema);
