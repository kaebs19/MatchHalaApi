const express = require('express');
const router = express.Router();
const User = require('../models/User');
const { protect: auth } = require('../middleware/auth');
const { body, param, validationResult } = require('express-validator');

// ==================== إعدادات الخصوصية العامة ====================

/**
 * @route   GET /api/privacy/settings
 * @desc    الحصول على إعدادات الخصوصية الحالية
 * @access  Private
 */
router.get('/settings', auth, async (req, res) => {
    try {
        const user = await User.findById(req.user.id)
            .select('privacySettings blockedUsers mutedConversations');

        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'المستخدم غير موجود'
            });
        }

        res.json({
            success: true,
            data: {
                privacySettings: user.privacySettings,
                blockedUsersCount: user.blockedUsers?.length || 0,
                mutedConversationsCount: user.mutedConversations?.length || 0
            }
        });
    } catch (error) {
        console.error('خطأ في جلب إعدادات الخصوصية:', error);
        res.status(500).json({
            success: false,
            message: 'حدث خطأ في الخادم'
        });
    }
});

/**
 * @route   PUT /api/privacy/settings
 * @desc    تحديث إعدادات الخصوصية
 * @access  Private
 */
router.put('/settings', [
    auth,
    body('profileVisibility')
        .optional()
        .isIn(['public', 'contacts', 'private'])
        .withMessage('قيمة غير صالحة لإظهار الملف الشخصي'),
    body('showLastSeen')
        .optional()
        .isBoolean()
        .withMessage('يجب أن تكون قيمة منطقية'),
    body('notificationSound')
        .optional()
        .isBoolean()
        .withMessage('يجب أن تكون قيمة منطقية')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                errors: errors.array()
            });
        }

        const { profileVisibility, showLastSeen, notificationSound } = req.body;

        const updateFields = {};
        if (profileVisibility !== undefined) {
            updateFields['privacySettings.profileVisibility'] = profileVisibility;
        }
        if (showLastSeen !== undefined) {
            updateFields['privacySettings.showLastSeen'] = showLastSeen;
        }
        if (notificationSound !== undefined) {
            updateFields['privacySettings.notificationSound'] = notificationSound;
        }

        const user = await User.findByIdAndUpdate(
            req.user.id,
            { $set: updateFields },
            { new: true }
        ).select('privacySettings');

        res.json({
            success: true,
            message: 'تم تحديث إعدادات الخصوصية بنجاح',
            data: user.privacySettings
        });
    } catch (error) {
        console.error('خطأ في تحديث إعدادات الخصوصية:', error);
        res.status(500).json({
            success: false,
            message: 'حدث خطأ في الخادم'
        });
    }
});

// ==================== إخفاء الملف الشخصي ====================

/**
 * @route   PUT /api/privacy/profile-visibility
 * @desc    تغيير إعداد إظهار الملف الشخصي
 * @access  Private
 */
router.put('/profile-visibility', [
    auth,
    body('visibility')
        .isIn(['public', 'contacts', 'private'])
        .withMessage('القيمة يجب أن تكون: public, contacts, أو private')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                errors: errors.array()
            });
        }

        const { visibility } = req.body;

        await User.findByIdAndUpdate(req.user.id, {
            'privacySettings.profileVisibility': visibility
        });

        const visibilityMessages = {
            'public': 'ملفك الشخصي مرئي للجميع',
            'contacts': 'ملفك الشخصي مرئي لجهات الاتصال فقط',
            'private': 'ملفك الشخصي مخفي'
        };

        res.json({
            success: true,
            message: visibilityMessages[visibility],
            data: { profileVisibility: visibility }
        });
    } catch (error) {
        console.error('خطأ في تغيير إظهار الملف الشخصي:', error);
        res.status(500).json({
            success: false,
            message: 'حدث خطأ في الخادم'
        });
    }
});

// ==================== إخفاء آخر ظهور ====================

/**
 * @route   PUT /api/privacy/last-seen
 * @desc    تفعيل/إلغاء إظهار آخر ظهور
 * @access  Private
 */
router.put('/last-seen', [
    auth,
    body('show')
        .isBoolean()
        .withMessage('يجب أن تكون قيمة منطقية (true/false)')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                errors: errors.array()
            });
        }

        const { show } = req.body;

        await User.findByIdAndUpdate(req.user.id, {
            'privacySettings.showLastSeen': show
        });

        res.json({
            success: true,
            message: show ? 'تم تفعيل إظهار آخر ظهور' : 'تم إخفاء آخر ظهور',
            data: { showLastSeen: show }
        });
    } catch (error) {
        console.error('خطأ في تغيير إعداد آخر ظهور:', error);
        res.status(500).json({
            success: false,
            message: 'حدث خطأ في الخادم'
        });
    }
});

// ==================== حظر المستخدمين ====================

