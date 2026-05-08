// HalaChat - Appeals Routes
// المسارات الخاصة بالاستئنافات

const express = require('express');
const router = express.Router();
const Appeal = require('../models/Appeal');
const User = require('../models/User');
const BannedDevice = require('../models/BannedDevice');
const Notification = require('../models/Notification');
const { protect, adminOnly } = require('../middleware/auth');
const notificationService = require('../services/notificationService');
const { checkBannedWords } = require('./bannedWords');
const { sendAppealUpdate } = require('../services/emailService');

// ════════════════════════════════════════════════════════════════
// @route   POST /api/appeals/public/device-ban
// @desc    استئناف عام لحظر الجهاز — بدون auth (لأن المستخدم لا يقدر يسجل دخول)
// @access  Public (rate-limited)
// ════════════════════════════════════════════════════════════════

// rate limit بسيط: 3 محاولات / ساعة لكل deviceFingerprint
const deviceAppealRateLimit = new Map();
function checkDeviceAppealLimit(fp) {
    const now = Date.now();
    const record = deviceAppealRateLimit.get(fp) || { count: 0, resetAt: now + 3600000 };
    if (now >= record.resetAt) {
        record.count = 0;
        record.resetAt = now + 3600000;
    }
    if (record.count >= 3) return false;
    record.count += 1;
    deviceAppealRateLimit.set(fp, record);
    return true;
}

router.post('/public/device-ban', async (req, res) => {
    try {
        const { email, deviceFingerprint, deviceToken, reason } = req.body;

        if (!reason || !reason.trim()) {
            return res.status(400).json({ success: false, message: 'سبب الاستئناف مطلوب' });
        }
        if (reason.length > 1000) {
            return res.status(400).json({ success: false, message: 'الرسالة طويلة جداً (حد 1000 حرف)' });
        }
        if (!deviceFingerprint && !deviceToken) {
            return res.status(400).json({ success: false, message: 'بيانات الجهاز مطلوبة' });
        }

        // rate limit
        const fpKey = deviceFingerprint || deviceToken;
        if (!checkDeviceAppealLimit(fpKey)) {
            return res.status(429).json({
                success: false,
                message: 'لقد تجاوزت الحد المسموح لتقديم الاستئنافات. حاول بعد ساعة.'
            });
        }

        // ✅ فلترة الألفاظ البذيئة — يرفض الاستئناف إذا احتوى كلمات ممنوعة
        const bannedCheck = await checkBannedWords(reason.trim());
        if (bannedCheck && bannedCheck.hasBannedWord) {
            return res.status(400).json({
                success: false,
                code: 'BANNED_CONTENT',
                message: 'المحتوى يحتوي ألفاظاً غير لائقة. يُرجى صياغة الاستئناف باحترام.'
            });
        }

        // فحص: هل الجهاز فعلاً محظور؟
        const bannedDevice = await BannedDevice.findOne({
            isActive: true,
            $or: [
                ...(deviceFingerprint ? [{ deviceFingerprint }] : []),
                ...(deviceToken ? [{ keychainToken: deviceToken }] : [])
            ]
        });

        if (!bannedDevice) {
            return res.status(404).json({
                success: false,
                message: 'هذا الجهاز غير محظور. جرّب تسجيل الدخول مباشرة.'
            });
        }

        // منع استئناف مكرر قيد المراجعة على نفس الجهاز
        const existing = await Appeal.findOne({
            user: bannedDevice.originalUserId,
            actionType: 'device_ban',
            status: { $in: ['pending', 'forwarded', 'under_review'] }
        });
        if (existing) {
            return res.status(400).json({
                success: false,
                message: 'لديك استئناف قيد المراجعة بالفعل لهذا الجهاز',
                appealId: existing._id.toString()
            });
        }

        // ✅ cooldown 7 أيام بعد آخر رفض — منع نزاع لا ينتهي
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        const recentlyRejected = await Appeal.findOne({
            user: bannedDevice.originalUserId,
            actionType: 'device_ban',
            status: 'rejected',
            resolvedAt: { $gte: sevenDaysAgo }
        });
        if (recentlyRejected) {
            const resolvedAt = recentlyRejected.resolvedAt || recentlyRejected.updatedAt;
            const daysLeft = Math.ceil((sevenDaysAgo.getTime() + 7 * 86400000 - resolvedAt.getTime()) / 86400000);
            return res.status(400).json({
                success: false,
                code: 'APPEAL_COOLDOWN',
                message: `تم رفض استئنافك مؤخراً. يمكنك تقديم استئناف جديد بعد ${Math.max(1, daysLeft)} يوم.`,
                data: { daysLeft: Math.max(1, daysLeft), resolvedAt }
            });
        }

        // إنشاء الاستئناف مرتبط بـ originalUserId
        const trimmedEmail = email && typeof email === 'string' ? email.trim().toLowerCase() : null;
        const appeal = await Appeal.create({
            user: bannedDevice.originalUserId,
            reason: reason.trim(),
            actionType: 'device_ban',
            isPublicAppeal: true,
            publicEmail: trimmedEmail,
            statusHistory: [{
                status: 'pending',
                note: 'استئناف عام من جهاز محظور' + (trimmedEmail ? ` (${trimmedEmail})` : ''),
                changedAt: new Date()
            }],
            messages: [{
                sender: 'user',
                authorId: bannedDevice.originalUserId,
                content: reason.trim(),
                readByUser: true,
                readByAdmin: false,
                createdAt: new Date()
            }],
            unreadForAdmin: 1
        });

        res.status(201).json({
            success: true,
            message: 'تم إرسال الاستئناف. سيتم مراجعته والرد عبر التطبيق عند الحاجة.',
            data: { appealId: appeal._id.toString() }
        });
    } catch (error) {
        console.error('خطأ في استئناف حظر الجهاز (public):', error);
        res.status(500).json({ success: false, message: 'خطأ في السيرفر' });
    }
});

