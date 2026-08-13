// MatchHala - Live Location Model
// مشاركة موقع مباشر داخل محادثة، لمدة محددة تنتهي تلقائياً.

const mongoose = require('mongoose');

const liveLocationSchema = new mongoose.Schema({
    conversation: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Conversation',
        required: true,
        index: true
    },
    sender: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    // فقاعة المحادثة المرتبطة — تُعرض عندها المشاركة
    message: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Message',
        required: true
    },

    latitude: { type: Number, required: true },
    longitude: { type: Number, required: true },
    /// دقة القياس بالأمتار — تُعرض كدائرة حول النقطة
    accuracy: { type: Number, default: null },
    /// اتجاه الحركة بالدرجات (اختياري)
    heading: { type: Number, default: null },

    startedAt: { type: Date, default: Date.now },
    /// نهاية المشاركة المجدولة — 15 أو 60 دقيقة
    expiresAt: { type: Date, required: true, index: true },
    /// إيقاف يدوي قبل الموعد
    endedAt: { type: Date, default: null },
    /// آخر إحداثي وصل من الجهاز
    lastUpdateAt: { type: Date, default: Date.now }
}, {
    timestamps: true
});

// أحدث مشاركة نشطة لكل محادثة — أكثر استعلام تكراراً
liveLocationSchema.index({ conversation: 1, endedAt: 1, expiresAt: -1 });

liveLocationSchema.virtual('isActive').get(function () {
    return !this.endedAt && this.expiresAt > new Date();
});

/// ⚠️ الوثيقة لا تُحذف عند الانتهاء: الفقاعة تبقى في المحادثة وتعرض «انتهت
/// المشاركة» مع آخر موقع، وحذفها كان سيترك فقاعة بلا بيانات.
liveLocationSchema.methods.toClient = function () {
    return {
        id: this._id,
        conversationId: this.conversation,
        senderId: this.sender,
        messageId: this.message,
        latitude: this.latitude,
        longitude: this.longitude,
        accuracy: this.accuracy,
        heading: this.heading,
        startedAt: this.startedAt,
        expiresAt: this.expiresAt,
        endedAt: this.endedAt,
        lastUpdateAt: this.lastUpdateAt,
        isActive: !this.endedAt && this.expiresAt > new Date()
    };
};

module.exports = mongoose.model('LiveLocation', liveLocationSchema);
