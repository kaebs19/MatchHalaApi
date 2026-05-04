// MatchHala - Sensitive Content Reveal Audit Log
// سجل قانوني: من كشف محتوى حساس، متى، وأي رسالة
// TTL 90 يوم (auto-delete)

const mongoose = require('mongoose');

const sensitiveContentRevealSchema = new mongoose.Schema({
    // المستخدم الذي ضغط "عرض"
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    // الرسالة المكشوفة
    message: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Message',
        required: true
    },
    // المحادثة (للتتبع السريع)
    conversation: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Conversation'
    },
    // الفئة المكشوفة (sexual, violence, ...)
    category: {
        type: String,
        required: true
    },
    // عمر المستخدم وقت الكشف (snapshot للحماية القانونية)
    userAgeAtReveal: {
        type: Number,
        default: null
    },
    // App-Version header وقت الطلب (للتدقيق)
    clientVersion: {
        type: String,
        default: null
    },
    // IP للتدقيق الأمني
    ipAddress: {
        type: String,
        default: null
    }
}, {
    timestamps: { createdAt: 'revealedAt', updatedAt: false }
});

// TTL — auto-delete بعد 90 يوم
sensitiveContentRevealSchema.index(
    { revealedAt: 1 },
    { expireAfterSeconds: 90 * 24 * 60 * 60 }
);

// indexes للتقارير
sensitiveContentRevealSchema.index({ user: 1, revealedAt: -1 });
sensitiveContentRevealSchema.index({ category: 1, revealedAt: -1 });

module.exports = mongoose.model('SensitiveContentReveal', sensitiveContentRevealSchema);
