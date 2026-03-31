const mongoose = require('mongoose');

const interestSchema = new mongoose.Schema({
    key: { type: String, required: true, unique: true, trim: true },
    nameAr: { type: String, required: true, trim: true },
    nameEn: { type: String, required: true, trim: true },
    emoji: { type: String, required: true },
    category: {
        type: String,
        enum: ['sports', 'entertainment', 'lifestyle', 'social', 'creative', 'food', 'tech', 'other'],
        default: 'other'
    },
    isActive: { type: Boolean, default: true },
    order: { type: Number, default: 0 }
}, { timestamps: true });

interestSchema.index({ isActive: 1, order: 1 });

const Interest = mongoose.model('Interest', interestSchema);

module.exports = Interest;
