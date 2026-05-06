// HalaChat Dashboard - Reports Routes
// المسارات الخاصة بإدارة البلاغات

const express = require('express');
const router = express.Router();
const mongoose = require("mongoose");
const Report = require('../models/Report');
const User = require('../models/User');
const Message = require('../models/Message');
const Conversation = require('../models/Conversation');
const { protect, adminOnly } = require('../middleware/auth');
const { get, set } = require('../utils/cache');

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
            category,
            hasScreenshot,
            last24h
        } = req.query;

        // بناء الفلتر
        const filter = {};
        if (status) filter.status = status;
        if (priority) filter.priority = priority;
        if (type) filter.type = type;
        if (category) filter.category = category;

        // ✅ Phase 3: Quick filters
        if (hasScreenshot === 'true' || hasScreenshot === true) {
            filter.screenshot = { $ne: null, $exists: true };
        }
        if (last24h === 'true' || last24h === true) {
            filter.createdAt = { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) };
        }

        const limitNum = Math.min(parseInt(limit) || 20, 100);

        const [reports, count] = await Promise.all([
            Report.find(filter)
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
                .limit(limitNum)
                .skip((page - 1) * limitNum)
                .lean(),
            Report.countDocuments(filter)
        ]);

        // Attach total report count (cached 60s to avoid heavy aggregation on every page load)
        let reportsData = [...reports];
        const reportedUserIds = [...new Set(reportsData.filter(r => r.reportedUser).map(r => r.reportedUser._id.toString()))];
        if (reportedUserIds.length > 0) {
            const cacheKey = 'report_counts_' + reportedUserIds.sort().join(',').substring(0, 100);
            let countMap = get(cacheKey);
            if (!countMap) {
                const reportCounts = await Report.aggregate([
                    { $match: { reportedUser: { $in: reportedUserIds.map(id => new mongoose.Types.ObjectId(id)) } } },
                    { $group: { _id: '$reportedUser', count: { $sum: 1 } } }
                ]);
                countMap = {};
                reportCounts.forEach(rc => { countMap[rc._id.toString()] = rc.count; });
                set(cacheKey, countMap, 60);
            }
            reportsData.forEach(r => {
                if (r.reportedUser) {
                    r.reportedUser.totalReports = countMap[r.reportedUser._id?.toString()] || 0;
                }
            });
        }

        res.status(200).json({
            success: true,
            data: {
                reports: reportsData,
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
        const { get, set } = require('../utils/cache');
        const CACHE_KEY = 'reports_stats';
        const cached = get(CACHE_KEY);
        if (cached) return res.status(200).json(cached);

        const [
            totalReports, pendingReports, reviewingReports, resolvedReports, urgentReports,
            reportsByType, reportsByCategory
        ] = await Promise.all([
            Report.countDocuments(),
            Report.countDocuments({ status: 'pending' }),
            Report.countDocuments({ status: 'reviewing' }),
            Report.countDocuments({ status: 'resolved' }),
            Report.countDocuments({ priority: 'urgent', status: { $in: ['pending', 'reviewing'] } }),
            Report.aggregate([{ $group: { _id: '$type', count: { $sum: 1 } } }]),
            Report.aggregate([{ $group: { _id: '$category', count: { $sum: 1 } } }])
        ]);

        const payload = {
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
        };
        set(CACHE_KEY, payload, 60); // cache 60s
        res.status(200).json(payload);

    } catch (error) {
        console.error('خطأ في جلب إحصائيات البلاغات:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في السيرفر'
        });
    }
});


// @route   PUT /api/reports/bulk-status
// @desc    تحديث حالة عدة بلاغات دفعة واحدة
// @access  Private/Admin
router.put('/bulk-status', protect, adminOnly, async (req, res) => {
    try {
        const { ids, status } = req.body;

        if (!ids || !Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'يرجى تحديد البلاغات'
            });
        }

        if (!['resolved', 'rejected'].includes(status)) {
            return res.status(400).json({
                success: false,
                message: 'الحالة يجب أن تكون resolved أو rejected'
            });
        }

        const updateData = { status };
        if (status === 'resolved' || status === 'rejected') {
            updateData.resolvedBy = req.user._id;
            updateData.resolvedAt = Date.now();
        }

        const result = await Report.updateMany(
            { _id: { $in: ids } },
            { $set: updateData }
        );

        // إشعار المبلِّغين بنتيجة بلاغاتهم
        try {
            const updatedReports = await Report.find({ _id: { $in: ids } }).select('reportedBy');
            const reporterIds = [...new Set(
                updatedReports
                    .map(r => (r.reportedBy?._id || r.reportedBy)?.toString())
                    .filter(Boolean)
            )];

            if (reporterIds.length > 0) {
                const pushService = require('../services/pushNotificationService');
                const NotificationModel = require('../models/Notification');
                const notifTitle = status === 'resolved'
                    ? 'تم اتخاذ إجراء على بلاغك ✅'
                    : 'تمت مراجعة بلاغك';
                const notifBody = status === 'resolved'
                    ? 'شكراً لتبليغك. تمت معالجة البلاغ واتخاذ الإجراء المناسب.'
                    : 'تمت مراجعة بلاغك ولم يُثبت وجود مخالفة. شكراً لحرصك على سلامة المجتمع.';

                const mongoose = require('mongoose');
                const targetUserIds = reporterIds.map(id => new mongoose.Types.ObjectId(id));

                for (const rid of reporterIds) {
                    try {
                        await pushService.sendNotificationToUser(rid, {
                            title: notifTitle,
                            body: notifBody
                        }, { type: 'report_result' });
                    } catch (e) {}
                }

                await NotificationModel.create({
                    title: notifTitle,
                    body: notifBody,
                    type: 'system',
                    sender: req.user._id,
                    recipients: 'specific',
                    targetUsers: targetUserIds,
                    status: 'sent',
                    sentAt: new Date()
                });
            }
        } catch (notifErr) {
            console.error('Bulk reporter notification error:', notifErr.message);
        }

        res.status(200).json({
            success: true,
            message: `تم تحديث ${result.modifiedCount} بلاغ`,
            data: { updatedCount: result.modifiedCount }
        });

    } catch (error) {
        console.error('خطأ في تحديث البلاغات:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في السيرفر'
        });
    }
});

