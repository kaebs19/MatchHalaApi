const mongoose = require('mongoose');

/**
 * SpamReport Model
 * يتتبع بلاغات السبام التلقائية من الأجهزة
 * عند تكرار البلاغات → تعليق تلقائي + حظر الجهاز
 */
const spamReportSchema = new mongoose.Schema({
    // المستخدم المُبلَّغ عنه
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    // المحادثة
    conversationId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Conversation'
    },
    // نوع السبام
    reason: {
        type: String,
        enum: ['spam_keywords', 'repeated_message', 'flood', 'phone_spam'],
        required: true
    },
    // محتوى الرسالة المخالفة
    content: {
        type: String,
        maxlength: 500
    },
    // معلومات الجهاز
    deviceFingerprint: String,
    keychainToken: String,
    // مصدر البلاغ
    source: {
        type: String,
        enum: ['client', 'server'],
        default: 'client'
    }
}, {
    timestamps: true
});

// فهرس لحساب عدد البلاغات بسرعة
spamReportSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model('SpamReport', spamReportSchema);
