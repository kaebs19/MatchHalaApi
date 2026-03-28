// HalaChat Dashboard - Conversations Routes
// المسارات الخاصة بإدارة المحادثات

const express = require('express');
const router = express.Router();
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const { protect, adminOnly } = require('../middleware/auth');

// @route   GET /api/conversations
// @desc    الحصول على جميع المحادثات
// @access  Private/Admin
router.get('/', protect, adminOnly, async (req, res) => {
    try {
        const { page = 1, limit = 20, type, isActive, status, search, hasFlaggedMessages, sortBy = 'updatedAt' } = req.query;
        const pageNum = parseInt(page);
        const limitNum = parseInt(limit);

        // بناء الفلتر
        const filter = {};
        if (type) filter.type = type;
        if (isActive !== undefined) filter.isActive = isActive === 'true';
        if (status) filter.status = status;

        // بحث بالاسم
        let participantIds = null;
        if (search) {
            const User = require('../models/User');
            const matchingUsers = await User.find({
                $or: [
                    { name: { $regex: search, $options: 'i' } },
                    { email: { $regex: search, $options: 'i' } }
                ]
            }).select('_id');
            participantIds = matchingUsers.map(u => u._id);
            if (participantIds.length > 0) {
                filter.participants = { $in: participantIds };
            } else {
                return res.status(200).json({
                    success: true,
                    data: { conversations: [], totalPages: 0, currentPage: pageNum, total: 0 }
                });
            }
        }

        // فلترة المحادثات التي تحتوي رسائل محظورة
        let flaggedConvIds = null;
        if (hasFlaggedMessages === 'true') {
            const FlaggedMessage = require('../models/FlaggedMessage');
            const flaggedAgg = await FlaggedMessage.aggregate([
                { $group: { _id: '$conversation' } }
            ]);
            flaggedConvIds = flaggedAgg.map(f => f._id);
            filter._id = { $in: flaggedConvIds };
        }

        // ترتيب
        const sortOptions = {};
        if (sortBy === 'messages') {
            sortOptions['metadata.totalMessages'] = -1;
        } else if (sortBy === 'oldest') {
            sortOptions.createdAt = 1;
        } else {
            sortOptions.updatedAt = -1;
        }

        const conversations = await Conversation.find(filter)
            .populate('participants', 'name email profileImage isPremium isOnline lastLogin verification.isVerified bannedWords.isBanned')
            .populate({
                path: 'lastMessage',
                populate: { path: 'sender', select: 'name' }
            })
            .sort(sortOptions)
            .limit(limitNum)
            .skip((pageNum - 1) * limitNum);

        const count = await Conversation.countDocuments(filter);

        // جلب عدد الرسائل المحظورة لكل محادثة
        const FlaggedMessage = require('../models/FlaggedMessage');
        const convIds = conversations.map(c => c._id);
        const flaggedCounts = await FlaggedMessage.aggregate([
            { $match: { conversation: { $in: convIds } } },
            { $group: { _id: '$conversation', count: { $sum: 1 } } }
        ]);
        const flaggedMap = {};
        flaggedCounts.forEach(f => { flaggedMap[f._id.toString()] = f.count; });

        // جلب عدد الرسائل لكل محادثة
        const messageCounts = await Message.aggregate([
            { $match: { conversation: { $in: convIds }, isDeleted: false } },
            { $group: { _id: '$conversation', count: { $sum: 1 } } }
        ]);
        const msgCountMap = {};
        messageCounts.forEach(m => { msgCountMap[m._id.toString()] = m.count; });

        // جلب عدد الصور لكل محادثة
        const imageCounts = await Message.aggregate([
            { $match: { conversation: { $in: convIds }, type: 'image', isDeleted: false } },
            { $group: { _id: '$conversation', count: { $sum: 1 } } }
        ]);
        const imgCountMap = {};
        imageCounts.forEach(i => { imgCountMap[i._id.toString()] = i.count; });

        // إضافة العدادات
        const enriched = conversations.map(c => {
            const obj = c.toObject();
            obj.flaggedMessagesCount = flaggedMap[c._id.toString()] || 0;
            obj.messagesCount = msgCountMap[c._id.toString()] || 0;
            obj.imagesCount = imgCountMap[c._id.toString()] || 0;
            return obj;
        });

        res.status(200).json({
            success: true,
            data: {
                conversations: enriched,
                totalPages: Math.ceil(count / limitNum),
                currentPage: pageNum,
                total: count
            }
        });

    } catch (error) {
        console.error('خطأ في جلب المحادثات:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في السيرفر'
        });
    }
});

