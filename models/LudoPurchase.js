// مشتريات جواهر هلا لودو (IAP قابلة للاستهلاك) — transactionId فريد: المعاملة تُمنح مرة واحدة فقط
const mongoose = require('mongoose');

const ludoPurchaseSchema = new mongoose.Schema({
    transactionId: { type: String, required: true, unique: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    productId: { type: String, required: true },
    gems: { type: Number, required: true },
    environment: String
}, { timestamps: true });

module.exports = mongoose.model('LudoPurchase', ludoPurchaseSchema);
