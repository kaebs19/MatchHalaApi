// HalaChat Dashboard - Messages Routes
// مسارات API الخاصة بالرسائل

const express = require('express');
const router = express.Router();
const Message = require('../models/Message');
const Conversation = require('../models/Conversation');
const { protect, adminOnly } = require('../middleware/auth');
const path = require('path');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');

// ✅ أرشيف الصور المؤقتة المنتهية — خارج /uploads فلا يُخدَم للمستخدمين
const EXPIRED_DIR = path.join(__dirname, '..', 'uploads', '_expired');

// ✅ الصورة المؤقتة تختفي عن الطرفين لكنها تبقى للإشراف
const { withExpiredPhotoForAdmin } = require('../utils/expiredPhotoAdmin');

// @route   GET /api/messages/conversation/:conversationId
// @desc    جلب جميع رسائل محادثة معينة
// @access  Admin
router.get('/conversation/:conversationId', protect, adminOnly, async (req, res) => {
    try {
        const { conversationId } = req.params;
        const { page = 1, limit = 50, search = '' } = req.query;

        // ✅ التحقق من صحة الـ ID
        const mongoose = require('mongoose');
        if (!mongoose.Types.ObjectId.isValid(conversationId)) {
            return res.status(400).json({
                success: false,
                message: 'معرّف المحادثة غير صالح'
            });
        }

        // التحقق من وجود المحادثة
        const conversation = await Conversation.findById(conversationId);
        if (!conversation) {
            return res.status(404).json({
                success: false,
                message: 'المحادثة غير موجودة'
            });
        }

        // بناء الفلتر
        const filter = {
            conversation: conversationId
        };

        // البحث في المحتوى
        if (search) {
            filter.content = { $regex: search, $options: 'i' };
        }

        // الحصول على الرسائل مع pagination
        const messages = await Message.find(filter)
            .populate('sender', 'name email profileImage')
            .sort({ createdAt: -1 })
            .limit(limit * 1)
            .skip((page - 1) * limit);

        // عدد الرسائل الكلي
        const total = await Message.countDocuments(filter);

        res.json({
            success: true,
            data: {
                messages: messages.map(withExpiredPhotoForAdmin),
                currentPage: page,
                totalPages: Math.ceil(total / limit),
                totalMessages: total
            }
        });
    } catch (error) {
        console.error('خطأ في جلب الرسائل:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في جلب الرسائل',
            error: error.message
        });
    }
});

// @route   GET /api/messages/:id/expired-photo
// @desc    عرض صورة مؤقتة انتهت — للإشراف فقط (الملف في /uploads/_expired خارج الويب)
// @access  Admin
// ملاحظة: <img src> لا يرسل هيدر Authorization، لذا نقبل التوكن من ?token= أيضاً
router.get('/:id/expired-photo', async (req, res) => {
    try {
        const bearer = req.headers.authorization?.startsWith('Bearer')
            ? req.headers.authorization.split(' ')[1]
            : null;
        const token = bearer || req.query.token;
        if (!token) {
            return res.status(401).json({ success: false, message: 'غير مصرح' });
        }

        let admin;
        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            admin = await User.findById(decoded.id).select('role');
        } catch (e) {
            return res.status(401).json({ success: false, message: 'توكن غير صالح' });
        }
        if (!admin || admin.role !== 'admin') {
            return res.status(403).json({ success: false, message: 'صلاحيات غير كافية' });
        }

        const message = await Message.findById(req.params.id).select('disappearing').lean();
        const archived = message?.disappearing?.archivedPath;
        if (!archived) {
            return res.status(404).json({ success: false, message: 'لا يوجد أرشيف لهذه الصورة' });
        }

        // حماية من path traversal — اسم الملف فقط
        const filePath = path.join(EXPIRED_DIR, path.basename(archived));
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ success: false, message: 'الملف غير موجود في الأرشيف' });
        }

        return res.sendFile(filePath);
    } catch (error) {
        console.error('خطأ في جلب صورة الأرشيف:', error);
        res.status(500).json({ success: false, message: 'خطأ في السيرفر' });
    }
});

