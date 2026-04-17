const express = require('express');
const router = express.Router();
const User = require('../../models/User');
const Report = require('../../models/Report');
const Conversation = require('../../models/Conversation');
const Message = require('../../models/Message');
const Notification = require('../../models/Notification');
const { protect } = require('../../middleware/auth');
const notificationService = require('../../services/notificationService');
const pushNotificationService = require('../../services/pushNotificationService');
const { getFullUrl } = require('./helpers');

// ==========================================
// نظام الإبلاغات
// ==========================================

// @route   POST /api/mobile/reports
// @desc    إنشاء بلاغ جديد (شكل مبسط للتطبيق)
// @access  Private
router.post('/reports', protect, async (req, res) => {
    try {
        const {
            reportedUser,   // userId للمستخدم المبلغ عنه
            reason,         // spam | inappropriate | harassment | fake_profile | other
            description     // وصف إضافي (اختياري)
        } = req.body;

        // التحقق من البيانات المطلوبة
        if (!reportedUser || !reason) {
            return res.status(400).json({
                success: false,
                message: 'معرف المستخدم وسبب البلاغ مطلوبان'
            });
        }

        // التحقق من صحة السبب
        const validReasons = ['spam', 'inappropriate', 'harassment', 'fake_profile', 'other'];
        if (!validReasons.includes(reason)) {
            return res.status(400).json({
                success: false,
                message: 'سبب البلاغ غير صالح'
            });
        }

        // التحقق من وجود المستخدم المبلغ عنه
        const targetUser = await User.findById(reportedUser);
        if (!targetUser) {
            return res.status(404).json({
                success: false,
                message: 'المستخدم المبلغ عنه غير موجود'
            });
        }

        // لا يمكن الإبلاغ عن نفسك
        if (reportedUser === req.user._id.toString()) {
            return res.status(400).json({
                success: false,
                message: 'لا يمكن الإبلاغ عن نفسك'
            });
        }

        // ✅ منع التكرار — لا تسمح ببلاغين pending/reviewing من نفس المُبلّغ ضد نفس المستخدم
        // (نعتبر بلاغاً واحداً لكل مستخدم — بغض النظر عن السبب)
        const existingActive = await Report.findOne({
            reportedBy: req.user._id,
            reportedUser: reportedUser,
            status: { $in: ['pending', 'reviewing'] }
        }).lean();

        if (existingActive) {
            return res.status(200).json({
                success: true,
                message: 'تم استلام بلاغك سابقاً وهو قيد المراجعة',
                code: 'REPORT_ALREADY_EXISTS',
                data: { report: { _id: existingActive._id, status: existingActive.status } }
            });
        }

        // ✅ cooldown إضافي: منع أي بلاغ جديد من نفس المُبلّغ ضد نفس المستخدم خلال 24 ساعة
        // (حتى لو السابق انغلق — يمنع "إعادة الفتح" فوراً)
        const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const recentClosed = await Report.findOne({
            reportedBy: req.user._id,
            reportedUser: reportedUser,
            createdAt: { $gte: dayAgo }
        }).lean();

        if (recentClosed && !existingActive) {
            return res.status(429).json({
                success: false,
                message: 'أبلغت عن هذا المستخدم مؤخراً. حاول لاحقاً',
                code: 'REPORT_COOLDOWN',
                data: { retryAfter: 24 * 60 * 60 }
            });
        }

        // تحديد الأولوية بناء على السبب
        const highPriorityReasons = ['harassment', 'inappropriate'];
        const priority = highPriorityReasons.includes(reason) ? 'high' : 'medium';

        const report = await Report.create({
            type: 'user',
            reportedBy: req.user._id,
            reportedUser: reportedUser,
            category: reason,
            description: description || '',
            status: 'pending',
            priority
        });

        // إرسال إشعار للأدمن عند إنشاء بلاغ جديد
        try {
            // جلب جميع الأدمن
            const admins = await User.find({ role: 'admin', isActive: true }).lean();

            // ترجمة السبب للعربية
            const reasonTranslations = {
                'spam': 'سبام',
                'inappropriate': 'محتوى غير لائق',
                'harassment': 'تحرش',
                'fake_profile': 'حساب مزيف',
                'other': 'أخرى'
            };

            const reasonArabic = reasonTranslations[reason] || reason;

            // ✅ حساب عدد المبلّغين الفريدين لعرضه في الإشعار
            const uniqueReportersCount = await Report.distinct('reportedBy', {
                reportedUser: reportedUser,
                status: { "$in": ['pending', 'reviewing'] }
            }).then(r => r.length);
            const AUTO_THRESHOLD = 5;
            const reportProgress = `(بلاغ ${uniqueReportersCount}/${AUTO_THRESHOLD}${uniqueReportersCount >= AUTO_THRESHOLD - 1 ? ' ⚠️ قريب من التعليق التلقائي!' : ''})`;

            // إنشاء إشعار في قاعدة البيانات
            await Notification.create({
                title: `بلاغ جديد ${reportProgress}`,
                body: `${req.user.name} أبلغ عن ${targetUser.name} - السبب: ${reasonArabic}`,
                type: 'report',
                recipients: 'specific',
                targetUsers: admins.map(admin => admin._id),
                sender: req.user._id,
                status: 'sent',
                priority: priority === 'high' ? 'high' : 'normal',
                sentAt: new Date(),
                sentCount: admins.length,
                data: {
                    reportId: report._id.toString(),
                    reportedUserId: reportedUser,
                    reportedUserName: targetUser.name,
                    reason: reason,
                    type: 'new_report'
                }
            });

            // ✅ Socket.IO للوحة الأدمن فقط (room منفصل) — لا يوصل لجهاز الأدمن الشخصي
            // لا نرسل Push للأدمن: البلاغات يتم إدارتها من لوحة التحكم فقط
            if (global.io) {
                global.io.to('admin-dashboard').emit('new-report', {
                    reportId: report._id.toString(),
                    reportedUserId: reportedUser,
                    reportedUserName: targetUser.name,
                    reporterName: req.user.name,
                    reason: reasonArabic,
                    priority,
                    uniqueReportersCount
                });
            }
        } catch (notifError) {
            console.error('خطأ في إرسال إشعار البلاغ:', notifError);
            // نكمل حتى لو فشل الإشعار
        }


        // ══════════════════════════════════════════════════════════
        // ✅ نظام التحذير التلقائي (Auto-Warning System)
        // ──────────────────────────────────────────────────────────
        // عند 2 بلاغات: تنبيه أولي
        // عند 4 بلاغات: تحذير أخير (حسابك معرض للتقييد)
        // عند 5 بلاغات: تعليق تلقائي (الكود الموجود أسفل)
        // ══════════════════════════════════════════════════════════
        try {
            const WARNING_THRESHOLDS = { 2: 'initial', 4: 'final' };
            const warningReporters = await Report.distinct('reportedBy', {
                reportedUser: reportedUser,
                status: { "$in": ["pending", "reviewing"] }
            });
            const reportCount = warningReporters.length;
            const warningType = WARNING_THRESHOLDS[reportCount];

            if (warningType && targetUser.isActive && !targetUser.suspension?.isSuspended) {
                const warningMessages = {
                    initial: {
                        title: '⚠️ تنبيه: بلاغات على حسابك',
                        body: 'تم استلام بلاغات على حسابك. يرجى الالتزام بقواعد الاستخدام لتجنب التقييد.'
                    },
                    final: {
                        title: '🚨 تحذير أخير: حسابك معرض للتقييد',
                        body: 'حسابك وصل لعدد بلاغات مرتفع وقد يتم تقييده تلقائياً. يرجى مراجعة سلوكك فوراً.'
                    }
                };

                const msg = warningMessages[warningType];

                // إشعار في قاعدة البيانات
                await Notification.create({
                    title: msg.title,
                    body: msg.body,
                    type: 'system',
                    recipients: 'specific',
                    targetUsers: [targetUser._id],
                    data: {
                        type: 'report_warning',
                        warningType: warningType,
                        reportCount: reportCount,
                        maxReports: 5,
                        userId: targetUser._id.toString()
                    },
                    status: 'sent',
                    sentAt: new Date()
                });

                // Push notification
                await pushNotificationService.sendNotificationToUser(targetUser._id, {
                    title: msg.title,
                    body: msg.body
                }, { type: 'report_warning', warningType, reportCount, maxReports: 5 });

                // Socket.IO — تحذير فوري
                if (global.io) {
                    global.io.to('user-' + targetUser._id).emit('account-warning', {
                        warningType: warningType,
                        title: msg.title,
                        body: msg.body,
                        reportCount: reportCount,
                        maxReports: 5
                    });
                }

                console.log('⚠️ تحذير تلقائي: ' + targetUser.name + ' — ' + warningType + ' (' + reportCount + '/5 بلاغات)');
            }
        } catch (warningError) {
            console.error('خطأ في نظام التحذير:', warningError);
        }

        // ══════════════════════════════════════════════════════════
        // ✅ نظام التعليق التلقائي التدريجي (Auto-Suspension System)
        // ──────────────────────────────────────────────────────────
        // الشروط:
        //   - 5 بلاغات أو أكثر من مستخدمين مختلفين (unique reporters)
        //   - البلاغات بحالة pending أو reviewing فقط
        //   - المستخدم غير معلّق حالياً
        //
        // التدرج:
        //   المستوى 1 → 24 ساعة
        //   المستوى 2 → 48 ساعة
        //   المستوى 3 → 3 أيام
        //   المستوى 4 → 7 أيام
        //   المستوى 5 → دائم
        //
        // كل تعليق يُسجّل في history مع source: 'auto'
        // ══════════════════════════════════════════════════════════
        try {
            const AUTO_SUSPEND_THRESHOLD = 5;

            // حساب عدد البلاغات من مستخدمين مختلفين (pending أو reviewing فقط)
            const uniqueReporters = await Report.distinct('reportedBy', {
                reportedUser: reportedUser,
                status: { "$in": ['pending', 'reviewing'] }
            });

            if (uniqueReporters.length >= AUTO_SUSPEND_THRESHOLD && !targetUser.suspension?.isSuspended) {
                // تحديد المستوى التالي تدريجياً
                const SUSPENSION_LEVELS = {
                    1: { hours: 24, text: '24 ساعة' },
                    2: { hours: 48, text: '48 ساعة' },
                    3: { hours: 72, text: '3 أيام' },
                    4: { hours: 168, text: '7 أيام' },
                    5: { hours: null, text: 'دائم' }
                };

                const currentLevel = targetUser.suspension?.level || 0;
                const newLevel = Math.min(currentLevel + 1, 5);
                const levelInfo = SUSPENSION_LEVELS[newLevel];

                const suspendedUntil = levelInfo.hours
                    ? new Date(Date.now() + levelInfo.hours * 60 * 60 * 1000)
                    : null;

                const suspendReason = 'تعليق تلقائي - بلاغات متعددة من مستخدمين مختلفين';

                // حفظ في السجل
                const historyEntry = {
                    level: newLevel,
                    reason: suspendReason,
                    suspendedAt: new Date(),
                    suspendedUntil: suspendedUntil,
                    suspendedBy: null,
                    source: 'auto'
                };

                const currentHistory = targetUser.suspension?.history || [];
                const totalSuspensions = (targetUser.suspension?.totalSuspensions || 0) + 1;

                targetUser.set('suspension', {
                    isSuspended: true,
                    suspendedAt: new Date(),
                    suspendedUntil: suspendedUntil,
                    reason: suspendReason,
                    suspendedBy: null,
                    level: newLevel,
                    totalSuspensions: totalSuspensions,
                    history: [...currentHistory, historyEntry]
                });
                targetUser.isActive = false;
                await targetUser.save();

                // إشعار المستخدم المعلّق
                const suspendTitle = '⚠️ تم تعليق حسابك';
                const suspendBody = `تم تعليق حسابك تلقائياً لمدة ${levelInfo.text} بسبب بلاغات متعددة.`;

                await pushNotificationService.sendNotificationToUser(targetUser._id, {
                    title: suspendTitle,
                    body: suspendBody
                }, { type: 'account_suspended', suspendedUntil, reason: suspendReason, level: newLevel });

                await Notification.create({
                    title: suspendTitle,
                    body: suspendBody,
                    type: 'system',
                    recipients: 'specific',
                    targetUsers: [targetUser._id],
                    data: {
                        type: 'account_suspended',
                        suspendedUntil, reason: suspendReason,
                        level: newLevel,
                        violationCount: uniqueReporters.length,
                        userId: targetUser._id.toString()
                    },
                    status: 'sent',
                    sentAt: new Date()
                });

                // Socket.IO — تعليق فوري
                if (global.io) {
                    global.io.to(`user-${targetUser._id}`).emit('account-suspended', {
                        suspendedUntil, reason: suspendReason,
                        duration: levelInfo.text, level: newLevel
                    });
                }

                console.log(`🔒 تعليق تلقائي: ${targetUser.name} — المستوى ${newLevel} (${levelInfo.text}) — ${uniqueReporters.length} بلاغ`);
            }
        } catch (autoSuspendError) {
            console.error('خطأ في التعليق التلقائي:', autoSuspendError);
            // نكمل حتى لو فشل التعليق التلقائي
        }

        res.status(201).json({
            success: true,
            message: 'تم إرسال البلاغ'
        });

    } catch (error) {
        console.error('خطأ في إنشاء البلاغ:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في السيرفر',
            error: error.message
        });
    }
});

