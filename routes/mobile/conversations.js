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
const { getFullUrl, getBestUserImage } = require('./helpers');
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

        // التحقق من عدم وجود محادثة سابقة
        const existingConversation = await Conversation.findOne({
            type: 'private',
            participants: { $all: [req.user._id, targetUserId] }
        }).lean();

        if (existingConversation) {
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
            .populate('participants', 'name email deviceToken');

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
        const conversations = await Conversation.find({
            participants: req.user._id,
            creator: { $ne: req.user._id },
            status: 'pending'
        })
            .populate('creator', 'name email profileImage verification.isVerified isPremium')
            .populate('participants', 'name email profileImage lastLogin isOnline isPremium isActive verification.isVerified')
            .sort({ createdAt: -1 })
            .lean();

        // إضافة حقل isSuperLike لكل طلب
        const creatorIds = conversations.map(c => c.creator._id);
        const superLikes = await SuperLike.find({
            receiver: req.user._id,
            sender: { $in: creatorIds }
        }).lean();
        const superLikeSet = new Set(superLikes.map(sl => sl.sender.toString()));

        // جلب أول رسالة نصية من المُرسل لكل طلب (رسالة الطلب الأولية)
        const conversationIds = conversations.map(c => c._id);
        const initialMessages = await Message.aggregate([
            {
                $match: {
                    conversation: { $in: conversationIds },
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
        const initialMessageMap = new Map();
        initialMessages.forEach(m => {
            // نتأكد أن الرسالة من المُرسل (منشئ الطلب)
            const conv = conversations.find(c => c._id.toString() === m._id.toString());
            if (conv && m.sender.toString() === conv.creator._id.toString()) {
                initialMessageMap.set(m._id.toString(), {
                    content: m.content,
                    createdAt: m.createdAt
                });
            }
        });

        const enrichedConversations = conversations.map(conv => {
            const convObj = { ...conv };
            convObj.isSuperLike = superLikeSet.has(conv.creator._id.toString());
            convObj.creator.isVerified = conv.creator.verification?.isVerified || false;
            convObj.initialMessage = initialMessageMap.get(conv._id.toString()) || null;
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

        const total = await Conversation.countDocuments({
            participants: userId,
            creator: { $ne: userId },
            status: 'pending'
        });

        // العدد الجديد (آخر 24 ساعة)
        const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const recent = await Conversation.countDocuments({
            participants: userId,
            creator: { $ne: userId },
            status: 'pending',
            createdAt: { $gte: dayAgo }
        });

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

        const conv = await Conversation.findById(req.params.id);
        if (!conv) return res.status(404).json({ success: false, message: 'الطلب غير موجود' });
        if (conv.status !== 'pending') {
            return res.status(400).json({ success: false, message: 'الطلب ليس قيد الانتظار' });
        }
        if (!conv.participants.some(p => p.toString() === userId.toString())) {
            return res.status(403).json({ success: false, message: 'ليس لديك صلاحية' });
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
        const { page = 1, limit = 20 } = req.query;
        const userId = req.user._id;

        const convFilter = {
            participants: userId,
            status: { $in: ['accepted', 'pending', 'rejected'] },
            // ✅ استبعاد المحادثات المخفية عن هذا المستخدم
            'hiddenFor.user': { $ne: userId }
        };

        // ETag: التحقق من آخر تعديل
        const lastConv = await Conversation.findOne(convFilter).sort({ updatedAt: -1 }).select('updatedAt').lean();
        const lastModified = lastConv ? lastConv.updatedAt : new Date(0);
        const ifModifiedSince = req.headers['if-modified-since'];

        if (ifModifiedSince && lastModified <= new Date(ifModifiedSince)) {
            return res.status(304).end();
        }

        res.set('Last-Modified', lastModified.toUTCString());

        const conversations = await Conversation.find(convFilter)
            .populate('participants', 'name email profileImage photos lastLogin isOnline isPremium verification.isVerified')
            .populate('lastMessage')
            .select('+creator')
            .sort({ updatedAt: -1 })
            .limit(limit * 1)
            .skip((page - 1) * limit)
            .lean(); // استخدام lean للتعديل على النتائج

        // تحويل صور المشاركين إلى thumbnails
        for (const conv of conversations) {
            if (conv.participants) {
                for (const p of conv.participants) {
                    const mainPhoto = p.photos && p.photos.length > 0
                        ? (p.photos.find(ph => ph.order === 0) || p.photos[0])
                        : null;
                    p.profileImage = mainPhoto && mainPhoto.thumbnail
                        ? getFullUrl(mainPhoto.thumbnail)
                        : getFullUrl(p.profileImage);
                    delete p.photos;
                }
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
                totalPages: Math.ceil(total / limit)
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

module.exports = router;
