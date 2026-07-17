// MatchHala - Notification Categories
// المصدر الموحّد لتصنيف أنواع الإشعارات
// يُستخدم من: backend filters, admin dashboard, iOS app
//
// 4 فئات:
// 1. PERSONAL  → إشعارات شخصية للمستخدم (مطابقات، إعجابات، تنبيهات النظام)
// 2. SOCIAL    → تفاعلات اجتماعية (إعجاب، زيارة بروفايل، سوبرلايك) — قابلة للـ grouping
// 3. ADMIN     → إدارية (بلاغات، رسائل محظورة) — تظهر فقط في لوحة التحكم
// 4. CHANNEL   → رسائل المحادثات — لا تُحفظ في DB (يكفي tab المحادثات + push)

const NOTIFICATION_CATEGORIES = {
    PERSONAL: 'personal',
    SOCIAL: 'social',
    ADMIN: 'admin',
    CHANNEL: 'channel'
};

/**
 * تعريف كل نوع notification:
 *   category: الفئة (للفلترة)
 *   groupable: قابل للـ grouping (5 إعجابات → سطر واحد)
 *   adminOnly: لا يظهر في تطبيق المستخدم (حتى للأدمن نفسه)
 *   icon: SF Symbol أو emoji
 *   sound: اقتراح صوت (للمستقبل)
 */
const NOTIFICATION_TYPES = {
    // ===== Personal — System events =====
    'general':              { category: 'personal', groupable: false, adminOnly: false },
    'system':               { category: 'personal', groupable: false, adminOnly: false },
    'announcement':         { category: 'personal', groupable: false, adminOnly: false },
    'broadcast':            { category: 'personal', groupable: false, adminOnly: false },
    'verification':         { category: 'personal', groupable: false, adminOnly: false },
    'warning':              { category: 'personal', groupable: false, adminOnly: false },
    'official_warning':     { category: 'personal', groupable: false, adminOnly: false },
    'account_suspended':    { category: 'personal', groupable: false, adminOnly: false },
    'account_unsuspended':  { category: 'personal', groupable: false, adminOnly: false },
    'account_restricted':   { category: 'personal', groupable: false, adminOnly: false },
    'restriction':          { category: 'personal', groupable: false, adminOnly: false },
    'name_action':          { category: 'personal', groupable: false, adminOnly: false },
    'bio_action':           { category: 'personal', groupable: false, adminOnly: false },
    'photo_action':         { category: 'personal', groupable: false, adminOnly: false },
    'photo_removed':        { category: 'personal', groupable: false, adminOnly: false },
    'security_alert':       { category: 'personal', groupable: false, adminOnly: false },
    'appeal_update':        { category: 'personal', groupable: false, adminOnly: false },
    'report_result':        { category: 'personal', groupable: false, adminOnly: false },
    'chat_mode_changed':    { category: 'personal', groupable: false, adminOnly: false },
    'conversations_censored': { category: 'personal', groupable: false, adminOnly: false },
    'conversations_wiped':  { category: 'personal', groupable: false, adminOnly: false },

    // ===== Social — Engagement (groupable) =====
    'new_match':            { category: 'social', groupable: true, adminOnly: false },
    'match':                { category: 'social', groupable: true, adminOnly: false },
    'new_like':             { category: 'social', groupable: true, adminOnly: false },
    'like':                 { category: 'social', groupable: true, adminOnly: false },
    'super_like':           { category: 'social', groupable: true, adminOnly: false },
    'profile_view':         { category: 'social', groupable: true, adminOnly: false },
    'new_follower':         { category: 'social', groupable: true, adminOnly: false },
    'comment':              { category: 'social', groupable: true, adminOnly: false },
    'friend_request':       { category: 'social', groupable: false, adminOnly: false },
    'friend_accepted':      { category: 'social', groupable: false, adminOnly: false },
    'conversation_request': { category: 'social', groupable: false, adminOnly: false },
    'conversation_accepted':{ category: 'social', groupable: false, adminOnly: false },
    'conversation_reminder':{ category: 'social', groupable: false, adminOnly: false },
    'conversation_expired': { category: 'personal', groupable: false, adminOnly: false },

    // ===== Admin — لا تظهر في تطبيق المستخدم العادي ولا الأدمن =====
    'flagged_message':      { category: 'admin', groupable: false, adminOnly: true },
    'report':               { category: 'admin', groupable: false, adminOnly: true },
    'report_warning':       { category: 'admin', groupable: false, adminOnly: true },

    // ===== Channel — لا تُحفظ في DB أبداً =====
    'message':              { category: 'channel', groupable: false, adminOnly: false },
    'new_message':          { category: 'channel', groupable: false, adminOnly: false }
};

