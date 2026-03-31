const express = require('express');
const router = express.Router();
const Interest = require('../models/Interest');
const { protect, adminOnly } = require('../middleware/auth');

// ============================================
// Public — قائمة الاهتمامات المتاحة
// ============================================

// GET /api/interests — جلب كل الاهتمامات النشطة
router.get('/', async (req, res) => {
    try {
        const interests = await Interest.find({ isActive: true }).sort({ order: 1, nameAr: 1 });
        res.json({ success: true, data: interests, count: interests.length });
    } catch (error) {
        res.status(500).json({ success: false, message: 'خطأ في السيرفر' });
    }
});

// ============================================
// Admin — إدارة الاهتمامات
// ============================================

// POST /api/interests — إضافة اهتمام جديد
router.post('/', protect, adminOnly, async (req, res) => {
    try {
        const { key, nameAr, nameEn, emoji, category, order } = req.body;

        if (!key || !nameAr || !nameEn || !emoji) {
            return res.status(400).json({ success: false, message: 'جميع الحقول مطلوبة (key, nameAr, nameEn, emoji)' });
        }

        const exists = await Interest.findOne({ key });
        if (exists) {
            return res.status(400).json({ success: false, message: 'هذا الاهتمام موجود مسبقاً' });
        }

        const interest = await Interest.create({ key, nameAr, nameEn, emoji, category, order });
        res.status(201).json({ success: true, data: interest });
    } catch (error) {
        res.status(500).json({ success: false, message: 'خطأ في السيرفر', error: error.message });
    }
});

// PUT /api/interests/:id — تعديل اهتمام
router.put('/:id', protect, adminOnly, async (req, res) => {
    try {
        const { nameAr, nameEn, emoji, category, isActive, order } = req.body;
        const interest = await Interest.findByIdAndUpdate(req.params.id, {
            ...(nameAr && { nameAr }),
            ...(nameEn && { nameEn }),
            ...(emoji && { emoji }),
            ...(category && { category }),
            ...(isActive !== undefined && { isActive }),
            ...(order !== undefined && { order })
        }, { new: true });

        if (!interest) {
            return res.status(404).json({ success: false, message: 'الاهتمام غير موجود' });
        }

        res.json({ success: true, data: interest });
    } catch (error) {
        res.status(500).json({ success: false, message: 'خطأ في السيرفر' });
    }
});

// DELETE /api/interests/:id — حذف اهتمام
router.delete('/:id', protect, adminOnly, async (req, res) => {
    try {
        const interest = await Interest.findByIdAndDelete(req.params.id);
        if (!interest) {
            return res.status(404).json({ success: false, message: 'الاهتمام غير موجود' });
        }
        res.json({ success: true, message: 'تم حذف الاهتمام' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'خطأ في السيرفر' });
    }
});

