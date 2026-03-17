// MatchHala - Banned Words Model
// نموذج الكلمات المحظورة

const mongoose = require('mongoose');

const bannedWordSchema = new mongoose.Schema({
    word: {
        type: String,
        required: [true, 'الكلمة مطلوبة'],
        trim: true,
        lowercase: true,
        unique: true
    },
    language: {
        type: String,
        enum: ['ar', 'en', 'other'],
        default: 'other'
    },
    category: {
        type: String,
        enum: ['sexual', 'violence', 'hate', 'spam', 'other'],
        default: 'other'
    },
    isActive: {
        type: Boolean,
        default: true
    },
    addedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }
}, {
    timestamps: true
});

bannedWordSchema.index({ word: 1 });
bannedWordSchema.index({ isActive: 1 });

const BannedWord = mongoose.model('BannedWord', bannedWordSchema);

module.exports = BannedWord;
