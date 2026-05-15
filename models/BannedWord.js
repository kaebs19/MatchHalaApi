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
        // promotion = ترويج | contact = رقم تواصل / حساب خارجي
        enum: ['sexual', 'violence', 'hate', 'spam', 'promotion', 'contact', 'other'],
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

bannedWordSchema.index({ isActive: 1 });

const BannedWord = mongoose.model('BannedWord', bannedWordSchema);

module.exports = BannedWord;
