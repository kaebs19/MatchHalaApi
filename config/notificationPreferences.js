// MatchHala - تفضيلات الإشعارات خارج التطبيق
// المصدر الواحد لمفاتيح التفضيلات وقيمها الافتراضية وقرار الإرسال لكل نوع.
// يستعمله: routes/mobile/notifications.js (GET/PATCH) و services/pushNotificationService.js (البوابة)
// و utils/notificationDigest.js (الملخّص الدوري).

const { getPreferenceKey } = require('./notificationCategories');

const LEVELS = ['all', 'digest', 'off'];          // كل / ملخّص / إيقاف
const DELIVERY = ['sound', 'quiet', 'off'];       // بصوت / بهدوء / إيقاف
const SECTIONS = ['stories', 'likes', 'visits'];

const BOOL_KEYS = [
    'pushEnabled', 'invitations', 'messages', 'profileVisits', 'appAlerts',
    'storyReplies', 'storyScreenshots', 'friendStories', 'storyExpiryReminder',
    'matches', 'superLikes'
];
const LEVEL_KEYS = ['storyReactions', 'likes', 'visits'];

const DEFAULTS = {
    pushEnabled: true,
    invitations: true,
    messages: true,
    profileVisits: true,
    appAlerts: true,
    // 📸 القصص
    storyReplies: true,
    storyReactions: 'all',
    storyScreenshots: true,
    friendStories: false,
    storyExpiryReminder: true,
    // ❤️ الإعجابات والتطابق
    matches: true,
    superLikes: true,
    likes: 'digest',
    // 👀 الزيارات
    visits: 'digest',
    delivery: { stories: 'sound', likes: 'sound', visits: 'sound' }
};

/** التفضيلات كاملة بالقيم الافتراضية — للردّ على التطبيق */
function withDefaults(prefs = {}) {
    const out = {};
    for (const key of [...BOOL_KEYS, ...LEVEL_KEYS]) {
        out[key] = prefs[key] ?? DEFAULTS[key];
    }
    // التوافق: إيقاف «زيارات الملف» القديم يعني إيقاف الزيارات (buildUpdate يُبقيهما متّسقين،
    // والمستند المُرطَّب يحمل visits الافتراضي حتى لمن أوقف المفتاح القديم قبل وجوده)
    if (prefs.profileVisits === false) out.visits = 'off';
    out.delivery = {};
    for (const s of SECTIONS) {
        out.delivery[s] = prefs.delivery?.[s] ?? DEFAULTS.delivery[s];
    }
    return out;
}

/** تحويل جسم PATCH إلى $set — يقبل المفاتيح المعروفة وقيمها الصالحة فقط */
function buildUpdate(body = {}) {
    const updates = {};
    for (const key of BOOL_KEYS) {
        if (typeof body[key] === 'boolean') updates[`notificationPreferences.${key}`] = body[key];
    }
    for (const key of LEVEL_KEYS) {
        if (LEVELS.includes(body[key])) updates[`notificationPreferences.${key}`] = body[key];
    }
    if (body.delivery && typeof body.delivery === 'object') {
        for (const s of SECTIONS) {
            if (DELIVERY.includes(body.delivery[s])) updates[`notificationPreferences.delivery.${s}`] = body.delivery[s];
        }
    }
    // زيارات ← أبقِ المفتاح القديم متّسقاً للإصدارات القديمة
    if (updates['notificationPreferences.visits']) {
        updates['notificationPreferences.profileVisits'] = updates['notificationPreferences.visits'] !== 'off';
    } else if (typeof body.profileVisits === 'boolean') {
        updates['notificationPreferences.visits'] = body.profileVisits ? DEFAULTS.visits : 'off';
    }
    return updates;
}

/**
 * قاعدة كل نوع: القسم، المفتاح، وهل يقبل الملخّص (digest = اسم العدّاد).
 * story_reply ليس نوعاً — رسالة/طلب محادثة بـ data.storyReply = '1'.
 */
