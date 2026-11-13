// مشتريات هلا لودو (جواهر، عملات، باقات) (IAP قابلة للاستهلاك) — transactionId فريد: المعاملة تُمنح مرة واحدة فقط
const mongoose = require('mongoose');

const ludoPurchaseSchema = new mongoose.Schema({
    transactionId: { type: String, required: true, unique: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    productId: { type: String, required: true },
    gems: { type: Number, default: 0 },
    coins: { type: Number, default: 0 },
    environment: String,
    // استرداد أبل (REFUND/REVOKE): ما سُحب فعلاً، وما لم يُسحب لأنه أُنفق قبل الاسترداد
    refundedAt: { type: Date, default: null },
    clawedGems: { type: Number, default: 0 },
    clawedCoins: { type: Number, default: 0 },
    shortfallGems: { type: Number, default: 0 },
    shortfallCoins: { type: Number, default: 0 }
}, { timestamps: true });

module.exports = mongoose.model('LudoPurchase', ludoPurchaseSchema);
