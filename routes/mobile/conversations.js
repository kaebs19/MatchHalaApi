const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const User = require('../../models/User');
const Conversation = require('../../models/Conversation');
const Message = require('../../models/Message');
const Notification = require('../../models/Notification');
const SuperLike = require('../../models/SuperLike');
const { protect } = require('../../middleware/auth');
const { spamCheckMiddleware } = require('../../middleware/spamDetection');
const pushNotificationService = require('../../services/pushNotificationService');
const { getFullUrl, getBestUserImage, maskBannedUser, isUserFullyBanned } = require('./helpers');
const { conversationLimitMiddleware } = require('../../middleware/conversationLimits');

// ==========================================
// نظام المحادثات (طلب/قبول/رفض)
// ==========================================

// @route   POST /api/mobile/conversations/request
// @desc    طلب بدء محادثة مع مستخدم
// @access  Private
router.post('/conversations/request', protect, spamCheckMiddleware, conversationLimitMiddleware, async (req, res) => {
    try {
        const { targetUserId, initialMessage, isSuperLike } = req.body;

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

        if (!targetUserId) {
            return res.status(400).json({
                success: false,
                message: 'معرف المستخدم المستهدف مطلوب'
            });
        }

        // التحقق من وجود المستخدم المستهدف
        const targetUser = await User.findById(targetUserId).lean();
        if (!targetUser) {
            return res.status(404).json({
                success: false,
                message: 'المستخدم غير موجود'
            });
        }

        if (!targetUser.isActive) {
            return res.status(400).json({
                success: false,
                message: 'المستخدم غير نشط'
            });
        }

        // ✅ Privacy: المستخدم المستهدف أوقف استقبال الطلبات
        if (targetUser.acceptingRequests === false) {
            return res.status(403).json({
                success: false,
                message: 'هذا المستخدم لا يستقبل طلبات محادثة جديدة حالياً',
                code: 'NOT_ACCEPTING_REQUESTS'
            });
        }

        // ✅ Privacy: المستخدم المستهدف يقبل من Premium فقط
        if (targetUser.premiumOnlyRequests === true && !req.user.isPremium) {
            return res.status(403).json({
                success: false,
                message: 'هذا المستخدم يستقبل طلبات من المشتركين فقط',
                code: 'PREMIUM_ONLY_REQUESTS'
            });
        }

        // التحقق من عدم وجود محادثة سابقة
        const existingConversation = await Conversation.findOne({
            type: 'private',
            participants: { $all: [req.user._id, targetUserId] }
        }).lean();

        if (existingConversation) {
            // ✅ محادثة منتهية (ملغاة/مرفوضة/غير نشطة) → أعد فتحها كطلب جديد
            //    الرسائل القديمة تبقى ظاهرة، والطرف الآخر يستقبل طلباً جديداً يقبله.
            const isEnded = existingConversation.status === 'cancelled'
                || existingConversation.status === 'rejected'
                || existingConversation.isActive === false;

            if (isEnded) {
                await Conversation.findByIdAndUpdate(existingConversation._id, {
                    status: 'pending',
                    isActive: true,
                    creator: req.user._id,        // المُرسِل الجديد هو منشئ الطلب
                    cancelledBy: null,
                    cancelledAt: null,
                    // أعد إظهارها للطرفين (نبدأ من سجل نظيف للإخفاء)
                    hiddenFor: []
                });

                if (initialMessage) {
                    await Message.create({
                        conversation: existingConversation._id,
                        sender: req.user._id,
                        content: initialMessage,
                        type: 'text',
                        status: 'sent'
                    });
                }

                if (global.io) {
                    global.io.to(`user:${targetUserId}`).emit('conversation:request', {
                        conversationId: existingConversation._id,
                        isSuperLike: false,
                        from: {
                            _id: req.user._id,
                            name: req.user.name,
                            profileImage: req.user.profileImage
                        }
                    });
                }

                const reopened = await Conversation.findById(existingConversation._id).lean();
                return res.status(200).json({
                    success: true,
                    message: 'تم إرسال طلب محادثة جديد',
                    data: { conversation: reopened, isExisting: true, reopened: true }
                });
            }

            // ✅ لو المحادثة مخفية عند المرسل (من reset chats/delete سابق)، أعد إظهارها
            const wasHidden = (existingConversation.hiddenFor || []).some(h =>
                h.user && h.user.toString() === req.user._id.toString()
            );
            if (wasHidden) {
                await Conversation.findByIdAndUpdate(existingConversation._id, {
                    $pull: { hiddenFor: { user: req.user._id } }
                });
                existingConversation.hiddenFor = (existingConversation.hiddenFor || []).filter(h =>
                    !h.user || h.user.toString() !== req.user._id.toString()
                );
            }

            return res.status(200).json({
                success: true,
                message: 'محادثة موجودة بالفعل',
                data: {
                    conversation: existingConversation,
                    isExisting: true
                }
            });
        }

        // ========== معالجة Super Like ==========
        let superLikeCreated = false;
        if (isSuperLike) {
            const senderId = req.user._id;

            // التحقق من الحد اليومي
            const senderUser = await User.findById(senderId).lean();
            const today = new Date();
            today.setHours(0, 0, 0, 0);

            const lastReset = senderUser.superLikes?.lastReset ? new Date(senderUser.superLikes.lastReset) : new Date(0);
            lastReset.setHours(0, 0, 0, 0);

            let dailyCount = senderUser.superLikes?.daily || 0;
            if (lastReset < today) dailyCount = 0;

            const userIsPremium = senderUser.isPremium && senderUser.premiumExpiresAt > new Date();
            const maxDaily = userIsPremium ? 5 : 1;

            if (dailyCount >= maxDaily) {
                return res.status(429).json({
                    success: false,
                    error: 'super_like_limit_reached',
                    message: `وصلت الحد الأقصى من Super Likes (${maxDaily} يومياً)`,
                    data: { remaining: 0, max: maxDaily }
                });
            }

            // إنشاء Super Like
            await SuperLike.create({ sender: senderId, receiver: targetUserId });
            await User.findByIdAndUpdate(senderId, {
                'superLikes.daily': dailyCount + 1,
                'superLikes.lastReset': new Date()
            });
            superLikeCreated = true;
        }

        // إنشاء محادثة جديدة بحالة "pending"
        const conversation = await Conversation.create({
            type: 'private',
            participants: [req.user._id, targetUserId],
            creator: req.user._id,
            status: 'pending',
            isActive: true,
            title: `محادثة بين ${req.user.name} و ${targetUser.name}`
        });
        // مسح كاش شركاء المحادثات
        if (global.invalidatePartnersCache) {
            global.invalidatePartnersCache(req.user._id.toString());
            global.invalidatePartnersCache(targetUserId.toString());
        }

        // إرسال الرسالة الأولى إذا وجدت
        if (initialMessage) {
            await Message.create({
                conversation: conversation._id,
                sender: req.user._id,
                content: initialMessage,
                type: 'text',
                status: 'sent'
            });
        }

        // ١. Socket.IO (لو متصل)
        if (global.io) {
            global.io.to(`user:${targetUserId}`).emit('conversation:request', {
                conversationId: conversation._id,
                isSuperLike: superLikeCreated,
                from: {
                    _id: req.user._id,
                    name: req.user.name,
                    profileImage: req.user.profileImage
                }
            });
        }

        // ٢. Push Notification عبر FCM
        const notifTitle = superLikeCreated ? '💎 إعجاب مميز!' : 'طلب محادثة جديد';
        const notifBody = superLikeCreated
            ? `${req.user.name} أرسل لك Super Like ويريد التحدث معك`
            : `${req.user.name} يريد التحدث معك`;

        try {
            await pushNotificationService.sendNotificationToUser(
                targetUserId,
                {
                    title: notifTitle,
                    body: notifBody,
                    type: superLikeCreated ? 'super_like' : 'conversation_request'
                },
                {
                    type: superLikeCreated ? 'super_like' : 'conversation_request',
                    conversationId: conversation._id.toString(),
                    senderId: req.user._id.toString(),
                    senderName: req.user.name,
                    senderImage: (() => {
                        const img = getBestUserImage(req.user);
                        if (!img) return '';
                        if (img.startsWith('http')) return img;
                        const baseUrl = process.env.BASE_URL || 'https://matchhala.chathala.com';
                        return baseUrl + img;
                    })(),
                    isSuperLike: superLikeCreated ? 'true' : 'false'
                }
            );
        } catch (notifError) {
            console.error('خطأ في إرسال إشعار طلب المحادثة:', notifError);
        }

        res.status(201).json({
            success: true,
            message: superLikeCreated ? 'تم إرسال Super Like وطلب المحادثة' : 'تم إرسال طلب المحادثة',
            data: {
                conversation,
                isExisting: false,
                isSuperLike: superLikeCreated
            }
        });

    } catch (error) {
        console.error('خطأ في طلب المحادثة:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في السيرفر',
            error: error.message
        });
    }
});