// @route   POST /api/appeals
// @desc    إنشاء استئناف جديد
// @access  Private
router.post('/', protect, async (req, res) => {
    try {
        const { reason, actionType } = req.body;

        if (!reason || !reason.trim()) {
            return res.status(400).json({
                success: false,
                message: 'سبب الاستئناف مطلوب'
            });
        }

        if (reason.length > 1000) {
            return res.status(400).json({
                success: false,
                message: 'سبب الاستئناف يجب ألا يتجاوز 1000 حرف'
            });
        }

        // التحقق من عدم وجود استئناف معلق
        const existingPending = await Appeal.findOne({
            user: req.user._id,
            status: { $in: ['pending', 'forwarded', 'under_review'] }
        });

        if (existingPending) {
            return res.status(400).json({
                success: false,
                message: 'لديك استئناف قيد المراجعة بالفعل'
            });
        }

        const appeal = await Appeal.create({
            user: req.user._id,
            reason: reason.trim(),
            actionType: actionType || 'suspension',
            suspensionLevel: req.user.suspension?.level || null,
            statusHistory: [{
                status: 'pending',
                note: 'تم إنشاء الاستئناف',
                changedAt: new Date()
            }],
            // ✅ أول رسالة في المحادثة = سبب الاستئناف
            messages: [{
                sender: 'user',
                authorId: req.user._id,
                content: reason.trim(),
                readByUser: true,
                readByAdmin: false,
                createdAt: new Date()
            }],
            unreadForAdmin: 1
        });

        // ✅ تنبيه فوري لكل الأدمنز المتصلين
        if (global.io) {
            global.io.to('admin-dashboard').emit('admin:new-appeal', {
                appealId: appeal._id.toString(),
                userId: req.user._id.toString(),
                userName: req.user.name,
                actionType: appeal.actionType,
                reason: reason.trim().slice(0, 120),
                createdAt: appeal.createdAt
            });
        }

        res.status(201).json({
            success: true,
            message: 'تم إرسال الاستئناف بنجاح',
            data: appeal
        });

    } catch (error) {
        console.error('خطأ في إنشاء الاستئناف:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في السيرفر'
        });
    }
});