// @route   DELETE /api/reports/bulk-delete
// @desc    حذف عدة بلاغات دفعة واحدة
// @access  Private/Admin
router.delete('/bulk-delete', protect, adminOnly, async (req, res) => {
    try {
        const { ids } = req.body;

        if (!ids || !Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'يرجى تحديد البلاغات'
            });
        }

        const result = await Report.deleteMany({ _id: { $in: ids } });

        res.status(200).json({
            success: true,
            message: `تم حذف ${result.deletedCount} بلاغ`,
            data: { deletedCount: result.deletedCount }
        });

    } catch (error) {
        console.error('خطأ في حذف البلاغات:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في السيرفر'
        });
    }
});

// @route   PUT /api/reports/resolve-all-pending
// @desc    حل جميع البلاغات المعلقة
// @access  Private/Admin
router.put('/resolve-all-pending', protect, adminOnly, async (req, res) => {
    try {
        const result = await Report.updateMany(
            { status: 'pending' },
            {
                $set: {
                    status: 'resolved',
                    action: 'none',
                    resolvedBy: req.user._id,
                    resolvedAt: Date.now()
                }
            }
        );

        res.status(200).json({
            success: true,
            message: `تم حل ${result.modifiedCount} بلاغ معلق`,
            data: { updatedCount: result.modifiedCount }
        });

    } catch (error) {
        console.error('خطأ في حل البلاغات المعلقة:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في السيرفر'
        });
    }
});

// @route   GET /api/reports/top-reported
// @desc    أكثر المستخدمين المبلّغ عنهم
// @access  Private/Admin
router.get('/top-reported', protect, adminOnly, async (req, res) => {
    try {
        const topReported = await Report.aggregate([
            { $match: { reportedUser: { $ne: null } } },
            {
                $group: {
                    _id: '$reportedUser',
                    reportCount: { $sum: 1 },
                    categories: { $push: '$category' }
                }
            },
            { $sort: { reportCount: -1 } },
            { $limit: 10 },
            {
                $lookup: {
                    from: 'users',
                    localField: '_id',
                    foreignField: '_id',
                    as: 'user'
                }
            },
            { $unwind: '$user' },
            {
                $project: {
                    _id: 0,
                    userId: '$_id',
                    name: '$user.name',
                    email: '$user.email',
                    profileImage: '$user.profileImage',
                    reportCount: 1,
                    categories: 1
                }
            }
        ]);

        // تحويل categories إلى breakdown
        const data = topReported.map(item => {
            const breakdown = {};
            item.categories.forEach(cat => {
                breakdown[cat] = (breakdown[cat] || 0) + 1;
            });
            return { ...item, categories: breakdown };
        });

        res.status(200).json({
            success: true,
            data
        });

    } catch (error) {
        console.error('خطأ في جلب أكثر المبلّغ عنهم:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في السيرفر'
        });
    }
});