// @route   PUT /api/mobile/conversations/:id/accept
// @desc    قبول طلب محادثة
// @access  Private
router.put('/conversations/:id/accept', protect, async (req, res) => {
    try {
        const conversation = await Conversation.findById(req.params.id)
            .populate('participants', 'name email deviceToken isActive suspension bannedWords');

        if (!conversation) {
            return res.status(404).json({
                success: false,
                message: 'المحادثة غير موجودة'
            });
        }

        // التحقق من أن المستخدم هو المستهدف وليس المنشئ
        if (conversation.creator.toString() === req.user._id.toString()) {
            return res.status(400).json({
                success: false,
                message: 'لا يمكنك قبول طلب أنت أرسلته'
            });
        }

        // التحقق من أن المستخدم جزء من المحادثة
        const isParticipant = conversation.participants.some(
            p => p._id.toString() === req.user._id.toString()
        );

        if (!isParticipant) {
            return res.status(403).json({
                success: false,
                message: 'ليس لديك صلاحية لهذه المحادثة'
            });
        }

        // ✅ Idempotent: لو سبق وقُبل → ارجع 200 بدون تغيير (يمنع تكرار العملية)
        if (conversation.status === 'accepted') {
            return res.status(200).json({
                success: true,
                message: 'الطلب مقبول بالفعل',
                code: 'ALREADY_ACCEPTED',
                data: { conversation }
            });
        }

        // ✅ لو مرفوض سابقًا → 400 برمز واضح
        if (conversation.status === 'rejected') {
            return res.status(400).json({
                success: false,
                message: 'الطلب رُفض سابقًا',
                code: 'ALREADY_REJECTED'
            });
        }

        // ✅ لو حالة غير متوقعة (ليست pending) → ارفض بوضوح
        if (conversation.status !== 'pending') {
            return res.status(400).json({
                success: false,
                message: 'الطلب لم يعد قيد الانتظار',
                code: 'INVALID_STATUS'
            });
        }

        // ✅ منع قبول طلب من مستخدم موقوف/محظور
        const creatorUser = conversation.participants.find(
            p => p._id.toString() === conversation.creator.toString()
        );
        const creatorBlocked =
            !creatorUser ||
            creatorUser.isActive === false ||
            creatorUser.suspension?.isSuspended === true ||
            creatorUser.bannedWords?.isBanned === true;
        if (creatorBlocked) {
            // علّم الطلب كمرفوض حتى يختفي من القائمة
            conversation.status = 'rejected';
            conversation.isActive = false;
            await conversation.save();
            return res.status(403).json({
                success: false,
                message: 'لا يمكن قبول هذا الطلب — المستخدم موقوف',
                code: 'USER_SUSPENDED'
            });
        }

        // تفعيل المحادثة
        conversation.status = 'accepted';
        conversation.isActive = true;
        await conversation.save();

        // إرسال إشعار لمنشئ المحادثة عبر FCM
        const creator = conversation.participants.find(
            p => p._id.toString() === conversation.creator.toString()
        );

        if (creator && creator.deviceToken) {
            await pushNotificationService.sendNotificationToUser(
                creator._id,
                {
                    title: 'تم قبول طلب المحادثة',
                    body: `${req.user.name} قبل طلب المحادثة`
                },
                {
                    type: 'conversation_request',
                    conversationId: conversation._id.toString(),
                    action: 'accepted'
                }
            );
        }

        // إرسال عبر Socket.IO
        if (global.io) {
            global.io.to(`user:${conversation.creator.toString()}`).emit('conversation-accepted', {
                conversationId: conversation._id,
                acceptedBy: req.user.name
            });
        }

        res.status(200).json({
            success: true,
            message: 'تم قبول المحادثة',
            data: { conversation }
        });

    } catch (error) {
        console.error('خطأ في قبول المحادثة:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في السيرفر',
            error: error.message
        });
    }
});

// @route   PUT /api/mobile/conversations/:id/reject
// @desc    رفض طلب محادثة
// @access  Private
router.put('/conversations/:id/reject', protect, async (req, res) => {
    try {
        const conversation = await Conversation.findById(req.params.id)
            .populate('participants', 'name email deviceToken');

        if (!conversation) {
            return res.status(404).json({
                success: false,
                message: 'المحادثة غير موجودة'
            });
        }

        // التحقق من أن المستخدم هو المستهدف
        if (conversation.creator.toString() === req.user._id.toString()) {
            return res.status(400).json({
                success: false,
                message: 'لا يمكنك رفض طلب أنت أرسلته'
            });
        }

        const isParticipant = conversation.participants.some(
            p => p._id.toString() === req.user._id.toString()
        );

        if (!isParticipant) {
            return res.status(403).json({
                success: false,
                message: 'ليس لديك صلاحية لهذه المحادثة'
            });
        }

        // تحديث حالة المحادثة
        conversation.status = 'rejected';
        conversation.isActive = false;
        await conversation.save();

        // إرسال إشعار لمنشئ المحادثة عبر FCM
        const creator = conversation.participants.find(
            p => p._id.toString() === conversation.creator.toString()
        );

        if (creator && creator.deviceToken) {
            await pushNotificationService.sendNotificationToUser(
                creator._id,
                {
                    title: 'طلب المحادثة',
                    body: 'لم يتم قبول طلب المحادثة'
                },
                {
                    type: 'conversation_request',
                    conversationId: conversation._id.toString(),
                    action: 'rejected'
                }
            );
        }

        // إرسال عبر Socket.IO
        if (global.io) {
            global.io.to(`user:${conversation.creator.toString()}`).emit('conversation-rejected', {
                conversationId: conversation._id,
                rejectedBy: req.user.name
            });
        }

        res.status(200).json({
            success: true,
            message: 'تم رفض طلب المحادثة',
            data: { conversation }
        });

    } catch (error) {
        console.error('خطأ في رفض المحادثة:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في السيرفر',
            error: error.message
        });
    }
});

