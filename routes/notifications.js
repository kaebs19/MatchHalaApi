// Notifications Routes - مسارات الإشعارات
const express = require('express');
const router = express.Router();
const Notification = require('../models/Notification');
const User = require('../models/User');
const { protect, adminOnly } = require('../middleware/auth');
const { sendToMultipleDevices } = require('../config/firebase');

// ✅ إرسال Push عبر FCM لقائمة مستخدمين — يظهر خارج التطبيق (أندرويد + iOS)
// نفس مسار إشعارات المحادثات العاملة (notification payload + android high priority).
// يُرجع نفس الشكل المتوقّع من بقية المعالج: { total, sent, failed }
async function sendFcmToUsers(users, { title, body, type, data = {}, badge = 1 }) {
    // توكن واحد لكل مستخدم (deviceToken ثم fcmToken كـ fallback) مع إزالة التكرار
    const tokens = [...new Set(
        users.map(u => u.deviceToken || u.fcmToken).filter(Boolean)
    )];

    const result = { total: users.length, sent: 0, failed: 0 };
    if (tokens.length === 0) return result;

    const payload = { title, body };
    const dataPayload = { ...data, type: type || 'general', badge };

    // إرسال على دفعات (حد FCM للـ multicast = 500)
    const batchSize = 500;
    for (let i = 0; i < tokens.length; i += batchSize) {
        const batch = tokens.slice(i, i + batchSize);
        const r = await sendToMultipleDevices(batch, payload, dataPayload);
        if (r.success) {
            result.sent += r.successCount || 0;
            result.failed += r.failureCount || 0;
        } else {
            result.failed += batch.length;
        }
    }
    return result;
}

// @route   GET /api/notifications
// @desc    الحصول على جميع الإشعارات
// @access  Admin
router.get('/', protect, adminOnly, async (req, res) => {
    try {
        const { page = 1, limit = 20, status, type } = req.query;

        const query = {};
        if (status) query.status = status;
        if (type) query.type = type;

        const notifications = await Notification.find(query)
            .populate('sender', 'name email')
            .populate('targetUsers', 'name email')
            .sort({ createdAt: -1 })
            .limit(limit * 1)
            .skip((page - 1) * limit);

        const count = await Notification.countDocuments(query);

        res.json({
            success: true,
            data: {
                notifications,
                totalPages: Math.ceil(count / limit),
                currentPage: page,
                total: count
            }
        });
    } catch (error) {
        console.error('خطأ في جلب الإشعارات:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في جلب الإشعارات',
            error: error.message
        });
    }
});

// @route   GET /api/notifications/stats
// @desc    إحصائيات الإشعارات
// @access  Admin
router.get('/stats', protect, adminOnly, async (req, res) => {
    try {
        const total = await Notification.countDocuments();
        const sent = await Notification.countDocuments({ status: 'sent' });
        const pending = await Notification.countDocuments({ status: 'pending' });
        const failed = await Notification.countDocuments({ status: 'failed' });

        // إحصائيات حسب النوع
        const byType = await Notification.aggregate([
            {
                $group: {
                    _id: '$type',
                    count: { $sum: 1 }
                }
            }
        ]);

        res.json({
            success: true,
            data: {
                total,
                sent,
                pending,
                failed,
                byType
            }
        });
    } catch (error) {
        console.error('خطأ في جلب إحصائيات الإشعارات:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في جلب الإحصائيات',
            error: error.message
        });
    }
});

