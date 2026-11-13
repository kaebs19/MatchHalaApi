// محفظة هلا لودو — وثيقة لكل لاعب، تُنشأ عند أول فتح برصيد البداية (utils/ludo/economy.js)
// ⚠️ العملات عملة لعب لا تُستبدل بمال. الجواهر تُشترى (IAP) أو تُربح. كل تغيير في رصيد ذرّي ($inc بشرط).
const mongoose = require('mongoose');

const ludoWalletSchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    coins: { type: Number, default: 0, min: 0 },
    gems: { type: Number, default: 0, min: 0 },
    // مباريات الدوري وحدها (الودّية لا تُحسب)
    played: { type: Number, default: 0 },
    wins: { type: Number, default: 0 },
    losses: { type: Number, default: 0 },
    winStreak: { type: Number, default: 0 },
    bestStreak: { type: Number, default: 0 },
    coinsWon: { type: Number, default: 0 },
    // النجوم: كل فوز في الدوري — المجموع يحدّد المرتبة، والأسبوعي يحدّد الترتيب
    points: { type: Number, default: 0 },
    weekKey: { type: String, default: null },      // 'YYYY-MM-DD' (اثنين الأسبوع، UTC)
    weekPoints: { type: Number, default: 0 },
    // جائزة الترتيب الأسبوعي الأخيرة — تُعرض مرة في التطبيق
    lastPrize: {
        weekKey: String, rank: Number, gems: Number, coins: Number,
        seen: { type: Boolean, default: false }
    },
    dailyClaimedAt: { type: Date, default: null }
}, { timestamps: true });

// الترتيب الأسبوعي
ludoWalletSchema.index({ weekKey: 1, weekPoints: -1 });

module.exports = mongoose.model('LudoWallet', ludoWalletSchema);
