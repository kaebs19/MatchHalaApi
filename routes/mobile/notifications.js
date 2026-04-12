const express = require('express');
const router = express.Router();
const Notification = require('../../models/Notification');
const { protect } = require('../../middleware/auth');
const { getFullUrl, getBestUserImage } = require('./helpers');

// ==========================================
// نظام الإشعارات
// ==========================================

// @route   GET /api/mobile/notifications
// @desc    الحصول على إشعارات المستخدم
// @access  Private
router.get('/notifications', protect, async (req, res) => {
    try {
        const { page = 1, limit = 20 } = req.query;

        // جلب الإشعارات الموجهة للمستخدم أو للجميع
        const query = {
            $or: [
                { targetUsers: req.user._id },
                { recipients: 'all' }
            ],
            isActive: true
        };

        const notifications = await Notification.find(query)
            .populate('sender', 'name profileImage photos isPremium verification.isVerified')
            .sort({ createdAt: -1 })
            .limit(limit * 1)
            .skip((page - 1) * limit)
            .lean();

        const total = await Notification.countDocuments(query);

        // حساب الإشعارات غير المقروءة
        const unreadCount = await Notification.countDocuments({
            ...query,
            'readBy._id': { $ne: req.user._id }
        });

        // تحويل صور المرسلين إلى روابط كاملة (أفضل صورة متاحة)
        const formattedNotifications = notifications.map(n => {
            const notif = { ...n };
            if (notif.sender) {
                notif.sender.profileImage = getFullUrl(getBestUserImage(notif.sender));
            }
            if (notif.image) {
                notif.image = getFullUrl(notif.image);
            }
            return notif;
        });

        res.status(200).json({
            success: true,
            data: {
                notifications: formattedNotifications,
                total,
                unreadCount,
                currentPage: parseInt(page),
                totalPages: Math.ceil(total / limit)
            }
        });

    } catch (error) {
        console.error('خطأ في جلب الإشعارات:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في السيرفر',
            error: error.message
        });
    }
});

// @route   PUT /api/mobile/notifications/:id/read
// @desc    تحديد إشعار كمقروء
// @access  Private
router.put('/notifications/:id/read', protect, async (req, res) => {
    try {
        const notification = await Notification.findById(req.params.id);

        if (!notification) {
            return res.status(404).json({
                success: false,
                message: 'الإشعار غير موجود'
            });
        }

        // إضافة المستخدم لقائمة القراء (بنفس format الموجود في DB)
        const alreadyRead = notification.readBy.some(r =>
            (r._id && r._id.toString() === req.user._id.toString()) ||
            (r.toString() === req.user._id.toString())
        );
        if (!alreadyRead) {
            notification.readBy.push({ _id: req.user._id, readAt: new Date() });
            await notification.save();
        }

        res.status(200).json({
            success: true,
            message: 'تم تحديد الإشعار كمقروء'
        });

    } catch (error) {
        console.error('خطأ في تحديث الإشعار:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في السيرفر',
            error: error.message
        });
    }
});

// @route   PUT /api/mobile/notifications/read-all
// @desc    تحديد جميع الإشعارات كمقروءة
// @access  Private
router.put('/notifications/read-all', protect, async (req, res) => {
    try {
        await Notification.updateMany(
            {
                $or: [
                    { targetUsers: req.user._id },
                    { recipients: 'all' }
                ],
                'readBy._id': { $ne: req.user._id }
            },
            {
                $addToSet: { readBy: { _id: req.user._id, readAt: new Date() } }
            }
        );

        res.status(200).json({
            success: true,
            message: 'تم تحديد جميع الإشعارات كمقروءة'
        });

    } catch (error) {
        console.error('خطأ في تحديث الإشعارات:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في السيرفر',
            error: error.message
        });
    }
});

// @route   DELETE /api/mobile/notifications/:id
// @desc    حذف إشعار للمستخدم
// @access  Private
router.delete('/notifications/:id', protect, async (req, res) => {
    try {
        const notification = await Notification.findById(req.params.id).lean();
        if (!notification) {
            return res.status(404).json({ success: false, message: 'الإشعار غير موجود' });
        }

        // حذف الإشعار (المستخدم يحذف إشعاراته فقط)
        await Notification.findByIdAndDelete(req.params.id);

        res.json({ success: true, message: 'تم حذف الإشعار' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'خطأ في حذف الإشعار', error: error.message });
    }
});

// @route   DELETE /api/mobile/notifications
// @desc    حذف جميع إشعارات المستخدم
// @access  Private
router.delete('/notifications', protect, async (req, res) => {
    try {
        await Notification.deleteMany({
            $or: [
                { targetUsers: req.user._id },
                { sender: req.user._id }
            ]
        });

        res.json({ success: true, message: 'تم حذف جميع الإشعارات' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'خطأ في حذف الإشعارات', error: error.message });
    }
});

module.exports = router;
