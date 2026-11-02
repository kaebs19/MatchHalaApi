// MatchHala - ملصق صورة لمحرّر القصص والوسائط
// يُرسم في الصورة عند الإرسال، فالتعطيل والحذف يوقفان استعماله الجديد فقط

const mongoose = require('mongoose');

const stickerSchema = new mongoose.Schema({
    category: { type: mongoose.Schema.Types.ObjectId, ref: 'StickerCategory', required: true },
    imageUrl: { type: String, required: true },
    order: { type: Number, default: 0 },
    active: { type: Boolean, default: true }
}, { timestamps: true });

stickerSchema.index({ category: 1, order: 1 });

module.exports = mongoose.model('Sticker', stickerSchema);
