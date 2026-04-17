// HalaChat - Appeals Routes
// المسارات الخاصة بالاستئنافات

const express = require('express');
const router = express.Router();
const Appeal = require('../models/Appeal');
const User = require('../models/User');
const BannedDevice = require('../models/BannedDevice');
const Notification = require('../models/Notification');
const { protect, adminOnly } = require('../middleware/auth');
const notificationService = require('../services/notificationService');

// @route   POST /api/appeals
// @desc    إنشاء استئناف جديد
// @access  Private
router.post('/', protect, async (req, res) => {
    try {
        const { reason, actionType } = req.body;

        if (!reason || !reason.trim()) {
            return res.status(400).json({
                success: false,
                message: 'سبب الاستئناف مطلوب'
            });
        }

        if (reason.length > 1000) {
            return res.status(400).json({
                success: false,
                message: 'سبب الاستئناف يجب ألا يتجاوز 1000 حرف'
            });
        }

        // التحقق من عدم وجود استئناف معلق
        const existingPending = await Appeal.findOne({
            user: req.user._id,
            status: { $in: ['pending', 'forwarded', 'under_review'] }
        });

        if (existingPending) {
            return res.status(400).json({
                success: false,
                message: 'لديك استئناف قيد المراجعة بالفعل'
            });
        }

        const appeal = await Appeal.create({
            user: req.user._id,
            reason: reason.trim(),
            actionType: actionType || 'suspension',
            suspensionLevel: req.user.suspension?.level || null,
            statusHistory: [{
                status: 'pending',
                note: 'تم إنشاء الاستئناف',
                changedAt: new Date()
            }]
        });

        res.status(201).json({
            success: true,
            message: 'تم إرسال الاستئناف بنجاح',
            data: appeal
        });

    } catch (error) {
        console.error('خطأ في إنشاء الاستئناف:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في السيرفر'
        });
    }
});

// @route   GET /api/appeals/my
// @desc    جلب استئنافات المستخدم
// @access  Private
router.get('/my', protect, async (req, res) => {
    try {
        const appeals = await Appeal.find({ user: req.user._id })
            .sort({ createdAt: -1 });

        res.status(200).json({
            success: true,
            data: appeals
        });

    } catch (error) {
        console.error('خطأ في جلب الاستئنافات:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في السيرفر'
        });
    }
});

// @route   GET /api/appeals
// @desc    جلب جميع الاستئنافات (أدمن)
// @access  Private/Admin
router.get('/', protect, adminOnly, async (req, res) => {
    try {
        const {
            page = 1,
            limit = 20,
            status
        } = req.query;

        const filter = {};
        if (status) filter.status = status;

        const appeals = await Appeal.find(filter)
            .populate('user', 'name email avatar profileImage halaId createdAt isActive isPremium suspension restrictions warnings bannedWords country birthDate gender lastLogin isOnline deviceFingerprint')
            .populate('resolvedBy', 'name')
            .sort({ createdAt: -1 });

        // ✅ فلترة: إخفاء استئنافات المحظورين بشكل كامل فقط (bannedWords)
        // ملاحظة: المعلّقون يمتلكون isActive=false لكنهم يحتاجون تقديم استئناف — لا نخفيهم
        const visibleAppeals = appeals.filter(appeal => {
            if (!appeal.user) return false; // حساب محذوف فعلاً
            if (appeal.user.bannedWords?.isBanned) return false; // محظور نهائياً
            return true;
        });

        // pagination بعد الفلترة لضمان دقة العدد
        const totalFiltered = visibleAppeals.length;
        const startIdx = (page - 1) * limit;
        const pagedAppeals = visibleAppeals.slice(startIdx, startIdx + Number(limit));

        res.status(200).json({
            success: true,
            data: {
                appeals: pagedAppeals,
                totalPages: Math.ceil(totalFiltered / limit),
                currentPage: Number(page),
                total: totalFiltered
            }
        });

    } catch (error) {
        console.error('خطأ في جلب الاستئنافات:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في السيرفر'
        });
    }
});

