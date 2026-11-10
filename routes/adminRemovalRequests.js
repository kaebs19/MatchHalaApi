// لوحة التحكم — طلبات إزالة المحتوى (أدمن فقط)
//   GET    /api/admin/removal-requests                 القائمة (?status=&type=&q=&page=)
//   GET    /api/admin/removal-requests/stats           العدّاد للقائمة الجانبية
//   GET    /api/admin/removal-requests/:id             التفاصيل + الحساب المقصود
//   PATCH  /api/admin/removal-requests/:id             { status, adminNote, targetUserId, message, notify }
//   GET    /api/admin/removal-requests/:id/evidence/:i صورة دليل (مصادَق — الملفات خارج /uploads)
//   DELETE /api/admin/removal-requests/:id             حذف الطلب وأدلته (طلبات مزعجة)

const express = require('express');
const mongoose = require('mongoose');
const fs = require('fs');
const router = express.Router();

const { protect, adminOnly } = require('../middleware/auth');
const RemovalRequest = require('../models/RemovalRequest');
const User = require('../models/User');
const rr = require('../utils/removalRequests');

router.use(protect, adminOnly);

const validId = (req, res, next) => mongoose.isValidObjectId(req.params.id)
    ? next()
    : res.status(400).json({ success: false, message: 'معرّف غير صالح' });

const fail = (res, error) => {
    console.error('خطأ في طلبات الإزالة (أدمن):', error);
    res.status(500).json({ success: false, message: 'خطأ في السيرفر' });
};

const USER_FIELDS = 'name email halaId profileImage isActive isPremium accountStatus suspensionReason createdAt verification.isVerified';

router.get('/stats', async (req, res) => {
    try {
        const [fresh, reviewing] = await Promise.all([
            RemovalRequest.countDocuments({ status: 'new' }),
            RemovalRequest.countDocuments({ status: 'reviewing' })
        ]);
        res.json({ success: true, data: { new: fresh, reviewing, open: fresh + reviewing } });
    } catch (error) { fail(res, error); }
});

router.get('/', async (req, res) => {
    try {
        const page = Math.max(1, parseInt(req.query.page, 10) || 1);
        const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
        const filter = {};
        if (['new', 'reviewing', 'removed', 'rejected'].includes(req.query.status)) filter.status = req.query.status;
        else if (req.query.status === 'open') filter.status = { $in: ['new', 'reviewing'] };
        if (rr.TYPE_LABELS[req.query.type]) filter.type = req.query.type;

        const q = String(req.query.q || '').trim().slice(0, 100);
        if (q) {
            const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            filter.$or = [
                { reference: { $regex: escaped, $options: 'i' } },
                { requesterEmail: { $regex: escaped, $options: 'i' } },
                { target: { $regex: escaped, $options: 'i' } }
            ];
        }

        const [items, total] = await Promise.all([
            RemovalRequest.find(filter)
                .sort({ createdAt: -1 })
                .skip((page - 1) * limit)
                .limit(limit)
                .select('-ipHash -userAgent')
                .populate('targetUser', 'name halaId profileImage isActive')
                .lean(),
            RemovalRequest.countDocuments(filter)
        ]);

        res.json({ success: true, data: { items, total, page, pages: Math.ceil(total / limit) } });
    } catch (error) { fail(res, error); }
});

router.get('/:id', validId, async (req, res) => {
    try {
        const item = await RemovalRequest.findById(req.params.id)
            .populate('targetUser', USER_FIELDS)
            .populate('handledBy', 'name')
            .lean();
        if (!item) return res.status(404).json({ success: false, message: 'الطلب غير موجود' });

        // طلبات أخرى من نفس البريد أو عن نفس الحساب — للسياق ولكشف الإساءة
        const related = await RemovalRequest.find({
            _id: { $ne: item._id },
            $or: [
                { requesterEmail: item.requesterEmail },
                ...(item.targetUser ? [{ targetUser: item.targetUser._id }] : [])
            ]
        }).sort({ createdAt: -1 }).limit(10).select('reference type status createdAt requesterEmail').lean();

        delete item.ipHash;
        res.json({ success: true, data: { ...item, related } });
    } catch (error) { fail(res, error); }
});

router.patch('/:id', validId, async (req, res) => {
    try {
        const item = await RemovalRequest.findById(req.params.id);
        if (!item) return res.status(404).json({ success: false, message: 'الطلب غير موجود' });

        const { status, adminNote, targetUserId, message, notify } = req.body || {};

        if (status !== undefined) {
            if (!['new', 'reviewing', 'removed', 'rejected'].includes(status)) {
                return res.status(400).json({ success: false, message: 'حالة غير صالحة' });
            }
            item.status = status;
            item.handledBy = req.user._id;
            item.handledAt = new Date();
        }
        if (adminNote !== undefined) item.adminNote = String(adminNote).slice(0, 3000);

        if (targetUserId !== undefined) {
            if (targetUserId === null || targetUserId === '') {
                item.targetUser = null;
                item.targetMatchedBy = null;
            } else {
                // يقبل المعرّف أو Hala ID
                const key = String(targetUserId).trim();
                const user = mongoose.isValidObjectId(key)
                    ? await User.findById(key).select('_id').lean()
                    : await User.findOne({ halaId: { $regex: `^${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' } }).select('_id').lean();
                if (!user) return res.status(404).json({ success: false, message: 'لم يُعثر على الحساب' });
                item.targetUser = user._id;
                item.targetMatchedBy = 'admin';
            }
        }

        let emailed = false;
        const text = typeof message === 'string' ? message.trim().slice(0, 3000) : '';
        if (notify && text) {
            item.responseMessage = text;
            emailed = await rr.sendDecision(item, text);
        }

        await item.save();
        const fresh = await RemovalRequest.findById(item._id)
            .populate('targetUser', USER_FIELDS)
            .populate('handledBy', 'name')
            .select('-ipHash')
            .lean();
        res.json({
            success: true,
            message: notify && text
                ? (emailed ? 'حُفظ وأُرسل البريد لصاحب الطلب' : 'حُفظ، لكن تعذّر إرسال البريد')
                : 'تم الحفظ',
            data: fresh
        });
    } catch (error) { fail(res, error); }
});

router.get('/:id/evidence/:index', validId, async (req, res) => {
    try {
        const item = await RemovalRequest.findById(req.params.id).select('evidence').lean();
        const name = item && item.evidence[parseInt(req.params.index, 10)];
        const file = name && rr.evidencePath(name);
        if (!file || !fs.existsSync(file)) return res.status(404).json({ success: false, message: 'الملف غير موجود' });
        res.set('Cache-Control', 'private, no-store');
        res.set('X-Content-Type-Options', 'nosniff');
        res.type('image/jpeg');
        fs.createReadStream(file).pipe(res);
    } catch (error) { fail(res, error); }
});

router.delete('/:id', validId, async (req, res) => {
    try {
        const item = await RemovalRequest.findByIdAndDelete(req.params.id).lean();
        if (!item) return res.status(404).json({ success: false, message: 'الطلب غير موجود' });
        rr.removeEvidence(item.evidence);
        res.json({ success: true, message: 'حُذف الطلب' });
    } catch (error) { fail(res, error); }
});

module.exports = router;
