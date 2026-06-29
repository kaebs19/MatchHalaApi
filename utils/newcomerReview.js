// ═══════════════════════════════════════════════════════════════
// مراجعة المستخدمين الجدد (newcomer review)
// عند وقوع مخالفة تلقائية من مستخدم جديد ما زال تحت المراجعة
// (status='pending' وعمر الحساب < 24 ساعة) نرفعه إلى flagged
// فيُخفى من الاكتشاف للجميع ويظهر للمشرف للمراجعة اليدوية.
// ═══════════════════════════════════════════════════════════════
const User = require('../models/User');

const REVIEW_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 ساعة

async function flagPendingNewcomer(userId, reason) {
    try {
        const u = await User.findById(userId).select('newcomer createdAt');
        if (!u) return false;
        // نرفع فقط الجدد المعلّقين خلال نافذة المراجعة
        if (u.newcomer?.status !== 'pending') return false;
        const ageMs = Date.now() - new Date(u.createdAt).getTime();
        if (ageMs > REVIEW_WINDOW_MS) return false;

        await User.findByIdAndUpdate(userId, {
            'newcomer.status': 'flagged',
            'newcomer.flaggedReason': reason || 'مخالفة تلقائية أثناء فترة المراجعة',
            'newcomer.flaggedAt': new Date()
        });
        return true;
    } catch (e) {
        console.error('flagPendingNewcomer error:', e.message);
        return false;
    }
}

module.exports = { flagPendingNewcomer, REVIEW_WINDOW_MS };
