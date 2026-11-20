// ربط اللوحة بخدمة خارجية (حالياً AdMob Reporting) — رمز التحديث مشفّر (utils/secretBox) ولا يُرجَع افتراضياً
const mongoose = require('mongoose');

const adminIntegrationSchema = new mongoose.Schema({
    provider: { type: String, required: true, unique: true },     // 'admob'
    refreshTokenEnc: { type: String, select: false },
    accountId: { type: String, default: null },                   // accounts/pub-XXXX
    publisherId: { type: String, default: null },
    currencyCode: { type: String, default: null },
    connectedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    connectedAt: { type: Date, default: null },
    lastError: { type: String, default: null },
    lastErrorAt: { type: Date, default: null }
}, { timestamps: true });

module.exports = mongoose.model('AdminIntegration', adminIntegrationSchema);