// @route   GET /api/mobile/reports/my
// @desc    الحصول على بلاغاتي
// @access  Private
router.get('/reports/my', protect, async (req, res) => {
    try {
        const reports = await Report.find({ reportedBy: req.user._id })
            .populate('reportedUser', 'name email')
            .sort({ createdAt: -1 })
            .lean();

        res.status(200).json({
            success: true,
            data: { reports }
        });

    } catch (error) {
        console.error('خطأ في جلب البلاغات:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في السيرفر',
            error: error.message
        });
    }
});

// ═══════════════════════════════════════════════════════════════
// @route   POST /api/mobile/client-error
// @desc    استقبال أخطاء التطبيق لتشخيص المشاكل عن بُعد
// @access  Private
// ═══════════════════════════════════════════════════════════════
router.post('/client-error', protect, async (req, res) => {
    const { endpoint, error, details, appVersion, device } = req.body;
    console.error(`📱 CLIENT ERROR from ${req.user.name} (${req.user._id}):`);
    console.error(`   Endpoint: ${endpoint}`);
    console.error(`   Error: ${error}`);
    console.error(`   Details: ${details}`);
    console.error(`   App: ${appVersion} | Device: ${device}`);
    res.json({ success: true });
});

// ═══════════════════════════════════════════════════════════════
// @route   POST /api/mobile/report-spam
// @desc    بلاغ سبام تلقائي من التطبيق
// @access  Private
// ═══════════════════════════════════════════════════════════════
router.post('/report-spam', protect, async (req, res) => {
    try {
        const { userId, conversationId, reason, content, deviceFingerprint, deviceToken } = req.body;
        const SpamReport = require('../../models/SpamReport');
        const { handleAutoSuspension } = require('../../middleware/spamDetection');

        await SpamReport.create({
            userId: userId || req.user._id,
            conversationId,
            reason: reason || 'spam_keywords',
            content: content?.substring(0, 500),
            deviceFingerprint,
            keychainToken: deviceToken,
            source: 'client'
        });

        // فحص التعليق التلقائي
        await handleAutoSuspension(userId || req.user._id);

        res.json({ success: true, message: 'Spam report received' });
    } catch (error) {
        console.error('Report spam error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// ═══════════════════════════════════════════════════════════════
// @route   GET /api/mobile/chat/export
// @desc    تصدير جميع المحادثات والرسائل للنسخ الاحتياطي
// @access  Private
// ═══════════════════════════════════════════════════════════════
router.get('/chat/export', protect, async (req, res) => {
    try {
        const userId = req.user.id;

        // جلب جميع المحادثات المقبولة
        const conversations = await Conversation.find({
            participants: userId,
            isActive: true,
            status: 'accepted'
        })
        .populate('participants', 'name profileImage')
        .sort({ updatedAt: -1 })
        .lean();

        // جلب رسائل كل محادثة (بدون المحذوفة والمؤقتة المنتهية)
        const exportData = [];

        for (const conv of conversations) {
            const messages = await Message.find({
                conversation: conv._id,
                isDeleted: { $ne: true },
                $or: [
                    { 'disappearing.enabled': { $ne: true } },
                    { 'disappearing.enabled': true, 'disappearing.expiresAt': { $gt: new Date() } }
                ]
            })
            .populate('sender', 'name')
            .sort({ createdAt: 1 })
            .select('sender content type mediaUrl createdAt imageSource')
            .lean();

            // أسماء المشاركين (بدون المستخدم الحالي)
            const participantNames = conv.participants
                .filter(p => p._id.toString() !== userId)
                .map(p => p.name);

            exportData.push({
                id: conv._id,
                participantNames,
                chatMode: conv.chatMode || 'snap',
                totalMessages: messages.length,
                messages: messages.map(m => ({
                    sender: m.sender?.name || 'مجهول',
                    content: m.content || null,
                    type: m.type || 'text',
                    mediaUrl: m.mediaUrl ? getFullUrl(m.mediaUrl) : null,
                    createdAt: m.createdAt
                }))
            });
        }

        res.json({
            success: true,
            data: {
                userId,
                exportedAt: new Date().toISOString(),
                totalConversations: exportData.length,
                totalMessages: exportData.reduce((sum, c) => sum + c.totalMessages, 0),
                conversations: exportData
            }
        });

    } catch (error) {
        console.error('خطأ في تصدير المحادثات:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في تصدير المحادثات'
        });
    }
});

module.exports = router;