// @route   GET /api/reports/top-reporters
// @desc    أكثر المستخدمين الذين يقدمون بلاغات
// @access  Private/Admin
router.get('/top-reporters', protect, adminOnly, async (req, res) => {
    try {
        const topReporters = await Report.aggregate([
            { $match: { reportedBy: { $ne: null } } },
            {
                $group: {
                    _id: '$reportedBy',
                    reportCount: { $sum: 1 }
                }
            },
            { $sort: { reportCount: -1 } },
            { $limit: 10 },
            {
                $lookup: {
                    from: 'users',
                    localField: '_id',
                    foreignField: '_id',
                    as: 'user'
                }
            },
            { $unwind: '$user' },
            {
                $project: {
                    _id: 0,
                    userId: '$_id',
                    name: '$user.name',
                    email: '$user.email',
                    reportCount: 1
                }
            }
        ]);

        res.status(200).json({
            success: true,
            data: topReporters
        });

    } catch (error) {
        console.error('خطأ في جلب أكثر المبلّغين:', error);
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

        // تنفيذ الإجراء باستخدام نظام التصعيد الموحّد
        const { escalateUser } = require('../middleware/escalation');
        const notificationService = require('../services/notificationService') || require('../services/pushNotificationService');

        switch (action) {
            case 'warning':
                // إرسال تحذير عبر نظام التصعيد
                if (report.reportedUser) {
                    const targetId = report.reportedUser._id || report.reportedUser;
                    await escalateUser(targetId.toString(), reviewNotes || 'تحذير إداري بسبب بلاغ', 'admin');
                }
                break;

            case 'message_deleted':
                if (report.reportedMessage) {
                    const msgId = report.reportedMessage._id || report.reportedMessage;
                    await Message.findByIdAndUpdate(msgId, { isDeleted: true });
                    // إشعار المستخدم
                    if (report.reportedUser) {
                        const targetId = report.reportedUser._id || report.reportedUser;
                        try {
                            const pushService = require('../services/pushNotificationService');
                            await pushService.sendNotificationToUser(targetId, {
                                title: 'تم حذف رسالتك',
                                body: 'تم حذف رسالة مخالفة لسياسة الاستخدام.'
                            }, { type: 'message_deleted' });
                        } catch(e) {}
                    }
                }
                break;

            case 'user_suspended':
                // تعليق عبر نظام التصعيد الموحّد
                if (report.reportedUser) {
                    const targetId = report.reportedUser._id || report.reportedUser;
                    await escalateUser(targetId.toString(), reviewNotes || 'تعليق بسبب بلاغ', 'admin');
                }
                break;

            case 'user_banned':
                // حظر نهائي
                if (report.reportedUser) {
                    const targetId = report.reportedUser._id || report.reportedUser;
                    // تصعيد للمستوى 7 (حظر نهائي + جهاز)
                    let currentResult;
                    for (let i = 0; i < 7; i++) {
                        currentResult = await escalateUser(targetId.toString(), reviewNotes || 'حظر نهائي بسبب مخالفات', 'admin');
                        if (currentResult.newLevel >= 7) break;
                    }
                }
                break;

            case 'conversation_locked':
                if (report.reportedConversation) {
                    const convId = report.reportedConversation._id || report.reportedConversation;
                    await Conversation.findByIdAndUpdate(convId, {
                        isLocked: true,
                        'settings.allowMembersToSend': false
                    });
                }
                break;

            case 'none':
                // لا إجراء — فقط معالجة البلاغ
                break;
        }

        await report.save();

        // إشعار المبلِّغ بنتيجة بلاغه
        try {
            const reporterId = report.reportedBy?._id || report.reportedBy;
            if (reporterId) {
                const pushService = require('../services/pushNotificationService');
                let notifTitle, notifBody;

                if (action === 'none') {
                    notifTitle = 'شكراً لك 💚';
                    notifBody = 'نشكرك! تم التعامل مع بلاغك بنجاح. شكراً لك على جعل تطبيق هلا مكان آمن ومميز.';
                } else if (action === 'warning') {
                    notifTitle = 'تم اتخاذ إجراء على بلاغك ✅';
                    notifBody = 'بفضلك تم اتخاذ إجراء! تم تنبيه المستخدم المخالف. نقدر حرصك على سلامة مجتمع هلا 💚';
                } else if (action === 'message_deleted') {
                    notifTitle = 'تم اتخاذ إجراء على بلاغك ✅';
                    notifBody = 'بفضلك تم حذف المحتوى المخالف. شكراً لمساهمتك في جعل هلا أفضل للجميع 💚';
                } else if (action === 'user_suspended') {
                    notifTitle = 'تم اتخاذ إجراء على بلاغك ✅';
                    notifBody = 'بفضل تبليغك تم تعليق المستخدم المخالف. نقدر حرصك على سلامة مجتمعنا 💚';
                } else if (action === 'user_banned') {
                    notifTitle = 'تم اتخاذ إجراء على بلاغك ✅';
                    notifBody = 'بفضل تبليغك تم حظر المستخدم المخالف نهائياً. شكراً لك على جعل هلا مكان آمن للجميع 💚';
                } else if (action === 'conversation_locked') {
                    notifTitle = 'تم اتخاذ إجراء على بلاغك ✅';
                    notifBody = 'بفضل تبليغك تم قفل المحادثة المخالفة. شكراً لمساهمتك في حماية مجتمع هلا 💚';
                }

                if (notifTitle) {
                    await pushService.sendNotificationToUser(reporterId, {
                        title: notifTitle,
                        body: notifBody
                    }, { type: 'report_result' });

                    // Also save in-app notification
                    const Notification = require('../models/Notification');
                    await Notification.create({
                        title: notifTitle,
                        body: notifBody,
                        type: 'system',
                        sender: req.user._id,
                        recipients: 'specific',
                        targetUsers: [reporterId],
                        status: 'sent',
                        sentAt: new Date()
                    });
                }
            }
        } catch (notifErr) {
            console.error('Reporter notification error:', notifErr.message);
        }

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