// POST /api/interests/seed — إضافة الاهتمامات الافتراضية
router.post('/seed', protect, adminOnly, async (req, res) => {
    try {
        const defaults = [
            // رياضة
            { key: 'football', nameAr: 'كرة القدم', nameEn: 'Football', emoji: '⚽', category: 'sports', order: 1 },
            { key: 'swimming', nameAr: 'السباحة', nameEn: 'Swimming', emoji: '🏊', category: 'sports', order: 2 },
            { key: 'fitness', nameAr: 'اللياقة البدنية', nameEn: 'Fitness', emoji: '💪', category: 'sports', order: 3 },
            { key: 'basketball', nameAr: 'كرة السلة', nameEn: 'Basketball', emoji: '🏀', category: 'sports', order: 4 },
            { key: 'running', nameAr: 'الجري', nameEn: 'Running', emoji: '🏃', category: 'sports', order: 5 },
            { key: 'hiking', nameAr: 'المشي والتسلق', nameEn: 'Hiking', emoji: '🥾', category: 'sports', order: 6 },
            { key: 'yoga', nameAr: 'يوغا', nameEn: 'Yoga', emoji: '🧘', category: 'sports', order: 7 },
            // ترفيه
            { key: 'movies', nameAr: 'الأفلام والمسلسلات', nameEn: 'Movies & Series', emoji: '🎬', category: 'entertainment', order: 10 },
            { key: 'gaming', nameAr: 'الألعاب الإلكترونية', nameEn: 'Gaming', emoji: '🎮', category: 'entertainment', order: 11 },
            { key: 'music', nameAr: 'الموسيقى', nameEn: 'Music', emoji: '🎵', category: 'entertainment', order: 12 },
            { key: 'reading', nameAr: 'القراءة', nameEn: 'Reading', emoji: '📚', category: 'entertainment', order: 13 },
            { key: 'dancing', nameAr: 'الرقص', nameEn: 'Dancing', emoji: '💃', category: 'entertainment', order: 14 },
            // أسلوب حياة
            { key: 'travel', nameAr: 'السفر والسياحة', nameEn: 'Travel', emoji: '✈️', category: 'lifestyle', order: 20 },
            { key: 'nightlife', nameAr: 'السهر والحياة الليلية', nameEn: 'Nightlife', emoji: '🌙', category: 'lifestyle', order: 21 },
            { key: 'shopping', nameAr: 'التسوق', nameEn: 'Shopping', emoji: '🛍️', category: 'lifestyle', order: 22 },
            { key: 'fashion', nameAr: 'الموضة والأزياء', nameEn: 'Fashion', emoji: '👗', category: 'lifestyle', order: 23 },
            { key: 'nature', nameAr: 'الطبيعة', nameEn: 'Nature', emoji: '🌿', category: 'lifestyle', order: 24 },
            { key: 'pets', nameAr: 'الحيوانات الأليفة', nameEn: 'Pets', emoji: '🐾', category: 'lifestyle', order: 25 },
            // اجتماعي
            { key: 'chat', nameAr: 'الدردشة والتعارف', nameEn: 'Chat & Connect', emoji: '💬', category: 'social', order: 30 },
            { key: 'relationships', nameAr: 'العلاقات الجدية', nameEn: 'Relationships', emoji: '❤️', category: 'social', order: 31 },
            { key: 'friendship', nameAr: 'صداقات جديدة', nameEn: 'New Friends', emoji: '🤝', category: 'social', order: 32 },
            // إبداع
            { key: 'photography', nameAr: 'التصوير', nameEn: 'Photography', emoji: '📸', category: 'creative', order: 40 },
            { key: 'art', nameAr: 'الفن والرسم', nameEn: 'Art & Drawing', emoji: '🎨', category: 'creative', order: 41 },
            { key: 'writing', nameAr: 'الكتابة', nameEn: 'Writing', emoji: '✍️', category: 'creative', order: 42 },
            // طعام
            { key: 'cooking', nameAr: 'الطبخ', nameEn: 'Cooking', emoji: '🍳', category: 'food', order: 50 },
            { key: 'coffee', nameAr: 'القهوة', nameEn: 'Coffee', emoji: '☕', category: 'food', order: 51 },
            { key: 'food', nameAr: 'تجربة المطاعم', nameEn: 'Food & Dining', emoji: '🍕', category: 'food', order: 52 },
            // تقنية
            { key: 'tech', nameAr: 'التقنية', nameEn: 'Technology', emoji: '💻', category: 'tech', order: 60 },
            { key: 'ai', nameAr: 'الذكاء الاصطناعي', nameEn: 'AI & Tech', emoji: '🤖', category: 'tech', order: 61 },
        ];

        let added = 0;
        for (const item of defaults) {
            const exists = await Interest.findOne({ key: item.key });
            if (!exists) {
                await Interest.create(item);
                added++;
            }
        }

        const all = await Interest.find().sort({ order: 1 });
        res.json({ success: true, message: `تم إضافة ${added} اهتمام جديد`, data: all, total: all.length });
    } catch (error) {
        res.status(500).json({ success: false, message: 'خطأ في السيرفر', error: error.message });
    }
});

module.exports = router;
