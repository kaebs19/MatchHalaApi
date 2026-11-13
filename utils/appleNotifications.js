// معالجة App Store Server Notifications V2.
//
// ما يُعالَج الآن: استرداد/إلغاء مشتريات هلا لودو (REFUND / REVOKE) ← سحب الجواهر والعملات الممنوحة،
// وعكسه (REFUND_REVERSED). البقية تُسجَّل فقط (AppleNotification) — منها استرداد اشتراك هلا+، الذي لم
// يُربط بعد بإلغاء الاشتراك (قرار منفصل).
// ⚠️ يُضبط الرابط في App Store Connect ← التطبيق ← App Information ← App Store Server Notifications (V2):
//    https://matchhala.chathala.com/api/apple/notifications — للإنتاج وSandbox.

const AppleNotification = require('../models/AppleNotification');
const apple = require('./appleTransactions');

const LUDO_PREFIX = 'com.app.hala.ludo.';

async function handle(signedPayload) {
    let n;
    try {
        n = await apple.verifySignedNotification(signedPayload);
    } catch (e) {
        const err = new Error(e.message || String(e));
        err.code = 'BAD_SIGNATURE';
        throw err;
    }
    let t = null;
    if (n.data?.signedTransactionInfo) {
        try { t = await apple.verifySignedTransaction(n.data.signedTransactionInfo); } catch (e) { t = null; }
    }

    // مرة واحدة لكل إشعار (أبل تعيد الإرسال)
    try {
        await AppleNotification.create({
            notificationUUID: n.notificationUUID,
            notificationType: n.notificationType,
            subtype: n.subtype || null,
            environment: n.data?.environment || null,
            transactionId: t?.transactionId || null,
            originalTransactionId: t?.originalTransactionId || null,
            productId: t?.productId || null,
            result: 'pending'
        });
    } catch (e) {
        if (e.code === 11000) {
            const prev = await AppleNotification.findOne({ notificationUUID: n.notificationUUID }).select('result').lean();
            // معالجة سابقة فشلت في منتصفها ← نعيدها؛ وإلا تكرار
            if (prev && prev.result !== 'pending') return { result: 'duplicate' };
        } else {
            throw e;
        }
    }

    let result = 'logged';
    let detail = null;
    const isLudo = t?.productId?.startsWith(LUDO_PREFIX);
    if (isLudo && (n.notificationType === 'REFUND' || n.notificationType === 'REVOKE')) {
        detail = await require('./ludo/economy').refundPurchase(t.transactionId);
        result = detail ? 'ludo_refunded' : 'ludo_unknown_purchase';
        if (detail) console.log(`💸 هلا لودو: استرداد ${t.productId} (${t.transactionId}) للمستخدم ${detail.user} — سُحب ${detail.clawedGems} جوهرة و${detail.clawedCoins} عملة`);
    } else if (isLudo && n.notificationType === 'REFUND_REVERSED') {
        detail = await require('./ludo/economy').restorePurchase(t.transactionId);
        result = detail ? 'ludo_restored' : 'ludo_unknown_purchase';
    } else if (n.notificationType === 'TEST') {
        result = 'ignored';
    } else if (['REFUND', 'REVOKE'].includes(n.notificationType)) {
        console.warn(`[apple-notifications] ${n.notificationType} لمنتج غير اللودو: ${t?.productId} (${t?.transactionId}) — مسجَّل فقط`);
    }
    await AppleNotification.updateOne({ notificationUUID: n.notificationUUID }, { $set: { result, detail } });
    return { result, detail };
}

module.exports = { handle };
