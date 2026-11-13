// أسبوع ترتيب هلا لودو — وثيقة لكل أسبوع وُزّعت جوائزه (فرادة weekKey = التوزيع مرة واحدة عبر نسخ الـ cluster)
const mongoose = require('mongoose');

const ludoSeasonSchema = new mongoose.Schema({
    weekKey: { type: String, required: true, unique: true },
    awardedAt: { type: Date, default: Date.now },
    winners: [{ user: mongoose.Schema.Types.ObjectId, rank: Number, points: Number, gems: Number, coins: Number }]
}, { timestamps: false });

module.exports = mongoose.model('LudoSeason', ludoSeasonSchema);
