/**
 * نظام التصعيد الموحّد — Unified Escalation System
 *
 * يربط كل أنظمة العقوبات في دالة واحدة:
 * تحذيرات → تقييد → تعليق → حظر نهائي + حظر جهاز
 *
 * المستويات:
 * 0: عادي
 * 1: ⚠️ تحذير أول
 * 2: 🔴 تحذير أخير
 * 3: 🔒 تقييد جزئي (24h) — منع محادثات جديدة
 * 4: 🔒 تقييد كامل (48h) — منع كل الرسائل
 * 5: ⛔ تعليق (3 أيام)
 * 6: ⛔ تعليق (7 أيام)
 * 7: 🚫 حظر نهائي + حظر جهاز
 */

const User = require('../models/User');
const BannedDevice = require('../models/BannedDevice');
const Notification = require('../models/Notification');

const ESCALATION_LEVELS = {
    0: { type: 'none',      text: 'عادي' },
    1: { type: 'warn',      text: 'تنبيه أول',           pushTitle: '⚠️ تنبيه أول',            pushBody: 'تم رصد مخالفة لسياسة الاستخدام. هذا تنبيه أول — يرجى الالتزام بالشروط.' },
    2: { type: 'warn',      text: 'تنبيه أخير',          pushTitle: '🔴 تنبيه أخير!',           pushBody: 'تنبيه أخير — تم رصد مخالفة متكررة. المخالفة القادمة ستؤدي لتقييد حسابك تلقائياً.' },
    3: { type: 'restrict',  text: 'تقييد جزئي (24h)',    pushTitle: '🔒 تقييد مؤقت',            pushBody: 'تم تقييد حسابك مؤقتاً بسبب مخالفات. لا يمكنك بدء محادثات جديدة لمدة 24 ساعة.', level: 'new_only', hours: 24 },
    4: { type: 'restrict',  text: 'تقييد كامل (48h)',    pushTitle: '🔒 تقييد كامل',            pushBody: 'تم تقييد حسابك بسبب مخالفات متكررة. لا يمكنك إرسال أي رسائل لمدة 48 ساعة.',    level: 'all',      hours: 48 },
    5: { type: 'suspend',   text: 'إيقاف (3 أيام)',      pushTitle: '⛔ تم إيقاف حسابك',        pushBody: 'تم إيقاف حسابك مؤقتاً لمدة 3 أيام بسبب مخالفات متكررة لسياسة الاستخدام.',      hours: 72 },
    6: { type: 'suspend',   text: 'إيقاف (7 أيام)',      pushTitle: '⛔ تم إيقاف حسابك',        pushBody: 'تم إيقاف حسابك مؤقتاً لمدة 7 أيام بسبب مخالفات متكررة لسياسة الاستخدام.',      hours: 168 },
    7: { type: 'ban',       text: 'إيقاف نهائي + جهاز',  pushTitle: '🚫 تم إيقاف حسابك نهائياً', pushBody: 'تم إيقاف حسابك وجهازك بشكل نهائي بسبب مخالفات متكررة لسياسة الاستخدام.' },
};

/**
 * تصعيد عقوبة المستخدم للمستوى التالي تلقائياً
 * @param {string} userId - معرف المستخدم
 * @param {string} reason - سبب التصعيد
 * @param {string} source - 'auto' | 'admin'
 * @returns {object} { success, newLevel, action, message }
 */