// @route   PUT /api/appeals/:id/status
// @desc    تحديث حالة الاستئناف (أدمن)
// @access  Private/Admin
router.put('/:id/status', protect, adminOnly, async (req, res) => {
    try {
        const { status, adminNote } = req.body;

        if (!status) {
            return res.status(400).json({
                success: false,
                message: 'الحالة مطلوبة'
            });
        }

        const appeal = await Appeal.findById(req.params.id);

        if (!appeal) {
            return res.status(404).json({
                success: false,
                message: 'الاستئناف غير موجود'
            });
        }

        // تحديث الحالة
        appeal.status = status;
        if (adminNote) appeal.adminNote = adminNote;

        // إضافة للسجل
        appeal.statusHistory.push({
            status,
            note: adminNote || '',
            changedBy: req.user._id,
            changedAt: new Date()
        });

        // إذا تمت الموافقة أو الرفض
        if (status === 'approved' || status === 'rejected') {
            appeal.resolvedBy = req.user._id;
            appeal.resolvedAt = new Date();
        }

        // إذا تمت الموافقة: رفع التعليق + فك التقييد عن المستخدم
        if (status === 'approved') {
            await User.findByIdAndUpdate(appeal.user, {
                'suspension.isSuspended': false,
                'suspension.suspendedUntil': null,
                'suspension.level': 0,
                'suspension.reason': null,
                // ✅ فك جميع التقييدات
                'restrictions.messagingRestricted': false,
                'restrictions.messagingRestrictedUntil': null,
                'restrictions.messagingRestrictedLevel': null,
                'restrictions.restrictionReason': null,
                'restrictions.photoBlocked': false,
                'restrictions.photoBlockedUntil': null,
                'restrictions.photoBlockedReason': null,
                'restrictions.nameBlocked': false,
                'restrictions.nameBlockedUntil': null,
                'restrictions.nameBlockedReason': null
            });

            // إذا كان حظر: إعادة تفعيل الحساب
            if (appeal.actionType === 'ban' || appeal.actionType === 'device_ban') {
                await User.findByIdAndUpdate(appeal.user, { isActive: true });
            }

            // إذا كان حظر جهاز: إزالة حظر الجهاز
            if (appeal.actionType === 'device_ban') {
                await BannedDevice.updateMany(
                    { originalUserId: appeal.user, isActive: true },
                    { isActive: false }
                );
            }
        }

        await appeal.save();

        // إرسال إشعار للمستخدم
        try {
            const notifTitle = status === 'approved'
                ? 'تمت الموافقة على استئنافك ✅'
                : status === 'rejected'
                ? 'تم رفض استئنافك'
                : 'تحديث على استئنافك';

            const notifBody = status === 'approved'
                ? 'تم رفع التقييد عن حسابك. مرحباً بك مجدداً في هلا!'
                : status === 'rejected'
                ? 'للأسف تم رفض استئنافك. يمكنك تقديم استئناف جديد لاحقاً.'
                : 'تم تحديث حالة استئنافك. افتح التطبيق للتفاصيل.';

            await Notification.create({
                title: notifTitle,
                body: notifBody,
                type: 'system',
                recipients: 'specific',
                targetUsers: [appeal.user],
                sender: req.user._id,
                status: 'sent',
                priority: 'high',
                sentAt: new Date(),
                sentCount: 1
            });

            const targetUser = await User.findById(appeal.user);
            if (targetUser && targetUser.deviceToken) {
                await notificationService.sendPush(
                    targetUser.deviceToken,
                    notifTitle,
                    notifBody,
                    { type: 'appeal_update', appealId: appeal._id.toString(), status }
                );
            }
        } catch (notifErr) {
            console.error('خطأ في إرسال إشعار الاستئناف:', notifErr);
        }

        res.status(200).json({
            success: true,
            message: 'تم تحديث حالة الاستئناف',
            data: appeal
        });

    } catch (error) {
        console.error('خطأ في تحديث الاستئناف:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في السيرفر'
        });
    }
});

module.exports = router;