// @route   POST /api/appeals/:id/reply
// @desc    رد المستخدم على استئنافه (رسالة جديدة في المحادثة)
// @access  Private
router.post('/:id/reply', protect, async (req, res) => {
    try {
        const { content } = req.body;
        if (!content || !content.trim()) {
            return res.status(400).json({ success: false, message: 'محتوى الرسالة مطلوب' });
        }
        if (content.length > 2000) {
            return res.status(400).json({ success: false, message: 'الرسالة طويلة جداً (حد 2000 حرف)' });
        }

        const appeal = await Appeal.findOne({ _id: req.params.id, user: req.user._id });
        if (!appeal) {
            return res.status(404).json({ success: false, message: 'الاستئناف غير موجود' });
        }
        if (appeal.status === 'approved' || appeal.status === 'rejected') {
            return res.status(400).json({ success: false, message: 'تم إغلاق هذا الاستئناف' });
        }

        appeal.messages.push({
            sender: 'user',
            authorId: req.user._id,
            content: content.trim(),
            readByUser: true,
            readByAdmin: false,
            createdAt: new Date()
        });
        appeal.unreadForAdmin = (appeal.unreadForAdmin || 0) + 1;
        await appeal.save();

        // ✅ تنبيه فوري لكل الأدمنز المتصلين
        if (global.io) {
            global.io.to('admin-dashboard').emit('admin:appeal-user-reply', {
                appealId: appeal._id.toString(),
                userId: req.user._id.toString(),
                userName: req.user.name,
                preview: content.trim().slice(0, 120),
                unreadForAdmin: appeal.unreadForAdmin,
                createdAt: new Date()
            });
        }

        res.json({ success: true, data: appeal });
    } catch (error) {
        console.error('خطأ في رد المستخدم على الاستئناف:', error);
        res.status(500).json({ success: false, message: 'خطأ في السيرفر' });
    }
});

// @route   POST /api/appeals/:id/admin-reply
// @desc    رد الإدارة في محادثة الاستئناف (+ push للمستخدم)
// @access  Private/Admin
router.post('/:id/admin-reply', protect, adminOnly, async (req, res) => {
    try {
        const { content } = req.body;
        if (!content || !content.trim()) {
            return res.status(400).json({ success: false, message: 'محتوى الرسالة مطلوب' });
        }

        const appeal = await Appeal.findById(req.params.id);
        if (!appeal) {
            return res.status(404).json({ success: false, message: 'الاستئناف غير موجود' });
        }

        const newMessage = {
            sender: 'admin',
            authorId: req.user._id,
            content: content.trim(),
            readByUser: false,
            readByAdmin: true,
            createdAt: new Date()
        };
        appeal.messages.push(newMessage);
        appeal.unreadForUser = (appeal.unreadForUser || 0) + 1;
        // النقل التلقائي: pending → under_review عند أول رد من الأدمن
        if (appeal.status === 'pending') {
            appeal.status = 'under_review';
            appeal.statusHistory.push({
                status: 'under_review',
                note: 'بدأت المراجعة',
                changedBy: req.user._id,
                changedAt: new Date()
            });
        }
        await appeal.save();

        // ✅ Real-time: بث رسالة الأدمن عبر Socket للمستخدم (فورية بدون push)
        if (global.io) {
            const savedMsg = appeal.messages[appeal.messages.length - 1];
            global.io.to(`user:${appeal.user.toString()}`).emit('appeal-message', {
                appealId: appeal._id.toString(),
                message: {
                    _id: savedMsg._id?.toString(),
                    sender: savedMsg.sender,
                    authorId: savedMsg.authorId?.toString(),
                    content: savedMsg.content,
                    createdAt: savedMsg.createdAt
                },
                status: appeal.status,
                unreadForUser: appeal.unreadForUser
            });
        }

        // ✅ email للاستئناف العام (لا يوجد push لأن المستخدم ليس له token)
        if (appeal.isPublicAppeal && appeal.publicEmail) {
            try {
                await sendAppealUpdate(appeal.publicEmail, {
                    status: 'reply',
                    adminMessage: content.trim(),
                    appealId: appeal._id.toString()
                });
            } catch (e) { console.error('Appeal email error:', e.message); }
        }

        // إشعار + push
        try {
            const title = 'رد جديد على استئنافك';
            const body = content.trim().length > 80 ? content.trim().slice(0, 80) + '…' : content.trim();
            await Notification.create({
                title,
                body,
                type: 'system',
                recipients: 'specific',
                targetUsers: [appeal.user],
                sender: req.user._id,
                status: 'sent',
                priority: 'high',
                sentAt: new Date(),
                sentCount: 1
            });

            const targetUser = await User.findById(appeal.user);
            if (targetUser && (targetUser.deviceToken || targetUser.fcmToken)) {
                await notificationService.sendPush(
                    targetUser.deviceToken || targetUser.fcmToken,
                    title,
                    body,
                    { type: 'appeal_reply', appealId: appeal._id.toString() }
                );
            }
        } catch (notifErr) {
            console.error('خطأ في إرسال إشعار رد الاستئناف:', notifErr);
        }

        res.json({ success: true, data: appeal });
    } catch (error) {
        console.error('خطأ في رد الإدارة على الاستئناف:', error);
        res.status(500).json({ success: false, message: 'خطأ في السيرفر' });
    }
});

