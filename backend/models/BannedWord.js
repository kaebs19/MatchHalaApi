// نموذج الكلمات المحظورة - Banned Words Model
const mongoose = require('mongoose');

const bannedWordSchema = new mongoose.Schema({
    word: {
        type: String,
        required: [true, 'الكلمة مطلوبة'],
        unique: true,
        trim: true,
        lowercase: true
    },
    type: {
        type: String,
        enum: ['word', 'name', 'both'], // كلمة في الرسائل، اسم مستخدم، أو كلاهما
        default: 'both'
    },
    severity: {
        type: String,
        enum: ['low', 'medium', 'high', 'critical'],
        default: 'medium'
    },
    action: {
        type: String,
        enum: ['filter', 'warn', 'block', 'ban'], // فلترة، تحذير، حظر الرسالة، حظر المستخدم
        default: 'filter'
    },
    isActive: {
        type: Boolean,
        default: true
    },
    addedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    usageCount: {
        type: Number,
        default: 0
    }
}, {
    timestamps: true
});

// Index للبحث السريع
bannedWordSchema.index({ word: 1 });
bannedWordSchema.index({ type: 1, isActive: 1 });

// دالة للتحقق من النص
bannedWordSchema.statics.checkText = async function(text, type = 'both') {
    if (!text) return { isClean: true, foundWords: [] };

    const normalizedText = text.toLowerCase().trim();

    // جلب الكلمات المحظورة النشطة
    const query = { isActive: true };
    if (type !== 'both') {
        query.$or = [{ type: type }, { type: 'both' }];
    }

    const bannedWords = await this.find(query).select('word severity action');

    const foundWords = [];

    for (const banned of bannedWords) {
        // البحث عن الكلمة في النص
        const regex = new RegExp(`\\b${escapeRegex(banned.word)}\\b`, 'gi');
        if (regex.test(normalizedText)) {
            foundWords.push({
                word: banned.word,
                severity: banned.severity,
                action: banned.action
            });

            // تحديث عداد الاستخدام
            await this.updateOne({ _id: banned._id }, { $inc: { usageCount: 1 } });
        }
    }

    return {
        isClean: foundWords.length === 0,
        foundWords,
        highestSeverity: foundWords.length > 0
            ? foundWords.reduce((max, w) => {
                const order = { low: 1, medium: 2, high: 3, critical: 4 };
                return order[w.severity] > order[max] ? w.severity : max;
            }, 'low')
            : null,
        suggestedAction: foundWords.length > 0
            ? foundWords.reduce((max, w) => {
                const order = { filter: 1, warn: 2, block: 3, ban: 4 };
                return order[w.action] > order[max] ? w.action : max;
            }, 'filter')
            : null
    };
};

// دالة لتنظيف النص من الكلمات المحظورة
bannedWordSchema.statics.cleanText = async function(text, replacement = '***') {
    if (!text) return text;

    const bannedWords = await this.find({ isActive: true }).select('word');

    let cleanedText = text;

    for (const banned of bannedWords) {
        const regex = new RegExp(`\\b${escapeRegex(banned.word)}\\b`, 'gi');
        cleanedText = cleanedText.replace(regex, replacement);
    }

    return cleanedText;
};

// دالة مساعدة لتجنب مشاكل regex
function escapeRegex(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = mongoose.model('BannedWord', bannedWordSchema);
