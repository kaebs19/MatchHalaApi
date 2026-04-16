// MatchHala - Fingerprint Updater Middleware
// يُشغَّل بعد protect لتحديث deviceFingerprint و keychainToken تلقائياً
// عندما يرسل التطبيق المحدّث هذه القيم في headers أو body.
// الهدف: المستخدمون القدامى (اللي سجّلوا دخول قبل إضافة البصمة) يتم تحديث
// بصماتهم لحظة استخدامهم النسخة الجديدة.

const User = require('../models/User');

/**
 * يحدّث بصمة الجهاز للمستخدم المُصادَق عليه إذا أرسلها في الطلب.
 * - لا يوقف الـ request أبداً (fire-and-forget ما عدا عند التغيير)
 * - لا يكتب إلا إذا تغيّرت البصمة فعلاً (لتقليل الكتابة)
 * - يُسجّل lastFingerprintUpdate = now
 */
async function updateFingerprint(req, res, next) {
    try {
        if (!req.user || !req.user._id) return next();

        const fp = (req.headers['x-device-fingerprint'] || req.body?.deviceFingerprint || '').toString().trim();
        const kt = (req.headers['x-keychain-token'] || req.body?.keychainToken || '').toString().trim();

        if (!fp && !kt) return next();

        // نقرأ القيم الحالية (بدون select: false سيعود null، لذا نستخدم findById مع select)
        const current = await User.findById(req.user._id)
            .select('+deviceFingerprint +keychainToken')
            .lean();

        if (!current) return next();

        const updates = {};
        if (fp && current.deviceFingerprint !== fp) {
            updates.deviceFingerprint = fp;
        }
        if (kt && current.keychainToken !== kt) {
            updates.keychainToken = kt;
        }

        if (Object.keys(updates).length > 0) {
            updates.lastFingerprintUpdate = new Date();
            // fire-and-forget (لا نُعطّل الـ request)
            User.findByIdAndUpdate(req.user._id, updates)
                .exec()
                .catch(err => console.error('⚠️ fingerprintUpdater error:', err.message));
        } else if (fp || kt) {
            // البصمة موجودة وصالحة — نحدّث تاريخ آخر تحديث فقط (مرة كل 24h)
            const last = current.lastFingerprintUpdate ? new Date(current.lastFingerprintUpdate) : null;
            const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
            if (!last || last < dayAgo) {
                User.findByIdAndUpdate(req.user._id, { lastFingerprintUpdate: new Date() })
                    .exec()
                    .catch(() => {});
            }
        }
    } catch (e) {
        console.error('⚠️ fingerprintUpdater exception:', e.message);
    }
    next();
}

module.exports = updateFingerprint;