// @route   PUT /api/mobile/conversations/:id/cancel
// @desc    إنهاء/إلغاء المحادثة للطرفين (تبقى الرسائل) — لا يمكن الإرسال إلا بطلب جديد يُقبل
// @access  Private
router.put('/conversations/:id/cancel', protect, async (req, res) => {
    try {
        const conversation = await Conversation.findById(req.params.id)
            .populate('participants', 'name email deviceToken');

        if (!conversation) {
            return res.status(404).json({ success: false, message: 'المحادثة غير موجودة' });
        }

        const isParticipant = conversation.participants.some(
            p => p._id.toString() === req.user._id.toString()
        );
        if (!isParticipant) {
            return res.status(403).json({ success: false, message: 'ليس لديك صلاحية لهذه المحادثة' });
        }

        // إنهاء المحادثة للطرفين — الرسائل تبقى محفوظة
        conversation.status = 'cancelled';
        conversation.isActive = false;
        conversation.cancelledBy = req.user._id;
        conversation.cancelledAt = new Date();
        await conversation.save();

        // إخطار الطرف الآخر فوراً عبر Socket.IO
        const otherParticipant = conversation.participants.find(
            p => p._id.toString() !== req.user._id.toString()
        );
        if (global.io && otherParticipant) {
            global.io.to(`user:${otherParticipant._id.toString()}`).emit('conversation:cancelled', {
                conversationId: conversation._id,
                cancelledBy: req.user.name
            });
        }

        // إشعار push للطرف الآخر
        if (otherParticipant && otherParticipant.deviceToken) {
            await pushNotificationService.sendNotificationToUser(
                otherParticipant._id,
                {
                    title: 'انتهت المحادثة',
                    body: `${req.user.name} أنهى المحادثة. يمكنك إرسال طلب جديد للاستئناف.`
                },
                {
                    type: 'conversation_request',
                    conversationId: conversation._id.toString(),
                    action: 'cancelled'
                }
            ).catch(() => {});
        }

        res.status(200).json({
            success: true,
            message: 'تم إنهاء المحادثة',
            data: { conversation }
        });
    } catch (error) {
        console.error('خطأ في إنهاء المحادثة:', error);
        res.status(500).json({ success: false, message: 'خطأ في السيرفر', error: error.message });
    }
});

// @route   PUT /api/mobile/conversations/:id/read
// @desc    تحديث الرسائل كمقروءة في المحادثة
// @access  Private
router.put('/conversations/:id/read', protect, async (req, res) => {
    try {
        const conversationId = req.params.id;
        const userId = req.user._id;

        // التحقق من المحادثة
        const conversation = await Conversation.findById(conversationId).lean();

        if (!conversation) {
            return res.status(404).json({
                success: false,
                message: 'المحادثة غير موجودة'
            });
        }

        // التحقق من أن المستخدم جزء من المحادثة
        const isParticipant = conversation.participants.some(
            p => p.toString() === userId.toString()
        );

        if (!isParticipant) {
            return res.status(403).json({
                success: false,
                message: 'ليس لديك صلاحية لهذه المحادثة'
            });
        }

        // تحديث جميع الرسائل غير المقروءة (التي لم يقرأها هذا المستخدم)
        const result = await Message.updateMany(
            {
                conversation: conversationId,
                sender: { $ne: userId }, // رسائل الآخرين فقط
                'readBy.user': { $ne: userId } // لم يقرأها هذا المستخدم بعد
            },
            {
                $addToSet: {
                    readBy: { user: userId, readAt: new Date() }
                },
                $set: { status: 'read' }
            }
        );

        // إرسال Socket event للطرف الآخر
        if (global.io && result.modifiedCount > 0) {
            const readPayload = {
                conversationId,
                readBy: userId,
                count: result.modifiedCount
            };
            // بث لغرفة المحادثة
            global.io.to(`conversation-${conversationId}`).emit('messages-read', readPayload);
            // بث لغرفة المستخدمين الآخرين (حتى لو لم ينضموا لغرفة المحادثة)
            const otherParticipants = conversation.participants.filter(
                p => p.toString() !== userId.toString()
            );
            for (const participantId of otherParticipants) {
                global.io.to(`user:${participantId}`).emit('messages-read', readPayload);
            }
        }

        res.status(200).json({
            success: true,
            message: 'تم تحديث حالة القراءة',
            data: {
                markedAsRead: result.modifiedCount
            }
        });

    } catch (error) {
        console.error('خطأ في تحديث حالة القراءة:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في السيرفر',
            error: error.message
        });
    }
});

