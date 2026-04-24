const express = require('express');
const router = express.Router();
const User = require('../../models/User');
const SuperLike = require('../../models/SuperLike');
const Conversation = require('../../models/Conversation');
const Notification = require('../../models/Notification');
const { protect } = require('../../middleware/auth');
const pushNotificationService = require('../../services/pushNotificationService');
const { getFullUrl } = require('./helpers');

// ==========================================
// Super Like + الاشتراكات (Premium)
// ==========================================

// @route   POST /api/mobile/super-like
// @desc    إرسال Super Like
// @access  Protected
router.post('/super-like', protect, async (req, res) => {
    try {
        const { userId: targetUserId } = req.body;
        const senderId = req.user._id;

        if (!targetUserId) {
            return res.status(400).json({ success: false, message: 'معرف المستخدم مطلوب' });
        }

        if (targetUserId === senderId.toString()) {
            return res.status(400).json({ success: false, message: 'لا يمكن إرسال Super Like لنفسك' });
        }

        // ✅ فحص تقييد المراسلة — محادثات جديدة محظورة لـ new_only و all
        if (req.user.restrictions?.messagingRestricted) {
            const now = new Date();
            const until = req.user.restrictions.messagingRestrictedUntil;
            if (!until || now < until) {
                return res.status(403).json({
                    success: false,
                    message: 'حسابك مقيّد من بدء محادثات جديدة مؤقتاً',
                    code: 'MESSAGING_RESTRICTED',
                    data: {
                        level: req.user.restrictions.messagingRestrictedLevel,
                        until: until?.toISOString(),
                        reason: req.user.restrictions.restrictionReason
                    }
                });
            }
        }

        // التحقق من وجود المستخدم المستهدف
        const targetUser = await User.findById(targetUserId).lean();
        if (!targetUser) {
            return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
        }

        if (!targetUser.isActive) {
            return res.status(400).json({ success: false, message: 'المستخدم غير نشط' });
        }

        // ✅ Privacy: المستخدم المستهدف أوقف استقبال الطلبات
        if (targetUser.acceptingRequests === false) {
            return res.status(403).json({
                success: false,
                message: 'هذا المستخدم لا يستقبل طلبات محادثة جديدة حالياً',
                code: 'NOT_ACCEPTING_REQUESTS'
            });
        }

        // ✅ Privacy: Premium-only (Super Like يبقى مسموح للمشتركين فقط لو targetUser فعّلها)
        if (targetUser.premiumOnlyRequests === true && !req.user.isPremium) {
            return res.status(403).json({
                success: false,
                message: 'هذا المستخدم يستقبل طلبات من المشتركين فقط',
                code: 'PREMIUM_ONLY_REQUESTS'
            });
        }

        // ✅ فحص الحظر (ثنائي الاتجاه)
        const senderBlocked = (req.user.blockedUsers || []).some(
            id => id.toString() === targetUserId.toString()
        );
        const targetBlocked = (targetUser.blockedUsers || []).some(
            id => id.toString() === senderId.toString()
        );
        if (senderBlocked || targetBlocked) {
            return res.status(403).json({
                success: false,
                message: 'لا يمكن إرسال Super Like لهذا المستخدم',
                code: 'USER_BLOCKED'
            });
        }

        // التحقق من الحد اليومي
        const user = await User.findById(senderId).lean();
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const lastReset = user.superLikes?.lastReset ? new Date(user.superLikes.lastReset) : new Date(0);
        lastReset.setHours(0, 0, 0, 0);

        let dailyCount = user.superLikes?.daily || 0;

        // ريسيت إذا يوم جديد
        if (lastReset < today) {
            dailyCount = 0;
        }

        const isPremium = user.isPremium && user.premiumExpiresAt > new Date();
        const maxDaily = isPremium ? 5 : 1;

        if (dailyCount >= maxDaily) {
            return res.status(429).json({
                success: false,
                error: 'super_like_limit_reached',
                message: `وصلت الحد الأقصى (${maxDaily} يومياً)`,
                data: { remaining: 0, max: maxDaily }
            });
        }

        // إنشاء Super Like
        await SuperLike.create({ sender: senderId, receiver: targetUserId });

        // تحديث العداد
        await User.findByIdAndUpdate(senderId, {
            'superLikes.daily': dailyCount + 1,
            'superLikes.lastReset': new Date()
        });

        // إنشاء محادثة pending تلقائياً (إذا ما فيه محادثة سابقة)
        let conversation = null;
        const existingConversation = await Conversation.findOne({
            type: 'private',
            participants: { $all: [senderId, targetUserId] }
        }).lean();

        if (!existingConversation) {
            conversation = await Conversation.create({
                type: 'private',
                participants: [senderId, targetUserId],
                creator: senderId,
                status: 'pending',
                isActive: true,
                title: `محادثة بين ${req.user.name} و ${targetUser.name}`
            });
            // مسح كاش شركاء المحادثات
            if (global.invalidatePartnersCache) {
                global.invalidatePartnersCache(senderId.toString());
                global.invalidatePartnersCache(targetUserId.toString());
            }
        }

        // Socket.IO (لو متصل)
        if (global.io) {
            global.io.to(`user:${targetUserId}`).emit('conversation:request', {
                conversationId: conversation ? conversation._id : existingConversation._id,
                isSuperLike: true,
                from: {
                    _id: senderId,
                    name: req.user.name,
                    profileImage: req.user.profileImage
                }
            });
        }

        // إرسال إشعار push
        try {
            await pushNotificationService.sendNotificationToUser(targetUserId, {
                title: '💎 إعجاب مميز!',
                body: `${req.user.name} أرسل لك Super Like`,
                type: 'super_like'
            }, {
                userId: senderId.toString(),
                type: 'super_like',
                conversationId: conversation ? conversation._id.toString() : existingConversation._id.toString()
            });
        } catch (notifError) {
            console.error('خطأ في إرسال إشعار Super Like:', notifError);
        }

        res.json({
            success: true,
            message: 'تم إرسال Super Like بنجاح',
            data: {
                remaining: maxDaily - (dailyCount + 1),
                max: maxDaily,
                conversationId: conversation ? conversation._id : existingConversation._id
            }
        });
    } catch (error) {
        console.error('خطأ في Super Like:', error);
        res.status(500).json({ success: false, message: 'فشل في إرسال Super Like' });
    }
});

