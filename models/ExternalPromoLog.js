/**
 * External Promo Log
 * يسجّل كل محاولة ترويج خارجي (Snap/Insta/WhatsApp/...)
 *
 * الاستخدام:
 *   - تحليل: أيّ منصة تستهدف الـ funnel-out أكثر؟
 *   - تتبّع المخالفين بالتفصيل (timeline)
 *   - admin dashboard
 *
 * TTL: 90 يوماً (تنظيف تلقائي للسجلات القديمة)
 */

const mongoose = require('mongoose');

const externalPromoLogSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    source: {
        type: String,
        enum: ['bio', 'message', 'name'],
        required: true
    },
    categories: [{
        type: String  // snap, instagram, whatsapp, zinji, phone, email, ...
    }],
    matchedPatterns: [String],   // النصوص الفعلية المطابقة (للتحليل)
    conversationId: {            // فقط للـ messages
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Conversation',
        default: null
    },
    createdAt: {
        type: Date,
        default: Date.now,
        index: true,
        expires: 60 * 60 * 24 * 90    // TTL: 90 يوم
    }
}, {
    timestamps: false
});

// مفهرسة للـ analytics
externalPromoLogSchema.index({ source: 1, createdAt: -1 });
externalPromoLogSchema.index({ categories: 1, createdAt: -1 });

module.exports = mongoose.model('ExternalPromoLog', externalPromoLogSchema);
