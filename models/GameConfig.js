// MatchHala - إعدادات ألعاب المحادثة (مستند واحد)

const mongoose = require('mongoose');

const ALL_KINDS = ['truth_dare', 'would_you_rather', 'never_have_i_ever', 'two_truths_lie'];

const gameConfigSchema = new mongoose.Schema({
    key: { type: String, default: 'main', unique: true },
    // الألعاب المتاحة للمستخدمين. فارغة = الميزة متوقفة.
    enabledKinds: { type: [String], enum: ALL_KINDS, default: ALL_KINDS },
    // زرع الأسئلة الابتدائية (utils/gameBanks.js ensureSeeded): نسخة الزرع وعدد ما زُرع من كل بنك
    seedVersion: { type: Number, default: 0 },
    seededCounts: { type: mongoose.Schema.Types.Mixed, default: undefined }
}, { timestamps: true });

gameConfigSchema.statics.getConfig = async function () {
    let doc = await this.findOne({ key: 'main' });
    if (!doc) {
        try { doc = await this.create({ key: 'main' }); }
        catch (e) { doc = await this.findOne({ key: 'main' }); }   // سباق إنشاء
    }
    return doc;
};

const GameConfig = mongoose.model('GameConfig', gameConfigSchema);
GameConfig.ALL_KINDS = ALL_KINDS;
module.exports = GameConfig;
