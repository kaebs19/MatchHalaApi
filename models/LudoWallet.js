// رصيد عملات هلا لودو — وثيقة لكل لاعب، تُنشأ عند أول فتح برصيد البداية (utils/ludo/economy.js)
// ⚠️ عملات لعب فقط: لا تُشترى ولا تُستبدل بمال. كل تغيير في الرصيد ذرّي ($inc بشرط) — لا قراءة ثم كتابة.
const mongoose = require('mongoose');

const ludoWalletSchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    coins: { type: Number, default: 0, min: 0 },
    // مباريات الدوري وحدها (الودّية لا تُحسب)
    played: { type: Number, default: 0 },
    wins: { type: Number, default: 0 },
    losses: { type: Number, default: 0 },
    dailyClaimedAt: { type: Date, default: null }
}, { timestamps: true });

module.exports = mongoose.model('LudoWallet', ludoWalletSchema);
