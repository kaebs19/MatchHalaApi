// لوحة التحكم — 🛡️ الصور الممنوعة (كشف العُري، utils/nudity) — أدمن فقط
//   GET   /api/admin/blocked-images/stats        { pending, last24h }
//   GET   /api/admin/blocked-images?status=&page= القائمة (مع المستخدم وعدد محاولاته خلال 7 أيام)
//   GET   /api/admin/blocked-images/:id/image     الصورة (مصادَقة — الملفات خارج /uploads)
//   PATCH /api/admin/blocked-images/:id          { status: confirmed | false_positive | pending }

const express = require('express');
const mongoose = require('mongoose');
const fs = require('fs');
const router = express.Router();

const { protect, adminOnly } = require('../middleware/auth');
const BlockedImage = require('../models/BlockedImage');
const { blockedFilePath } = require('../utils/nudity');
const { getFullUrl } = require('./mobile/helpers');

router.use(protect, adminOnly);

const fail = (res, error) => {
    console.error('خطأ في الصور الممنوعة (أدمن):', error);
    res.status(500).json({ success: false, message: 'خطأ في السيرفر' });
};
const validId = (req, res, next) => (mongoose.isValidObjectId(req.params.id)
    ? next()
    : res.status(400).json({ success: false, message: 'معرّف غير صالح' }));

router.get('/stats', async (req, res) => {
    try {
        const [pending, last24h, confirmed, falsePositive] = await Promise.all([
            BlockedImage.countDocuments({ status: 'pending' }),
            BlockedImage.countDocuments({ createdAt: { $gt: new Date(Date.now() - 86400000) } }),
            BlockedImage.countDocuments({ status: 'confirmed' }),
            BlockedImage.countDocuments({ status: 'false_positive' })
        ]);
        res.json({ success: true, data: { pending, last24h, confirmed, falsePositive } });
    } catch (error) { fail(res, error); }
});

router.get('/', async (req, res) => {
    try {
        const page = Math.max(1, parseInt(req.query.page, 10) || 1);
        const limit = 30;
        const filter = {};
        if (['pending', 'confirmed', 'false_positive'].includes(req.query.status)) filter.status = req.query.status;
        const [items, total] = await Promise.all([
            BlockedImage.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit)
                .populate('user', 'name profileImage isActive accountStatus suspension')
                .populate('reviewedBy', 'name').lean(),
            BlockedImage.countDocuments(filter)
        ]);
        // محاولات كل مستخدم خلال 7 أيام — من يكرّر هو المهمّ
        const userIds = [...new Set(items.map(i => String(i.user?._id || i.user)))].map(id => new mongoose.Types.ObjectId(id));
        const attempts = userIds.length ? await BlockedImage.aggregate([
            { $match: { user: { $in: userIds }, createdAt: { $gt: new Date(Date.now() - 7 * 86400000) } } },
            { $group: { _id: '$user', n: { $sum: 1 } } }
        ]) : [];
        const attemptMap = new Map(attempts.map(a => [String(a._id), a.n]));
        res.json({
            success: true,
            data: {
                items: items.map(i => ({
                    ...i,
                    hasImage: !!i.file,
                    file: undefined,
                    user: i.user ? { ...i.user, profileImage: getFullUrl(i.user.profileImage) } : null,
                    attempts7d: attemptMap.get(String(i.user?._id || i.user)) || 1
                })),
                total, page, pages: Math.ceil(total / limit)
            }
        });
    } catch (error) { fail(res, error); }
});

router.get('/:id/image', validId, async (req, res) => {
    try {
        const item = await BlockedImage.findById(req.params.id).select('file').lean();
        const file = item && blockedFilePath(item.file);
        if (!file || !fs.existsSync(file)) return res.status(404).json({ success: false, message: 'الملف غير موجود' });
        res.set('Cache-Control', 'private, no-store');
        res.set('X-Content-Type-Options', 'nosniff');
        res.type('image/jpeg');
        fs.createReadStream(file).pipe(res);
    } catch (error) { fail(res, error); }
});

router.patch('/:id', validId, async (req, res) => {
    try {
        const status = req.body?.status;
        if (!['pending', 'confirmed', 'false_positive'].includes(status)) {
            return res.status(400).json({ success: false, message: 'حالة غير صالحة' });
        }
        const item = await BlockedImage.findByIdAndUpdate(req.params.id, {
            $set: { status, reviewedBy: status === 'pending' ? null : req.user._id, reviewedAt: status === 'pending' ? null : new Date() }
        }, { returnDocument: 'after' }).lean();
        if (!item) return res.status(404).json({ success: false, message: 'غير موجود' });
        res.json({ success: true, data: { _id: item._id, status: item.status } });
    } catch (error) { fail(res, error); }
});

module.exports = router;
