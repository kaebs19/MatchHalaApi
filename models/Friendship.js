// MatchHala - Friendship Model
// نموذج الصداقة — طلب صريح + قبول (نظام الأصدقاء)

const mongoose = require('mongoose');

const friendshipSchema = new mongoose.Schema({
    // مرسل الطلب
    requester: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    // مستقبل الطلب
    recipient: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    // حالة الصداقة
    status: {
        type: String,
        enum: ['pending', 'accepted', 'declined'],
        default: 'pending'
    },
    // وقت الرد (قبول/رفض)
    respondedAt: {
        type: Date,
        default: null
    }
}, {
    timestamps: true
});

// Indexes — الاتجاه الواحد unique، والاتجاه المعاكس يُفحص في الكود
friendshipSchema.index({ requester: 1, recipient: 1 }, { unique: true });
friendshipSchema.index({ recipient: 1, status: 1 });
friendshipSchema.index({ requester: 1, status: 1 });

const Friendship = mongoose.model('Friendship', friendshipSchema);

module.exports = Friendship;
