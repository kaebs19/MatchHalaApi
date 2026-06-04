// utils/hideManager.js
// إدارة إخفاء الحسابات (عقوبة أخف من التعليق)
// المستخدم يستطيع تسجيل الدخول والمحادثة، لكن لا يظهر في Explore/Search،
// ويظهر بصورة مبهمة + اسم مخفي للمستخدمين الآخرين.

const User = require('../models/User');

const DURATIONS = {
    '24h': 24 * 60 * 60 * 1000,
    '3d': 3 * 24 * 60 * 60 * 1000,
    '7d': 7 * 24 * 60 * 60 * 1000,
    '30d': 30 * 24 * 60 * 60 * 1000,
    'permanent': null
};

function durationToDate(duration) {
    if (!duration || duration === 'permanent') return null;
    const ms = DURATIONS[duration];
    if (typeof ms !== 'number') {
        throw new Error(`Invalid duration: ${duration}`);
    }
    return new Date(Date.now() + ms);
}

/**
 * هل المستخدم مخفي حالياً (يأخذ في الحسبان انتهاء المدة)؟
 */
function isCurrentlyHidden(user) {
    if (!user?.hidden?.isHidden) return false;
    if (!user.hidden.hiddenUntil) return true; // دائم
    return new Date(user.hidden.hiddenUntil) > new Date();
}

/**
 * إخفاء حساب من الأدمن
 * @param {string} userId
 * @param {object} opts { duration, reason, adminId }
 * @returns {Promise<User>}
 */
async function hideUser(userId, { duration = '7d', reason = '', adminId } = {}) {
    const hiddenUntil = durationToDate(duration);
    const user = await User.findById(userId);
    if (!user) throw new Error('User not found');

    user.hidden = user.hidden || {};
    user.hidden.isHidden = true;
    user.hidden.hiddenAt = new Date();
    user.hidden.hiddenUntil = hiddenUntil;
    user.hidden.reason = reason || null;
    user.hidden.hiddenBy = adminId || null;
    user.hidden.notified = false;
    user.hidden.history = user.hidden.history || [];
    user.hidden.history.push({
        hiddenAt: new Date(),
        hiddenUntil,
        reason: reason || null,
        hiddenBy: adminId || null,
        source: 'admin'
    });

    await user.save();
    return user;
}

/**
 * فك الإخفاء (إما من الأدمن أو من الاستئناف أو عند انتهاء المدة)
 * @param {string} userId
 * @param {object} opts { adminId, source }
 */
async function unhideUser(userId, { adminId = null, source = 'admin' } = {}) {
    const user = await User.findById(userId);
    if (!user) throw new Error('User not found');
    if (!user.hidden?.isHidden) return user;

    // تحديث آخر سجل في history
    if (user.hidden.history && user.hidden.history.length > 0) {
        const last = user.hidden.history[user.hidden.history.length - 1];
        if (!last.unhiddenAt) {
            last.unhiddenAt = new Date();
            last.unhiddenBy = adminId;
            last.source = source;
        }
    }

    user.hidden.isHidden = false;
    user.hidden.hiddenAt = null;
    user.hidden.hiddenUntil = null;
    user.hidden.reason = null;
    user.hidden.hiddenBy = null;
    user.hidden.notified = false;

    await user.save();
    return user;
}

/**
 * استبعاد المخفيين من نتائج البحث/Explore بشرط في mongoose query
 * يستثني أيضاً من انتهت مدته
 */
function notHiddenFilter() {
    const now = new Date();
    return {
        $or: [
            { 'hidden.isHidden': { $ne: true } },
            { 'hidden.isHidden': true, 'hidden.hiddenUntil': { $ne: null, $lte: now } }
        ]
    };
}

module.exports = {
    DURATIONS,
    durationToDate,
    isCurrentlyHidden,
    hideUser,
    unhideUser,
    notHiddenFilter
};
