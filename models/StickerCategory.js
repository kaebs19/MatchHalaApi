// MatchHala - فئات الملصقات (تُدار من لوحة التحكم)

const mongoose = require('mongoose');

const stickerCategorySchema = new mongoose.Schema({
    name: { type: String, required: true, trim: true, maxlength: 40 },
    order: { type: Number, default: 0 },
    active: { type: Boolean, default: true },
    // فئة لمشتركي هلا+ — التطبيق يعرض تاجاً ويطلب الاشتراك
    premium: { type: Boolean, default: false }
}, { timestamps: true });

module.exports = mongoose.model('StickerCategory', stickerCategorySchema);
