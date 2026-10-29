// MatchHala - إشعارات القصص خارج التطبيق (لقطة الشاشة، قصة صديق جديدة، تذكير الانتهاء)
//
// كلها تمرّ على sendNotificationToUser فتحترم تفضيلات «القصص» (config/notificationPreferences.js).
// لا تُحفظ صفوفاً في الإشعارات (saveToDb=false): القصة نفسها تختفي بعد 24 ساعة.
// storyImage = مصغّرة القصة يرفقها امتداد الإشعارات (القصص النصّية بلا صورة).

const Story = require('../models/Story');
const User = require('../models/User');
const Friendship = require('../models/Friendship');
const pushNotificationService = require('../services/pushNotificationService');
const { getFullUrl } = require('../routes/mobile/helpers');

const FRIEND_STORY_THROTTLE_MS = 12 * 60 * 60 * 1000;   // إشعار واحد لكل صاحب قصص كل 12 ساعة
const FRIEND_STORY_MAX_RECIPIENTS = 500;
const EXPIRY_NOTICE_MS = 60 * 60 * 1000;                // التذكير قبل الانتهاء بساعة

const isPremiumActive = (user) => !!(user?.isPremium && user.premiumExpiresAt && new Date(user.premiumExpiresAt) > new Date());
const storyImageOf = (story) => (story?.kind === 'text' || !story?.imageUrl ? '' : getFullUrl(story.imageUrl) || '');

/** 📸 لقطة شاشة لقصتي — الاسم والصورة لهلا+ فقط (كقائمة المشاهدين) */
async function notifyStoryScreenshot(story, viewer) {
    const owner = await User.findById(story.user).select('isPremium premiumExpiresAt').lean();
    if (!owner) return;
    const premium = isPremiumActive(owner);
    const name = viewer.name || 'مستخدم';
    const verb = viewer.gender === 'female' ? 'التقطت' : 'التقط';
    await pushNotificationService.sendNotificationToUser(String(story.user), {
        title: '📸 لقطة شاشة لقصتك',
        body: premium ? `${name} ${verb} لقطة شاشة لقصتك` : 'التقط أحدهم لقطة شاشة لقصتك'
    }, {
        type: 'story_screenshot',
        storyId: String(story._id),
        storyImage: storyImageOf(story),
        ...(premium ? {
            senderId: String(viewer._id),
            senderName: name,
            senderImage: getFullUrl(viewer.profileImage) || ''
        } : {})
    }, false);
}

/** 👥 قصة جديدة لصديق — لمن فعّل «قصص الأصدقاء» فقط (مطفأ افتراضياً) */
async function notifyFriendsOfStory(story, author) {
    if (author.stealthMode || author.role === 'admin') return 0;

    // أول قصة في 12 ساعة فقط — لا إشعار مع كل قصة متتالية
    const recent = await Story.exists({
        user: author._id,
        _id: { $ne: story._id },
        createdAt: { $gt: new Date(Date.now() - FRIEND_STORY_THROTTLE_MS) }
    });
    if (recent) return 0;

    const links = await Friendship.find({
        status: 'accepted',
        $or: [{ requester: author._id }, { recipient: author._id }]
    }).select('requester recipient').lean();
    const authorId = String(author._id);
    const friendIds = links.map(l => (String(l.requester) === authorId ? l.recipient : l.requester));
    if (friendIds.length === 0) return 0;

    const blocked = (author.blockedUsers || []).map(String);
    const recipients = await User.find({
        _id: { $in: friendIds, $nin: blocked },
        isActive: true,
        'notificationPreferences.friendStories': true,
        blockedUsers: { $ne: author._id },
        storyMutedUsers: { $ne: author._id }
    }).select('_id').limit(FRIEND_STORY_MAX_RECIPIENTS).lean();

    const name = author.name || 'صديقك';
    const verb = author.gender === 'female' ? 'نشرت' : 'نشر';
    const data = {
        type: 'friend_story',
        storyId: String(story._id),
        senderId: authorId,
        senderName: name,
        senderImage: getFullUrl(author.profileImage) || '',
        storyImage: storyImageOf(story)
    };
    for (const r of recipients) {
        await pushNotificationService.sendNotificationToUser(String(r._id), {
            title: '📸 قصة جديدة',
            body: `${name} ${verb} قصة جديدة`
        }, data, false).catch(() => {});
    }
    return recipients.length;
}

/** ⏳ تذكير قبل انتهاء قصتي بساعة — مرة لكل قصة (مطالبة ذرّية بـ expiryReminded) */
async function remindExpiringStories(now = new Date()) {
    const due = await Story.find({
        status: 'active',
        expiresAt: { $gt: now, $lte: new Date(now.getTime() + EXPIRY_NOTICE_MS) },
        expiryReminded: { $ne: true },
        heldAt: null
    }).select('user kind imageUrl viewCount reactionCount').limit(200).lean();

    let sent = 0;
    for (const story of due) {
        const claimed = await Story.updateOne(
            { _id: story._id, expiryReminded: { $ne: true } },
            { $set: { expiryReminded: true } }
        );
        if (claimed.modifiedCount === 0) continue;

        const views = story.viewCount || 0;
        const reactions = story.reactionCount || 0;
        const stats = views > 0
            ? `شاهدها ${views}${reactions > 0 ? ` وتفاعل معها ${reactions}` : ''} — احفظها قبل أن تختفي`
            : 'احفظها قبل أن تختفي أو أضف قصة جديدة';
        const result = await pushNotificationService.sendNotificationToUser(String(story.user), {
            title: '⏳ قصتك تنتهي خلال ساعة',
            body: stats
        }, {
            type: 'story_expiring',
            storyId: String(story._id),
            storyImage: storyImageOf(story)
        }, false).catch(() => null);
        if (result?.pushed) sent += 1;
    }
    return sent;
}

module.exports = { notifyStoryScreenshot, notifyFriendsOfStory, remindExpiringStories };