// @route   GET /api/mobile/conversations/pending
// @desc    الحصول على طلبات المحادثة المعلقة
// @access  Private
router.get('/conversations/pending', protect, async (req, res) => {
    try {
        const allPending = await Conversation.find({
            participants: req.user._id,
            creator: { $ne: req.user._id },
            status: 'pending'
        })
            .populate('creator', 'name email profileImage verification.isVerified isPremium isActive suspension bannedWords')
            .populate('participants', 'name email profileImage lastLogin isOnline isPremium isActive verification.isVerified')
            .sort({ createdAt: -1 })
            .lean();

        // ✅ استثناء الطلبات من المستخدمين الموقوفين/المحظورين
        // (لا يجب أن يظهر طلب من مستخدم لا يستطيع المتابعة معه أصلاً)
        const conversations = allPending.filter(c => {
            const creator = c.creator;
            if (!creator) return false;
            if (creator.isActive === false) return false;
            if (creator.suspension?.isSuspended === true) return false;
            if (creator.bannedWords?.isBanned === true) return false;
            return true;
        });

        // ✅ تنظيف صامت في الخلفية: حوّل الطلبات من الموقوفين إلى rejected (لا تتراكم)
        const filteredOutIds = allPending
            .filter(c => !conversations.some(kept => kept._id.toString() === c._id.toString()))
            .map(c => c._id);
        if (filteredOutIds.length > 0) {
            Conversation.updateMany(
                { _id: { $in: filteredOutIds } },
                { $set: { status: 'rejected', isActive: false } }
            ).catch(err => console.error('cleanup pending from banned creators:', err.message));
        }

        // إضافة حقل isSuperLike لكل طلب
        const creatorIds = conversations.map(c => c.creator._id);
        const superLikes = await SuperLike.find({
            receiver: req.user._id,
            sender: { $in: creatorIds }
        }).lean();
        const superLikeSet = new Set(superLikes.map(sl => sl.sender.toString()));

        // جلب آخر 5 رسائل من المُرسل لكل طلب (لعرضها كـ chat preview قبل القبول)
        const conversationIds = conversations.map(c => c._id);
        const allInitialMsgs = await Message.find({
            conversation: { $in: conversationIds },
            isDeleted: { $ne: true }
        })
            .sort({ createdAt: 1 })  // الأقدم أولاً
            .lean();

        // group by conversation + filter من المُرسل فقط + max 5
        const messagesMap = new Map();
        for (const conv of conversations) {
            const creatorId = conv.creator._id.toString();
            const convId = conv._id.toString();
            const fromCreator = allInitialMsgs.filter(m =>
                m.conversation.toString() === convId &&
                m.sender.toString() === creatorId
            );
            // آخر 5 (الأحدث) — لكن نبقي الترتيب الزمني
            const last5 = fromCreator.slice(-5).map(m => ({
                content: m.content || '',
                type: m.type || 'text',
                mediaUrl: m.mediaUrl || null,
                createdAt: m.createdAt
            }));
            messagesMap.set(convId, {
                messages: last5,
                totalCount: fromCreator.length
            });
        }

        const enrichedConversations = conversations.map(conv => {
            const convObj = { ...conv };
            convObj.isSuperLike = superLikeSet.has(conv.creator._id.toString());
            convObj.creator.isVerified = conv.creator.verification?.isVerified || false;
            const m = messagesMap.get(conv._id.toString());
            // ✅ كائن initialMessage القديم (للتوافق مع التطبيقات القديمة): أول رسالة فقط
            convObj.initialMessage = m && m.messages.length > 0
                ? { content: m.messages[0].content, createdAt: m.messages[0].createdAt }
                : null;
            // ✅ المصفوفة الجديدة (التطبيقات الجديدة)
            convObj.initialMessages = m?.messages || [];
            convObj.initialMessagesTotal = m?.totalCount || 0;
            return convObj;
        });

        // ترتيب: Super Like أولاً ثم بالتاريخ
        enrichedConversations.sort((a, b) => {
            if (a.isSuperLike && !b.isSuperLike) return -1;
            if (!a.isSuperLike && b.isSuperLike) return 1;
            return new Date(b.createdAt) - new Date(a.createdAt);
        });

        // ✅ عدد الطلبات الجديدة (لم تتجاوز 24 ساعة) للـ badge
        const recentCount = enrichedConversations.filter(c => {
            const ageHours = (Date.now() - new Date(c.createdAt).getTime()) / (1000 * 60 * 60);
            return ageHours <= 24;
        }).length;

        res.status(200).json({
            success: true,
            data: {
                conversations: enrichedConversations,
                total: enrichedConversations.length,
                recentCount   // ✅ للـ badge في bottom tab
            }
        });

    } catch (error) {
        console.error('خطأ في جلب الطلبات المعلقة:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في السيرفر',
            error: error.message
        });
    }
});

// @route   GET /api/mobile/conversations/pending-count
// @desc    عدد طلبات المحادثة المعلقة (للـ badge في bottom tab) — خفيف وسريع
// @access  Private
router.get('/conversations/pending-count', protect, async (req, res) => {
    try {
        const Conversation = require('../../models/Conversation');
        const userId = req.user._id;

        // ✅ عدد بعد استثناء الموقوفين/المحظورين — يطابق ما يراه المستخدم في القائمة
        const pending = await Conversation.find({
            participants: userId,
            creator: { $ne: userId },
            status: 'pending'
        })
            .populate('creator', 'isActive suspension bannedWords')
            .select('_id creator createdAt')
            .lean();

        const isCreatorActive = (c) => {
            const u = c.creator;
            if (!u) return false;
            if (u.isActive === false) return false;
            if (u.suspension?.isSuspended === true) return false;
            if (u.bannedWords?.isBanned === true) return false;
            return true;
        };

        const validPending = pending.filter(isCreatorActive);
        const total = validPending.length;

        // العدد الجديد (آخر 24 ساعة)
        const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
        const recent = validPending.filter(c => new Date(c.createdAt).getTime() >= dayAgo).length;

        res.json({
            success: true,
            data: { total, recent }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'خطأ في السيرفر' });
    }
});

// @route   POST /api/mobile/conversations/:id/accept-with-message
// @desc    قبول طلب محادثة + إرسال رسالة ترحيب فورية في خطوة واحدة
// @access  Private
router.post('/conversations/:id/accept-with-message', protect, async (req, res) => {
    try {
        const Conversation = require('../../models/Conversation');
        const Message = require('../../models/Message');
        const userId = req.user._id;
        const { greeting } = req.body;

        // ✅ فحص تقييد المراسلة (accept-with-message يُرسل رسالة ترحيب)
        if (req.user.restrictions?.messagingRestricted) {
            const now = new Date();
            const until = req.user.restrictions.messagingRestrictedUntil;
            if (!until || now < until) {
                if (req.user.restrictions.messagingRestrictedLevel === 'all') {
                    return res.status(403).json({
                        success: false,
                        message: 'حسابك مقيّد من إرسال الرسائل مؤقتاً. يمكنك القبول بدون رسالة ترحيب.',
                        code: 'MESSAGING_RESTRICTED',
                        data: {
                            level: 'all',
                            until: until?.toISOString(),
                            reason: req.user.restrictions.restrictionReason
                        }
                    });
                }
            }
        }

        const conv = await Conversation.findById(req.params.id);
        if (!conv) return res.status(404).json({ success: false, message: 'الطلب غير موجود' });
        if (!conv.participants.some(p => p.toString() === userId.toString())) {
            return res.status(403).json({ success: false, message: 'ليس لديك صلاحية' });
        }

        // ✅ Idempotent على الحالات النهائية
        if (conv.status === 'accepted') {
            return res.status(200).json({
                success: true,
                message: 'الطلب مقبول بالفعل',
                code: 'ALREADY_ACCEPTED',
                data: { conversation: conv }
            });
        }
        if (conv.status === 'rejected') {
            return res.status(400).json({ success: false, message: 'الطلب رُفض سابقًا', code: 'ALREADY_REJECTED' });
        }
        if (conv.status !== 'pending') {
            return res.status(400).json({ success: false, message: 'الطلب ليس قيد الانتظار', code: 'INVALID_STATUS' });
        }

        // ✅ منع قبول طلب من مستخدم موقوف/محظور
        const creatorDoc = await User.findById(conv.creator)
            .select('isActive suspension bannedWords')
            .lean();
        const creatorBlocked =
            !creatorDoc ||
            creatorDoc.isActive === false ||
            creatorDoc.suspension?.isSuspended === true ||
            creatorDoc.bannedWords?.isBanned === true;
        if (creatorBlocked) {
            conv.status = 'rejected';
            conv.isActive = false;
            await conv.save();
            return res.status(403).json({
                success: false,
                message: 'لا يمكن قبول هذا الطلب — المستخدم موقوف',
                code: 'USER_SUSPENDED'
            });
        }

        // 1. قبول
        conv.status = 'accepted';
        await conv.save();

        // 2. إرسال رسالة الترحيب (إن وُجدت)
        let welcomeMessage = null;
        if (greeting && typeof greeting === 'string' && greeting.trim()) {
            welcomeMessage = await Message.create({
                conversation: conv._id,
                sender: userId,
                content: greeting.trim(),
                type: 'text',
                status: 'sent'
            });
            conv.lastMessage = welcomeMessage._id;
            await conv.save();
        }

        // 3. Socket.IO — إبلاغ المُرسل بالقبول + الرسالة
        if (global.io) {
            const otherParticipant = conv.participants.find(p => p.toString() !== userId.toString());
            if (otherParticipant) {
                global.io.to(`user:${otherParticipant}`).emit('conversation-accepted', {
                    conversationId: String(conv._id)
                });
                if (welcomeMessage) {
                    global.io.to(`user:${otherParticipant}`).emit('new-message', {
                        message: welcomeMessage
                    });
                }
            }
        }

        res.json({
            success: true,
            message: welcomeMessage ? 'تم القبول وإرسال الترحيب' : 'تم القبول',
            data: {
                conversationId: conv._id,
                welcomeMessage
            }
        });
    } catch (error) {
        console.error('accept-with-message error:', error);
        res.status(500).json({ success: false, message: 'خطأ في السيرفر' });
    }
});

