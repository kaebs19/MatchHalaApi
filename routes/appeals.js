// HalaChat - Appeals Routes
// المسارات الخاصة بالاستئنافات

const express = require('express');
const router = express.Router();
const Appeal = require('../models/Appeal');
const User = require('../models/User');
const BannedDevice = require('../models/BannedDevice');
const Notification = require('../models/Notification');
const { protect, adminOnly } = require('../middleware/auth');
const { sendToDevice } = require('../config/firebase');
const { checkBannedWords } = require('./bannedWords');
const { sendAppealUpdate } = require('../services/emailService');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// ✅ إعداد multer لرفع صور المشرف في طلبات المراجعة
const appealsUploadDir = path.join(__dirname, '..', 'uploads', 'appeals');
if (!fs.existsSync(appealsUploadDir)) {
    fs.mkdirSync(appealsUploadDir, { recursive: true });
}
const appealImageUpload = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => cb(null, appealsUploadDir),
        filename: (req, file, cb) => {
            const uniqueName = `appeal-${Date.now()}-${Math.random().toString(36).substr(2, 9)}${path.extname(file.originalname)}`;
            cb(null, uniqueName);
        }
    }),
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
    fileFilter: (req, file, cb) => {
        const ok = /jpeg|jpg|png|gif|webp/;
        if (ok.test(path.extname(file.originalname).toLowerCase()) && ok.test(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('فقط الصور مسموحة (JPEG, PNG, GIF, WEBP)'));
        }
    }
});

