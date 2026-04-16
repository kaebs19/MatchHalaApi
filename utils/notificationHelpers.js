// MatchHala - Notification Helpers
// دوال موحّدة لمعالجة الإشعارات (grouping, formatting)
// تُستخدم في mobile/notifications endpoint

const { isGroupableType } = require('../config/notificationCategories');

/**
 * تجميع الإشعارات المتشابهة (Smart Grouping)
 * مثال: 5 إعجابات في نفس اليوم → سطر واحد "❤️ 5 إعجابات جديدة"
 *
 * قاعدة التجميع:
 *   - same type
 *   - same day (UTC date)
 *   - groupable=true
 *   - يحفظ آخر إشعار كـ representative + يضيف groupCount
 *
 * @param {Array<object>} notifications - من DB، مرتّبة by createdAt DESC
 * @returns {Array<object>} - بعد التجميع
 */
function groupNotifications(notifications) {
    if (!Array.isArray(notifications) || notifications.length === 0) return [];

    const groups = new Map();
    const out = [];

    for (const notif of notifications) {
        // غير قابل للـ grouping → كما هو
        if (!isGroupableType(notif.type)) {
            out.push(notif);
            continue;
        }

        // مفتاح التجميع: type + day
        const day = new Date(notif.createdAt).toISOString().slice(0, 10); // YYYY-MM-DD
        const key = `${notif.type}|${day}`;

        if (!groups.has(key)) {
            // أول إشعار من هذه المجموعة → نحفظه كأساس
            groups.set(key, { primary: notif, count: 1, sample: [notif] });
            out.push(notif);  // placeholder — سنُعدّله بعد المرور
        } else {
            const g = groups.get(key);
            g.count++;
            if (g.sample.length < 5) g.sample.push(notif);
        }
    }

    // المرور الثاني: تحديث الـ primary بمعلومات المجموعة
    return out.map(notif => {
        if (!isGroupableType(notif.type)) return notif;
        const day = new Date(notif.createdAt).toISOString().slice(0, 10);
        const key = `${notif.type}|${day}`;
        const g = groups.get(key);
        if (!g || g.count <= 1) return notif;
        // إذا أكثر من 1 → الأول فقط يحمل count
        if (g.primary._id.toString() !== notif._id.toString()) return null;
        return {
            ...notif,
            groupCount: g.count,
            grouped: true
        };
    }).filter(Boolean);
}

/**
 * إعادة كتابة عنوان/نص الإشعار المجمّع للعرض
 * مثال: type=new_like, count=5 → "❤️ 5 إعجابات جديدة"
 */
function formatGroupedNotification(notif) {
    if (!notif.grouped || !notif.groupCount || notif.groupCount <= 1) return notif;

    const count = notif.groupCount;
    const formatters = {
        'new_like': () => ({
            title: '❤️ إعجابات جديدة',
            body: count === 2 ? `أعجب بك شخصان` : `أعجب بك ${count} أشخاص`
        }),
        'like': () => ({
            title: '❤️ إعجابات جديدة',
            body: count === 2 ? `أعجب بك شخصان` : `أعجب بك ${count} أشخاص`
        }),
        'super_like': () => ({
            title: '⭐ سوبر لايك جديدة',
            body: count === 2 ? `استلمت سوبر لايك من شخصين` : `استلمت ${count} سوبر لايك`
        }),
        'profile_view': () => ({
            title: '👀 زيارات لبروفايلك',
            body: count === 2 ? `زار بروفايلك شخصان اليوم` : `زار بروفايلك ${count} أشخاص اليوم`
        }),
        'new_match': () => ({
            title: '💖 مطابقات جديدة',
            body: count === 2 ? `لديك مطابقتان جديدتان` : `لديك ${count} مطابقات جديدة`
        }),
        'match': () => ({
            title: '💖 مطابقات جديدة',
            body: count === 2 ? `لديك مطابقتان جديدتان` : `لديك ${count} مطابقات جديدة`
        }),
        'new_follower': () => ({
            title: '👋 متابعون جدد',
            body: count === 2 ? `متابعان جديدان` : `${count} متابعين جدد`
        })
    };

    const fmt = formatters[notif.type];
    if (!fmt) return notif;
    const { title, body } = fmt();
    return { ...notif, title, body };
}

module.exports = {
    groupNotifications,
    formatGroupedNotification
};
