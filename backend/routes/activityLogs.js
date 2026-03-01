// HalaChat Dashboard - Activity Logs Routes
// مسارات API الخاصة بسجلات النشاطات

const express = require('express');
const router = express.Router();
const ActivityLog = require('../models/ActivityLog');
const { protect, adminOnly } = require('../middleware/auth');

// @route   GET /api/activity-logs
// @desc    جلب جميع سجلات النشاطات
// @access  Admin
router.get('/', protect, adminOnly, async (req, res) => {
    try {
        const {
            page = 1,
            limit = 50,
            search = '',
            action = '',
            userId = '',
            severity = '',
            status = '',
            startDate = '',
            endDate = '',
            sortBy = 'createdAt',
            sortOrder = 'desc'
        } = req.query;

        // بناء الفلتر
        const filter = {};

        if (search) {
            filter.$or = [
                { description: { $regex: search, $options: 'i' } },
                { targetName: { $regex: search, $options: 'i' } }
            ];
        }

        if (action) {
            filter.action = action;
        }

        if (userId) {
            filter.user = userId;
        }

        if (severity) {
            filter.severity = severity;
        }

        if (status) {
            filter.status = status;
        }

        // فلتر التاريخ
        if (startDate || endDate) {
            filter.createdAt = {};
            if (startDate) {
                filter.createdAt.$gte = new Date(startDate);
            }
            if (endDate) {
                filter.createdAt.$lte = new Date(endDate);
            }
        }

        // الترتيب
        const sort = {};
        sort[sortBy] = sortOrder === 'asc' ? 1 : -1;

        // جلب السجلات
        const logs = await ActivityLog.find(filter)
            .populate('user', 'name email role')
            .sort(sort)
            .limit(limit * 1)
            .skip((page - 1) * limit)
            .lean();

        const total = await ActivityLog.countDocuments(filter);

        res.json({
            success: true,
            data: {
                logs,
                pagination: {
                    currentPage: parseInt(page),
                    totalPages: Math.ceil(total / limit),
                    totalLogs: total,
                    logsPerPage: parseInt(limit),
                    hasNextPage: page * limit < total,
                    hasPrevPage: page > 1
                }
            }
        });
    } catch (error) {
        console.error('خطأ في جلب سجلات النشاطات:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في جلب سجلات النشاطات',
            error: error.message
        });
    }
});

// @route   GET /api/activity-logs/user/:userId
// @desc    جلب سجلات نشاطات مستخدم معين
// @access  Admin
router.get('/user/:userId', protect, adminOnly, async (req, res) => {
    try {
        const { userId } = req.params;
        const { page = 1, limit = 20 } = req.query;

        const logs = await ActivityLog.find({ user: userId })
            .populate('user', 'name email')
            .sort({ createdAt: -1 })
            .limit(limit * 1)
            .skip((page - 1) * limit);

        const total = await ActivityLog.countDocuments({ user: userId });

        res.json({
            success: true,
            data: {
                logs,
                totalPages: Math.ceil(total / limit),
                currentPage: parseInt(page),
                total
            }
        });
    } catch (error) {
        console.error('خطأ في جلب سجلات المستخدم:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في جلب سجلات المستخدم',
            error: error.message
        });
    }
});

