const express = require('express');
const router = express.Router();
const Notification = require('../../models/Notification');
const User = require('../../models/User');
const { protect } = require('../../middleware/auth');
const { getFullUrl, getBestUserImage } = require('./helpers');
const { buildUserNotificationsFilter, FILTER_CATEGORIES } = require('../../config/notificationCategories');
const { groupNotifications, formatGroupedNotification } = require('../../utils/notificationHelpers');

// ==========================================
// نظام الإشعارات الموحّد
// ==========================================
//
// قواعد:
// - الرسائل (channel) لا تُحفظ هنا — تظهر في تاب المحادثات + Push فقط
// - الإدارية (admin) لا تظهر للمستخدم العادي ولا للأدمن في تطبيقه
// - Smart Grouping: 5 إعجابات في يوم → سطر واحد
// - Filter tabs: all / unread / social / system
// - Auto mark-as-read عند فتح الصفحة (markRead=true)
// ==========================================

// @route   GET /api/mobile/notifications
// @desc    الحصول على إشعارات المستخدم (مع filter + grouping + auto-read)
// @access  Private
//
// Query params:
//   page=1, limit=20
//   filter=all|unread|social|system
//   group=true (default) | false
//   markRead=true (default) | false  — تحديد كل المعروض كمقروء عند الـ fetch
router.get('/notifications', protect, async (req, res) => {
    try {
        const {
            page = 1,
            limit = 20,
            filter = 'all',
            group = 'true',
            markRead = 'true'
        } = req.query;

        const userId = req.user._id;
        const role = req.user.role || 'user';
        const enableGrouping = String(group) === 'true';
        const shouldMarkRead = String(markRead) === 'true';

        // ✅ استخدام الـ filter الموحّد
        const query = buildUserNotificationsFilter({ userId, role, filter });

        // ✅ نجلب أكثر بقليل للسماح للـ grouping بإعطاء النتيجة الصحيحة
        const fetchLimit = enableGrouping ? Math.min(parseInt(limit) * 3, 200) : parseInt(limit);

        const [rawNotifications, total, unreadCount, allCount] = await Promise.all([
            Notification.find(query)
                .populate('sender', 'name profileImage photos isPremium verification.isVerified')
                .sort({ createdAt: -1 })
                .limit(fetchLimit)
                .skip((page - 1) * fetchLimit)
                .lean(),
            Notification.countDocuments(query),
            // عدّ غير المقروءة (نفس filter لكن مع شرط readBy)
            Notification.countDocuments({
                ...query,
                'readBy.user': { $ne: userId }
            }),
            // العداد الإجمالي (للتاب all)
            Notification.countDocuments(buildUserNotificationsFilter({ userId, role, filter: 'all' }))
        ]);

        // ✅ Smart Grouping
        let processed = enableGrouping ? groupNotifications(rawNotifications) : rawNotifications;
        processed = processed.map(formatGroupedNotification).slice(0, parseInt(limit));

        // ✅ تنسيق صور المرسلين
        const formatted = processed.map(n => {
            const notif = { ...n };
            if (notif.sender) {
                notif.sender.profileImage = getFullUrl(getBestUserImage(notif.sender));
            }
            if (notif.image) {
                notif.image = getFullUrl(notif.image);
            }
            return notif;
        });

        // ✅ Auto mark-as-read — fire-and-forget (لا نُعطّل الـ response)
        if (shouldMarkRead && formatted.length > 0) {
            const idsToMark = formatted.map(n => n._id);
            Notification.updateMany(
                {
                    _id: { $in: idsToMark },
                    'readBy.user': { $ne: userId }
                },
                {
                    $addToSet: { readBy: { user: userId, readAt: new Date() } }
                }
            ).exec().catch(err => console.error('auto markRead error:', err.message));
        }

        res.status(200).json({
            success: true,
            data: {
                notifications: formatted,
                total,
                unreadCount,
                allCount,
                currentPage: parseInt(page),
                totalPages: Math.ceil(total / parseInt(limit)),
                filter,
                availableFilters: FILTER_CATEGORIES
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
// @desc    تحديد إشعار كمقروء (يدوي — auto متاح في GET)
// @access  Private
router.put('/notifications/:id/read', protect, async (req, res) => {
    try {
        const result = await Notification.updateOne(
            {
                _id: req.params.id,
                'readBy.user': { $ne: req.user._id }
            },
            { $addToSet: { readBy: { user: req.user._id, readAt: new Date() } } }
        );

        res.status(200).json({
            success: true,
            message: result.modifiedCount > 0 ? 'تم تحديد الإشعار كمقروء' : 'الإشعار مقروء مسبقاً'
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
        const query = buildUserNotificationsFilter({
            userId: req.user._id,
            role: req.user.role,
            filter: 'unread'
        });

        const result = await Notification.updateMany(
            query,
            { $addToSet: { readBy: { user: req.user._id, readAt: new Date() } } }
        );

        res.status(200).json({
            success: true,
            message: `تم تحديد ${result.modifiedCount} إشعار كمقروء`
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
// @desc    حذف إشعار (المستخدم يحذف من قائمته فقط — soft remove)
// @access  Private
router.delete('/notifications/:id', protect, async (req, res) => {
    try {
        // soft remove: نزيل المستخدم من targetUsers
        // لو ما فيه أحد بعدها → نحذف فعلياً
        const notification = await Notification.findById(req.params.id);
        if (!notification) {
            return res.status(404).json({ success: false, message: 'الإشعار غير موجود' });
        }

        // إذا الـ notification موجه لـ "all" → ما نقدر نحذفه (مرسل لجميع المستخدمين)
        // الحل: إضافة المستخدم لـ "deletedBy" array أو مجرد استبعاده
        if (notification.recipients === 'all') {
            // soft hide via readBy + delete from targetUsers
            await Notification.updateOne(
                { _id: req.params.id },
                {
                    $addToSet: {
                        readBy: { user: req.user._id, readAt: new Date() },
                        // نحفظ في metadata أن المستخدم خفّاه
                        deletedBy: req.user._id
                    }
                }
            );
        } else {
            // مرسل لمستخدمين محددين → نزيل المستخدم من القائمة
            await Notification.updateOne(
                { _id: req.params.id },
                { $pull: { targetUsers: req.user._id } }
            );

            // إذا ما بقي أحد → احذف فعلياً
            const remaining = await Notification.findById(req.params.id).lean();
            if (remaining && (!remaining.targetUsers || remaining.targetUsers.length === 0)) {
                await Notification.deleteOne({ _id: req.params.id });
            }
        }

        res.json({ success: true, message: 'تم حذف الإشعار' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'خطأ في حذف الإشعار', error: error.message });
    }
});

// @route   GET /api/mobile/notifications/unread-count
// @desc    عدد الإشعارات غير المقروءة فقط (خفيف — بدون جلب القائمة)
// @access  Private
router.get('/notifications/unread-count', protect, async (req, res) => {
    try {
        const userId = req.user._id;

        const filter = buildUserNotificationsFilter({
            userId: userId.toString(),
            role: req.user.role || 'user',
            filter: 'unread'
        });

        const unreadCount = await Notification.countDocuments(filter);

        res.json({
            success: true,
            data: { unreadCount }
        });
    } catch (error) {
        console.error('خطأ في جلب عدد الإشعارات غير المقروءة:', error);
        res.status(500).json({ success: false, message: 'خطأ في الخادم' });
    }
});

// @route   DELETE /api/mobile/notifications
// @desc    حذف جميع إشعارات المستخدم
// @access  Private
router.delete('/notifications', protect, async (req, res) => {
    try {
        // soft hide — نُزيل المستخدم من targetUsers (للإشعارات الموجهة)
        // ونحذف فقط الإشعارات التي يكون فيه target واحد فقط (هو)
        const userId = req.user._id;

        // الإشعارات الموجهة لمستخدمين محددين فقط — نزيل المستخدم
        await Notification.updateMany(
            { targetUsers: userId },
            { $pull: { targetUsers: userId } }
        );

        // ثم نحذف فعلياً اللي ما بقي فيها أحد
        await Notification.deleteMany({
            targetUsers: { $size: 0 },
            recipients: { $ne: 'all' }
        });

        res.json({ success: true, message: 'تم حذف جميع الإشعارات' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'خطأ في حذف الإشعارات', error: error.message });
    }
});

// ==========================================
// تفضيلات الإشعارات (Push Preferences)
// ==========================================

// المفاتيح المسموح بها فقط — حماية من حقن مفاتيح عشوائية
const PREF_KEYS = ['pushEnabled', 'invitations', 'messages', 'profileVisits', 'appAlerts'];

const PREF_DEFAULTS = {
    pushEnabled: true,
    invitations: true,
    messages: true,
    profileVisits: true,
    appAlerts: true
};

// @route   GET /api/mobile/notifications/preferences
// @desc    جلب تفضيلات إشعارات المستخدم
// @access  Private
router.get('/notifications/preferences', protect, async (req, res) => {
    try {
        const user = await User.findById(req.user._id)
            .select('notificationPreferences').lean();

        if (!user) {
            return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
        }

        const prefs = user.notificationPreferences || {};
        const data = {};
        for (const key of PREF_KEYS) {
            data[key] = prefs[key] ?? PREF_DEFAULTS[key];
        }

        res.json({ success: true, data });
    } catch (error) {
        console.error('خطأ في جلب تفضيلات الإشعارات:', error);
        res.status(500).json({ success: false, message: 'خطأ في الخادم' });
    }
});

// @route   PATCH /api/mobile/notifications/preferences
// @desc    تحديث تفضيل أو أكثر من تفضيلات الإشعارات
// @access  Private
router.patch('/notifications/preferences', protect, async (req, res) => {
    try {
        const updates = {};
        for (const key of PREF_KEYS) {
            if (typeof req.body[key] === 'boolean') {
                updates[`notificationPreferences.${key}`] = req.body[key];
            }
        }

        if (Object.keys(updates).length === 0) {
            return res.status(400).json({ success: false, message: 'لا توجد قيم صالحة للتحديث' });
        }

        await User.findByIdAndUpdate(req.user._id, { $set: updates });

        const user = await User.findById(req.user._id)
            .select('notificationPreferences').lean();
        const prefs = user.notificationPreferences || {};
        const data = {};
        for (const key of PREF_KEYS) {
            data[key] = prefs[key] ?? PREF_DEFAULTS[key];
        }

        res.json({ success: true, message: 'تم تحديث إعدادات الإشعارات', data });
    } catch (error) {
        console.error('خطأ في تحديث تفضيلات الإشعارات:', error);
        res.status(500).json({ success: false, message: 'فشل في تحديث الإعدادات' });
    }
});

module.exports = router;