/**
 * احصل على بيانات نوع notification
 * @param {string} type
 * @returns {{category, groupable, adminOnly}}
 */
function getTypeMeta(type) {
    return NOTIFICATION_TYPES[type] || {
        category: 'personal',
        groupable: false,
        adminOnly: false
    };
}

/**
 * هل هذا النوع قناة (channel) — لا يُحفظ في DB أبداً
 */
function isChannelType(type) {
    return getTypeMeta(type).category === 'channel';
}

/**
 * هل هذا النوع إداري — يُخفى من تطبيق المستخدم
 */
function isAdminOnlyType(type) {
    return getTypeMeta(type).adminOnly === true;
}

/**
 * هل هذا النوع قابل للـ grouping
 */
function isGroupableType(type) {
    return getTypeMeta(type).groupable === true;
}

/**
 * ربط نوع الإشعار بمفتاح تفضيل الـ push الذي يتحكّم به المستخدم.
 * يُستخدم لبوابة الـ push في pushNotificationService.
 *
 * القيم الممكنة: 'invitations' | 'messages' | 'profileVisits' | 'appAlerts'
 * أو null للأنواع الحرجة (تحذيرات/أمان/إيقاف حساب) التي تبقى مفعّلة دائماً.
 */
const PREFERENCE_KEY_BY_TYPE = {
    // دعوات المحادثة
    'conversation_request':  'invitations',
    'conversation_accepted': 'invitations',
    'conversation_reminder': 'invitations',
    // الرسائل
    'message':               'messages',
    'new_message':           'messages',
    // زيارة الملف الشخصي
    'profile_view':          'profileVisits',
    // تنبيهات التطبيق (إعلانات عامة)
    'announcement':          'appAlerts',
    'broadcast':             'appAlerts',
    'system':                'appAlerts',
    'general':               'appAlerts'
};

/**
 * احصل على مفتاح التفضيل الذي يتحكّم بإشعار من هذا النوع.
 * @param {string} type
 * @returns {string|null} مفتاح التفضيل أو null للأنواع الحرجة (دائماً مفعّلة)
 */
function getPreferenceKey(type) {
    return PREFERENCE_KEY_BY_TYPE[type] || null;
}

/**
 * أنواع تُستخدم للـ filter tabs في iOS
 * يجب أن تطابق NotificationCategory.swift
 */
const FILTER_CATEGORIES = {
    all: 'الكل',
    unread: 'غير المقروءة',
    social: 'تفاعلات',
    system: 'تنبيهات النظام'
};

/**
 * بناء MongoDB filter يُستخدم في /mobile/notifications
 * يستبعد admin-only + channel + يُطبّق filter المستخدم
 *
 * @param {object} params
 * @param {string} params.userId
 * @param {string} [params.role='user']
 * @param {string} [params.filter='all']  // all | unread | social | system
 * @returns {object} mongo filter
 */
function buildUserNotificationsFilter({ userId, role = 'user', filter = 'all' }) {
    // الأنواع الإدارية + Channel — استبعد دائماً
    const excludedTypes = Object.entries(NOTIFICATION_TYPES)
        .filter(([, meta]) => meta.adminOnly || meta.category === 'channel')
        .map(([type]) => type);

    const baseFilter = {
        $or: [
            { targetUsers: userId },
            { recipients: 'all' }
        ],
        isActive: true,
        type: { $nin: excludedTypes }
    };

    if (filter === 'unread') {
        baseFilter['readBy.user'] = { $ne: userId };
    } else if (filter === 'social') {
        const socialTypes = Object.entries(NOTIFICATION_TYPES)
            .filter(([, meta]) => meta.category === 'social' && !meta.adminOnly)
            .map(([type]) => type);
        baseFilter.type = { $in: socialTypes };
    } else if (filter === 'system') {
        const systemTypes = Object.entries(NOTIFICATION_TYPES)
            .filter(([, meta]) => meta.category === 'personal' && !meta.adminOnly)
            .map(([type]) => type);
        baseFilter.type = { $in: systemTypes };
    }

    return baseFilter;
}

module.exports = {
    NOTIFICATION_CATEGORIES,
    NOTIFICATION_TYPES,
    FILTER_CATEGORIES,
    getTypeMeta,
    isChannelType,
    isAdminOnlyType,
    isGroupableType,
    getPreferenceKey,
    buildUserNotificationsFilter
};
