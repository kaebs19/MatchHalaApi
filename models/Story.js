// MatchHala - Story Model
// قصص البروفايل: صور فقط، 3 قصص نشطة كحدّ أقصى، كل قصة 24 ساعة.
// الملف في uploads/ephemeral (Nginx: private, no-store — Cloudflare لا يحتفظ بنسخة بعد الانتهاء).
// الكنس الدوري في utils/storySweeper.js يُنهي المنتهية ويحذف ملفها (أو يؤرشفه إن كان مُبلَّغاً عنه).

const mongoose = require('mongoose');

const storySchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    imageUrl: { type: String, default: null },
    width: { type: Number, default: null },
    height: { type: Number, default: null },
    status: {
        type: String,
        enum: ['active', 'deleted', 'expired', 'removed'], // removed = حذفها المشرف
        default: 'active'
    },
    expiresAt: { type: Date, required: true },
    // المشاهدات الظاهرة فقط (المخفية بوضع التخفي/المشرف لا تُعدّ)
    viewCount: { type: Number, default: 0 },
    // بلاغات عليها — المُبلَّغ عنها تُؤرشف عند الانتهاء بدل الحذف (دليل للمشرف)
    reportCount: { type: Number, default: 0 },
    archivedPath: { type: String, default: null },
    endedAt: { type: Date, default: null }
}, { timestamps: true });

// القصص النشطة لمستخدم (البروفايل، الحدّ)، والكنس
storySchema.index({ user: 1, status: 1, expiresAt: 1 });
storySchema.index({ status: 1, expiresAt: 1 });

module.exports = mongoose.model('Story', storySchema);
