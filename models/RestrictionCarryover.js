// تقييدات حساب مُخالِف حُذف — تنتقل إلى حسابه الجديد إن أعاد التسجيل (ثغرة: الحذف كان يمحو العقوبة).
// لا بيانات شخصية صريحة: المعرّفات كلها HMAC باتجاه واحد (بصمة الجهاز، Keychain، vendorId،
// البريد، معرّف أبل/جوجل). يُحذف تلقائياً عند expiresAt (≤ 90 يوماً، كما تعد صفحة «حذف الحساب»).
// ⚠️ معرّف أبل (sub) ثابت لنفس Apple ID حتى مع «إخفاء البريد» — لذلك يُحفظ مع البريد.

const mongoose = require('mongoose');

const restrictionCarryoverSchema = new mongoose.Schema({
    // HMAC لكل معرّف بنوعه: email: / apple: / google: / facebook: / device: / keychain: / vendor:
    identityHashes: { type: [String], default: [], index: true },

    deletedAt: { type: Date, required: true },

    // لقطة التقييدات السارية لحظة الحذف — تواريخ انتهاء مطلقة (null = دائم)
    // nameBlocked/photoBlocked/bioBlocked/messaging/hidden/suspension/storyBan/bannedWordsBan/warningsLevel/externalPromo
    // (الشكل في utils/restrictionCarryover.js → buildSnapshot)
    snapshot: { type: mongoose.Schema.Types.Mixed, default: {} },
    summary: { type: [String], default: [] },   // وصف عربي مختصر للوحة

    appliedTo: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],

    expiresAt: { type: Date, required: true }
}, {
    timestamps: true
});

restrictionCarryoverSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('RestrictionCarryover', restrictionCarryoverSchema);
