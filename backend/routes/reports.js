// HalaChat Dashboard - Reports Routes
// المسارات الخاصة بإدارة البلاغات

const express = require('express');
const router = express.Router();
const Report = require('../models/Report');
const User = require('../models/User');
const Message = require('../models/Message');
const Conversation = require('../models/Conversation');
const { protect, adminOnly } = require('../middleware/auth');

// @route   GET /api/reports
// @desc    الحصول على جميع البلاغات
// @access  Private/Admin
router.get('/', protect, adminOnly, async (req, res) => {
    try {
        const {
            page = 1,
            limit = 20,
            status,
            priority,
            type,
            category
        } = req.query;

        // بناء الفلتر
        const filter = {};
        if (status) filter.status = status;
        if (priority) filter.priority = priority;
        if (type) filter.type = type;
        if (category) filter.category = category;

        const reports = await Report.find(filter)
            .populate('reportedBy', 'name email')
            .populate('reportedUser', 'name email isActive')
            .populate('reportedConversation', 'title type')
            .populate({
                path: 'reportedMessage',
                select: 'content type mediaUrl sender createdAt',
                populate: { path: 'sender', select: 'name' }
            })
            .populate('assignedTo', 'name')
            .populate('resolvedBy', 'name')
            .sort({ createdAt: -1 })
            .limit(limit * 1)
            .skip((page - 1) * limit);

        const count = await Report.countDocuments(filter);

        res.status(200).json({
            success: true,
            data: {
                reports,
                totalPages: Math.ceil(count / limit),
                currentPage: page,
                total: count
            }
        });

    } catch (error) {
        console.error('خطأ في جلب البلاغات:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في السيرفر'
        });
    }
});

// @route   GET /api/reports/stats
// @desc    إحصائيات البلاغات
// @access  Private/Admin
router.get('/stats', protect, adminOnly, async (req, res) => {
    try {
        const totalReports = await Report.countDocuments();
        const pendingReports = await Report.countDocuments({ status: 'pending' });
        const reviewingReports = await Report.countDocuments({ status: 'reviewing' });
        const resolvedReports = await Report.countDocuments({ status: 'resolved' });
        const urgentReports = await Report.countDocuments({ priority: 'urgent', status: { $in: ['pending', 'reviewing'] } });

        // تصنيف البلاغات حسب النوع
        const reportsByType = await Report.aggregate([
            {
                $group: {
                    _id: '$type',
                    count: { $sum: 1 }
                }
            }
        ]);

        // تصنيف البلاغات حسب الفئة
        const reportsByCategory = await Report.aggregate([
            {
                $group: {
                    _id: '$category',
                    count: { $sum: 1 }
                }
            }
        ]);

        res.status(200).json({
            success: true,
            data: {
                totalReports,
                pendingReports,
                reviewingReports,
                resolvedReports,
                urgentReports,
                reportsByType,
                reportsByCategory
            }
        });

    } catch (error) {
        console.error('خطأ في جلب إحصائيات البلاغات:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في السيرفر'
        });
    }
});

// @route   GET /api/reports/:id
// @desc    الحصول على بلاغ واحد
// @access  Private/Admin
router.get('/:id', protect, adminOnly, async (req, res) => {
    try {
        const report = await Report.findById(req.params.id)
            .populate('reportedBy', 'name email createdAt')
            .populate('reportedUser', 'name email isActive role')
            .populate('reportedMessage')
            .populate('reportedConversation')
            .populate('assignedTo', 'name email')
            .populate('resolvedBy', 'name email');

        if (!report) {
            return res.status(404).json({
                success: false,
                message: 'البلاغ غير موجود'
            });
        }

        res.status(200).json({
            success: true,
            data: { report }
        });

    } catch (error) {
        console.error('خطأ في جلب البلاغ:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في السيرفر'
        });
    }
});