// @route   GET /api/mobile/conversations
// @desc    الحصول على محادثات المستخدم النشطة مع عدد الرسائل غير المقروءة (مع دعم Last-Modified/304)
// @access  Private
router.get('/conversations', protect, async (req, res) => {
    try {
        // ✅ زيادة limit الافتراضي من 20 → 50 (يحل 95% من حالات اختفاء المحادثات)
        // ✅ دعم since=ISO timestamp للتحديثات الجزئية (delta sync)
        // ✅ all=true يجلب كل المحادثات النشطة بدون pagination (للـ initial load)
        const { page = 1, since, all, status } = req.query;
        const limit = Math.min(parseInt(req.query.limit) || 50, 200);
        const userId = req.user._id;

        // ✅ فلتر حالة اختياري (متوافق للخلف):
        //   - status=accepted → القائمة الرئيسية المقبولة فقط (يمنع مزاحمة الطلبات/المرفوضة لها)
        //   - يقبل قيمة واحدة أو عدة قيم مفصولة بفواصل (accepted,pending)
        //   - الافتراضي (بدون status) = السلوك القديم: accepted + pending + rejected
        const ALLOWED_STATUSES = ['accepted', 'pending', 'rejected', 'expired', 'cancelled'];
        let statusValues = ['accepted', 'pending', 'rejected', 'cancelled'];
        if (typeof status === 'string' && status.trim()) {
            const requested = status.split(',')
                .map(s => s.trim())
                .filter(s => ALLOWED_STATUSES.includes(s));
            if (requested.length > 0) statusValues = requested;
        }

        const convFilter = {
            participants: userId,
            status: { $in: statusValues },
            // ✅ استبعاد المحادثات المخفية عن هذا المستخدم
            'hiddenFor.user': { $ne: userId }
        };

        // ✅ Delta sync — رجّع فقط المحادثات اللي تغيّرت بعد آخر sync
        if (since) {
            const sinceDate = new Date(since);
            if (!isNaN(sinceDate.getTime())) {
                convFilter.updatedAt = { $gt: sinceDate };
            }
        }

        // ETag: التحقق من آخر تعديل
        const lastConv = await Conversation.findOne({
            participants: userId,
            'hiddenFor.user': { $ne: userId }
        }).sort({ updatedAt: -1 }).select('updatedAt').lean();
        const lastModified = lastConv ? lastConv.updatedAt : new Date(0);
        const ifModifiedSince = req.headers['if-modified-since'];

        if (ifModifiedSince && lastModified <= new Date(ifModifiedSince)) {
            return res.status(304).end();
        }

        res.set('Last-Modified', lastModified.toUTCString());

        // ✅ all=true: جلب كل المحادثات النشطة (limit آمن 500)
        const effectiveLimit = (all === 'true' || all === '1') ? 500 : limit;
        const skip = (all === 'true' || all === '1') ? 0 : (page - 1) * limit;

        const conversations = await Conversation.find(convFilter)
            .populate('participants', 'name email profileImage photos lastLogin isOnline isPremium verification.isVerified isActive bannedWords suspension')
            .populate('lastMessage')
            .select('+creator')
            .sort({ updatedAt: -1 })
            .limit(effectiveLimit)
            .skip(skip)
            .lean();

        // تحويل صور المشاركين إلى thumbnails + قناع المحظورين
        for (const conv of conversations) {
            if (conv.participants) {
                conv.participants = conv.participants.map(p => {
                    // إذا محظور بشكل كامل → قناع (اسم/صورة)
                    if (isUserFullyBanned(p)) {
                        return maskBannedUser(p);
                    }
                    const mainPhoto = p.photos && p.photos.length > 0
                        ? (p.photos.find(ph => ph.order === 0) || p.photos[0])
                        : null;
                    p.profileImage = mainPhoto && mainPhoto.thumbnail
                        ? getFullUrl(mainPhoto.thumbnail)
                        : getFullUrl(p.profileImage);
                    delete p.photos;
                    delete p.bannedWords;
                    delete p.suspension;
                    delete p.isActive;
                    return p;
                });
            }
        }

        // ✅ حساب عدد الرسائل غير المقروءة بـ aggregation واحد بدل N+1 queries
        const convIds = conversations.map(c => c._id);
        const unreadCounts = await Message.aggregate([
            {
                $match: {
                    conversation: { $in: convIds },
                    sender: { $ne: new mongoose.Types.ObjectId(userId) },
                    'readBy.user': { $ne: new mongoose.Types.ObjectId(userId) }
                }
            },
            {
                $group: {
                    _id: '$conversation',
                    count: { $sum: 1 }
                }
            }
        ]);

        const unreadMap = {};
        for (const item of unreadCounts) {
            unreadMap[item._id.toString()] = item.count;
        }

        // ✅ جلب أول رسالة من المُرسل للطلبات المعلقة فقط (لعرضها في شاشة القبول)
        const pendingConvIds = conversations
            .filter(c => c.status === 'pending' && c.creator && c.creator.toString() !== userId.toString())
            .map(c => c._id);
        const initialMessageMap = new Map();
        if (pendingConvIds.length > 0) {
            const initialMessages = await Message.aggregate([
                {
                    $match: {
                        conversation: { $in: pendingConvIds },
                        type: 'text',
                        isDeleted: { $ne: true }
                    }
                },
                { $sort: { createdAt: 1 } },
                {
                    $group: {
                        _id: '$conversation',
                        content: { $first: '$content' },
                        sender: { $first: '$sender' },
                        createdAt: { $first: '$createdAt' }
                    }
                }
            ]);
            for (const m of initialMessages) {
                const conv = conversations.find(c => c._id.toString() === m._id.toString());
                if (conv && conv.creator && m.sender.toString() === conv.creator.toString()) {
                    initialMessageMap.set(m._id.toString(), {
                        content: m.content,
                        createdAt: m.createdAt
                    });
                }
            }
        }

        const conversationsWithUnread = conversations.map(conv => {
            // إضافة isRead + isDelivered لآخر رسالة
            if (conv.lastMessage && conv.lastMessage.sender) {
                const senderId = conv.lastMessage.sender.toString();
                if (senderId === userId.toString()) {
                    conv.lastMessage.isRead = conv.lastMessage.status === 'read' ||
                        (conv.lastMessage.readBy && conv.lastMessage.readBy.some(
                            r => r.user && r.user.toString() !== userId.toString()
                        ));
                    conv.lastMessage.isDelivered = conv.lastMessage.isRead || conv.lastMessage.status === 'delivered';
                } else {
                    conv.lastMessage.isRead = true;
                    conv.lastMessage.isDelivered = true;
                }
            }

            return {
                ...conv,
                unreadCount: unreadMap[conv._id.toString()] || 0,
                initialMessage: initialMessageMap.get(conv._id.toString()) || null
            };
        });

        const total = await Conversation.countDocuments(convFilter);

        // حساب إجمالي الرسائل غير المقروءة
        const totalUnread = conversationsWithUnread.reduce((sum, conv) => sum + conv.unreadCount, 0);

        res.status(200).json({
            success: true,
            data: {
                conversations: conversationsWithUnread,
                total,
                totalUnread,
                currentPage: parseInt(page),
                totalPages: Math.ceil(total / limit),
                // ✅ syncedAt — يستخدمه iOS للـ delta sync التالية
                syncedAt: lastModified.toISOString()
            }
        });

    } catch (error) {
        console.error('خطأ في جلب المحادثات:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في السيرفر',
            error: error.message
        });
    }
});