const RULES = {
    story_reply:      { section: 'stories', key: 'storyReplies' },
    story_reaction:   { section: 'stories', key: 'storyReactions', digest: 'reactions' },
    story_screenshot: { section: 'stories', key: 'storyScreenshots' },
    friend_story:     { section: 'stories', key: 'friendStories' },
    story_expiring:   { section: 'stories', key: 'storyExpiryReminder' },
    new_match:        { section: 'likes', key: 'matches', timeSensitive: true },
    match:            { section: 'likes', key: 'matches', timeSensitive: true },
    super_like:       { section: 'likes', key: 'superLikes' },
    new_like:         { section: 'likes', key: 'likes', digest: 'likes' },
    like:             { section: 'likes', key: 'likes', digest: 'likes' },
    profile_view:     { section: 'visits', key: 'visits', digest: 'visits' }
};

/**
 * قرار الإرسال لإشعار واحد.
 * @returns {{ controlled: boolean, allowed: boolean, reason?: string,
 *             digest?: string, quiet: boolean, timeSensitive: boolean }}
 *   controlled = يتحكّم به المستخدم (يخضع للمفتاح الرئيسي وساعات الهدوء)
 */
function resolveDelivery(type, data = {}, rawPrefs = {}) {
    const prefs = withDefaults(rawPrefs || {});
    const isStoryReply = data.storyReply === '1' || data.storyReply === true;
    const ruleName = isStoryReply ? 'story_reply' : type;
    const rule = RULES[ruleName];
    const legacyKey = getPreferenceKey(type);

    // قبول طلب المحادثة — يخترق التركيز (Time Sensitive)
    const accepted = type === 'conversation_request' && data.action === 'accepted';

    // الملخّص نفسه — يحمل نمطه من مُرسِله
    if (type === 'notification_digest') {
        if (!prefs.pushEnabled) return { controlled: true, allowed: false, reason: 'push_disabled', quiet: false, timeSensitive: false };
        return { controlled: true, allowed: true, quiet: data.quiet === '1', timeSensitive: false };
    }

    if (!rule) {
        if (!legacyKey) return { controlled: false, allowed: true, quiet: false, timeSensitive: false };
        if (!prefs.pushEnabled) return { controlled: true, allowed: false, reason: 'push_disabled', quiet: false, timeSensitive: false };
        if (prefs[legacyKey] === false) return { controlled: true, allowed: false, reason: 'pref_disabled', quiet: false, timeSensitive: false };
        return { controlled: true, allowed: true, quiet: false, timeSensitive: accepted };
    }

    if (!prefs.pushEnabled) return { controlled: true, allowed: false, reason: 'push_disabled', quiet: false, timeSensitive: false };
    // ردّ القصة طلبُ محادثة أيضاً — إيقاف الدعوات يوقفه كما كان
    if (isStoryReply && type === 'conversation_request' && prefs.invitations === false) {
        return { controlled: true, allowed: false, reason: 'pref_disabled', quiet: false, timeSensitive: false };
    }

    const delivery = prefs.delivery[rule.section];
    if (delivery === 'off') return { controlled: true, allowed: false, reason: 'section_off', quiet: false, timeSensitive: false };

    const value = prefs[rule.key];
    if (value === false || value === 'off') return { controlled: true, allowed: false, reason: 'pref_disabled', quiet: false, timeSensitive: false };

    const quiet = delivery === 'quiet';
    if (value === 'digest' && rule.digest) {
        return { controlled: true, allowed: false, reason: 'digest', digest: rule.digest, section: rule.section, quiet, timeSensitive: false };
    }
    return { controlled: true, allowed: true, quiet, timeSensitive: !!rule.timeSensitive && !quiet };
}

module.exports = { DEFAULTS, LEVELS, DELIVERY, SECTIONS, withDefaults, buildUpdate, resolveDelivery };