/**
 * @route   GET /api/privacy/blocked
 * @desc    الحصول على قائمة المستخدمين المحظورين
 * @access  Private
 */
router.get('/blocked', auth, async (req, res) => {
    try {
        const user = await User.findById(req.user.id)
            .populate('blockedUsers', 'name phone avatar isOnline');

        res.json({
            success: true,
            data: {
                blockedUsers: user.blockedUsers || [],
                count: user.blockedUsers?.length || 0
            }
        });
    } catch (error) {
        console.error('خطأ في جلب قائمة المحظورين:', error);
        res.status(500).json({
            success: false,
            message: 'حدث خطأ في الخادم'
        });
    }
});

/**
 * @route   POST /api/privacy/block/:userId
 * @desc    حظر مستخدم
 * @access  Private
 */
router.post('/block/:userId', [
    auth,
    param('userId').isMongoId().withMessage('معرف المستخدم غير صالح')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                errors: errors.array()
            });
        }

        const { userId } = req.params;

        // التحقق من عدم حظر النفس
        if (userId === req.user.id) {
            return res.status(400).json({
                success: false,
                message: 'لا يمكنك حظر نفسك'
            });
        }

        // التحقق من وجود المستخدم المراد حظره
        const userToBlock = await User.findById(userId);
        if (!userToBlock) {
            return res.status(404).json({
                success: false,
                message: 'المستخدم غير موجود'
            });
        }

        // التحقق من عدم الحظر مسبقاً
        const currentUser = await User.findById(req.user.id);
        if (currentUser.blockedUsers?.includes(userId)) {
            return res.status(400).json({
                success: false,
                message: 'هذا المستخدم محظور بالفعل'
            });
        }

        // إضافة للقائمة المحظورة
        await User.findByIdAndUpdate(req.user.id, {
            $addToSet: { blockedUsers: userId }
        });

        res.json({
            success: true,
            message: `تم حظر ${userToBlock.name} بنجاح`,
            data: { blockedUserId: userId }
        });
    } catch (error) {
        console.error('خطأ في حظر المستخدم:', error);
        res.status(500).json({
            success: false,
            message: 'حدث خطأ في الخادم'
        });
    }
});

/**
 * @route   DELETE /api/privacy/unblock/:userId
 * @desc    إلغاء حظر مستخدم
 * @access  Private
 */
router.delete('/unblock/:userId', [
    auth,
    param('userId').isMongoId().withMessage('معرف المستخدم غير صالح')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                errors: errors.array()
            });
        }

        const { userId } = req.params;

        const user = await User.findById(req.user.id);
        if (!user.blockedUsers?.includes(userId)) {
            return res.status(400).json({
                success: false,
                message: 'هذا المستخدم غير محظور'
            });
        }

        await User.findByIdAndUpdate(req.user.id, {
            $pull: { blockedUsers: userId }
        });

        res.json({
            success: true,
            message: 'تم إلغاء الحظر بنجاح',
            data: { unblockedUserId: userId }
        });
    } catch (error) {
        console.error('خطأ في إلغاء حظر المستخدم:', error);
        res.status(500).json({
            success: false,
            message: 'حدث خطأ في الخادم'
        });
    }
});

/**
 * @route   GET /api/privacy/is-blocked/:userId
 * @desc    التحقق إذا كان مستخدم محظور
 * @access  Private
 */
router.get('/is-blocked/:userId', [
    auth,
    param('userId').isMongoId().withMessage('معرف المستخدم غير صالح')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                errors: errors.array()
            });
        }

        const user = await User.findById(req.user.id);
        const isBlocked = user.blockedUsers?.includes(req.params.userId) || false;

        res.json({
            success: true,
            data: { isBlocked }
        });
    } catch (error) {
        console.error('خطأ في التحقق من الحظر:', error);
        res.status(500).json({
            success: false,
            message: 'حدث خطأ في الخادم'
        });
    }
});

// ==================== كتم الإشعارات ====================

/**
 * @route   GET /api/privacy/muted
 * @desc    الحصول على قائمة المحادثات المكتومة
 * @access  Private
 */
router.get('/muted', auth, async (req, res) => {
    try {
        const user = await User.findById(req.user.id)
            .populate('mutedConversations.conversationId');

        // تصفية المحادثات المنتهية كتمها
        const now = new Date();
        const activeMuted = (user.mutedConversations || []).filter(m => {
            return !m.mutedUntil || m.mutedUntil > now;
        });

        res.json({
            success: true,
            data: {
                mutedConversations: activeMuted,
                count: activeMuted.length
            }
        });
    } catch (error) {
        console.error('خطأ في جلب المحادثات المكتومة:', error);
        res.status(500).json({
            success: false,
            message: 'حدث خطأ في الخادم'
        });
    }
});

/**
 * @route   POST /api/privacy/mute/:conversationId
 * @desc    كتم محادثة
 * @access  Private
 */