// @route   DELETE /api/mobile/conversations/:id
// @desc    إخفاء محادثة عن المستخدم (soft delete — لا يحذف من الطرف الآخر)
// @access  Private
router.delete('/conversations/:id', protect, async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user._id;

        console.log(`[DEL-CONV] user=${userId} id=${id} valid=${mongoose.Types.ObjectId.isValid(id)}`);

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'معرّف المحادثة غير صالح' });
        }

        const conv = await Conversation.findOne({
            _id: id,
            participants: userId
        }).select('_id hiddenFor participants').lean();

        if (!conv) {
            // ✅ debug: تحقق هل المحادثة موجودة لكن المستخدم ليس participant
            const convExists = await Conversation.findById(id).select('_id participants').lean();
            console.log(`[DEL-CONV] not found for user. convExists=${!!convExists}, participants=${convExists?.participants?.map(p=>p.toString())}`);
            return res.status(404).json({
                success: false,
                message: 'المحادثة غير موجودة أو لست مشاركاً فيها'
            });
        }

        // hidden مسبقاً؟
        const alreadyHidden = (conv.hiddenFor || []).some(h =>
            h.user && h.user.toString() === userId.toString()
        );
        if (!alreadyHidden) {
            await Conversation.updateOne(
                { _id: id },
                { $push: { hiddenFor: { user: userId, hiddenAt: new Date(), reason: 'user_delete' } } }
            );
        }

        return res.status(200).json({
            success: true,
            message: 'تم حذف المحادثة من قائمتك'
        });
    } catch (error) {
        console.error('خطأ في حذف المحادثة:', error);
        return res.status(500).json({
            success: false,
            message: 'خطأ في السيرفر'
        });
    }
});

// @route   GET /api/mobile/conversations/:id
// @desc    جلب محادثة واحدة بمعرّفها (للـ Smart Merge في iOS عند Socket events)
// @access  Private
router.get('/conversations/:id', protect, async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user._id;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'معرّف المحادثة غير صالح' });
        }

        const conv = await Conversation.findOne({
            _id: id,
            participants: userId,
            'hiddenFor.user': { $ne: userId }
        })
            .populate('participants', 'name email profileImage photos lastLogin isOnline isPremium verification.isVerified isActive bannedWords suspension')
            .populate('lastMessage')
            .select('+creator')
            .lean();

        if (!conv) {
            return res.status(404).json({ success: false, message: 'المحادثة غير موجودة' });
        }

        // قناع المشاركين المحظورين + thumbnails
        if (conv.participants) {
            conv.participants = conv.participants.map(p => {
                if (isUserFullyBanned(p)) return maskBannedUser(p);
                const mainPhoto = p.photos && p.photos.length > 0
                    ? (p.photos.find(ph => ph.order === 0) || p.photos[0])
                    : null;
                p.profileImage = mainPhoto && mainPhoto.thumbnail
                    ? getFullUrl(mainPhoto.thumbnail)
                    : getFullUrl(p.profileImage);
                delete p.photos;
                delete p.bannedWords;
                delete p.suspension;
                delete p.isActive;
                return p;
            });
        }

        // عدّ غير المقروءة لهذه المحادثة فقط
        const unreadCount = await Message.countDocuments({
            conversation: conv._id,
            sender: { $ne: new mongoose.Types.ObjectId(userId) },
            'readBy.user': { $ne: new mongoose.Types.ObjectId(userId) }
        });

        // initialMessage للطلبات المعلقة
        let initialMessage = null;
        if (conv.status === 'pending' && conv.creator && conv.creator.toString() !== userId.toString()) {
            const m = await Message.findOne({
                conversation: conv._id,
                sender: conv.creator,
                type: 'text',
                isDeleted: { $ne: true }
            }).sort({ createdAt: 1 }).select('content createdAt').lean();
            if (m) initialMessage = { content: m.content, createdAt: m.createdAt };
        }

        // إضافة isRead/isDelivered لـ lastMessage
        if (conv.lastMessage && conv.lastMessage.sender) {
            const senderId = conv.lastMessage.sender.toString();
            if (senderId === userId.toString()) {
                conv.lastMessage.isRead = conv.lastMessage.status === 'read' ||
                    (conv.lastMessage.readBy && conv.lastMessage.readBy.some(
                        r => r.user && r.user.toString() !== userId.toString()
                    ));
                conv.lastMessage.isDelivered = conv.lastMessage.isRead || conv.lastMessage.status === 'delivered';
            } else {
                conv.lastMessage.isRead = true;
                conv.lastMessage.isDelivered = true;
            }
        }

        res.json({
            success: true,
            data: {
                conversation: { ...conv, unreadCount, initialMessage }
            }
        });
    } catch (error) {
        console.error('خطأ في جلب المحادثة:', error);
        res.status(500).json({ success: false, message: 'خطأ في السيرفر' });
    }
});