// @route   POST /api/appeals/:id/mark-read
// @desc    تصفير unreadForAdmin عند فتح الأدمن للاستئناف
// @access  Private/Admin
router.post('/:id/mark-read', protect, adminOnly, async (req, res) => {
    try {
        const appeal = await Appeal.findById(req.params.id);
        if (!appeal) return res.status(404).json({ success: false, message: 'الاستئناف غير موجود' });

        if ((appeal.unreadForAdmin || 0) > 0) {
            appeal.messages.forEach(m => {
                if (m.sender === 'user' && !m.readByAdmin) m.readByAdmin = true;
            });
            appeal.unreadForAdmin = 0;
            await appeal.save();
        }
        res.json({ success: true, data: { unreadForAdmin: 0 } });
    } catch (error) {
        console.error('خطأ في mark-read الاستئناف:', error);
        res.status(500).json({ success: false, message: 'خطأ في السيرفر' });
    }
});

// @route   GET /api/appeals/admin/stats
// @desc    إحصائيات سريعة للأدمن (للـ badge في Header)
// @access  Private/Admin
// ⚠️ يجب أن يأتي قبل /:id وإلا Express يطابق "admin" كـ id
router.get('/admin/stats', protect, adminOnly, async (req, res) => {
    try {
        const [pending, underReview, awaitingReply] = await Promise.all([
            Appeal.countDocuments({ status: 'pending' }),
            Appeal.countDocuments({ status: 'under_review' }),
            // ردود مستخدمين لم يقرأها الأدمن (في استئنافات مفتوحة فقط)
            Appeal.countDocuments({
                status: { $in: ['pending', 'forwarded', 'under_review'] },
                unreadForAdmin: { $gt: 0 }
            })
        ]);
        res.json({
            success: true,
            data: {
                pending,
                underReview,
                awaitingReply,
                total: pending + underReview
            }
        });
    } catch (error) {
        console.error('خطأ في إحصائيات الاستئنافات:', error);
        res.status(500).json({ success: false, message: 'خطأ في السيرفر' });
    }
});

