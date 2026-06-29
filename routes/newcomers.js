// ═══════════════════════════════════════════════════════════════
// مراجعة المستخدمين الجدد — لوحة التحكم (admin)
// - GET  /api/newcomers            قائمة الجدد (pending خلال 24h + flagged)
// - GET  /api/newcomers/stats      إحصاءات سريعة
// - POST /api/newcomers/:id/approve  اعتماد الحساب (ظهور عادي)
// - POST /api/newcomers/:id/reject   رفض الحساب (إخفاء دائم من الاكتشاف)
// ═══════════════════════════════════════════════════════════════
const express = require('express');
const router = express.Router();
const User = require('../models/User');
const { protect, adminOnly } = require('../middleware/auth');
const { REVIEW_WINDOW_MS } = require('../utils/newcomerReview');

const getFullUrl = (imgPath) => {
    if (!imgPath) return null;
    if (imgPath.startsWith('http')) return imgPath;
    const baseUrl = process.env.BASE_URL || 'https://matchhala.chathala.com';
    return `${baseUrl}${imgPath}`;
};

// @route GET /api/newcomers
// @desc  قائمة الجدد المطلوب مراجعتهم
// @query status=pending|flagged|all (افتراضي: review = pending+flagged)
router.get('/', protect, adminOnly, async (req, res) => {
    try {
        const { status, page = 1, limit = 20 } = req.query;
        const pageNum = Math.max(1, parseInt(page));
        const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
        const reviewCutoff = new Date(Date.now() - REVIEW_WINDOW_MS);

        let filter;
        if (status === 'flagged') {
            filter = { 'newcomer.status': 'flagged' };
        } else if (status === 'pending') {
            // معلّق وما زال داخل نافذة المراجعة (24 ساعة)
            filter = { 'newcomer.status': 'pending', createdAt: { $gte: reviewCutoff } };
        } else if (status === 'all') {
            filter = { 'newcomer.status': { $in: ['pending', 'flagged', 'rejected'] } };
        } else {
            // الافتراضي: ما يحتاج تدخّل المشرف = flagged دائماً + pending داخل النافذة
            filter = {
                $or: [
                    { 'newcomer.status': 'flagged' },
                    { 'newcomer.status': 'pending', createdAt: { $gte: reviewCutoff } }
                ]
            };
        }

        const total = await User.countDocuments(filter);
        const users = await User.find(filter)
            .select('name email profileImage gender country bio createdAt newcomer bannedWords.violations externalPromo.violations verification.isVerified')
            .sort({ 'newcomer.flaggedAt': -1, createdAt: -1 })
            .skip((pageNum - 1) * limitNum)
            .limit(limitNum)
            .lean();

        const data = users.map(u => ({
            _id: u._id,
            name: u.name,
            email: u.email,
            profileImage: getFullUrl(u.profileImage),
            gender: u.gender,
            country: u.country,
            bio: u.bio,
            createdAt: u.createdAt,
            status: u.newcomer?.status || 'pending',
            flaggedReason: u.newcomer?.flaggedReason || null,
            flaggedAt: u.newcomer?.flaggedAt || null,
            isVerified: u.verification?.isVerified || false,
            bannedWordViolations: u.bannedWords?.violations || 0,
            externalPromoViolations: u.externalPromo?.violations || 0
        }));

        res.json({ success: true, data, page: pageNum, limit: limitNum, total });
    } catch (error) {
        console.error('خطأ في جلب الجدد:', error);
        res.status(500).json({ success: false, message: 'خطأ في السيرفر' });
    }
});

// @route GET /api/newcomers/stats
router.get('/stats', protect, adminOnly, async (req, res) => {
    try {
        const reviewCutoff = new Date(Date.now() - REVIEW_WINDOW_MS);
        const [flagged, pending] = await Promise.all([
            User.countDocuments({ 'newcomer.status': 'flagged' }),
            User.countDocuments({ 'newcomer.status': 'pending', createdAt: { $gte: reviewCutoff } })
        ]);
        res.json({ success: true, data: { flagged, pending, needsReview: flagged + pending } });
    } catch (error) {
        console.error('خطأ في إحصاءات الجدد:', error);
        res.status(500).json({ success: false, message: 'خطأ في السيرفر' });
    }
});

// @route POST /api/newcomers/:id/approve
// @desc  اعتماد الحساب الجديد — ظهور عادي في الاكتشاف
router.post('/:id/approve', protect, adminOnly, async (req, res) => {
    try {
        const user = await User.findByIdAndUpdate(
            req.params.id,
            {
                'newcomer.status': 'approved',
                'newcomer.reviewedBy': req.user._id,
                'newcomer.reviewedAt': new Date(),
                'newcomer.flaggedReason': null,
                // ✅ رفع إخفاء الاكتشاف إن كان مخفياً بسبب الرفع التلقائي
                'hidden.isHidden': false
            },
            { new: true }
        ).select('name newcomer');
        if (!user) return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
        res.json({ success: true, message: 'تم اعتماد الحساب', data: { _id: user._id, status: user.newcomer.status } });
    } catch (error) {
        console.error('خطأ في اعتماد الحساب الجديد:', error);
        res.status(500).json({ success: false, message: 'خطأ في السيرفر' });
    }
});

// @route POST /api/newcomers/:id/reject
// @desc  رفض الحساب الجديد — إخفاء دائم من الاكتشاف
router.post('/:id/reject', protect, adminOnly, async (req, res) => {
    try {
        const { reason } = req.body || {};
        const user = await User.findByIdAndUpdate(
            req.params.id,
            {
                'newcomer.status': 'rejected',
                'newcomer.reviewedBy': req.user._id,
                'newcomer.reviewedAt': new Date(),
                'newcomer.flaggedReason': reason || 'رُفض بعد مراجعة المشرف',
                'newcomer.flaggedAt': new Date(),
                // ✅ إخفاء دائم من الاكتشاف
                'hidden.isHidden': true,
                'hidden.hiddenAt': new Date(),
                'hidden.hiddenUntil': null,
                'hidden.reason': reason || 'رُفض الحساب بعد مراجعة الحسابات الجديدة',
                'hidden.hiddenBy': req.user._id
            },
            { new: true }
        ).select('name newcomer');
        if (!user) return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
        res.json({ success: true, message: 'تم رفض الحساب وإخفاؤه', data: { _id: user._id, status: user.newcomer.status } });
    } catch (error) {
        console.error('خطأ في رفض الحساب الجديد:', error);
        res.status(500).json({ success: false, message: 'خطأ في السيرفر' });
    }
});

module.exports = router;
