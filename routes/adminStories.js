// لوحة التحكم — قصص البروفايل
//   GET    /api/admin/stories                 أحدث القصص (status=active|ended|all، reported=1، userId)
//   GET    /api/admin/stories/user/:userId    قصص مستخدم (النشطة + آخر 30 منتهية) + حالة المنع
//   GET    /api/admin/stories/:id/archived    صورة قصة مؤرشفة (مُبلَّغ عنها) — ?token= لأن <img> بلا هيدر
//   DELETE /api/admin/stories/:id             حذف قصة نشطة (removed) — المُبلَّغ عنها تُؤرشف
//   POST   /api/admin/stories/:id/release     إظهار قصة حُجبت تلقائياً بالبلاغات (heldAt ← null)
//   POST   /api/admin/stories/ban/:userId     منع النشر { days 1…365, reason, removeActive }
//   DELETE /api/admin/stories/ban/:userId     رفع المنع
const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const router = express.Router();

const { protect, adminOnly } = require('../middleware/auth');
const User = require('../models/User');
const Story = require('../models/Story');
const { endStory } = require('../utils/storySweeper');
const { EXPIRED_DIR } = require('../utils/disappearingMedia');
const pushService = require('../services/pushNotificationService');

// إبلاغ صاحب القصة بإجراء المشرف — إشعار محفوظ + push. لا يُفشل الإجراء نفسه إن تعذّر.
const notifyStoryOwner = (userId, title, body, type) =>
    pushService.sendNotificationToUser(userId, { title, body }, { type })
        .catch(e => console.error('⚠️ إشعار القصة:', e.message));

const baseUrl = () => process.env.BASE_URL || 'https://matchhala.chathala.com';

const shape = (s) => ({
    _id: s._id,
    kind: s.kind || 'image',
    text: s.text || null,
    background: s.background || 0,
    imageUrl: s.imageUrl ? `${baseUrl()}${s.imageUrl}` : null,
    archivedUrl: s.archivedPath ? `/api/admin/stories/${s._id}/archived` : null,
    status: s.status,
    viewCount: s.viewCount || 0,
    reportCount: s.reportCount || 0,
    heldAt: s.heldAt || null,
    createdAt: s.createdAt,
    expiresAt: s.expiresAt,
    endedAt: s.endedAt,
    user: s.user && s.user._id ? {
        _id: s.user._id,
        name: s.user.name,
        profileImage: s.user.profileImage ? (String(s.user.profileImage).startsWith('http') ? s.user.profileImage : `${baseUrl()}${s.user.profileImage}`) : null
    } : undefined
});

// قبل protect: <img src> لا يرسل Authorization — التوكن من الهيدر أو ?token=
router.get('/:id/archived', async (req, res) => {
    try {
        const bearer = req.headers.authorization?.startsWith('Bearer') ? req.headers.authorization.split(' ')[1] : null;
        const token = bearer || req.query.token;
        if (!token) return res.status(401).json({ success: false, message: 'غير مصرح' });
        let admin;
        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            admin = await User.findById(decoded.id).select('role').lean();
        } catch (e) {
            return res.status(401).json({ success: false, message: 'توكن غير صالح' });
        }
        if (!admin || admin.role !== 'admin') return res.status(403).json({ success: false, message: 'صلاحيات غير كافية' });
        if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ success: false, message: 'معرّف غير صالح' });

        const story = await Story.findById(req.params.id).select('archivedPath').lean();
        if (!story?.archivedPath) return res.status(404).json({ success: false, message: 'لا يوجد أرشيف لهذه القصة' });
        const filePath = path.join(EXPIRED_DIR, path.basename(story.archivedPath));
        if (!fs.existsSync(filePath)) return res.status(404).json({ success: false, message: 'الملف غير موجود في الأرشيف' });
        return res.sendFile(filePath);
    } catch (error) {
        console.error('خطأ في أرشيف القصة:', error);
        res.status(500).json({ success: false, message: 'خطأ في السيرفر' });
    }
});

router.use(protect, adminOnly);

router.get('/', async (req, res) => {
    try {
        const page = Math.max(1, parseInt(req.query.page, 10) || 1);
        const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 30));
        const filter = {};
        const now = new Date();
        if (req.query.status === 'active') Object.assign(filter, { status: 'active', expiresAt: { $gt: now } });
        else if (req.query.status === 'ended') filter.status = { $ne: 'active' };
        if (req.query.reported === '1') filter.reportCount = { $gt: 0 };
        if (req.query.held === '1') filter.heldAt = { $ne: null };
        if (req.query.userId && mongoose.isValidObjectId(req.query.userId)) filter.user = req.query.userId;

        const [items, total] = await Promise.all([
            Story.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit)
                .populate('user', 'name profileImage').lean(),
            Story.countDocuments(filter)
        ]);
        res.json({ success: true, data: { stories: items.map(shape), total, page, pages: Math.ceil(total / limit) } });
    } catch (error) {
        console.error('خطأ في قائمة القصص (أدمن):', error);
        res.status(500).json({ success: false, message: 'خطأ في السيرفر' });
    }
});

