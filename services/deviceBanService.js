// services/deviceBanService.js
//
// حظر جهاز المستخدم لحظةَ صدور عقوبة دائمة — لا لحظةَ محاولته الدخول بعدها.
//
// ⚠️ سبب وجود هذا الملف: كان حظر الجهاز حدثاً لاحقاً، يُسجَّل فقط عندما
//    يحاول الموقوفُ الدخولَ إلى حسابه الموقوف (recordDeviceBanForUser في
//    auth.js). فمن جرّب حسابه القديم أولاً حُظر جهازه ولم يستطع إنشاء حساب
//    جديد، ومن ذهب مباشرةً إلى «إنشاء حساب» لم يجد ما يمنعه — عقوبةٌ واحدة
//    بنتيجتَين حسب ترتيب نقرات المستخدم. الآن العقوبة الدائمة تحظر الجهاز
//    فوراً من بيانات الحساب المخزّنة، ومسار الدخول يبقى شبكةَ أمان للحسابات
//    القديمة بلا بصمة.

const mongoose = require('mongoose');
const User = require('../models/User');
const BannedDevice = require('../models/BannedDevice');

/**
 * هل العقوبة على هذا المستخدم دائمة فعلاً؟
 * دائم = تعليق بلا نهاية، أو تعطيل صريح ليس أثراً جانبياً لعقوبة مؤقتة.
 *
 * ⚠️ `isActive === false` وحده لا يكفي: التعليق المؤقت وحظر الكلمات (٢٤ ساعة)
 *    كلاهما يُطفئ isActive ثم يُعاد تشغيله عند الانتهاء. اعتبارُه دليلَ دوامٍ
 *    كان يحوّل عقوبة يوم واحد إلى حظر جهاز أبدي — وهو ما احتاج سكربت
 *    cleanupTemporaryDeviceBans لتنظيف آثاره.
 */
function isPermanentlyPunished(user) {
    if (!user) return false;
    const s = user.suspension;
    if (s?.isSuspended === true && !s.suspendedUntil) return true;

    const temporarilySuspended = s?.isSuspended === true && !!s.suspendedUntil;
    const wordBanned = user.bannedWords?.isBanned === true;
    return user.isActive === false && !temporarilySuspended && !wordBanned;
}

/**
 * يسجّل/يحدّث BannedDevice لمستخدم عقوبته دائمة، من بصماته المخزّنة.
 * بلا بصمة → سجل pendingFingerprint يُربَط عند أول دخول يحمل بصمة
 * (saveLoginRecord في auth.js يتكفّل بالربط).
 *
 * @param {ObjectId|string} userId
 * @param {object} opts
 * @param {string} opts.reason      من enum BannedDevice.reason
 * @param {string} opts.details
 * @param {string} opts.bannedBy    'admin' | 'auto' | 'spam_system'
 * @param {ObjectId} [opts.adminId]
 * @returns {Promise<{banned: boolean, pending?: boolean, skipped?: string}>}
 */
async function banDeviceForUser(userId, { reason = 'manual', details = '', bannedBy = 'auto', adminId = null } = {}) {
    try {
        if (!mongoose.Types.ObjectId.isValid(userId)) return { banned: false, skipped: 'invalid_id' };

        // الحقول المخفية (select: false) تحتاج طلباً صريحاً
        const user = await User.findById(userId)
            .select('+deviceFingerprint +keychainToken +vendorId +deviceDetails isActive suspension bannedWords')
            .lean();
        if (!user) return { banned: false, skipped: 'no_user' };
        if (!isPermanentlyPunished(user)) return { banned: false, skipped: 'not_permanent' };

        const fp = user.deviceFingerprint || null;
        const kt = user.keychainToken || null;
        const vid = user.vendorId || null;
        const hasFingerprint = !!(fp || kt || vid);

        const match = [{ originalUserId: user._id }];
        if (fp) match.push({ deviceFingerprint: fp });
        if (kt) match.push({ keychainToken: kt });
        if (vid) match.push({ vendorId: vid });

        const setFields = {
            isActive: true,
            pendingFingerprint: !hasFingerprint
        };
        if (fp) setFields.deviceFingerprint = fp;
        if (kt) setFields.keychainToken = kt;
        if (vid) setFields.vendorId = vid;

        // ⚠️ $setOnInsert لا يجوز أن يكرّر مفتاحاً في $set (ConflictingUpdateOperators)
        const setOnInsert = {
            originalUserId: user._id,
            reason,
            reasonDetails: details || `banned on permanent punishment (${reason})`,
            bannedBy,
            deviceInfo: user.deviceDetails || {}
        };
        if (adminId) setOnInsert.adminId = adminId;

        await BannedDevice.findOneAndUpdate(
            { $or: match },
            { $set: setFields, $setOnInsert: setOnInsert },
            { upsert: true, returnDocument: 'after' }
        );

        return { banned: true, pending: !hasFingerprint };
    } catch (e) {
        // لا نُفشل العقوبة نفسها بسبب فشل حظر الجهاز
        console.error('⚠️ banDeviceForUser error:', e.message);
        return { banned: false, skipped: 'error' };
    }
}

module.exports = { banDeviceForUser, isPermanentlyPunished };
