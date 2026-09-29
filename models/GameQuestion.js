// MatchHala - أسئلة ألعاب المحادثة (تُدار من لوحة التحكم)
// المصدر الابتدائي utils/gameQuestions.js يُزرع مرة واحدة عند أول استخدام.

const mongoose = require('mongoose');

const localized = { ar: { type: String, trim: true, maxlength: 200 }, en: { type: String, trim: true, maxlength: 200 } };

const gameQuestionSchema = new mongoose.Schema({
    // truth = حقيقة · dare = جرأة · wyr = هل تفضّل؟ · never = لم أفعل قط
    bank: { type: String, enum: ['truth', 'dare', 'wyr', 'never'], required: true, index: true },
    // truth / dare / never
    ar: localized.ar,
    en: localized.en,
    // wyr
    a: localized,
    b: localized,
    // light = الافتراضي · bold = «المستوى الجريء» (رومانسي/شخصي بلا محتوى جنسي، بموافقة الطرفين 18+)
    level: { type: String, enum: ['light', 'bold'], default: 'light', index: true },
    active: { type: Boolean, default: true },
    // الأسئلة التي زُرعت من الكود — للتمييز فقط
    seeded: { type: Boolean, default: false },
    // جاء من اقتراح مستخدم وافق عليه الأدمن
    fromUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }
}, { timestamps: true });

gameQuestionSchema.index({ bank: 1, active: 1 });

module.exports = mongoose.model('GameQuestion', gameQuestionSchema);