// @route   GET /api/appeals/:id
// @route   GET /api/appeals/my
// @desc    جلب استئنافات المستخدم
// @access  Private
// ⚠️ يجب أن يأتي هذا المسار **قبل** /:id وإلا Express يطابق "my" كـ id
router.get('/my', protect, async (req, res) => {
    try {
        const appeals = await Appeal.find({ user: req.user._id })
            .sort({ createdAt: -1 });

        // ✅ عدد الإيقافات السابقة بسبب الترويج الخارجي (لكل استئناف)
        // يساعد المستخدم على فهم تاريخه + يحفّز على الالتزام
        const externalPromoRegex = /خارجية|external|promo|حسابات|سناب|انستا|واتس|تيليجرام|زنجي|تيك ?توك/i;
        const enriched = await Promise.all(appeals.map(async (a) => {
            const obj = a.toObject();
            if (externalPromoRegex.test(a.reason || '')) {
                obj.previousSuspensionsCount = await Appeal.countDocuments({
                    user: req.user._id,
                    _id: { $ne: a._id },
                    actionType: { $in: ['suspension', 'restriction'] },
                    reason: { $regex: externalPromoRegex }
                });
            } else {
                obj.previousSuspensionsCount = 0;
            }
            return obj;
        }));

        res.status(200).json({
            success: true,
            data: enriched
        });

    } catch (error) {
        console.error('خطأ في جلب الاستئنافات:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في السيرفر'
        });
    }
});

// @route   GET /api/appeals/:id
// @desc    جلب استئناف واحد مع رسائله (للمستخدم صاحبه)
// @access  Private
router.get('/:id', protect, async (req, res) => {
    try {
        // فحص صحة الـ ObjectId قبل الاستعلام (مثلاً "my" ليس ObjectId)
        if (!req.params.id.match(/^[0-9a-fA-F]{24}$/)) {
            return res.status(400).json({ success: false, message: 'معرّف غير صالح' });
        }
        const appeal = await Appeal.findOne({ _id: req.params.id, user: req.user._id });
        if (!appeal) {
            return res.status(404).json({ success: false, message: 'الاستئناف غير موجود' });
        }

        // تعليم كل رسائل الأدمن كمقروءة + صفر عداد
        let changed = false;
        (appeal.messages || []).forEach(m => {
            if (m.sender === 'admin' && !m.readByUser) {
                m.readByUser = true;
                changed = true;
            }
        });
        if (changed || appeal.unreadForUser > 0) {
            appeal.unreadForUser = 0;
            await appeal.save();
        }

        // ✅ عدد الإيقافات السابقة بسبب الترويج الخارجي
        const externalPromoRegex = /خارجية|external|promo|حسابات|سناب|انستا|واتس|تيليجرام|زنجي|تيك ?توك/i;
        const result = appeal.toObject();
        if (externalPromoRegex.test(appeal.reason || '')) {
            result.previousSuspensionsCount = await Appeal.countDocuments({
                user: req.user._id,
                _id: { $ne: appeal._id },
                actionType: { $in: ['suspension', 'restriction'] },
                reason: { $regex: externalPromoRegex }
            });
        } else {
            result.previousSuspensionsCount = 0;
        }

        res.json({ success: true, data: result });
    } catch (error) {
        console.error('خطأ في جلب الاستئناف:', error);
        res.status(500).json({ success: false, message: 'خطأ في السيرفر' });
    }
});