// @route   PUT /api/mobile/conversations/:id/mute
// @desc    كتم/إلغاء كتم إشعارات محادثة
// @access  Private
router.put('/conversations/:id/mute', protect, async (req, res) => {
    try {
        const { id } = req.params;
        const { muted, mutedUntil } = req.body;
        const userId = req.user._id;

        // التحقق من وجود المحادثة وأن المستخدم مشارك فيها
        const conversation = await Conversation.findById(id).lean();
        if (!conversation) {
            return res.status(404).json({
                success: false,
                message: 'المحادثة غير موجودة'
            });
        }

        if (!conversation.participants.some(p => p.toString() === userId.toString())) {
            return res.status(403).json({
                success: false,
                message: 'غير مصرح لك بالوصول لهذه المحادثة'
            });
        }

        if (muted) {
            // إزالة أي كتم سابق لنفس المحادثة أولاً
            await User.findByIdAndUpdate(userId, {
                $pull: { mutedConversations: { conversationId: id } }
            });
            // إضافة للقائمة المكتومة
            await User.findByIdAndUpdate(userId, {
                $push: {
                    mutedConversations: {
                        conversationId: id,
                        mutedUntil: mutedUntil || null
                    }
                }
            });
        } else {
            // إزالة من القائمة المكتومة
            await User.findByIdAndUpdate(userId, {
                $pull: { mutedConversations: { conversationId: id } }
            });
        }

        res.json({
            success: true,
            muted,
            mutedUntil: muted ? (mutedUntil || null) : null,
            message: muted ? 'تم كتم المحادثة' : 'تم إلغاء كتم المحادثة'
        });
    } catch (error) {
        console.error('خطأ في كتم المحادثة:', error);
        res.status(500).json({
            success: false,
            message: 'فشل في تحديث حالة الكتم',
            error: error.message
        });
    }
});

// ==========================================
// أوضاع المحادثة (Chat Modes)
// ==========================================

// @route   PUT /api/mobile/conversations/:conversationId/chat-mode
// @desc    تغيير وضع المحادثة
// @access  Private
router.put('/conversations/:conversationId/chat-mode', protect, async (req, res) => {
    try {
        const { conversationId } = req.params;
        const { chatMode } = req.body; // 'snap' | '24h' | 'keep'
        const userId = req.user._id;

        if (!['snap', '24h', 'keep'].includes(chatMode)) {
            return res.status(400).json({ success: false, message: 'وضع غير صالح. استخدم: snap, 24h, keep' });
        }

        const conversation = await Conversation.findById(conversationId);
        if (!conversation) {
            return res.status(404).json({ success: false, message: 'المحادثة غير موجودة' });
        }

        const isParticipant = conversation.participants.some(
            p => p.toString() === userId.toString()
        );
        if (!isParticipant) {
            return res.status(403).json({ success: false, message: 'ليس لديك صلاحية' });
        }

        const oldMode = conversation.chatMode || 'snap';
        conversation.chatMode = chatMode;
        await conversation.save();

        const modeTextAr = chatMode === 'snap' ? 'حذف عند الخروج' :
                          chatMode === '24h' ? 'حذف بعد 24 ساعة' : 'الاحتفاظ دائماً';
        const modeTextEn = chatMode === 'snap' ? 'Delete on exit' :
                          chatMode === '24h' ? 'Delete after 24h' : 'Keep forever';

        // ✅ إنشاء رسالة نظام تظهر في المحادثة
        const systemMessage = await Message.create({
            conversation: conversationId,
            sender: req.user._id,
            type: 'system',
            content: JSON.stringify({
                action: 'chat_mode_changed',
                oldMode: oldMode,
                newMode: chatMode,
                textAr: `تم تغيير وضع المحادثة إلى: ${modeTextAr}`,
                textEn: `Chat mode changed to: ${modeTextEn}`
            })
        });

        const populatedSystem = await Message.findById(systemMessage._id)
            .populate('sender', 'name email profileImage isActive').lean();

        // إشعار الطرف الآخر عبر Socket
        if (global.io) {
            global.io.to(`conversation-${conversationId}`).emit('chat-mode-changed', {
                conversationId: conversationId,
                chatMode: chatMode,
                changedBy: req.user.name
            });
            // إرسال رسالة النظام كرسالة جديدة
            global.io.to(`conversation-${conversationId}`).emit('new-message', {
                message: populatedSystem
            });
        }

        // ✅ إرسال Push Notification للطرف الآخر
        try {
            const otherParticipant = conversation.participants.find(
                p => p.toString() !== userId.toString()
            );
            if (otherParticipant) {
                const modeIcon = chatMode === 'snap' ? '👻' : chatMode === '24h' ? '⏰' : '♾️';
                await pushNotificationService.sendNotificationToUser(otherParticipant, {
                    title: `${modeIcon} تم تغيير وضع المحادثة`,
                    body: `${req.user.name} غيّر وضع المحادثة إلى: ${modeTextAr}`,
                    type: 'chat_mode_changed'
                }, {
                    userId: userId.toString(),
                    type: 'chat_mode_changed',
                    conversationId: conversationId,
                    chatMode: chatMode
                });
            }
        } catch (notifError) {
            console.error('خطأ في إرسال إشعار تغيير وضع المحادثة:', notifError);
        }

        res.json({
            success: true,
            message: `تم تغيير وضع المحادثة إلى: ${modeTextAr}`,
            data: { chatMode, systemMessage: populatedSystem }
        });

    } catch (error) {
        console.error('Chat mode error:', error);
        res.status(500).json({ success: false, message: 'خطأ في السيرفر', error: error.message });
    }
});

// @route   POST /api/mobile/conversations/:conversationId/clear-messages
// @desc    مسح الرسائل للمستخدم (وضع سناب - عند الخروج)
// @access  Private
router.post('/conversations/:conversationId/clear-messages', protect, async (req, res) => {
    try {
        const { conversationId } = req.params;
        const userId = req.user._id;

        const conversation = await Conversation.findById(conversationId);
        if (!conversation) {
            return res.status(404).json({ success: false, message: 'المحادثة غير موجودة' });
        }

        const isParticipant = conversation.participants.some(
            p => p.toString() === userId.toString()
        );
        if (!isParticipant) {
            return res.status(403).json({ success: false, message: 'ليس لديك صلاحية' });
        }

        // ✅ مهم: الرسائل تبقى في السيرفر دائماً (للأدمن)
        // نحفظ تاريخ المسح لكل مستخدم — لا نعرض الرسائل القديمة عند إعادة فتح المحادثة
        const now = new Date();
        const clearIndex = conversation.clearedAt.findIndex(
            c => c.user.toString() === userId.toString()
        );
        if (clearIndex >= 0) {
            conversation.clearedAt[clearIndex].date = now;
        } else {
            conversation.clearedAt.push({ user: userId, date: now });
        }
        await conversation.save();

        res.json({
            success: true,
            message: 'تم مسح الرسائل من جهازك',
            data: {
                conversationId: conversationId,
                chatMode: conversation.chatMode,
                clearedAt: now
            }
        });

    } catch (error) {
        console.error('Clear messages error:', error);
        res.status(500).json({ success: false, message: 'خطأ في السيرفر', error: error.message });
    }
});