// @route   GET /api/messages/:id
// @desc    جلب رسالة واحدة
// @access  Admin
router.get('/:id', protect, adminOnly, async (req, res) => {
    try {
        const message = await Message.findById(req.params.id)
            .populate('sender', 'name email profileImage')
            .populate('conversation', 'title type');

        if (!message) {
            return res.status(404).json({
                success: false,
                message: 'الرسالة غير موجودة'
            });
        }

        res.json({
            success: true,
            data: message
        });
    } catch (error) {
        console.error('خطأ في جلب الرسالة:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في جلب الرسالة',
            error: error.message
        });
    }
});

// @route   DELETE /api/messages/:id
// @desc    حذف رسالة واحدة (soft delete)
// @access  Admin
router.delete('/:id', protect, adminOnly, async (req, res) => {
    try {
        const message = await Message.findById(req.params.id);

        if (!message) {
            return res.status(404).json({
                success: false,
                message: 'الرسالة غير موجودة'
            });
        }

        // استخدام الحذف الناعم
        await message.softDelete();

        res.json({
            success: true,
            message: 'تم حذف الرسالة بنجاح'
        });
    } catch (error) {
        console.error('خطأ في حذف الرسالة:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في حذف الرسالة',
            error: error.message
        });
    }
});

// @route   DELETE /api/messages/:id/permanent
// @desc    حذف رسالة نهائياً
// @access  Admin
router.delete('/:id/permanent', protect, adminOnly, async (req, res) => {
    try {
        const message = await Message.findById(req.params.id);

        if (!message) {
            return res.status(404).json({
                success: false,
                message: 'الرسالة غير موجودة'
            });
        }

        await Message.findByIdAndDelete(req.params.id);

        res.json({
            success: true,
            message: 'تم حذف الرسالة نهائياً'
        });
    } catch (error) {
        console.error('خطأ في حذف الرسالة:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في حذف الرسالة',
            error: error.message
        });
    }
});

// @route   POST /api/messages/send
// @desc    إرسال رسالة جديدة (مع Socket.IO)
// @access  Admin (للتجربة)
router.post('/send', protect, adminOnly, async (req, res) => {
    try {
        const { conversationId, content, type = 'text' } = req.body;

        // التحقق من وجود المحادثة
        const conversation = await Conversation.findById(conversationId);
        if (!conversation) {
            return res.status(404).json({
                success: false,
                message: 'المحادثة غير موجودة'
            });
        }

        // إنشاء الرسالة
        const message = await Message.create({
            conversation: conversationId,
            sender: req.user._id,
            content,
            type,
            isDeleted: false
        });

        // جلب الرسالة مع بيانات المرسل
        const populatedMessage = await Message.findById(message._id)
            .populate('sender', 'name email profileImage');

        // إرسال الرسالة عبر Socket.IO لكل المتصلين بهذه المحادثة
        if (global.io) {
            global.io.to(`conversation-${conversationId}`).emit('new-message', {
                message: populatedMessage
            });
        }

        res.json({
            success: true,
            message: 'تم إرسال الرسالة بنجاح',
            data: populatedMessage
        });
    } catch (error) {
        console.error('خطأ في إرسال الرسالة:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في إرسال الرسالة',
            error: error.message
        });
    }
});

// @route   GET /api/messages/stats/:conversationId
// @desc    إحصائيات رسائل محادثة
// @access  Admin
router.get('/stats/:conversationId', protect, adminOnly, async (req, res) => {
    try {
        const { conversationId } = req.params;

        const mongoose = require('mongoose');
        const stats = {
            totalMessages: await Message.countDocuments({ conversation: conversationId }),
            deletedMessages: await Message.countDocuments({ conversation: conversationId, isDeleted: true }),
            activeMessages: await Message.countDocuments({ conversation: conversationId, isDeleted: false }),
            messagesByType: await Message.aggregate([
                { $match: { conversation: new mongoose.Types.ObjectId(conversationId) } },
                { $group: { _id: '$type', count: { $sum: 1 } } }
            ])
        };

        res.json({
            success: true,
            data: stats
        });
    } catch (error) {
        console.error('خطأ في جلب الإحصائيات:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في جلب الإحصائيات',
            error: error.message
        });
    }
});

module.exports = router;
