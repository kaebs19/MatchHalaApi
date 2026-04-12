const express = require('express');
const router = express.Router();
const User = require('../../models/User');
const Conversation = require('../../models/Conversation');
const { protect } = require('../../middleware/auth');
const { getFullUrl } = require('./helpers');

// ==========================================
// نظام حظر المستخدمين
// ==========================================

// @route   POST /api/mobile/users/block/:userId
// @desc    حظر مستخدم
// @access  Private
router.post('/users/block/:userId', protect, async (req, res) => {
    try {
        const { userId } = req.params;

        // تحقق إن المستخدم موجود
        const target = await User.findById(userId).lean();
        if (!target) {
            return res.status(404).json({
                success: false,
                message: 'المستخدم غير موجود'
            });
        }

        // لا تحظر نفسك
        if (userId === req.user._id.toString()) {
            return res.status(400).json({
                success: false,
                message: 'لا يمكن حظر نفسك'
            });
        }

        // أضف للقائمة السوداء (بدون تكرار)
        await User.findByIdAndUpdate(req.user._id, {
            $addToSet: { blockedUsers: userId }
        });

        // حذف أي محادثة بينهم
        await Conversation.deleteMany({
            type: 'private',
            participants: { $all: [req.user._id, userId] }
        });

        res.json({
            success: true,
            message: 'تم حظر المستخدم'
        });

    } catch (error) {
        console.error('خطأ في حظر المستخدم:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في السيرفر',
            error: error.message
        });
    }
});

// @route   POST /api/mobile/users/unblock/:userId
// @desc    إلغاء حظر مستخدم
// @access  Private
router.post('/users/unblock/:userId', protect, async (req, res) => {
    try {
        const { userId } = req.params;

        // تحقق إن المستخدم موجود
        const target = await User.findById(userId).lean();
        if (!target) {
            return res.status(404).json({
                success: false,
                message: 'المستخدم غير موجود'
            });
        }

        // إزالة من القائمة السوداء
        await User.findByIdAndUpdate(req.user._id, {
            $pull: { blockedUsers: userId }
        });

        res.json({
            success: true,
            message: 'تم إلغاء حظر المستخدم'
        });

    } catch (error) {
        console.error('خطأ في إلغاء حظر المستخدم:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في السيرفر',
            error: error.message
        });
    }
});

// @route   GET /api/mobile/users/blocked
// @desc    الحصول على قائمة المحظورين
// @access  Private
router.get('/users/blocked', protect, async (req, res) => {
    try {
        const user = await User.findById(req.user._id)
            .populate('blockedUsers', 'name email profileImage isPremium isActive verification.isVerified').lean();

        res.json({
            success: true,
            data: {
                blockedUsers: user.blockedUsers || []
            }
        });

    } catch (error) {
        console.error('خطأ في جلب المحظورين:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في السيرفر',
            error: error.message
        });
    }
});

module.exports = router;
