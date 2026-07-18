// تنظيف شامل لبيانات مستخدم محذوف — يُستدعى من:
//   1. DELETE /auth/delete-account (حذف ذاتي)
//   2. DELETE /users/:id (حذف أدمن)
//
// يحذف: التمريرات + الإعجابات المميزة + زيارات البروفايل + المطابقات
//        + الإشعارات + الصداقات والطلبات وقوائم الأصدقاء + ملفات الصور
//        + مراجعه في بيانات الآخرين (تثبيتات/قوائم/حظر)
//
// يُبقي عمداً:
//   - الرسائل والمحادثات (نسخة الطرف الآخر — الهوية تُفصل تلقائياً بحذف المستخدم)
//   - البلاغات والمخالفات والاستئنافات (سجلات أمان — تُحفظ حسب سياسة 90 يوماً)

const fs = require('fs');
const path = require('path');

/**
 * @param {string|ObjectId} userId - معرّف المستخدم المحذوف
 * @param {object|null} userDoc - وثيقة المستخدم (لحذف ملفات الصور) — اختيارية
 * @returns {object} أعداد ما حُذف (للسجل)
 */
async function cleanupDeletedUser(userId, userDoc = null) {
    const Swipe = require('../models/Swipe');
    const SuperLike = require('../models/SuperLike');
    const ProfileView = require('../models/ProfileView');
    const Notification = require('../models/Notification');
    const Friendship = require('../models/Friendship');
    const FriendList = require('../models/FriendList');
    const Match = require('../models/Match');
    const User = require('../models/User');

    const counts = {};

    // ── 1. التفاعلات (وعد الصفحة القانونية: "المطابقات والإعجابات والتمريرات") ──
    const [swipes, superLikes, profileViews, matches] = await Promise.all([
        Swipe.deleteMany({ $or: [{ swiper: userId }, { swiped: userId }] }),
        SuperLike.deleteMany({ $or: [{ sender: userId }, { receiver: userId }] }),
        ProfileView.deleteMany({ $or: [{ viewer: userId }, { viewed: userId }] }),
        Match.deleteMany({ users: userId })
    ]);
    counts.swipes = swipes.deletedCount;
    counts.superLikes = superLikes.deletedCount;
    counts.profileViews = profileViews.deletedCount;
    counts.matches = matches.deletedCount;

    // ── 2. نظام الأصدقاء ──
    const [friendships, ownLists] = await Promise.all([
        Friendship.deleteMany({ $or: [{ requester: userId }, { recipient: userId }] }),
        FriendList.deleteMany({ owner: userId })
    ]);
    counts.friendships = friendships.deletedCount;
    counts.friendLists = ownLists.deletedCount;

    // إزالة مراجعه من بيانات الآخرين (عضويات قوائم + تثبيتات + قوائم حظر)
    await Promise.all([
        FriendList.updateMany({ members: userId }, { $pull: { members: userId } }),
        User.updateMany({ pinnedFriends: userId }, { $pull: { pinnedFriends: userId } }),
        User.updateMany({ blockedUsers: userId }, { $pull: { blockedUsers: userId } })
    ]);

    // ── 3. الإشعارات ──
    // إشعاراته الصادرة الموجهة (إعجاب/زيارة/طلب صداقة...) — تُحذف
    const outgoing = await Notification.deleteMany({ sender: userId, recipients: 'specific' });
    counts.notificationsSent = outgoing.deletedCount;
    // الإشعارات الواردة إليه — يُسحب من المستقبلين ثم تُحذف الفارغة
    await Notification.updateMany(
        { targetUsers: userId },
        { $pull: { targetUsers: userId } }
    );
    await Notification.deleteMany({
        recipients: { $ne: 'all' },
        targetUsers: { $size: 0 }
    });

    // ── 4. ملفات الصور من القرص (المعرض كاملاً + صورة البروفايل) ──
    counts.photoFiles = 0;
    if (userDoc) {
        const filePaths = new Set();
        if (userDoc.profileImage && !String(userDoc.profileImage).includes('/defaults/')) {
            filePaths.add(userDoc.profileImage);
        }
        for (const photo of (userDoc.photos || [])) {
            for (const key of ['original', 'medium', 'thumbnail']) {
                if (photo[key] && !String(photo[key]).includes('/defaults/')) {
                    filePaths.add(photo[key]);
                }
            }
        }
        for (const rel of filePaths) {
            // مسارات محلية نسبية فقط (تجاهل الروابط الخارجية)
            if (String(rel).startsWith('http')) continue;
            const abs = path.join(__dirname, '..', String(rel));
            try {
                if (fs.existsSync(abs)) {
                    fs.unlinkSync(abs);
                    counts.photoFiles++;
                }
            } catch (e) {
                console.error(`⚠️ فشل حذف ملف صورة ${rel}:`, e.message);
            }
        }
    }

    console.log(`🧹 cleanupDeletedUser(${userId}):`, JSON.stringify(counts));
    return counts;
}

module.exports = cleanupDeletedUser;
