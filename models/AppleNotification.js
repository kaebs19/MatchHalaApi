// إشعارات App Store Server Notifications V2 المستلمة — سجلّ تدقيق + منع المعالجة المزدوجة
// (أبل تعيد الإرسال حتى يصلها 200، فقد يصل الإشعار نفسه أكثر من مرة). تُحذف بعد 180 يوماً.
const mongoose = require('mongoose');

const appleNotificationSchema = new mongoose.Schema({
    notificationUUID: { type: String, required: true, unique: true },
    notificationType: String,
    subtype: String,
    environment: String,
    transactionId: String,
    originalTransactionId: String,
    productId: String,
    // ما فعله الخادم: ludo_refunded | ludo_restored | ludo_unknown_purchase | ignored | logged
    result: String,
    detail: mongoose.Schema.Types.Mixed,
    createdAt: { type: Date, default: Date.now, expires: 180 * 24 * 60 * 60 }
});

module.exports = mongoose.model('AppleNotification', appleNotificationSchema);
