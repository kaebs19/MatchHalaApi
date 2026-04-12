const express = require('express');
const router = express.Router();
const User = require('../../models/User');
const { protect } = require('../../middleware/auth');

// ==========================================
// نظام FCM Token (Firebase Cloud Messaging)
// ==========================================

// @route   POST /api/mobile/device/register-token
// @desc    تسجيل FCM Token للإشعارات
// @access  Private
router.post('/device/register-token', protect, async (req, res) => {
    try {
        const { fcmToken, deviceToken, platform, osVersion, appVersion } = req.body;
        const token = deviceToken || fcmToken;

        if (!token) {
            return res.status(400).json({
                success: false,
                message: 'Device Token مطلوب'
            });
        }

        // تحديث بيانات المستخدم — حفظ في كلا الحقلين للتوافق
        const updateData = {
            deviceToken: token,
            fcmToken: token,
            deviceInfo: {
                platform: platform || 'ios',
                osVersion: osVersion || null,
                appVersion: appVersion || null
            }
        };

        await User.findByIdAndUpdate(req.user._id, updateData);

        console.log(`📱 تم تسجيل Token للمستخدم ${req.user.name}`);

        res.status(200).json({
            success: true,
            message: 'تم تسجيل Token بنجاح'
        });

    } catch (error) {
        console.error('خطأ في تسجيل Token:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في السيرفر',
            error: error.message
        });
    }
});

// @route   DELETE /api/mobile/device/unregister-token
// @desc    إلغاء تسجيل FCM Token (عند تسجيل الخروج)
// @access  Private
router.delete('/device/unregister-token', protect, async (req, res) => {
    try {
        await User.findByIdAndUpdate(req.user._id, {
            $unset: { fcmToken: 1, deviceToken: 1 }
        });

        console.log(`📴 تم إلغاء تسجيل Token للمستخدم ${req.user.name}`);

        res.status(200).json({
            success: true,
            message: 'تم إلغاء تسجيل Token بنجاح'
        });

    } catch (error) {
        console.error('خطأ في إلغاء تسجيل Token:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في السيرفر',
            error: error.message
        });
    }
});

// @route   PUT /api/mobile/device/update-token
// @desc    تحديث FCM Token
// @access  Private
router.put('/device/update-token', protect, async (req, res) => {
    try {
        const { fcmToken, deviceToken } = req.body;
        const token = deviceToken || fcmToken;

        if (!token) {
            return res.status(400).json({
                success: false,
                message: 'Device Token مطلوب'
            });
        }

        // حفظ في كلا الحقلين للتوافق
        const updateData = {
            deviceToken: token,
            fcmToken: token
        };

        await User.findByIdAndUpdate(req.user._id, updateData);

        res.status(200).json({
            success: true,
            message: 'تم تحديث Token بنجاح'
        });

    } catch (error) {
        console.error('خطأ في تحديث Token:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في السيرفر',
            error: error.message
        });
    }
});

// @route   PUT /api/mobile/device-token
// @desc    تحديث/تسجيل Device Token (الـ endpoint الموحّد)
// @access  Private
router.put('/device-token', protect, async (req, res) => {
    try {
        const { deviceToken, platform, osVersion, appVersion } = req.body;

        if (!deviceToken) {
            return res.status(400).json({
                success: false,
                message: 'Device Token مطلوب'
            });
        }

        await User.findByIdAndUpdate(req.user._id, {
            deviceToken: deviceToken,
            fcmToken: deviceToken,
            deviceInfo: {
                platform: platform || 'ios',
                osVersion: osVersion || null,
                appVersion: appVersion || null
            }
        });

        console.log(`📱 Device Token updated for ${req.user.name}`);

        res.status(200).json({
            success: true,
            message: 'تم تحديث Device Token بنجاح'
        });

    } catch (error) {
        console.error('خطأ في تحديث Device Token:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في السيرفر',
            error: error.message
        });
    }
});

module.exports = router;