// @route   POST /api/notifications/send
// @desc    إرسال إشعار جديد
// @access  Admin
router.post('/send', protect, adminOnly, async (req, res) => {
    try {
        const {
            title,
            body,
            type = 'general',
            recipients = 'all',
            targetUserIds = [],
            priority = 'normal',
            data = {},
            sound = 'default',
            badge = 1
        } = req.body;

        // Validation
        if (!title || !body) {
            return res.status(400).json({
                success: false,
                message: 'العنوان والمحتوى مطلوبان'
            });
        }

        // إنشاء الإشعار في قاعدة البيانات
        const notification = await Notification.create({
            title,
            body,
            type,
            recipients,
            targetUsers: recipients === 'specific' ? targetUserIds : [],
            priority,
            data,
            sound,
            badge,
            sender: req.user._id,
            status: 'pending'
        });

        // إرسال الإشعار
        let sendResults;

        if (recipients === 'all') {
            // إرسال لجميع المستخدمين النشطين الذين لديهم توكن (deviceToken أو fcmToken)
            const users = await User.find({
                isActive: true,
                $or: [
                    { deviceToken: { $exists: true, $nin: [null, ''] } },
                    { fcmToken: { $exists: true, $nin: [null, ''] } }
                ]
            }).select('_id deviceToken fcmToken');

            sendResults = await sendFcmToUsers(users, { title, body, type, data, badge });
        } else {
            // إرسال لمستخدمين محددين
            const users = await User.find({
                _id: { $in: targetUserIds },
                isActive: true
            }).select('_id deviceToken fcmToken');

            sendResults = await sendFcmToUsers(users, { title, body, type, data, badge });
        }

        // تحديث حالة الإشعار
        notification.status = sendResults.sent > 0 ? 'sent' : 'failed';
        notification.sentCount = sendResults.sent;
        notification.failedCount = sendResults.failed;
        notification.sentAt = new Date();
        await notification.save();

        // إرسال عبر Socket.IO أيضاً
        if (global.io) {
            if (recipients === 'all') {
                global.io.emit('notification', {
                    id: notification._id,
                    title,
                    body,
                    type,
                    data
                });
            } else {
                targetUserIds.forEach(userId => {
                    global.io.to(`user-${userId}`).emit('notification', {
                        id: notification._id,
                        title,
                        body,
                        type,
                        data
                    });
                });
            }
        }

        res.json({
            success: true,
            message: `تم إرسال ${sendResults.sent} إشعار بنجاح`,
            data: {
                notification,
                sendResults
            }
        });
    } catch (error) {
        console.error('خطأ في إرسال الإشعار:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في إرسال الإشعار',
            error: error.message
        });
    }
});

// @route   GET /api/notifications/:id
// @desc    الحصول على إشعار واحد
// @access  Admin
router.get('/:id', protect, adminOnly, async (req, res) => {
    try {
        const notification = await Notification.findById(req.params.id)
            .populate('sender', 'name email')
            .populate('targetUsers', 'name email')
            .populate('readBy.user', 'name email');

        if (!notification) {
            return res.status(404).json({
                success: false,
                message: 'الإشعار غير موجود'
            });
        }

        res.json({
            success: true,
            data: notification
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'خطأ في جلب الإشعار',
            error: error.message
        });
    }
});

// @route   DELETE /api/notifications/:id
// @desc    حذف إشعار
// @access  Admin
router.delete('/:id', protect, adminOnly, async (req, res) => {
    try {
        const notification = await Notification.findByIdAndDelete(req.params.id);

        if (!notification) {
            return res.status(404).json({
                success: false,
                message: 'الإشعار غير موجود'
            });
        }

        res.json({
            success: true,
            message: 'تم حذف الإشعار بنجاح'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'خطأ في حذف الإشعار',
            error: error.message
        });
    }
});

// @route   POST /api/notifications/:id/resend
// @desc    إعادة إرسال إشعار
// @access  Admin
router.post('/:id/resend', protect, adminOnly, async (req, res) => {
    try {
        const notification = await Notification.findById(req.params.id);

        if (!notification) {
            return res.status(404).json({
                success: false,
                message: 'الإشعار غير موجود'
            });
        }

        // إرسال الإشعار مرة أخرى
        let sendResults;

        if (notification.recipients === 'all') {
            const users = await User.find({
                isActive: true,
                $or: [
                    { deviceToken: { $exists: true, $nin: [null, ''] } },
                    { fcmToken: { $exists: true, $nin: [null, ''] } }
                ]
            }).select('_id deviceToken fcmToken');

            sendResults = await sendFcmToUsers(users, {
                title: notification.title,
                body: notification.body,
                type: notification.type,
                data: notification.data,
                badge: notification.badge
            });
        } else {
            const users = await User.find({
                _id: { $in: notification.targetUsers },
                isActive: true
            }).select('_id deviceToken fcmToken');

            sendResults = await sendFcmToUsers(users, {
                title: notification.title,
                body: notification.body,
                type: notification.type,
                data: notification.data,
                badge: notification.badge
            });
        }

        // تحديث الإحصائيات
        notification.sentCount += sendResults.sent;
        notification.failedCount += sendResults.failed;
        notification.status = sendResults.sent > 0 ? 'sent' : 'failed';
        notification.sentAt = new Date();
        await notification.save();

        res.json({
            success: true,
            message: 'تم إعادة إرسال الإشعار بنجاح',
            data: {
                notification,
                sendResults
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'خطأ في إعادة إرسال الإشعار',
            error: error.message
        });
    }
});

module.exports = router;
