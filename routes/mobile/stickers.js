// MatchHala - ملصقات المحرّر للتطبيق

const express = require('express');
const router = express.Router();

const { protect } = require('../../middleware/auth');
const Sticker = require('../../models/Sticker');
const StickerCategory = require('../../models/StickerCategory');
const { getFullUrl } = require('./helpers');

// @route   GET /api/mobile/stickers
// @desc    الفئات المفعّلة وملصقاتها — ما يُعطَّل أو يُحذف من اللوحة يختفي فوراً
// @access  Private
router.get('/stickers', protect, async (req, res) => {
    try {
        const categories = await StickerCategory.find({ active: true }).sort({ order: 1, createdAt: 1 }).lean();
        const stickers = await Sticker.find({ active: true, category: { $in: categories.map(c => c._id) } })
            .sort({ order: 1, createdAt: 1 }).select('category imageUrl').lean();
        res.json({
            success: true,
            data: {
                categories: categories
                    .map(c => ({
                        _id: c._id,
                        name: c.name,
                        premium: c.premium,
                        stickers: stickers
                            .filter(s => String(s.category) === String(c._id))
                            .map(s => ({ _id: s._id, imageUrl: getFullUrl(s.imageUrl) }))
                    }))
                    .filter(c => c.stickers.length > 0)
            }
        });
    } catch (error) {
        console.error('خطأ في جلب الملصقات:', error);
        res.status(500).json({ success: false, message: 'فشل جلب الملصقات' });
    }
});

module.exports = router;