// @route   GET /api/mobile/conversations/:conversationId/chat-mode
// @desc    الحصول على وضع المحادثة الحالي
// @access  Private
router.get('/conversations/:conversationId/chat-mode', protect, async (req, res) => {
    try {
        const { conversationId } = req.params;
        const conversation = await Conversation.findById(conversationId, 'chatMode').lean();
        if (!conversation) {
            return res.status(404).json({ success: false, message: 'المحادثة غير موجودة' });
        }

        res.json({
            success: true,
            data: {
                chatMode: conversation.chatMode || 'snap',
                modes: [
                    { id: 'snap', nameAr: 'حذف عند الخروج', nameEn: 'Delete on exit', icon: '👻', isDefault: true },
                    { id: '24h', nameAr: 'حذف بعد 24 ساعة', nameEn: 'Delete after 24h', icon: '⏰', isDefault: false },
                    { id: 'keep', nameAr: 'الاحتفاظ دائماً', nameEn: 'Keep forever', icon: '💾', isDefault: false }
                ]
            }
        });

    } catch (error) {
        console.error('Get chat mode error:', error);
        res.status(500).json({ success: false, message: 'خطأ في السيرفر', error: error.message });
    }
});

// ═══════════════════════════════════════════════════════════════
// ✅ Best Friends — أفضل الأصدقاء حسب التفاعل
// (نُقل من mobile.js القديمة — كان غير مُسجّل في الـ modular routes)
// خوارزمية ذكية: عدد الرسائل المتبادلة + balance + recency.
// ═══════════════════════════════════════════════════════════════
router.get('/best-friends', protect, async (req, res) => {
    try {
        const userId = req.user._id;

        // ✅ المجاني: 3 أصدقاء | Premium: حتى 20
        const me = await User.findById(userId).select('isPremium premiumExpiresAt');
        const isPremium = !!(me && me.isPremium && (!me.premiumExpiresAt || new Date(me.premiumExpiresAt) > new Date()));
        const FREE_LIMIT = 3;
        const PREMIUM_MAX = 20;
        const requested = parseInt(req.query.limit) || (isPremium ? 8 : FREE_LIMIT);
        const limit = isPremium ? Math.min(requested, PREMIUM_MAX) : FREE_LIMIT;

        // 1. جلب كل المحادثات النشطة للمستخدم
        const conversations = await Conversation.find({
            participants: userId,
            status: 'accepted',
            isActive: true
        }).select('_id participants').lean();

        if (conversations.length === 0) {
            return res.json({ success: true, data: { friends: [], totalAvailable: 0, isPremium, freeLimit: FREE_LIMIT } });
        }

        const convIds = conversations.map(c => c._id);

        // 2. حساب الـ score لكل محادثة (عدد الرسائل آخر 30 يوم)
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const messageCounts = await Message.aggregate([
            {
                $match: {
                    conversation: { $in: convIds },
                    createdAt: { $gte: thirtyDaysAgo },
                    isDeleted: false
                }
            },
            {
                $group: {
                    _id: '$conversation',
                    messageCount: { $sum: 1 },
                    lastMessageAt: { $max: '$createdAt' },
                    myMessages: {
                        $sum: { $cond: [{ $eq: ['$sender', userId] }, 1, 0] }
                    }
                }
            }
        ]);

        const scoreMap = {};
        for (const item of messageCounts) {
            const total = item.messageCount;
            const mine = item.myMessages;
            const theirs = total - mine;
            const balance = (mine > 0 && theirs > 0) ? Math.min(mine, theirs) / Math.max(mine, theirs) : 0;
            const recencyBonus = item.lastMessageAt
                ? Math.max(0, 7 - Math.floor((Date.now() - new Date(item.lastMessageAt).getTime()) / (24 * 60 * 60 * 1000)))
                : 0;
            scoreMap[item._id.toString()] = {
                score: Math.round((total * balance * 10) + (recencyBonus * 5)),
                messageCount: total,
                lastMessageAt: item.lastMessageAt
            };
        }

        // 3. ترتيب المحادثات حسب الـ score
        const allRanked = conversations
            .map(conv => {
                const stats = scoreMap[conv._id.toString()] || { score: 0, messageCount: 0, lastMessageAt: null };
                const otherId = conv.participants.find(p => p.toString() !== userId.toString());
                return {
                    conversationId: conv._id,
                    otherId,
                    score: stats.score,
                    messageCount: stats.messageCount,
                    lastMessageAt: stats.lastMessageAt
                };
            })
            .filter(c => c.score > 0)
            .sort((a, b) => b.score - a.score);

        const totalAvailable = allRanked.length;
        const ranked = allRanked.slice(0, limit);

        if (ranked.length === 0) {
            return res.json({
                success: true,
                data: { friends: [], totalAvailable: 0, isPremium, freeLimit: FREE_LIMIT }
            });
        }

        // 4. جلب بيانات المستخدمين (مع احترام showLastSeen + stealthMode)
        const userIds = ranked.map(r => r.otherId);
        const users = await User.find({ _id: { $in: userIds } })
            .select('name profileImage photos isOnline lastLogin isPremium verification.isVerified privacySettings stealthMode')
            .lean();

        const userMap = {};
        users.forEach(u => {
            const mainPhoto = u.photos && u.photos.length > 0
                ? (u.photos.find(p => p.order === 0) || u.photos[0])
                : null;
            const baseUrl = process.env.BASE_URL || 'https://matchhala.chathala.com';
            const profileImage = mainPhoto && mainPhoto.thumbnail
                ? (mainPhoto.thumbnail.startsWith('http') ? mainPhoto.thumbnail : baseUrl + mainPhoto.thumbnail)
                : (u.profileImage ? (u.profileImage.startsWith('http') ? u.profileImage : baseUrl + u.profileImage) : null);

            // ✅ احترام إعداد showLastSeen + stealthMode (Premium)
            const hidePresence = u.privacySettings?.showLastSeen === false || u.stealthMode === true;

            userMap[u._id.toString()] = {
                _id: u._id,
                name: u.name,
                profileImage,
                isOnline: hidePresence ? false : u.isOnline,
                lastLogin: hidePresence ? null : u.lastLogin,
                isPremium: u.isPremium,
                isVerified: u.verification?.isVerified || false
            };
        });

        // 5. تركيب النتيجة النهائية
        const friends = ranked.map((r, idx) => {
            const user = userMap[r.otherId.toString()];
            if (!user) return null;
            return {
                rank: idx + 1,
                badge: idx === 0 ? '👑' : (idx === 1 ? '🥈' : (idx === 2 ? '🥉' : '⭐')),
                conversationId: r.conversationId,
                user,
                score: r.score,
                messageCount: r.messageCount
            };
        }).filter(Boolean);

        res.json({
            success: true,
            data: {
                friends,
                totalCount: friends.length,
                totalAvailable,
                isPremium,
                freeLimit: FREE_LIMIT
            }
        });
    } catch (error) {
        console.error('best-friends error:', error);
        res.status(500).json({ success: false, message: 'خطأ في الخادم' });
    }
});

module.exports = router;
