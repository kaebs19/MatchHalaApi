// MatchHala - أسئلة ألعاب يكتبها المستخدمون («أسئلتي»)
//
// - تُفحَص عند الكتابة بفلتر الترويج والكلمات المحظورة (routes/mobile/games.js).
// - لا تدخل بنك الجميع تلقائياً: تظهر فقط في ألعاب صاحبها/صديقه بخيار «أسئلتنا» أو «مزيج».
// - «اقترح للجميع» ترسلها لمراجعة الأدمن (status: pending_review).

const mongoose = require('mongoose');

const localized = { ar: { type: String, trim: true, maxlength: 120 }, en: { type: String, trim: true, maxlength: 120 } };

const userGameQuestionSchema = new mongoose.Schema({
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    bank: { type: String, enum: ['truth', 'dare', 'wyr', 'never'], required: true },
    ar: localized.ar,
    en: localized.en,
    a: localized,
    b: localized,
    // تعطيل صاحبها لها
    active: { type: Boolean, default: true },
    // active | pending_review | approved | rejected | reported
    //   reported = عُطّلت بسبب بلاغ (تنتظر قرار الأدمن)
    status: { type: String, enum: ['active', 'pending_review', 'approved', 'rejected', 'reported'], default: 'active', index: true },
    // آخر بلاغ — يُحتسب للإيقاف المؤقت عن إضافة أسئلة (3 بلاغات خلال 30 يوماً)
    reportedAt: { type: Date, default: null },
    reports: [{
        by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        at: { type: Date, default: Date.now }
    }]
}, { timestamps: true });

userGameQuestionSchema.index({ owner: 1, status: 1 });

module.exports = mongoose.model('UserGameQuestion', userGameQuestionSchema);
