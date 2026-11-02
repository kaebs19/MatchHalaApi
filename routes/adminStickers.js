// MatchHala - إدارة الملصقات من لوحة التحكم (أدمن فقط)
//   GET    /api/admin/stickers                     الفئات وملصقاتها
//   POST   /api/admin/stickers/categories          فئة جديدة { name }
//   PUT    /api/admin/stickers/categories/:id      { name, active, premium, order }
//   DELETE /api/admin/stickers/categories/:id      حذف الفئة وملصقاتها
//   POST   /api/admin/stickers/categories/:id/items  رفع ملصقات (images[])
//   PUT    /api/admin/stickers/items/:id           { active }
//   DELETE /api/admin/stickers/items/:id           حذف ملصق وملفه (طلب إزالة)

const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');
const router = express.Router();

const { protect, adminOnly } = require('../middleware/auth');
const Sticker = require('../models/Sticker');
const StickerCategory = require('../models/StickerCategory');
const { saveStickerFile, removeStickerFile } = require('../utils/stickerFiles');

router.use(protect, adminOnly);

const MAX_FILES = 50;
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 2 * 1024 * 1024, files: MAX_FILES },
    fileFilter: (req, file, cb) => cb(null, ['image/webp', 'image/png'].includes(file.mimetype))
}).array('images', MAX_FILES);

const validId = (req, res, next) => mongoose.isValidObjectId(req.params.id)
    ? next()
    : res.status(400).json({ success: false, message: 'معرّف غير صالح' });

const fail = (res, error) => {
    console.error('خطأ في الملصقات (أدمن):', error);
    res.status(500).json({ success: false, message: 'خطأ في السيرفر' });
};

router.get('/', async (req, res) => {
    try {
        const [categories, stickers] = await Promise.all([
            StickerCategory.find().sort({ order: 1, createdAt: 1 }).lean(),
            Sticker.find().sort({ order: 1, createdAt: 1 }).lean()
        ]);
        res.json({
            success: true,
            data: {
                categories: categories.map(c => ({
                    ...c,
                    stickers: stickers.filter(s => String(s.category) === String(c._id))
                }))
            }
        });
    } catch (error) { fail(res, error); }
});

router.post('/categories', async (req, res) => {
    try {
        const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
        if (!name) return res.status(400).json({ success: false, message: 'اسم الفئة مطلوب' });
        const order = await StickerCategory.countDocuments();
        const category = await StickerCategory.create({ name, order });
        res.status(201).json({ success: true, data: { category } });
    } catch (error) { fail(res, error); }
});

router.put('/categories/:id', validId, async (req, res) => {
    try {
        const { name, active, premium, order } = req.body || {};
        const set = {};
        if (typeof name === 'string' && name.trim()) set.name = name.trim();
        if (typeof active === 'boolean') set.active = active;
        if (typeof premium === 'boolean') set.premium = premium;
        if (Number.isInteger(order)) set.order = order;
        const category = await StickerCategory.findByIdAndUpdate(req.params.id, { $set: set }, { new: true }).lean();
        if (!category) return res.status(404).json({ success: false, message: 'الفئة غير موجودة' });
        res.json({ success: true, data: { category } });
    } catch (error) { fail(res, error); }
});

router.delete('/categories/:id', validId, async (req, res) => {
    try {
        const stickers = await Sticker.find({ category: req.params.id }).select('imageUrl').lean();
        await Sticker.deleteMany({ category: req.params.id });
        await StickerCategory.deleteOne({ _id: req.params.id });
        stickers.forEach(s => removeStickerFile(s.imageUrl));
        res.json({ success: true, message: 'حُذفت الفئة وملصقاتها', data: { removed: stickers.length } });
    } catch (error) { fail(res, error); }
});

router.post('/categories/:id/items', validId, (req, res) => {
    upload(req, res, async (uploadError) => {
        if (uploadError) {
            return res.status(400).json({ success: false, message: 'ملفات غير صالحة (WebP أو PNG، حتى 2MB)' });
        }
        try {
            if (!(await StickerCategory.exists({ _id: req.params.id }))) {
                return res.status(404).json({ success: false, message: 'الفئة غير موجودة' });
            }
            if (!req.files?.length) {
                return res.status(400).json({ success: false, message: 'اختر ملفات WebP أو PNG' });
            }
            let order = await Sticker.countDocuments({ category: req.params.id });
            const stickers = [];
            for (const file of req.files) {
                const imageUrl = await saveStickerFile(file.buffer);
                stickers.push(await Sticker.create({ category: req.params.id, imageUrl, order: order++ }));
            }
            res.status(201).json({ success: true, data: { stickers } });
        } catch (error) { fail(res, error); }
    });
});

router.put('/items/:id', validId, async (req, res) => {
    try {
        if (typeof req.body?.active !== 'boolean') {
            return res.status(400).json({ success: false, message: 'active مطلوب' });
        }
        const sticker = await Sticker.findByIdAndUpdate(req.params.id, { $set: { active: req.body.active } }, { new: true }).lean();
        if (!sticker) return res.status(404).json({ success: false, message: 'الملصق غير موجود' });
        res.json({ success: true, data: { sticker } });
    } catch (error) { fail(res, error); }
});

router.delete('/items/:id', validId, async (req, res) => {
    try {
        const sticker = await Sticker.findByIdAndDelete(req.params.id).lean();
        if (!sticker) return res.status(404).json({ success: false, message: 'الملصق غير موجود' });
        removeStickerFile(sticker.imageUrl);
        res.json({ success: true, message: 'حُذف الملصق' });
    } catch (error) { fail(res, error); }
});

module.exports = router;
