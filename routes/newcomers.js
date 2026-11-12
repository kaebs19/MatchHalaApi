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

// 🗂️ أسباب الرفع — للتجميع والاعتماد الجماعي. الإخفاء من الاكتشاف FLAGGED_HIDE_DAYS أيام فقط (routes/swipes.js)،
//    فـ«بحاجة لمراجعة» = المرفوع خلالها + pending؛ الأقدم يظهر أصلاً ويبقى في «مخالفات مرصودة» للسجلّ.
const FLAGGED_HIDE_DAYS = 3;
const REASON_GROUPS = {
    promo: { label: 'ترويج خارجي', re: /^ترويج خارجي/ },
    words: { label: 'كلمات محظورة', re: /^كلمات محظورة/ },
    carryover: { label: 'أعاد التسجيل بعد حذف', re: /^🔁/ },
    webBannedIp: { label: 'ويب بعنوان جهاز محظور', re: /^🌐/ }
};
const reasonFilter = (key) => {
    if (REASON_GROUPS[key]) return { 'newcomer.flaggedReason': REASON_GROUPS[key].re };
    if (key === 'other') return { 'newcomer.flaggedReason': { $not: /^(ترويج خارجي|كلمات محظورة|🔁|🌐)/ } };
    return {};
};
const recentFlagCutoff = () => new Date(Date.now() - FLAGGED_HIDE_DAYS * 24 * 60 * 60 * 1000);

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
        const { status, page = 1, limit = 20, reason } = req.query;
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
            // الافتراضي: ما يحتاج تدخّل المشرف = flagged ما زال مخفياً (≤ FLAGGED_HIDE_DAYS) + pending داخل النافذة
            filter = {
                $or: [
                    { 'newcomer.status': 'flagged', 'newcomer.flaggedAt': { $gt: recentFlagCutoff() } },
                    { 'newcomer.status': 'pending', createdAt: { $gte: reviewCutoff } }
                ]
            };
        }
        if (reason) filter = { $and: [filter, reasonFilter(reason)] };

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
        const [flagged, flaggedRecent, pending] = await Promise.all([
            User.countDocuments({ 'newcomer.status': 'flagged' }),
            User.countDocuments({ 'newcomer.status': 'flagged', 'newcomer.flaggedAt': { $gt: recentFlagCutoff() } }),
            User.countDocuments({ 'newcomer.status': 'pending', createdAt: { $gte: reviewCutoff } })
        ]);
        res.json({ success: true, data: { flagged, flaggedRecent, pending, needsReview: flaggedRecent + pending, hideDays: FLAGGED_HIDE_DAYS } });
    } catch (error) {
        console.error('خطأ في إحصاءات الجدد:', error);
        res.status(500).json({ success: false, message: 'خطأ في السيرفر' });
    }
});

// @route GET /api/newcomers/groups
// @desc  المرفوعون (flagged) مجمّعين حسب السبب: العدد، والمخفي حالياً (≤ FLAGGED_HIDE_DAYS)
router.get('/groups', protect, adminOnly, async (req, res) => {
    try {
        const cutoff = recentFlagCutoff();
        const keys = [...Object.keys(REASON_GROUPS), 'other'];
        const data = await Promise.all(keys.map(async (key) => {
            const base = { 'newcomer.status': 'flagged', ...reasonFilter(key) };
            const [total, recent] = await Promise.all([
                User.countDocuments(base),
                User.countDocuments({ ...base, 'newcomer.flaggedAt': { $gt: cutoff } })
            ]);
            return { key, label: REASON_GROUPS[key]?.label || 'أخرى', total, recent, older: total - recent };
        }));
        res.json({ success: true, data: data.filter(g => g.total > 0), hideDays: FLAGGED_HIDE_DAYS });
    } catch (error) {
        console.error('خطأ في تجميع الجدد:', error);
        res.status(500).json({ success: false, message: 'خطأ في السيرفر' });
    }
});

// @route POST /api/newcomers/bulk-approve
// @desc  اعتماد جماعي لمجموعة سبب — الأقدم من FLAGGED_HIDE_DAYS فقط (الأحدث يُراجَع فرداً).
//        لا يمسّ hidden.* عمداً: إخفاء وضعه مشرف لسبب آخر يبقى (بخلاف الاعتماد الفردي).
// @body  { reason: promo|words|carryover|other, dryRun?: bool }
router.post('/bulk-approve', protect, adminOnly, async (req, res) => {
    try {
        const { reason, dryRun } = req.body || {};
        if (!REASON_GROUPS[reason] && reason !== 'other') {
            return res.status(400).json({ success: false, message: 'سبب غير معروف' });
        }
        const filter = {
            'newcomer.status': 'flagged',
            'newcomer.flaggedAt': { $not: { $gt: recentFlagCutoff() } },
            ...reasonFilter(reason)
        };
        if (dryRun) {
            return res.json({ success: true, data: { wouldApprove: await User.countDocuments(filter) } });
        }
        const now = new Date();
        const r = await User.updateMany(filter, {
            $set: { 'newcomer.status': 'approved', 'newcomer.reviewedBy': req.user._id, 'newcomer.reviewedAt': now }
        });
        console.log(`[newcomers] bulk-approve ${reason}: ${r.modifiedCount} by ${req.user._id}`);
        res.json({ success: true, message: `تم اعتماد ${r.modifiedCount} حساباً`, data: { approved: r.modifiedCount } });
    } catch (error) {
        console.error('خطأ في الاعتماد الجماعي:', error);
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
