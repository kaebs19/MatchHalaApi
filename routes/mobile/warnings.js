// MatchHala - Mobile Official Warnings Routes
// endpoints للتطبيق لاستعلام التنبيهات الرسمية وتأكيد قراءتها
//
// يستخدمها iOS app:
// - عند فتح التطبيق (splash/home)، يستدعي /me/active-warning
// - إذا فيه warning نشط → يعرض Modal إجباري
// - بعد ضغط "فهمت" → /me/acknowledge-warning/:id

const express = require('express');
const router = express.Router();
const { protect } = require('../../middleware/auth');
const OfficialWarning = require('../../models/OfficialWarning');

/**
 * @route   GET /api/mobile/me/active-warning
 * @desc    الحصول على أحدث تنبيه رسمي نشط + قائمة كل التنبيهات النشطة
 * @access  Private
 *
 * Response:
 * {
 *   success: true,
 *   data: {
 *     hasActive: true,
 *     blocking: { _id, type, title, body, severity, icon, isBlocking, sentAt } | null,
 *     activeWarnings: [...]
 *   }
 * }
 */
router.get('/me/active-warning', protect, async (req, res) => {
    try {
        const userId = req.user._id;

        // جلب كل التنبيهات النشطة
        const activeWarnings = await OfficialWarning.find({
            user: userId,
            status: 'active'
        })
        .sort({ sentAt: -1 })
        .limit(10)
        .lean();

        // تحديد أحدث واحد blocking
        const blocking = activeWarnings.find(w => w.isBlocking) || null;

        // أول مرة يشاف = نسجّل readAt (لكن مو acknowledgedAt)
        if (blocking && !blocking.readAt) {
            OfficialWarning.findByIdAndUpdate(blocking._id, { readAt: new Date() })
                .exec()
                .catch(() => {});
        }

        res.json({
            success: true,
            data: {
                hasActive: activeWarnings.length > 0,
                blocking,
                activeWarnings
            }
        });
    } catch (error) {
        console.error('active-warning error:', error);
        res.status(500).json({ success: false, message: 'خطأ في السيرفر' });
    }
});

/**
 * @route   POST /api/mobile/me/acknowledge-warning/:id
 * @desc    المستخدم أقرّ بقراءة التنبيه (ضغط "فهمت")
 * @access  Private
 */
router.post('/me/acknowledge-warning/:id', protect, async (req, res) => {
    try {
        const userId = req.user._id;
        const warning = await OfficialWarning.findOne({
            _id: req.params.id,
            user: userId
        });

        if (!warning) {
            return res.status(404).json({ success: false, message: 'التنبيه غير موجود' });
        }

        if (warning.status === 'acknowledged') {
            return res.json({ success: true, message: 'تم التأكيد مسبقاً', data: { warning } });
        }

        warning.acknowledgedAt = new Date();
        warning.status = 'acknowledged';
        if (!warning.readAt) warning.readAt = warning.acknowledgedAt;
        await warning.save();

        // Socket.IO — إبلاغ لوحة التحكم إن المستخدم قرأ
        try {
            if (global.io) {
                global.io.emit('official-warning-acknowledged', {
                    userId: String(userId),
                    warningId: String(warning._id),
                    at: warning.acknowledgedAt
                });
            }
        } catch (e) { /* ignore */ }

        res.json({
            success: true,
            message: 'تم تأكيد قراءة التنبيه',
            data: { warning }
        });
    } catch (error) {
        console.error('acknowledge-warning error:', error);
        res.status(500).json({ success: false, message: 'خطأ في السيرفر' });
    }
});

/**
 * @route   GET /api/mobile/me/warnings-history
 * @desc    تاريخ التنبيهات السابقة للمستخدم (عرضها في صفحة الإشعارات)
 * @access  Private
 */
router.get('/me/warnings-history', protect, async (req, res) => {
    try {
        const userId = req.user._id;
        const { limit = 20 } = req.query;

        const warnings = await OfficialWarning.find({ user: userId })
            .sort({ sentAt: -1 })
            .limit(Math.min(parseInt(limit), 50))
            .lean();

        res.json({
            success: true,
            data: { warnings }
        });
    } catch (error) {
        console.error('warnings-history error:', error);
        res.status(500).json({ success: false, message: 'خطأ في السيرفر' });
    }
});

module.exports = router;
