// MatchHala - Mobile App Bootstrap
// GET /app/bootstrap — ما يحتاجه التطبيق عند كل فتح/عودة في نداء واحد
//
// كان التطبيق ينادي خمسة مسارات عند كل فتح (عدّاد الإشعارات، عدّاد الطلبات،
// التنبيه الرسمي، حالة الإخفاء، فحص انتهاء الاشتراك) — بعضها مرتين من أماكن
// مختلفة. على شبكة الجوال زمن الرحلة هو الكلفة الغالبة لا المعالجة.
//
// ⚠️ لا يُكرَّر أي منطق هنا (نفس نمط /friends/bootstrap): تُستدعى معالجات
//    المسارات نفسها ويُلتقط ما تكتبه. المسارات القديمة تبقى للإصدارات السابقة.
// ⚠️ فحص الاشتراك يكتب (ينظّف المنتهي) — مقصود، وهو idempotent.

const express = require('express');
const router = express.Router();
const { protect } = require('../../middleware/auth');
const { captureHandler } = require('../../utils/captureHandler');

router.get('/app/bootstrap', protect, async (req, res) => {
    try {
        const { getUnreadNotificationsCount } = require('./notifications');
        const { getPendingRequestsCount } = require('./conversations');
        const { getActiveWarning } = require('./warnings');
        const { verifySubscriptionExpiration } = require('./premium');
        const { getHideStatus } = require('../users');

        const [unreadRes, pendingRes, warningRes, subscriptionRes, hideRes] = await Promise.all([
            captureHandler(getUnreadNotificationsCount, req),
            captureHandler(getPendingRequestsCount, req),
            captureHandler(getActiveWarning, req),
            captureHandler(verifySubscriptionExpiration, req),
            captureHandler(getHideStatus, req)
        ]);

        res.set('Cache-Control', 'no-store');
        res.json({
            success: true,
            data: {
                notifications: unreadRes?.data || null,
                pendingRequests: pendingRes?.data || null,
                activeWarning: warningRes?.data || null,
                subscription: subscriptionRes?.data || null,
                hideStatus: hideRes?.data || null
            }
        });
    } catch (error) {
        console.error('app/bootstrap error:', error);
        res.status(500).json({ success: false, message: 'خطأ في الخادم' });
    }
});

module.exports = router;