// @route   PUT /api/reports/:id/status
// @desc    تحديث حالة البلاغ
// @access  Private/Admin
router.put('/:id/status', protect, adminOnly, async (req, res) => {
    try {
        const { status, reviewNotes } = req.body;

        const report = await Report.findById(req.params.id);

        if (!report) {
            return res.status(404).json({
                success: false,
                message: 'البلاغ غير موجود'
            });
        }

        report.status = status;
        if (reviewNotes) report.reviewNotes = reviewNotes;

        if (status === 'reviewing' && !report.assignedTo) {
            report.assignedTo = req.user._id;
        }

        if (status === 'resolved' || status === 'rejected') {
            report.resolvedBy = req.user._id;
            report.resolvedAt = Date.now();
        }

        await report.save();

        res.status(200).json({
            success: true,
            message: 'تم تحديث حالة البلاغ',
            data: { report }
        });

    } catch (error) {
        console.error('خطأ في تحديث البلاغ:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في السيرفر'
        });
    }
});

// @route   PUT /api/reports/:id/action
// @desc    اتخاذ إجراء على البلاغ
// @access  Private/Admin
router.put('/:id/action', protect, adminOnly, async (req, res) => {
    try {
        const { action, reviewNotes } = req.body;

        const report = await Report.findById(req.params.id)
            .populate('reportedUser')
            .populate('reportedMessage')
            .populate('reportedConversation');

        if (!report) {
            return res.status(404).json({
                success: false,
                message: 'البلاغ غير موجود'
            });
        }

        report.action = action;
        report.actionDate = Date.now();
        report.status = 'resolved';
        report.resolvedBy = req.user._id;
        report.resolvedAt = Date.now();
        if (reviewNotes) report.reviewNotes = reviewNotes;

        // تنفيذ الإجراء
        switch (action) {
            case 'message_deleted':
                if (report.reportedMessage) {
                    await Message.findByIdAndUpdate(report.reportedMessage, {
                        isDeleted: true
                    });
                }
                break;

            case 'user_suspended':
                if (report.reportedUser) {
                    await User.findByIdAndUpdate(report.reportedUser, {
                        isActive: false
                    });
                }
                break;

            case 'user_banned':
                if (report.reportedUser) {
                    await User.findByIdAndUpdate(report.reportedUser, {
                        isActive: false,
                        isBanned: true
                    });
                }
                break;

            case 'conversation_locked':
                if (report.reportedConversation) {
                    await Conversation.findByIdAndUpdate(report.reportedConversation, {
                        isLocked: true,
                        'settings.allowMembersToSend': false
                    });
                }
                break;
        }

        await report.save();

        res.status(200).json({
            success: true,
            message: 'تم تنفيذ الإجراء بنجاح',
            data: { report }
        });

    } catch (error) {
        console.error('خطأ في تنفيذ الإجراء:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في السيرفر'
        });
    }
});

// @route   PUT /api/reports/:id/priority
// @desc    تحديث أولوية البلاغ
// @access  Private/Admin
router.put('/:id/priority', protect, adminOnly, async (req, res) => {
    try {
        const { priority } = req.body;

        const report = await Report.findByIdAndUpdate(
            req.params.id,
            { priority },
            { new: true }
        );

        if (!report) {
            return res.status(404).json({
                success: false,
                message: 'البلاغ غير موجود'
            });
        }

        res.status(200).json({
            success: true,
            message: 'تم تحديث الأولوية',
            data: { report }
        });

    } catch (error) {
        console.error('خطأ في تحديث الأولوية:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في السيرفر'
        });
    }
});

// @route   DELETE /api/reports/:id
// @desc    حذف بلاغ
// @access  Private/Admin
router.delete('/:id', protect, adminOnly, async (req, res) => {
    try {
        const report = await Report.findById(req.params.id);

        if (!report) {
            return res.status(404).json({
                success: false,
                message: 'البلاغ غير موجود'
            });
        }

        await report.deleteOne();

        res.status(200).json({
            success: true,
            message: 'تم حذف البلاغ بنجاح'
        });

    } catch (error) {
        console.error('خطأ في حذف البلاغ:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في السيرفر'
        });
    }
});

module.exports = router;
