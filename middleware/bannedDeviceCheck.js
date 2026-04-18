// middleware/bannedDeviceCheck.js
// ✅ يمنع إنشاء حسابات/تسجيل دخول من جهاز محظور
// يُطبَّق على: /auth/register, /auth/login, /auth/google, /auth/apple

const BannedDevice = require('../models/BannedDevice');

/**
 * يقرأ deviceFingerprint + deviceToken من body أو headers
 * لو متطابقين مع جهاز محظور → يرفض بـ 403 DEVICE_BANNED
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

        // لا fingerprint ولا token → ندع الطلب يمر
        // (ملاحظة: يمكن تغيير هذا لسياسة صارمة تتطلب الـ token)
        if (!deviceFingerprint && !deviceToken) {
            return next();
        }

        const orConditions = [];
        if (deviceFingerprint) orConditions.push({ deviceFingerprint });
        if (deviceToken) orConditions.push({ keychainToken: deviceToken });

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
            bannedDevice.rejectedAttempts.push({
                email: req.body?.email || req.body?.appleEmail || null,
                name: req.body?.name || req.body?.fullName || null,
                ip,
                attemptedAt: new Date(),
                route: req.originalUrl || req.path
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