router.post('/mute/:conversationId', [
    auth,
    param('conversationId').isMongoId().withMessage('معرف المحادثة غير صالح'),
    body('duration')
        .optional()
        .isIn(['1h', '8h', '1d', '7d', 'forever'])
        .withMessage('مدة غير صالحة')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                errors: errors.array()
            });
        }

        const { conversationId } = req.params;
        const { duration = 'forever' } = req.body;

        // حساب تاريخ انتهاء الكتم
        let mutedUntil = null;
        const now = new Date();

        switch (duration) {
            case '1h':
                mutedUntil = new Date(now.getTime() + 60 * 60 * 1000);
                break;
            case '8h':
                mutedUntil = new Date(now.getTime() + 8 * 60 * 60 * 1000);
                break;
            case '1d':
                mutedUntil = new Date(now.getTime() + 24 * 60 * 60 * 1000);
                break;
            case '7d':
                mutedUntil = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
                break;
            case 'forever':
            default:
                mutedUntil = null;
        }

        // إزالة الكتم السابق إن وجد
        await User.findByIdAndUpdate(req.user.id, {
            $pull: { mutedConversations: { conversationId } }
        });

        // إضافة الكتم الجديد
        await User.findByIdAndUpdate(req.user.id, {
            $push: {
                mutedConversations: {
                    conversationId,
                    mutedUntil
                }
            }
        });

        const durationMessages = {
            '1h': 'ساعة واحدة',
            '8h': '8 ساعات',
            '1d': 'يوم واحد',
            '7d': 'أسبوع',
            'forever': 'دائماً'
        };

        res.json({
            success: true,
            message: `تم كتم المحادثة لمدة ${durationMessages[duration]}`,
            data: {
                conversationId,
                mutedUntil,
                duration
            }
        });
    } catch (error) {
        console.error('خطأ في كتم المحادثة:', error);
        res.status(500).json({
            success: false,
            message: 'حدث خطأ في الخادم'
        });
    }
});

/**
 * @route   DELETE /api/privacy/unmute/:conversationId
 * @desc    إلغاء كتم محادثة
 * @access  Private
 */
router.delete('/unmute/:conversationId', [
    auth,
    param('conversationId').isMongoId().withMessage('معرف المحادثة غير صالح')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                errors: errors.array()
            });
        }

        const { conversationId } = req.params;

        await User.findByIdAndUpdate(req.user.id, {
            $pull: { mutedConversations: { conversationId } }
        });

        res.json({
            success: true,
            message: 'تم إلغاء كتم المحادثة',
            data: { conversationId }
        });
    } catch (error) {
        console.error('خطأ في إلغاء كتم المحادثة:', error);
        res.status(500).json({
            success: false,
            message: 'حدث خطأ في الخادم'
        });
    }
});

/**
 * @route   GET /api/privacy/is-muted/:conversationId
 * @desc    التحقق إذا كانت محادثة مكتومة
 * @access  Private
 */
router.get('/is-muted/:conversationId', [
    auth,
    param('conversationId').isMongoId().withMessage('معرف المحادثة غير صالح')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                errors: errors.array()
            });
        }

        const user = await User.findById(req.user.id);
        const mutedConv = user.mutedConversations?.find(
            m => m.conversationId.toString() === req.params.conversationId
        );

        let isMuted = false;
        let mutedUntil = null;

        if (mutedConv) {
            if (!mutedConv.mutedUntil || mutedConv.mutedUntil > new Date()) {
                isMuted = true;
                mutedUntil = mutedConv.mutedUntil;
            }
        }

        res.json({
            success: true,
            data: { isMuted, mutedUntil }
        });
    } catch (error) {
        console.error('خطأ في التحقق من كتم المحادثة:', error);
        res.status(500).json({
            success: false,
            message: 'حدث خطأ في الخادم'
        });
    }
});

// ==================== صوت الإشعارات ====================

/**
 * @route   PUT /api/privacy/notification-sound
 * @desc    تفعيل/إلغاء صوت الإشعارات
 * @access  Private
 */
router.put('/notification-sound', [
    auth,
    body('enabled')
        .isBoolean()
        .withMessage('يجب أن تكون قيمة منطقية (true/false)')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                errors: errors.array()
            });
        }

        const { enabled } = req.body;

        await User.findByIdAndUpdate(req.user.id, {
            'privacySettings.notificationSound': enabled
        });

        res.json({
            success: true,
            message: enabled ? 'تم تفعيل صوت الإشعارات' : 'تم إلغاء صوت الإشعارات',
            data: { notificationSound: enabled }
        });
    } catch (error) {
        console.error('خطأ في تغيير إعداد صوت الإشعارات:', error);
        res.status(500).json({
            success: false,
            message: 'حدث خطأ في الخادم'
        });
    }
});

module.exports = router;