// @route   GET /api/activity-logs/stats
// @desc    إحصائيات سجلات النشاطات
// @access  Admin
router.get('/stats/overview', protect, adminOnly, async (req, res) => {
    try {
        const { days = 7 } = req.query;

        // تاريخ البداية
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - parseInt(days));

        // إجمالي السجلات
        const totalLogs = await ActivityLog.countDocuments();
        const recentLogs = await ActivityLog.countDocuments({
            createdAt: { $gte: startDate }
        });

        // حسب نوع النشاط
        const byAction = await ActivityLog.aggregate([
            { $match: { createdAt: { $gte: startDate } } },
            { $group: { _id: '$action', count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $limit: 10 }
        ]);

        // حسب المستوى
        const bySeverity = await ActivityLog.aggregate([
            { $match: { createdAt: { $gte: startDate } } },
            { $group: { _id: '$severity', count: { $sum: 1 } } }
        ]);

        // حسب الحالة
        const byStatus = await ActivityLog.aggregate([
            { $match: { createdAt: { $gte: startDate } } },
            { $group: { _id: '$status', count: { $sum: 1 } } }
        ]);

        // أكثر المستخدمين نشاطاً
        const mostActiveUsers = await ActivityLog.aggregate([
            { $match: { createdAt: { $gte: startDate } } },
            { $group: { _id: '$user', count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $limit: 10 },
            {
                $lookup: {
                    from: 'users',
                    localField: '_id',
                    foreignField: '_id',
                    as: 'userInfo'
                }
            },
            { $unwind: '$userInfo' },
            {
                $project: {
                    _id: 1,
                    count: 1,
                    name: '$userInfo.name',
                    email: '$userInfo.email'
                }
            }
        ]);

        // النشاطات حسب اليوم (للرسم البياني)
        const dailyActivity = await ActivityLog.aggregate([
            { $match: { createdAt: { $gte: startDate } } },
            {
                $group: {
                    _id: {
                        $dateToString: { format: '%Y-%m-%d', date: '$createdAt' }
                    },
                    count: { $sum: 1 }
                }
            },
            { $sort: { _id: 1 } }
        ]);

        res.json({
            success: true,
            data: {
                totalLogs,
                recentLogs,
                byAction,
                bySeverity,
                byStatus,
                mostActiveUsers,
                dailyActivity,
                period: {
                    days: parseInt(days),
                    startDate,
                    endDate: new Date()
                }
            }
        });
    } catch (error) {
        console.error('خطأ في جلب إحصائيات السجلات:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في جلب إحصائيات السجلات',
            error: error.message
        });
    }
});

// @route   GET /api/activity-logs/:id
// @desc    جلب سجل نشاط واحد
// @access  Admin
router.get('/:id', protect, adminOnly, async (req, res) => {
    try {
        const log = await ActivityLog.findById(req.params.id)
            .populate('user', 'name email role')
            .populate('targetId');

        if (!log) {
            return res.status(404).json({
                success: false,
                message: 'السجل غير موجود'
            });
        }

        res.json({
            success: true,
            data: log
        });
    } catch (error) {
        console.error('خطأ في جلب السجل:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في جلب السجل',
            error: error.message
        });
    }
});

// @route   DELETE /api/activity-logs/:id
// @desc    حذف سجل نشاط
// @access  Admin
router.delete('/:id', protect, adminOnly, async (req, res) => {
    try {
        const log = await ActivityLog.findById(req.params.id);

        if (!log) {
            return res.status(404).json({
                success: false,
                message: 'السجل غير موجود'
            });
        }

        await ActivityLog.findByIdAndDelete(req.params.id);

        res.json({
            success: true,
            message: 'تم حذف السجل بنجاح'
        });
    } catch (error) {
        console.error('خطأ في حذف السجل:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في حذف السجل',
            error: error.message
        });
    }
});

// @route   DELETE /api/activity-logs/bulk/delete
// @desc    حذف سجلات قديمة (أقدم من X يوم)
// @access  Admin
router.delete('/bulk/delete', protect, adminOnly, async (req, res) => {
    try {
        const { days = 90 } = req.body;

        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - parseInt(days));

        const result = await ActivityLog.deleteMany({
            createdAt: { $lt: cutoffDate }
        });

        res.json({
            success: true,
            message: `تم حذف ${result.deletedCount} سجل قديم`,
            deletedCount: result.deletedCount
        });
    } catch (error) {
        console.error('خطأ في الحذف الجماعي:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في الحذف الجماعي',
            error: error.message
        });
    }
});

module.exports = router;