/// رابط كامل لصورة طلب المراجعة
function appealImageFullUrl(req, relativePath) {
    if (!relativePath) return null;
    if (/^https?:\/\//.test(relativePath)) return relativePath;
    const base = `${req.protocol}://${req.get('host')}`;
    return relativePath.startsWith('/') ? base + relativePath : `${base}/${relativePath}`;
}

// ════════════════════════════════════════════════════════════════
// إغلاق تلقائي للاستئنافات المنتهية
// إذا انتهت مدة الإيقاف/التقييد (أو رُفعت) ولم يبقَ على المستخدم أي عقوبة
// فعّالة → لم يعد هناك ما يُستأنف عليه، فيختفي الاستئناف من لوحة الأدمن.
// (حظر الجهاز مستثنى — لأنه محفوظ في BannedDevice ولا ينتهي بمدة)
// ════════════════════════════════════════════════════════════════
const OPEN_STATUSES = ['pending', 'forwarded', 'under_review'];

function hasActivePenalty(user, now) {
    if (!user) return false;

    const stillOn = (flag, until) => !!flag && (!until || new Date(until) > now);

    const s = user.suspension || {};
    if (stillOn(s.isSuspended, s.suspendedUntil)) return true;

    const h = user.hidden || {};
    if (stillOn(h.isHidden, h.hiddenUntil)) return true;

    const r = user.restrictions || {};
    if (stillOn(r.messagingRestricted, r.messagingRestrictedUntil)) return true;
    if (stillOn(r.photoBlocked, r.photoBlockedUntil)) return true;
    if (stillOn(r.nameBlocked, r.nameBlockedUntil)) return true;
    if (stillOn(r.bioBlocked, r.bioBlockedUntil)) return true;

    if (user.bannedWords?.isBanned) return true;
    if (user.isActive === false) return true;

    return false;
}

// يُغلق الاستئنافات المفتوحة التي حُذف صاحبها (deleteOne يمسح المستند فيعود
// populate بـ null). كانت تبقى «قيد الانتظار» إلى الأبد: ٩٥ على الإنتاج، تُحصى
// في الإحصاء ولا يمكن فتحها. حذف الحساب من الآن يُغلقها لحظتها
// (utils/cleanupDeletedUser)، وهذا المسح يلتقط ما سبق وأي فجوة.
async function sweepOrphanAppeals() {
    try {
        const now = new Date();
        const open = await Appeal.find({
            status: { $in: OPEN_STATUSES },
            autoClosed: { $ne: true }
        }).select('user').populate('user', '_id').lean();

        const orphanIds = open.filter(a => !a.user).map(a => a._id);
        if (orphanIds.length) {
            await Appeal.updateMany(
                { _id: { $in: orphanIds } },
                // (لا $push في statusHistory: enum الحالة لا يحوي auto_closed — كما في sweepExpiredAppeals)
                { $set: { autoClosed: true, autoClosedAt: now } }
            );
        }
        return orphanIds.length;
    } catch (e) {
        console.error('خطأ في إغلاق استئنافات الحسابات المحذوفة:', e.message);
        return 0;
    }
}

// يُعلّم الاستئنافات المفتوحة التي انتهت عقوبتها بـ autoClosed
async function sweepExpiredAppeals() {
    try {
        const now = new Date();
        const openAppeals = await Appeal.find({
            status: { $in: OPEN_STATUSES },
            autoClosed: { $ne: true },
            actionType: { $ne: 'device_ban' }
        })
            .select('user actionType')
            .populate('user', 'suspension hidden restrictions bannedWords isActive')
            .lean();

        const expiredIds = openAppeals
            .filter(a => a.user && !hasActivePenalty(a.user, now))
            .map(a => a._id);

        if (expiredIds.length) {
            await Appeal.updateMany(
                { _id: { $in: expiredIds } },
                { $set: { autoClosed: true, autoClosedAt: now } }
            );
        }
        return expiredIds.length;
    } catch (e) {
        console.error('خطأ في إغلاق الاستئنافات المنتهية:', e.message);
        return 0;
    }
}

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
        // ✅ الاستئنافات المغلقة تلقائياً (انتهت العقوبة) لا تمنع استئنافاً جديداً
        const existingPending = await Appeal.findOne({
            user: req.user._id,
            status: { $in: OPEN_STATUSES },
            autoClosed: { $ne: true }
        });

        if (existingPending) {
            return res.status(400).json({
                success: false,
                message: 'لديك استئناف قيد المراجعة بالفعل'
            });
        }

        // ✅ تحديد نوع الاستئناف تلقائياً لو لم يُحدد (hide_appeal لو المستخدم مخفي وليس موقوف)
        let resolvedActionType = actionType || 'suspension';
        const isHidden = req.user.hidden?.isHidden &&
            (!req.user.hidden.hiddenUntil || new Date(req.user.hidden.hiddenUntil) > new Date());
        if (!actionType && isHidden && !req.user.suspension?.isSuspended) {
            resolvedActionType = 'hide';
        }

        const appeal = await Appeal.create({
            user: req.user._id,
            reason: reason.trim(),
            actionType: resolvedActionType,
            appealType: resolvedActionType === 'hide' ? 'hide' : 'suspension',
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
router.post('/:id/admin-reply', protect, adminOnly, appealImageUpload.single('image'), async (req, res) => {
    try {
        const { content } = req.body;
        const imagePath = req.file ? `/uploads/appeals/${req.file.filename}` : null;
        // ✅ يجب وجود نص أو صورة على الأقل
        if ((!content || !content.trim()) && !imagePath) {
            return res.status(400).json({ success: false, message: 'أرفق نصاً أو صورة' });
        }

        const appeal = await Appeal.findById(req.params.id);
        if (!appeal) {
            return res.status(404).json({ success: false, message: 'الاستئناف غير موجود' });
        }

        const newMessage = {
            sender: 'admin',
            authorId: req.user._id,
            content: (content || '').trim(),
            image: imagePath,
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
                    image: appealImageFullUrl(req, savedMsg.image),
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
            const title = 'رد جديد على طلب مراجعتك';
            const trimmed = (content || '').trim();
            const body = trimmed
                ? (trimmed.length > 80 ? trimmed.slice(0, 80) + '…' : trimmed)
                : '📷 أرسل المشرف صورة';
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
                await sendToDevice(
                    targetUser.deviceToken || targetUser.fcmToken,
                    { title, body },
                    { type: 'appeal_reply', appealId: appeal._id.toString() }
                );
            }
        } catch (notifErr) {
            console.error('خطأ في إرسال إشعار رد الاستئناف:', notifErr);
        }

        // ✅ حوّل مسارات الصور إلى روابط كاملة قبل الإرسال
        const out = appeal.toObject();
        if (Array.isArray(out.messages)) {
            out.messages = out.messages.map(m => ({ ...m, image: appealImageFullUrl(req, m.image) }));
        }
        res.json({ success: true, data: out });
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
        // ✅ إخفاء الاستئنافات التي انتهت مدة عقوبتها قبل العد
        await sweepExpiredAppeals();
        const notClosed = { autoClosed: { $ne: true } };

        const [pending, underReview, awaitingReply] = await Promise.all([
            Appeal.countDocuments({ status: 'pending', ...notClosed }),
            Appeal.countDocuments({ status: 'under_review', ...notClosed }),
            // ردود مستخدمين لم يقرأها الأدمن (في استئنافات مفتوحة فقط)
            Appeal.countDocuments({
                status: { $in: OPEN_STATUSES },
                unreadForAdmin: { $gt: 0 },
                ...notClosed
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
            // ✅ روابط كاملة لصور المشرف في الرسائل
            if (Array.isArray(obj.messages)) {
                obj.messages = obj.messages.map(m => ({ ...m, image: appealImageFullUrl(req, m.image) }));
            }
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
        // ✅ روابط كاملة لصور المشرف في الرسائل
        if (Array.isArray(result.messages)) {
            result.messages = result.messages.map(m => ({ ...m, image: appealImageFullUrl(req, m.image) }));
        }
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

        // ✅ إخفاء الاستئنافات التي انتهت مدة عقوبتها قبل الجلب
        await sweepExpiredAppeals();
        await sweepOrphanAppeals();

        // ⚠️ كان الفلتر يستثني autoClosed نهائياً، فتختفي من اللوحة استئنافات
        //    لم يرها أحد: عند القياس على الإنتاج كانت **٣٠٤ مراجعة pending**
        //    مخفية مقابل ٩٢ ظاهرة — أي أن ثلاثة أرباع ما ينتظر الردّ كان
        //    غير مرئي، لأن مدّة العقوبة انقضت قبل أن يفتحها أحد.
        //    الآن تظهر، مرتّبةً في الأسفل وبحالة خاصة، ويمكن عزلها بفلتر.
        const filter = {};
        if (status === 'auto_closed') {
            filter.autoClosed = true;
        } else if (status) {
            filter.status = status;
            filter.autoClosed = { $ne: true };
        }

        // ✅ ترتيب أولوي: قيد الانتظار → قيد المراجعة → forwarded → مقبولة → مرفوضة
        // المغلقة تلقائياً في الذيل دائماً — لا تُزاحم ما ينتظر قراراً
        const STATUS_ORDER = { pending: 1, under_review: 2, forwarded: 3, approved: 4, rejected: 5 };

        const appeals = await Appeal.find(filter)
            .populate('user', 'name email avatar profileImage halaId createdAt isActive isPremium suspension restrictions warnings bannedWords country birthDate gender lastLogin isOnline deviceFingerprint')
            .populate('resolvedBy', 'name');

        // ⚠️ populate يُبدّل معرّف مستخدمٍ محذوف بـ null فيضيع المعرّف نفسه —
        //    نحتفظ به لأن استئناف حظر الجهاز يُقبَل عليه (BannedDevice.originalUserId)
        const rawUserIds = new Map(
            (await Appeal.find(filter).select('user').lean()).map(a => [String(a._id), a.user])
        );

        // ⚠️ كانت القائمة تُسقط كل استئناف بلا حساب وتُخبر اللوحة «أصحابها حذفوا
        //    حساباتهم». لكن ٩٥ استئنافاً معلّقاً على الإنتاج كانت كلها استئنافات
        //    **حظر جهاز**: صاحبه حذف حسابه ثم استأنف من الجهاز — والقرار (فكّ الجهاز)
        //    لا يحتاج حساباً. تُخفى فقط استئنافات الحساب التي لم يبقَ لها حساب.
        const isActionable = (a) => !!a.user || a.actionType === 'device_ban';
        const deletedUserAppeals = appeals.filter(a => !isActionable(a)).length;

        const visibleAppeals = appeals
            .filter(isActionable)
            .sort((a, b) => {
                // المغلقة تلقائياً في الذيل مهما كانت حالتها
                if (!!a.autoClosed !== !!b.autoClosed) return a.autoClosed ? 1 : -1;
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
            const userId = user?._id || rawUserIds.get(String(a._id));
            obj.userDeleted = !user;
            obj.userIdRaw = userId || null;

            // 1. عدد الاستئنافات السابقة (أي سبب) — لكل المستخدمين
            obj.totalPastAppeals = userId ? await Appeal.countDocuments({
                user: userId,
                _id: { $ne: a._id }
            }) : 0;

            // 2. هل الحالة ترويج خارجي؟ نتحقق من ٣ مصادر موثوقة على المستخدم
            // (لا نعتمد على نص الاستئناف — لأنه ما يكتبه المستخدم بنفسه)
            const isExternalPromoCase =
                user?.restrictions?.restrictionReason === 'external_promotion' ||
                user?.suspension?.reason === 'external_promotion_repeat' ||
                (user?.externalPromo?.violations || 0) > 0;

            obj.isExternalPromoCase = isExternalPromoCase;

            // 3. لو ترويج خارجي → نحسب الإيقافات السابقة بنفس النوع
            if (isExternalPromoCase && userId) {
                obj.previousSuspensionsCount = await Appeal.countDocuments({
                    user: userId,
                    _id: { $ne: a._id },
                    actionType: { $in: ['suspension', 'restriction'] }
                });
            } else {
                obj.previousSuspensionsCount = 0;
            }

            return obj;
        }));

        // ✅ stats من DB مباشرة (مش من الـ list — لأن visible فلتر بعض)
        const notClosed = { autoClosed: { $ne: true } };
        const [pending, underReview, forwarded, approved, rejected, autoClosed] = await Promise.all([
            Appeal.countDocuments({ status: 'pending', ...notClosed }),
            Appeal.countDocuments({ status: 'under_review', ...notClosed }),
            Appeal.countDocuments({ status: 'forwarded', ...notClosed }),
            Appeal.countDocuments({ status: 'approved', ...notClosed }),
            Appeal.countDocuments({ status: 'rejected', ...notClosed }),
            Appeal.countDocuments({ autoClosed: true })
        ]);

        res.status(200).json({
            success: true,
            data: {
                appeals: enriched,
                totalPages: Math.ceil(totalFiltered / limit),
                currentPage: Number(page),
                total: totalFiltered,
                deletedUserAppeals,
                stats: {
                    total: pending + underReview + forwarded + approved + rejected,
                    pending,
                    forwarded,
                    under_review: underReview,
                    approved,
                    rejected,
                    auto_closed: autoClosed
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
        let wasExternalPromoCase = false;
        if (status === 'approved') {
            // ✅ تحقق إن كانت الحالة ترويج خارجي (قبل التصفير)
            const targetUserBefore = await User.findById(appeal.user)
                .select('suspension restrictions externalPromo').lean();
            wasExternalPromoCase =
                targetUserBefore?.suspension?.reason === 'external_promotion_repeat' ||
                targetUserBefore?.restrictions?.restrictionReason === 'external_promotion' ||
                (targetUserBefore?.externalPromo?.violations || 0) >= 5;

            const updates = {
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
                // ✅ فك قفل bio (لو كان مقفلاً من external_promo)
                'externalPromo.bioLockedUntil': null,
                'externalPromo.suspendedAt': null,
                // ✅ تفعيل الحساب
                isActive: true
            };

            if (wasExternalPromoCase) {
                // ✅ فرصتان فقط: نضع violations=8 (HARD=10، فرصتان قبل الإيقاف)
                // - مخالفة 1 → counter 9 → soft lock 24س
                // - مخالفة 2 → counter 10 → إيقاف 7 أيام
                updates['externalPromo.violations'] = 8;
                updates['externalPromo.lastViolationAt'] = new Date();
            } else {
                // ✅ ليس ترويجاً خارجياً → reset كامل
                updates['externalPromo.violations'] = 0;
                updates['externalPromo.lastViolationAt'] = null;
            }

            await User.findByIdAndUpdate(appeal.user, updates);

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
            // ✅ عنوان مختلف للترويج الخارجي (تنبيه شديد اللهجة)
            const notifTitle = status === 'approved'
                ? (wasExternalPromoCase
                    ? '⚠️ تنبيه شديد: فرصتان فقط قبل الإيقاف الدائم'
                    : 'تمت الموافقة على استئنافك ✅')
                : status === 'rejected'
                ? 'تم رفض استئنافك'
                : 'تحديث على استئنافك';

            // ✅ جسم مختلف للترويج الخارجي
            const notifBody = status === 'approved'
                ? (wasExternalPromoCase
                    ? 'تم رفع التقييد كاستثناء واحد. تذكير صارم: مشاركة الحسابات الخارجية أو أرقام التواصل ممنوعة منعاً باتاً. لديك فرصتان فقط — أي مخالفة قادمة ستؤدي إلى قفل المراسلة 24 ساعة، والتي تليها إلى إيقاف الحساب 7 أيام، ثم حظر دائم.'
                    : 'تم رفع التقييد عن حسابك. مرحباً بك مجدداً في هلا!')
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
            if (targetUser && (targetUser.deviceToken || targetUser.fcmToken)) {
                await sendToDevice(
                    targetUser.deviceToken || targetUser.fcmToken,
                    { title: notifTitle, body: notifBody },
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
