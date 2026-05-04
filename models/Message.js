// MatchHala - Message Model
// نموذج الرسالة في قاعدة البيانات

const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
    // للمحادثات الخاصة
    conversation: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Conversation',
        required: true
    },

    sender: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: [true, 'المرسل مطلوب']
    },
    content: {
        type: String,
        required: [function() { return this.type === 'text'; }, 'محتوى الرسالة مطلوب'],
        trim: true,
        default: ''
    },
    // رابط الوسائط (للصور والفيديو والملفات)
    mediaUrl: {
        type: String,
        default: ''
    },
    type: {
        type: String,
        enum: ['text', 'image', 'file', 'audio', 'video', 'system'],
        default: 'text'
    },
    status: {
        type: String,
        enum: ['sent', 'delivered', 'read'],
        default: 'sent'
    },
    // تتبع من قرأ الرسالة
    readBy: [{
        user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        readAt: { type: Date, default: Date.now }
    }],
    // الرد على رسالة
    replyTo: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Message'
    },
    // ردود الفعل (Reactions)
    reactions: [{
        user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        emoji: { type: String, required: true },
        createdAt: { type: Date, default: Date.now }
    }],
    isDeleted: {
        type: Boolean,
        default: false
    },
    deletedAt: {
        type: Date
    },
    deletedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null
    },
    // ✅ تشفير الرسالة كنجوم (من الأدمن) — النص يتحول لـ ★★★★
    isCensored: {
        type: Boolean,
        default: false
    },
    censoredAt: {
        type: Date,
        default: null
    },
    censoredBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null
    },
    // ✅ مصدر الصورة (كاميرا أو معرض)
    imageSource: {
        type: String,
        enum: ['camera', 'gallery', null],
        default: null
    },
    // ✅ الصور المؤقتة (تختفي بعد المشاهدة)
    disappearing: {
        enabled: { type: Boolean, default: false },
        duration: { type: Number, default: null },    // مدة العرض بالثواني (5, 10, 30)
        expiresAt: { type: Date, default: null },      // وقت انتهاء الصلاحية
        viewedBy: [{
            user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
            viewedAt: { type: Date, default: Date.now },
            expired: { type: Boolean, default: false }
        }]
    },
    // ✅ إشعارات الأمان
    securityAlerts: [{
        type: { type: String, enum: ['screenshot', 'screen_record', 'photo_saved'] },
        user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        createdAt: { type: Date, default: Date.now }
    }],
    metadata: {
        fileUrl: String,
        fileName: String,
        fileSize: Number,
        mimeType: String
    },
    // ✅ بيانات الرسالة الصوتية
    audioWaveform: { type: [Number], default: undefined },
    audioDuration: { type: Number, default: null },
    // ✅ Photo Privacy Lock — صورة مقفلة (blurred) حتى يطلب المستلم unlock
    isBlurred: { type: Boolean, default: false },
    blurredUnlockedFor: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],

    // ✅ Sensitive Content (Phase 1) — Additive only, backward-compatible
    // إذا الرسالة تحتوي محتوى حساس (مثلاً banned word category=sexual)
    hasFlaggedContent: { type: Boolean, default: false },
    // فئة المحتوى الحساس (sexual فقط حالياً، قابل للتوسيع)
    flaggedCategory: {
        type: String,
        enum: ['sexual', 'violence', 'hate', 'spam', 'other', null],
        default: null
    },
    // النص الأصلي قبل التكتيم — محمي بـ select: false (لا يُرجع افتراضياً)
    // يُرجع فقط عبر endpoint /reveal مع التحقق من الإذن + العمر + setting
    originalContent: { type: String, default: null, select: false }
}, {
    timestamps: true
});

// Indexes للبحث السريع
messageSchema.index({ conversation: 1, createdAt: -1 });
messageSchema.index({ sender: 1 });
messageSchema.index({ isDeleted: 1 });
// ✅ Compound index للرسائل غير المقروءة (يحل مشكلة N+1 query)
messageSchema.index({ conversation: 1, sender: 1, 'readBy.user': 1 });
// ✅ Index لحساب الصور اليومية (حد 2 صور/يوم)
messageSchema.index({ sender: 1, type: 1, createdAt: -1 });

// دالة للحذف الناعم
messageSchema.methods.softDelete = function() {
    this.isDeleted = true;
    this.deletedAt = new Date();
    return this.save();
};

// دالة للحصول على معرف المحادثة
messageSchema.methods.getChatId = function() {
    return this.conversation;
};

const Message = mongoose.model('Message', messageSchema);

module.exports = Message;