// @route   GET /api/conversations/stats/overview
// @desc    الحصول على إحصائيات المحادثات
// @access  Private/Admin
router.get('/stats/overview', protect, adminOnly, async (req, res) => {
    try {
        const FlaggedMessage = require('../models/FlaggedMessage');
        const [
            totalConversations, activeConversations, totalMessages,
            privateConversations, groupConversations, pendingConversations,
            lockedConversations, totalImages, flaggedMessagesCount, todayMessages
        ] = await Promise.all([
            Conversation.countDocuments(),
            Conversation.countDocuments({ isActive: true }),
            Message.countDocuments({ isDeleted: false }),
            Conversation.countDocuments({ type: 'private' }),
            Conversation.countDocuments({ type: 'group' }),
            Conversation.countDocuments({ status: 'pending' }),
            Conversation.countDocuments({ isLocked: true }),
            Message.countDocuments({ type: 'image', isDeleted: false }),
            FlaggedMessage.countDocuments(),
            Message.countDocuments({
                isDeleted: false,
                createdAt: { $gte: new Date(new Date().setHours(0, 0, 0, 0)) }
            })
        ]);

        res.status(200).json({
            success: true,
            data: {
                totalConversations, activeConversations, totalMessages,
                privateConversations, groupConversations, pendingConversations,
                lockedConversations, totalImages, flaggedMessagesCount, todayMessages
            }
        });
    } catch (error) {
        console.error('خطأ في جلب الإحصائيات:', error);
        res.status(500).json({ success: false, message: 'خطأ في السيرفر' });
    }
});

// @route   GET /api/conversations/:id
// @desc    الحصول على محادثة واحدة مع رسائلها
// @access  Private/Admin
router.get('/:id', protect, adminOnly, async (req, res) => {
    try {
        const conversation = await Conversation.findById(req.params.id)
            .populate('participants', 'name email profileImage isPremium isOnline lastLogin verification.isVerified bannedWords.isBanned');

        if (!conversation) {
            return res.status(404).json({
                success: false,
                message: 'المحادثة غير موجودة'
            });
        }

        // إحصائيات المحادثة
        const FlaggedMessage = require('../models/FlaggedMessage');
        const [totalMessages, imageMessages, flaggedMessages] = await Promise.all([
            Message.countDocuments({ conversation: req.params.id, isDeleted: false }),
            Message.countDocuments({ conversation: req.params.id, type: 'image', isDeleted: false }),
            FlaggedMessage.countDocuments({ conversation: req.params.id })
        ]);

        res.status(200).json({
            success: true,
            data: {
                conversation,
                stats: { totalMessages, imageMessages, flaggedMessages }
            }
        });

    } catch (error) {
        console.error('خطأ في جلب المحادثة:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في السيرفر'
        });
    }
});

// @route   DELETE /api/conversations/:id
// @desc    حذف محادثة
// @access  Private/Admin
router.delete('/:id', protect, adminOnly, async (req, res) => {
    try {
        const conversation = await Conversation.findById(req.params.id);

        if (!conversation) {
            return res.status(404).json({
                success: false,
                message: 'المحادثة غير موجودة'
            });
        }

        // حذف جميع رسائل المحادثة
        await Message.deleteMany({ conversation: req.params.id });

        // حذف المحادثة
        await conversation.deleteOne();

        res.status(200).json({
            success: true,
            message: 'تم حذف المحادثة بنجاح'
        });

    } catch (error) {
        console.error('خطأ في حذف المحادثة:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في السيرفر'
        });
    }
});

// @route   PUT /api/conversations/:id/toggle-active
// @desc    تفعيل/إلغاء تفعيل محادثة
// @access  Private/Admin
router.put('/:id/toggle-active', protect, adminOnly, async (req, res) => {
    try {
        const conversation = await Conversation.findById(req.params.id);

        if (!conversation) {
            return res.status(404).json({
                success: false,
                message: 'المحادثة غير موجودة'
            });
        }

        conversation.isActive = !conversation.isActive;
        await conversation.save();

        res.status(200).json({
            success: true,
            message: conversation.isActive ? 'تم تفعيل المحادثة' : 'تم إيقاف المحادثة',
            data: { conversation }
        });

    } catch (error) {
        console.error('خطأ في تحديث المحادثة:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في السيرفر'
        });
    }
});