async function escalateUser(userId, reason = 'مخالفة سياسة الاستخدام', source = 'auto') {
    const user = await User.findById(userId).select('+deviceFingerprint +keychainToken');
    if (!user) return { success: false, message: 'المستخدم غير موجود' };

    // حساب المستوى الحالي الفعلي
    const currentLevel = getCurrentLevel(user);
    const newLevel = Math.min(currentLevel + 1, 7);
    const levelConfig = ESCALATION_LEVELS[newLevel];

    console.log(`📊 Escalation: ${user.name} (${userId}) — Level ${currentLevel} → ${newLevel} (${levelConfig.text})`);

    // ── تنفيذ الإجراء حسب النوع ──

    if (levelConfig.type === 'warn') {
        // تحذير فقط
        user.set('warnings.level', newLevel);
        user.set('warnings.lastWarningAt', new Date());
        const history = user.warnings?.history || [];
        history.push({ level: newLevel, reason, source, at: new Date() });
        user.set('warnings.history', history);
        await user.save();

        // Socket.IO
        emitToUser(userId, 'account-warning', { level: newLevel, reason });

    } else if (levelConfig.type === 'restrict') {
        // تقييد المراسلة
        const until = new Date(Date.now() + levelConfig.hours * 60 * 60 * 1000);
        user.set('restrictions.messagingRestricted', true);
        user.set('restrictions.messagingRestrictedUntil', until);
        user.set('restrictions.messagingRestrictedLevel', levelConfig.level);
        user.set('restrictions.restrictionReason', reason);
        // ترفع مستوى التحذير أيضاً
        user.set('warnings.level', 2);
        await user.save();

        emitToUser(userId, 'account-restricted', {
            level: levelConfig.level, until: until.toISOString(), reason
        });

    } else if (levelConfig.type === 'suspend') {
        // تعليق كامل
        const until = new Date(Date.now() + levelConfig.hours * 60 * 60 * 1000);
        const suspLevel = newLevel === 5 ? 3 : 4; // map to old suspension levels

        user.set('suspension', {
            isSuspended: true,
            suspendedAt: new Date(),
            suspendedUntil: until,
            reason,
            level: suspLevel,
            totalSuspensions: (user.suspension?.totalSuspensions || 0) + 1,
            history: [
                ...(user.suspension?.history || []),
                { level: suspLevel, reason, suspendedAt: new Date(), suspendedUntil: until, source }
            ]
        });
        // isActive يبقى true — التعليق المؤقت لا يعطّل الحساب
        await user.save();

        emitToUser(userId, 'account-suspended', {
            suspendedUntil: until.toISOString(), reason, level: suspLevel
        });

    } else if (levelConfig.type === 'ban') {
        // حظر نهائي + حظر جهاز
        user.set('suspension', {
            isSuspended: true,
            suspendedAt: new Date(),
            suspendedUntil: null, // دائم
            reason,
            level: 5,
            totalSuspensions: (user.suspension?.totalSuspensions || 0) + 1,
            history: [
                ...(user.suspension?.history || []),
                { level: 5, reason: `حظر نهائي: ${reason}`, suspendedAt: new Date(), suspendedUntil: null, source }
            ]
        });
        user.isActive = false;
        await user.save();

        // حظر الجهاز تلقائياً
        if (user.deviceFingerprint || user.keychainToken) {
            await BannedDevice.findOneAndUpdate(
                {
                    $or: [
                        ...(user.deviceFingerprint ? [{ deviceFingerprint: user.deviceFingerprint }] : []),
                        ...(user.keychainToken ? [{ keychainToken: user.keychainToken }] : [])
                    ]
                },
                {
                    deviceFingerprint: user.deviceFingerprint,
                    keychainToken: user.keychainToken,
                    originalUserId: userId,
                    reason: 'auto_escalation',
                    reasonDetails: reason,
                    bannedBy: 'auto',
                    isActive: true
                },
                { upsert: true }
            );
            console.log(`📵 Device auto-banned for ${user.name}`);
        }

        emitToUser(userId, 'account-suspended', {
            suspendedUntil: null, reason, level: 5
        });
    }

    // ── إشعار Push ──
    try {
        const pushNotificationService = require('../services/pushNotificationService');
        await pushNotificationService.sendNotificationToUser(userId, {
            title: levelConfig.pushTitle,
            body: `${levelConfig.pushBody}\nالسبب: ${reason}`
        }, {
            type: levelConfig.type === 'warn' ? 'warning' : 'account_suspended',
            escalationLevel: newLevel
        });
    } catch (e) {
        console.error('Push notification error:', e.message);
    }

    return {
        success: true,
        newLevel,
        action: levelConfig.type,
        text: levelConfig.text,
        message: `تم تصعيد ${user.name} إلى المستوى ${newLevel}: ${levelConfig.text}`
    };
}

/**
 * حساب المستوى الحالي الفعلي للمستخدم
 */
function getCurrentLevel(user) {
    // حظر نهائي
    if (user.suspension?.isSuspended && !user.suspension.suspendedUntil) return 7;
    // تعليق 7 أيام
    if (user.suspension?.isSuspended && user.suspension.level >= 4) return 6;
    // تعليق 3 أيام
    if (user.suspension?.isSuspended && user.suspension.level >= 3) return 5;
    // تقييد كامل
    if (user.restrictions?.messagingRestricted && user.restrictions.messagingRestrictedLevel === 'all') return 4;
    // تقييد جزئي
    if (user.restrictions?.messagingRestricted && user.restrictions.messagingRestrictedLevel === 'new_only') return 3;
    // تحذير أخير
    if (user.warnings?.level >= 2) return 2;
    // تحذير أول
    if (user.warnings?.level >= 1) return 1;
    // عادي
    return 0;
}

/**
 * إرسال حدث Socket.IO للمستخدم
 */
function emitToUser(userId, event, data) {
    if (global.io) {
        global.io.to(`user:${userId}`).emit(event, data);
    }
}

module.exports = { escalateUser, getCurrentLevel, ESCALATION_LEVELS };
