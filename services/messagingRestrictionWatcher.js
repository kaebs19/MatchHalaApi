/**
 * مراقب فك تقييد المراسلة (الترويج الخارجي) تلقائياً.
 *
 * يعمل داخل عملية السيرفر الرئيسية (instance 0 فقط لتجنّب التكرار في الـ cluster)
 * كل دقيقة: يبحث عن مستخدمين انتهت مدة تقييدهم → يفكّ التقييد + يبثّ socket فوري
 * (يصل لأي إصدار عبر Redis adapter) + يرسل إشعار push.
 */

const CHECK_INTERVAL_MS = 60 * 1000; // كل دقيقة

async function liftExpiredMessagingRestrictions() {
    const User = require('../models/User');
    const now = new Date();

    // تقييد مراسلة منتهٍ بسبب الترويج الخارجي
    const expired = await User.find({
        'restrictions.messagingRestricted': true,
        'restrictions.messagingRestrictedUntil': { $ne: null, $lt: now }
    }).select('name restrictions.restrictionReason').limit(200);

    if (expired.length === 0) return;

    const pushService = require('./pushNotificationService');

    for (const user of expired) {
        try {
            await User.findByIdAndUpdate(user._id, {
                'restrictions.messagingRestricted': false,
                'restrictions.messagingRestrictedUntil': null,
                'restrictions.messagingRestrictedLevel': null,
                'restrictions.restrictionReason': null
            });

            // ✅ بثّ فوري للمستخدم (يعمل عبر الـ cluster بفضل Redis adapter)
            if (global.io) {
                global.io.to('user:' + user._id).emit('messaging-restriction-lifted', {
                    message: 'تم رفع تقييد المراسلة عن حسابك',
                    at: now.toISOString()
                });
            }

            // ✅ إشعار push + حفظ في قاعدة البيانات
            await pushService.sendNotificationToUser(
                user._id,
                {
                    title: '✅ تم رفع تقييد المراسلة',
                    body: 'انتهت مدة التقييد — يمكنك إرسال الرسائل الآن. حافظ على الالتزام بسياسة المنصة.'
                },
                { type: 'restriction_lifted' }
            );

            console.log('✅ رُفِع تقييد المراسلة عن:', user.name, String(user._id));
        } catch (err) {
            console.error('خطأ في فك تقييد المراسلة:', err.message);
        }
    }
}

/** يبدأ المراقب الدوري — يُستدعى مرة واحدة من server.js على instance 0 فقط. */
function startMessagingRestrictionWatcher() {
    // تشغيل أول بعد دقيقة من الإقلاع، ثم كل دقيقة
    setInterval(() => {
        liftExpiredMessagingRestrictions().catch(err =>
            console.error('messagingRestrictionWatcher:', err.message)
        );
    }, CHECK_INTERVAL_MS);
    console.log('🕒 مراقب فك تقييد المراسلة يعمل (كل دقيقة)');
}

module.exports = { startMessagingRestrictionWatcher, liftExpiredMessagingRestrictions };
