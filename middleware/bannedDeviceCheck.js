// middleware/bannedDeviceCheck.js
// ✅ يمنع إنشاء حسابات/تسجيل دخول من جهاز محظور
// يُطبَّق على: /auth/register, /auth/login, /auth/google, /auth/apple

const BannedDevice = require('../models/BannedDevice');
const { isStrictDeviceVersion } = require('../utils/strictDeviceMode');

/**
 * يقرأ deviceFingerprint + deviceToken + vendorId من body أو headers
 * لو متطابقين مع جهاز محظور → يرفض بـ 403 DEVICE_BANNED
 *
 * Strict Mode: نسخ التطبيق ≥ 5.4 ملزمة بإرسال البصمة (تسد ثغرة fail-open)
 */
const bannedDeviceCheck = async (req, res, next) => {
    try {
        // نقبل من body (JSON) أو من headers (احتياط)
        const deviceFingerprint =
            req.body?.deviceFingerprint ||
            req.headers['x-device-fingerprint'];
        const deviceToken =
            req.body?.deviceToken ||
            req.headers['x-device-token'];
        const vendorId =
            req.body?.vendorId ||
            req.headers['x-vendor-id'];

        // ✅ Strict Mode للنسخ ≥ 5.4 — إلزام إرسال البصمة
        if (isStrictDeviceVersion(req) && !deviceFingerprint && !deviceToken && !vendorId) {
            return res.status(400).json({
                success: false,
                message: 'بيانات الجهاز مطلوبة',
                code: 'MISSING_DEVICE_INFO'
            });
        }

        // النسخ القديمة بدون بصمة → ندع الطلب يمر (للتوافق)
        if (!deviceFingerprint && !deviceToken && !vendorId) {
            return next();
        }

        const orConditions = [];
        if (deviceFingerprint) orConditions.push({ deviceFingerprint });
        if (deviceToken) orConditions.push({ keychainToken: deviceToken });
        if (vendorId) orConditions.push({ vendorId });

        const bannedDevice = await BannedDevice.findOne({
            isActive: true,
            $or: orConditions
        });

        if (!bannedDevice) {
            return next();
        }

        // سجّل محاولة التسجيل المرفوضة (للمراجعة)
        try {
            const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
                       req.headers['x-real-ip'] ||
                       req.socket?.remoteAddress;
            // ✅ استنتاج نوع المحاولة من المسار
            const route = req.originalUrl || req.path || '';
            let action = 'login';
            if (route.includes('/google')) action = 'google';
            else if (route.includes('/apple')) action = 'apple';
            else if (route.includes('/register')) action = 'register';

            bannedDevice.rejectedAttempts.push({
                email: req.body?.email || req.body?.appleEmail || null,
                name: req.body?.name || req.body?.fullName || null,
                ip,
                attemptedAt: new Date(),
                action
            });
            // حد أقصى 100 محاولة لتجنّب التضخّم
            if (bannedDevice.rejectedAttempts.length > 100) {
                bannedDevice.rejectedAttempts = bannedDevice.rejectedAttempts.slice(-100);
            }
            await bannedDevice.save();
        } catch (logErr) {
            console.error('bannedDeviceCheck log error:', logErr.message);
        }

        return res.status(403).json({
            success: false,
            message: 'لا يمكن استخدام هذا الجهاز — محظور',
            code: 'DEVICE_BANNED'
        });
    } catch (err) {
        console.error('bannedDeviceCheck error:', err);
        // فشل الفحص → نترك الطلب يمر (fail-open) حتى لا نعطّل الدخول بسبب خطأ في DB
        return next();
    }
};

module.exports = bannedDeviceCheck;
