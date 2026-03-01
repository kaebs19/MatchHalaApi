// HalaChat - Categories Routes
// مسارات إدارة التصنيفات

const express = require('express');
const router = express.Router();
const Category = require('../models/Category');
const { protect, adminOnly } = require('../middleware/auth');

// ==================== جلب كل التصنيفات ====================
// GET /api/categories
router.get('/', async (req, res) => {
    try {
        const { active } = req.query;
        const filter = {};
        if (active === 'true') filter.isActive = true;

        const categories = await Category.find(filter)
            .sort({ order: 1, name: 1 });

        res.json({
            success: true,
            data: categories,
            count: categories.length
        });
    } catch (error) {
        console.error('خطأ في جلب التصنيفات:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في جلب التصنيفات'
        });
    }
});

// ==================== جلب تصنيف واحد ====================
// GET /api/categories/:id
router.get('/:id', async (req, res) => {
    try {
        const category = await Category.findById(req.params.id);
        if (!category) {
            return res.status(404).json({
                success: false,
                message: 'التصنيف غير موجود'
            });
        }

        res.json({
            success: true,
            data: category
        });
    } catch (error) {
        console.error('خطأ في جلب التصنيف:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في جلب التصنيف'
        });
    }
});

// ==================== إنشاء تصنيف جديد ====================
// POST /api/categories
router.post('/', protect, adminOnly, async (req, res) => {
    try {
        const { name, icon, color, description, order } = req.body;

        // التحقق من عدم تكرار الاسم
        const existing = await Category.findOne({ name });
        if (existing) {
            return res.status(400).json({
                success: false,
                message: 'اسم التصنيف موجود مسبقاً'
            });
        }

        // حساب الترتيب إذا لم يُحدد
        let categoryOrder = order;
        if (categoryOrder === undefined) {
            const lastCategory = await Category.findOne().sort({ order: -1 });
            categoryOrder = lastCategory ? lastCategory.order + 1 : 0;
        }

        const category = await Category.create({
            name,
            icon: icon || 'folder',
            color: color || '#007AFF',
            description,
            order: categoryOrder
        });

        res.status(201).json({
            success: true,
            message: 'تم إنشاء التصنيف بنجاح',
            data: category
        });
    } catch (error) {
        console.error('خطأ في إنشاء التصنيف:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'خطأ في إنشاء التصنيف'
        });
    }
});

// ==================== تحديث تصنيف ====================
// PUT /api/categories/:id
router.put('/:id', protect, adminOnly, async (req, res) => {
    try {
        const { name, icon, color, description, order, isActive } = req.body;

        const category = await Category.findById(req.params.id);
        if (!category) {
            return res.status(404).json({
                success: false,
                message: 'التصنيف غير موجود'
            });
        }

        // التحقق من عدم تكرار الاسم
        if (name && name !== category.name) {
            const existing = await Category.findOne({ name });
            if (existing) {
                return res.status(400).json({
                    success: false,
                    message: 'اسم التصنيف موجود مسبقاً'
                });
            }
        }

        // تحديث الحقول
        if (name) category.name = name;
        if (icon) category.icon = icon;
        if (color) category.color = color;
        if (description !== undefined) category.description = description;
        if (order !== undefined) category.order = order;
        if (isActive !== undefined) category.isActive = isActive;

        await category.save();

        res.json({
            success: true,
            message: 'تم تحديث التصنيف بنجاح',
            data: category
        });
    } catch (error) {
        console.error('خطأ في تحديث التصنيف:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'خطأ في تحديث التصنيف'
        });
    }
});

// ==================== حذف تصنيف ====================
// DELETE /api/categories/:id
router.delete('/:id', protect, adminOnly, async (req, res) => {
    try {
        const category = await Category.findById(req.params.id);
        if (!category) {
            return res.status(404).json({
                success: false,
                message: 'التصنيف غير موجود'
            });
        }

        // التحقق من عدم وجود غرف مرتبطة
        const ChatRoom = require('../models/ChatRoom');
        const roomsCount = await ChatRoom.countDocuments({ category: req.params.id });
        if (roomsCount > 0) {
            return res.status(400).json({
                success: false,
                message: `لا يمكن حذف التصنيف لأنه يحتوي على ${roomsCount} غرفة`
            });
        }

        await Category.findByIdAndDelete(req.params.id);

        res.json({
            success: true,
            message: 'تم حذف التصنيف بنجاح'
        });
    } catch (error) {
        console.error('خطأ في حذف التصنيف:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في حذف التصنيف'
        });
    }
});

// ==================== إعادة ترتيب التصنيفات ====================
// PUT /api/categories/reorder
router.put('/reorder/bulk', protect, adminOnly, async (req, res) => {
    try {
        const { categories } = req.body; // [{id, order}, ...]

        if (!categories || !Array.isArray(categories)) {
            return res.status(400).json({
                success: false,
                message: 'البيانات غير صحيحة'
            });
        }

        // تحديث الترتيب لكل تصنيف
        const updates = categories.map(cat =>
            Category.findByIdAndUpdate(cat.id, { order: cat.order })
        );

        await Promise.all(updates);

        res.json({
            success: true,
            message: 'تم إعادة ترتيب التصنيفات بنجاح'
        });
    } catch (error) {
        console.error('خطأ في إعادة الترتيب:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في إعادة ترتيب التصنيفات'
        });
    }
});

// ==================== تبديل حالة التصنيف ====================
// PUT /api/categories/:id/toggle
router.put('/:id/toggle', protect, adminOnly, async (req, res) => {
    try {
        const category = await Category.findById(req.params.id);
        if (!category) {
            return res.status(404).json({
                success: false,
                message: 'التصنيف غير موجود'
            });
        }

        category.isActive = !category.isActive;
        await category.save();

        res.json({
            success: true,
            message: category.isActive ? 'تم تفعيل التصنيف' : 'تم إلغاء تفعيل التصنيف',
            data: category
        });
    } catch (error) {
        console.error('خطأ في تبديل الحالة:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في تبديل حالة التصنيف'
        });
    }
});

module.exports = router;