// @route   GET /api/appeals
// @desc    جلب جميع الاستئنافات (أدمن)
// @access  Private/Admin
router.get('/', protect, adminOnly, async (req, res) => {
    try {
        const {
            page = 1,
            limit = 20,
            status
        } = req.query;

        const filter = {};
        if (status) filter.status = status;

        // ✅ ترتيب أولوي: قيد الانتظار → قيد المراجعة → forwarded → مقبولة → مرفوضة
        // داخل كل مجموعة: الأحدث أولاً
        const STATUS_ORDER = { pending: 1, under_review: 2, forwarded: 3, approved: 4, rejected: 5 };

        const appeals = await Appeal.find(filter)
            .populate('user', 'name email avatar profileImage halaId createdAt isActive isPremium suspension restrictions warnings bannedWords country birthDate gender lastLogin isOnline deviceFingerprint')
            .populate('resolvedBy', 'name');

        // فلترة + ترتيب يدوي (الـ count صغير، لا حاجة لـ aggregation)
        const visibleAppeals = appeals
            .filter(appeal => {
                // فقط نستثني الأبيلز اللي مستخدمها محذوف
                // (المحظورين والمعلّقين يجب أن تظهر استئنافاتهم — نحن نراجعها!)
                return !!appeal.user;
            })
            .sort((a, b) => {
                const orderA = STATUS_ORDER[a.status] || 99;
                const orderB = STATUS_ORDER[b.status] || 99;
                if (orderA !== orderB) return orderA - orderB;
                return new Date(b.createdAt) - new Date(a.createdAt);
            });

        const totalFiltered = visibleAppeals.length;
        const startIdx = (page - 1) * limit;
        const pagedAppeals = visibleAppeals.slice(startIdx, startIdx + Number(limit));

        // ✅ تخصيب: سجل الاستئنافات لكل appeal (للصفحة الحالية فقط)
        // نعرض دائماً totalPastAppeals لكل المستخدمين، وإذا الحالة ترويج
        // خارجي نعرض previousSuspensionsCount مع التوصيات.
        const enriched = await Promise.all(pagedAppeals.map(async (a) => {
            const obj = a.toObject();
            const user = a.user;

            // 1. عدد الاستئنافات السابقة (أي سبب) — لكل المستخدمين
            obj.totalPastAppeals = await Appeal.countDocuments({
                user: user._id,
                _id: { $ne: a._id }
            });

            // 2. هل الحالة ترويج خارجي؟ نتحقق من ٣ مصادر موثوقة على المستخدم
            // (لا نعتمد على نص الاستئناف — لأنه ما يكتبه المستخدم بنفسه)
            const isExternalPromoCase =
                user?.restrictions?.restrictionReason === 'external_promotion' ||
                user?.suspension?.reason === 'external_promotion_repeat' ||
                (user?.externalPromo?.violations || 0) > 0;

            obj.isExternalPromoCase = isExternalPromoCase;

            // 3. لو ترويج خارجي → نحسب الإيقافات السابقة بنفس النوع
            if (isExternalPromoCase) {
                obj.previousSuspensionsCount = await Appeal.countDocuments({
                    user: user._id,
                    _id: { $ne: a._id },
                    actionType: { $in: ['suspension', 'restriction'] }
                });
            } else {
                obj.previousSuspensionsCount = 0;
            }

            return obj;
        }));

        // ✅ stats من DB مباشرة (مش من الـ list — لأن visible فلتر بعض)
        const [pending, underReview, forwarded, approved, rejected] = await Promise.all([
            Appeal.countDocuments({ status: 'pending' }),
            Appeal.countDocuments({ status: 'under_review' }),
            Appeal.countDocuments({ status: 'forwarded' }),
            Appeal.countDocuments({ status: 'approved' }),
            Appeal.countDocuments({ status: 'rejected' })
        ]);

        res.status(200).json({
            success: true,
            data: {
                appeals: enriched,
                totalPages: Math.ceil(totalFiltered / limit),
                currentPage: Number(page),
                total: totalFiltered,
                stats: {
                    total: pending + underReview + forwarded + approved + rejected,
                    pending,
                    forwarded,
                    under_review: underReview,
                    approved,
                    rejected
                }
            }
        });

    } catch (error) {
        console.error('خطأ في جلب الاستئنافات:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في السيرفر'
        });
    }
});

