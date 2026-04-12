// HalaChat - Verification Admin Routes
// مسارات إدارة طلبات التوثيق (للأدمن)

const express = require('express');
const router = express.Router();
const User = require('../models/User');
const { protect, adminOnly } = require('../middleware/auth');
const pushNotificationService = require('../services/pushNotificationService');

// @route   GET /api/verifications
// @desc    قائمة طلبات التوثيق
// @access  Admin
router.get('/', protect, adminOnly, async (req, res) => {
    try {
        const { status = 'pending', page = 1, limit = 20 } = req.query;
        const pageNum = parseInt(page);
        const limitNum = parseInt(limit);

        const filter = {};
        if (status !== 'all') {
            filter['verification.status'] = status;
        } else {
            filter['verification.status'] = { $ne: 'none' };
        }

        const users = await User.find(filter)
            .select('name email profileImage verification isPremium premiumPlan createdAt')
            .sort({ 'verification.submittedAt': -1 })
            .limit(limitNum)
            .skip((pageNum - 1) * limitNum);

        const total = await User.countDocuments(filter);

        // إحصائيات
        const stats = {
            pending: await User.countDocuments({ 'verification.status': 'pending' }),
            approved: await User.countDocuments({ 'verification.status': 'approved' }),
            rejected: await User.countDocuments({ 'verification.status': 'rejected' }),
            total: await User.countDocuments({ 'verification.status': { $ne: 'none' } })
        };

        res.json({
            success: true,
            data: {
                users,
                stats,
                page: pageNum,
                totalPages: Math.ceil(total / limitNum),
                total
            }
        });
    } catch (error) {
        console.error('خطأ في جلب طلبات التوثيق:', error);
        res.status(500).json({ success: false, message: 'فشل في جلب طلبات التوثيق' });
    }
});

// @route   PUT /api/verifications/:userId
// @desc    قبول أو رفض طلب التوثيق
// @access  Admin
router.put('/:userId', protect, adminOnly, async (req, res) => {
    try {
        const { action } = req.body; // 'approved' أو 'rejected'

        if (!['approved', 'rejected'].includes(action)) {
            return res.status(400).json({
                success: false,
                message: 'الإجراء يجب أن يكون approved أو rejected'
            });
        }

        const user = await User.findById(req.params.userId);
        if (!user) {
            return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
        }

        if (user.verification?.status !== 'pending') {
            return res.status(400).json({
                success: false,
                message: 'لا يوجد طلب توثيق قيد الانتظار لهذا المستخدم'
            });
        }

        // تحديث حالة التوثيق
        user.verification.status = action;
        user.verification.isVerified = action === 'approved';
        user.verification.reviewedAt = new Date();
        await user.save();

        // إرسال إشعار للمستخدم
        try {
            const notifTitle = action === 'approved' ? '✅ تم توثيق حسابك!' : '❌ طلب التوثيق مرفوض';
            const notifBody = action === 'approved'
                ? 'تهانينا! تم توثيق حسابك بنجاح'
                : 'عذراً، تم رفض طلب التوثيق. يمكنك المحاولة مرة أخرى';

            await pushNotificationService.sendNotificationToUser(user._id, {
                title: notifTitle,
                body: notifBody,
                type: 'verification'
            }, { type: 'verification', status: action });
        } catch (notifError) {
            console.error('خطأ في إرسال إشعار التوثيق:', notifError);
        }

        res.json({
            success: true,
            message: action === 'approved' ? 'تم قبول طلب التوثيق' : 'تم رفض طلب التوثيق',
            data: {
                userId: user._id,
                verification: user.verification
            }
        });
    } catch (error) {
        console.error('خطأ في مراجعة طلب التوثيق:', error);
        res.status(500).json({ success: false, message: 'فشل في مراجعة طلب التوثيق' });
    }
});

module.exports = router;