// @route   GET /api/mobile/super-like/remaining
// @desc    المتبقي من Super Likes
// @access  Protected
router.get('/super-like/remaining', protect, async (req, res) => {
    try {
        const user = await User.findById(req.user._id).select('superLikes isPremium premiumExpiresAt').lean();

        const isPremium = user.isPremium && user.premiumExpiresAt > new Date();
        const maxDaily = isPremium ? 5 : 1;

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const lastReset = user.superLikes?.lastReset ? new Date(user.superLikes.lastReset) : new Date(0);
        lastReset.setHours(0, 0, 0, 0);

        let used = user.superLikes?.daily || 0;
        if (lastReset < today) used = 0;

        // وقت الريسيت القادم (بداية اليوم التالي)
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        res.json({
            success: true,
            data: {
                remaining: Math.max(0, maxDaily - used),
                max: maxDaily,
                used,
                resetsAt: tomorrow.toISOString()
            }
        });
    } catch (error) {
        console.error('خطأ في جلب بيانات Super Like:', error);
        res.status(500).json({ success: false, message: 'فشل في جلب البيانات' });
    }
});

// ==========================================
// نظام الاشتراكات (Subscription)
// ==========================================

// @route   POST /api/mobile/subscription/verify
// @desc    التحقق من إيصال Apple وتفعيل الاشتراك
// @access  Protected
router.post('/subscription/verify', protect, async (req, res) => {
    try {
        const { receipt, transactionId, originalTransactionId, plan } = req.body;

        // يجب إرسال إما receipt (StoreKit 1) أو transactionId (StoreKit 2)
        if (!receipt && !transactionId) {
            return res.status(400).json({
                success: false,
                message: 'بيانات الإيصال مطلوبة (receipt أو transactionId)'
            });
        }

        if (!plan) {
            return res.status(400).json({ success: false, message: 'الخطة مطلوبة' });
        }

        if (!['weekly', 'monthly', 'quarterly'].includes(plan)) {
            return res.status(400).json({ success: false, message: 'خطة غير صالحة' });
        }

        // TODO: التحقق الفعلي من Apple في بيئة الإنتاج
        // StoreKit 1: التحقق من receipt عبر Apple verifyReceipt API
        // StoreKit 2: التحقق من transactionId عبر App Store Server API v2

        // حساب تاريخ الانتهاء
        const now = new Date();
        let expiresAt;
        switch (plan) {
            case 'weekly':
                expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
                break;
            case 'monthly':
                expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
                break;
            case 'quarterly':
                expiresAt = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
                break;
        }

        const updateData = {
            isPremium: true,
            premiumPlan: plan,
            premiumExpiresAt: expiresAt
        };

        // حفظ بيانات المعاملة لو StoreKit 2
        if (transactionId) {
            updateData.subscriptionTransactionId = transactionId;
            if (originalTransactionId) {
                updateData.subscriptionOriginalTransactionId = originalTransactionId;
            }
        }

        await User.findByIdAndUpdate(req.user._id, updateData);

        res.json({
            success: true,
            message: 'تم تفعيل الاشتراك بنجاح',
            data: {
                isPremium: true,
                plan,
                expiresAt: expiresAt.toISOString()
            }
        });
    } catch (error) {
        console.error('خطأ في التحقق من الاشتراك:', error);
        res.status(500).json({ success: false, message: 'فشل في التحقق من الاشتراك' });
    }
});

// @route   GET /api/mobile/subscription/status
// @desc    حالة الاشتراك الحالية
// @access  Protected
router.get('/subscription/status', protect, async (req, res) => {
    try {
        const user = await User.findById(req.user._id)
            .select('isPremium premiumPlan premiumExpiresAt').lean();

        const isPremium = user.isPremium && user.premiumExpiresAt && user.premiumExpiresAt > new Date();

        res.json({
            success: true,
            data: {
                isPremium: isPremium || false,
                plan: isPremium ? user.premiumPlan : null,
                expiresAt: isPremium ? user.premiumExpiresAt.toISOString() : null
            }
        });
    } catch (error) {
        console.error('خطأ في جلب حالة الاشتراك:', error);
        res.status(500).json({ success: false, message: 'فشل في جلب حالة الاشتراك' });
    }
});

module.exports = router;