// @route   POST /api/conversations/create-group
// @desc    إنشاء مجموعة جديدة
// @access  Private/Admin
router.post('/create-group', protect, adminOnly, async (req, res) => {
    try {
        const { title, description, participants, groupImage } = req.body;

        if (!title || !participants || participants.length < 2) {
            return res.status(400).json({
                success: false,
                message: 'يجب توفير عنوان ومشاركين (2 على الأقل)'
            });
        }

        const conversation = await Conversation.create({
            title,
            description: description || '',
            type: 'group',
            participants,
            admins: [req.user._id],
            creator: req.user._id,
            groupImage: groupImage || null,
            metadata: {
                totalParticipants: participants.length
            }
        });

        const populatedConversation = await Conversation.findById(conversation._id)
            .populate('participants', 'name email')
            .populate('creator', 'name email');

        res.status(201).json({
            success: true,
            message: 'تم إنشاء المجموعة بنجاح',
            data: { conversation: populatedConversation }
        });

    } catch (error) {
        console.error('خطأ في إنشاء المجموعة:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في السيرفر'
        });
    }
});

// @route   PUT /api/conversations/:id/lock
// @desc    قفل/فتح محادثة
// @access  Private/Admin
router.put('/:id/lock', protect, adminOnly, async (req, res) => {
    try {
        const conversation = await Conversation.findById(req.params.id);

        if (!conversation) {
            return res.status(404).json({
                success: false,
                message: 'المحادثة غير موجودة'
            });
        }

        conversation.isLocked = !conversation.isLocked;
        if (conversation.isLocked) {
            conversation.settings.allowMembersToSend = false;
        }

        await conversation.save();

        res.status(200).json({
            success: true,
            message: conversation.isLocked ? 'تم قفل المحادثة' : 'تم فتح المحادثة',
            data: { conversation }
        });

    } catch (error) {
        console.error('خطأ في قفل المحادثة:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في السيرفر'
        });
    }
});

// @route   PUT /api/conversations/:id/settings
// @desc    تحديث إعدادات المحادثة
// @access  Private/Admin
router.put('/:id/settings', protect, adminOnly, async (req, res) => {
    try {
        const { settings } = req.body;

        const conversation = await Conversation.findById(req.params.id);

        if (!conversation) {
            return res.status(404).json({
                success: false,
                message: 'المحادثة غير موجودة'
            });
        }

        if (settings) {
            conversation.settings = {
                ...conversation.settings,
                ...settings
            };
        }

        await conversation.save();

        res.status(200).json({
            success: true,
            message: 'تم تحديث الإعدادات',
            data: { conversation }
        });

    } catch (error) {
        console.error('خطأ في تحديث الإعدادات:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في السيرفر'
        });
    }
});

// @route   DELETE /api/conversations/:id/messages
// @desc    حذف جميع رسائل المحادثة
// @access  Private/Admin
router.delete('/:id/messages', protect, adminOnly, async (req, res) => {
    try {
        const conversation = await Conversation.findById(req.params.id);

        if (!conversation) {
            return res.status(404).json({
                success: false,
                message: 'المحادثة غير موجودة'
            });
        }

        const result = await Message.updateMany(
            { conversation: req.params.id },
            { isDeleted: true }
        );

        conversation.metadata.totalMessages = 0;
        await conversation.save();

        res.status(200).json({
            success: true,
            message: `تم حذف ${result.modifiedCount} رسالة`,
            data: { deletedCount: result.modifiedCount }
        });

    } catch (error) {
        console.error('خطأ في حذف الرسائل:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في السيرفر'
        });
    }
});

// @route   GET /api/conversations/:id/reports
// @desc    الحصول على بلاغات المحادثة
// @access  Private/Admin
router.get('/:id/reports', protect, adminOnly, async (req, res) => {
    try {
        const Report = require('../models/Report');

        const reports = await Report.find({
            reportedConversation: req.params.id
        })
            .populate('reportedBy', 'name email')
            .populate('reportedUser', 'name email')
            .sort({ createdAt: -1 });

        res.status(200).json({
            success: true,
            data: { reports }
        });

    } catch (error) {
        console.error('خطأ في جلب البلاغات:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في السيرفر'
        });
    }
});

module.exports = router;
