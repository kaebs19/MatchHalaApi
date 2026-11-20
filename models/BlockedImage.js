// MatchHala - BlockedImage
// 🛡️ صورة منعها كشف العُري (utils/nudity) — نسختها في private/blocked-images، والمشرف يراجعها في «🛡️ الصور الممنوعة».
// status: pending ← confirmed (عُري فعلاً) | false_positive (خطأ في الكشف — لقياس العتبة)

const mongoose = require('mongoose');

const blockedImageSchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    source: { type: String, enum: ['story', 'profile', 'gallery'], required: true },
    file: { type: String, default: null },
    scores: {
        porn: Number, hentai: Number, sexy: Number, neutral: Number, drawing: Number
    },
    status: { type: String, enum: ['pending', 'confirmed', 'false_positive'], default: 'pending', index: true },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    reviewedAt: { type: Date, default: null },
    createdAt: { type: Date, default: Date.now }
});

// 90 يوماً مثل كنس الملفات
blockedImageSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 86400, name: 'ttl_90d' });

module.exports = mongoose.model('BlockedImage', blockedImageSchema);