router.get('/user/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        if (!mongoose.isValidObjectId(userId)) return res.status(400).json({ success: false, message: 'معرّف غير صالح' });
        const user = await User.findById(userId).select('name storyBan').lean();
        if (!user) return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
        const now = new Date();
        const [active, ended] = await Promise.all([
            Story.find({ user: userId, status: 'active', expiresAt: { $gt: now } }).sort({ createdAt: -1 }).lean(),
            Story.find({ user: userId, $or: [{ status: { $ne: 'active' } }, { expiresAt: { $lte: now } }] })
                .sort({ createdAt: -1 }).limit(60).lean()
        ]);
        const until = user.storyBan?.until && new Date(user.storyBan.until) > now ? user.storyBan.until : null;
        res.json({
            success: true,
            data: {
                active: active.map(shape),
                ended: ended.map(shape),
                ban: until ? { until, reason: user.storyBan.reason || null, at: user.storyBan.at } : null
            }
        });
    } catch (error) {
        console.error('خطأ في قصص المستخدم (أدمن):', error);
        res.status(500).json({ success: false, message: 'خطأ في السيرفر' });
    }
});

router.delete('/:id', async (req, res) => {
    try {
        if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ success: false, message: 'معرّف غير صالح' });
        const story = await Story.findOne({ _id: req.params.id, status: 'active' });
        if (!story) return res.status(404).json({ success: false, message: 'القصة غير موجودة أو انتهت' });
        await endStory(story, 'removed');
        // البلاغات المرتبطة بها: لا تُغلق تلقائياً — يقرّر المشرف من صفحة البلاغات
        notifyStoryOwner(
            story.user,
            '🗑️ حُذفت قصتك',
            'حذف فريق هلا إحدى قصصك لمخالفتها سياسة المحتوى. تكرار المخالفة قد يؤدي إلى منعك من نشر القصص.',
            'story_removed'
        );
        res.json({ success: true, message: 'تم حذف القصة' });
    } catch (error) {
        console.error('خطأ في حذف قصة (أدمن):', error);
        res.status(500).json({ success: false, message: 'خطأ في السيرفر' });
    }
});

router.post('/:id/release', async (req, res) => {
    try {
        if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ success: false, message: 'معرّف غير صالح' });
        const result = await Story.updateOne(
            { _id: req.params.id, status: 'active', heldAt: { $ne: null } },
            { $set: { heldAt: null } }
        );
        if (!result.matchedCount) return res.status(404).json({ success: false, message: 'القصة ليست محجوبة أو انتهت' });
        res.json({ success: true, message: 'أُظهرت القصة' });
    } catch (error) {
        console.error('خطأ في إظهار قصة (أدمن):', error);
        res.status(500).json({ success: false, message: 'خطأ في السيرفر' });
    }
});

router.post('/ban/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        if (!mongoose.isValidObjectId(userId)) return res.status(400).json({ success: false, message: 'معرّف غير صالح' });
        const days = parseInt(req.body?.days, 10);
        if (!Number.isFinite(days) || days < 1 || days > 365) {
            return res.status(400).json({ success: false, message: 'المدة بين 1 و365 يوماً' });
        }
        const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, 300) : null;
        const until = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
        const updated = await User.updateOne(
            { _id: userId },
            { $set: { storyBan: { until, reason: reason || null, by: req.user._id, at: new Date() } } }
        );
        if (!updated.matchedCount) return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });

        let removed = 0;
        if (req.body?.removeActive) {
            const active = await Story.find({ user: userId, status: 'active' });
            for (const s of active) { await endStory(s, 'removed'); removed++; }
        }
        const day = until.toLocaleDateString('ar-SA', { day: 'numeric', month: 'long' });
        notifyStoryOwner(
            userId,
            '🚫 مُنعت من نشر القصص',
            `لا يمكنك نشر قصص حتى ${day} لمخالفة سياسة المحتوى`
                + (reason ? ` — السبب: ${reason}` : '')
                + (removed ? `. حُذفت قصصك النشطة (${removed}).` : '.'),
            'story_banned'
        );
        res.json({ success: true, message: `مُنع من نشر القصص ${days} يوماً`, data: { until, removed } });
    } catch (error) {
        console.error('خطأ في منع القصص (أدمن):', error);
        res.status(500).json({ success: false, message: 'خطأ في السيرفر' });
    }
});

router.delete('/ban/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        if (!mongoose.isValidObjectId(userId)) return res.status(400).json({ success: false, message: 'معرّف غير صالح' });
        await User.updateOne({ _id: userId }, { $set: { 'storyBan.until': null } });
        res.json({ success: true, message: 'رُفع منع القصص' });
    } catch (error) {
        console.error('خطأ في رفع منع القصص (أدمن):', error);
        res.status(500).json({ success: false, message: 'خطأ في السيرفر' });
    }
});

module.exports = router;