// @route   PUT /api/appeals/:id/status
// @desc    تحديث حالة الاستئناف (أدمن)
// @access  Private/Admin
router.put('/:id/status', protect, adminOnly, async (req, res) => {
    try {
        const { status, adminNote } = req.body;

        if (!status) {
            return res.status(400).json({
                success: false,
                message: 'الحالة مطلوبة'
            });
        }

        const appeal = await Appeal.findById(req.params.id);

        if (!appeal) {
            return res.status(404).json({
                success: false,
                message: 'الاستئناف غير موجود'
            });
        }

        // تحديث الحالة
        appeal.status = status;
        if (adminNote) appeal.adminNote = adminNote;

        // إضافة للسجل
        appeal.statusHistory.push({
            status,
            note: adminNote || '',
            changedBy: req.user._id,
            changedAt: new Date()
        });

        // إذا تمت الموافقة أو الرفض
        if (status === 'approved' || status === 'rejected') {
            appeal.resolvedBy = req.user._id;
            appeal.resolvedAt = new Date();
        }

        // إذا تمت الموافقة: رفع التعليق + فك التقييد عن المستخدم
        if (status === 'approved') {
            await User.findByIdAndUpdate(appeal.user, {
                'suspension.isSuspended': false,
                'suspension.suspendedUntil': null,
                'suspension.level': 0,
                'suspension.reason': null,
                // ✅ فك جميع التقييدات
                'restrictions.messagingRestricted': false,
                'restrictions.messagingRestrictedUntil': null,
                'restrictions.messagingRestrictedLevel': null,
                'restrictions.restrictionReason': null,
                'restrictions.photoBlocked': false,
                'restrictions.photoBlockedUntil': null,
                'restrictions.photoBlockedReason': null,
                'restrictions.nameBlocked': false,
                'restrictions.nameBlockedUntil': null,
                'restrictions.nameBlockedReason': null,
                // ✅ فك حظر الكلمات المحظورة + تصفير العدّاد
                'bannedWords.isBanned': false,
                'bannedWords.bannedAt': null,
                'bannedWords.banReason': null,
                'bannedWords.violations': 0,
                'bannedWords.lastViolationDate': null,
                // ✅ تفعيل الحساب (لأن أي حظر يضع isActive=false)
                isActive: true
            });

            // إذا كان حظر جهاز: إزالة حظر الجهاز
            if (appeal.actionType === 'device_ban') {
                await BannedDevice.updateMany(
                    { originalUserId: appeal.user, isActive: true },
                    { isActive: false }
                );
            }

            // إذا كان حظر جهاز: إزالة حظر الجهاز
            if (appeal.actionType === 'device_ban') {
                await BannedDevice.updateMany(
                    { originalUserId: appeal.user, isActive: true },
                    { isActive: false }
                );
            }
        }

        await appeal.save();

        // إرسال إشعار للمستخدم
        try {
            const notifTitle = status === 'approved'
                ? 'تمت الموافقة على استئنافك ✅'
                : status === 'rejected'
                ? 'تم رفض استئنافك'
                : 'تحديث على استئنافك';

            const notifBody = status === 'approved'
                ? 'تم رفع التقييد عن حسابك. مرحباً بك مجدداً في هلا!'
                : status === 'rejected'
                ? 'للأسف تم رفض استئنافك. يمكنك تقديم استئناف جديد لاحقاً.'
                : 'تم تحديث حالة استئنافك. افتح التطبيق للتفاصيل.';

            await Notification.create({
                title: notifTitle,
                body: notifBody,
                type: 'system',
                recipients: 'specific',
                targetUsers: [appeal.user],
                sender: req.user._id,
                status: 'sent',
                priority: 'high',
                sentAt: new Date(),
                sentCount: 1
            });

            const targetUser = await User.findById(appeal.user);
            if (targetUser && targetUser.deviceToken) {
                await notificationService.sendPush(
                    targetUser.deviceToken,
                    notifTitle,
                    notifBody,
                    { type: 'appeal_update', appealId: appeal._id.toString(), status }
                );
            }

            // ✅ email للاستئناف العام (المستخدم بدون auth token)
            if (appeal.isPublicAppeal && appeal.publicEmail && (status === 'approved' || status === 'rejected')) {
                try {
                    await sendAppealUpdate(appeal.publicEmail, {
                        status,
                        adminMessage: adminNote || null,
                        appealId: appeal._id.toString()
                    });
                } catch (e) { console.error('Appeal email error:', e.message); }
            }
        } catch (notifErr) {
            console.error('خطأ في إرسال إشعار الاستئناف:', notifErr);
        }

        res.status(200).json({
            success: true,
            message: 'تم تحديث حالة الاستئناف',
            data: appeal
        });

    } catch (error) {
        console.error('خطأ في تحديث الاستئناف:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في السيرفر'
        });
    }
});

module.exports = router;
