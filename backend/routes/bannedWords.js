// HalaChat - Banned Words Routes
// إدارة الكلمات المحظورة

const express = require('express');
const router = express.Router();
const BannedWord = require('../models/BannedWord');
const { protect, adminOnly } = require('../middleware/auth');

// @route   GET /api/banned-words
// @desc    الحصول على جميع الكلمات المحظورة
// @access  Admin
router.get('/', protect, adminOnly, async (req, res) => {
    try {
        const { type, isActive, page = 1, limit = 50 } = req.query;

        const query = {};
        if (type) query.type = type;
        if (isActive !== undefined) query.isActive = isActive === 'true';

        const total = await BannedWord.countDocuments(query);
        const words = await BannedWord.find(query)
            .populate('addedBy', 'name email')
            .sort({ createdAt: -1 })
            .skip((page - 1) * limit)
            .limit(parseInt(limit));

        res.json({
            success: true,
            data: {
                words,
                pagination: {
                    total,
                    page: parseInt(page),
                    pages: Math.ceil(total / limit)
                }
            }
        });
    } catch (error) {
        console.error('خطأ في جلب الكلمات المحظورة:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في السيرفر',
            error: error.message
        });
    }
});

// @route   GET /api/banned-words/stats
// @desc    إحصائيات الكلمات المحظورة
// @access  Admin
router.get('/stats', protect, adminOnly, async (req, res) => {
    try {
        const total = await BannedWord.countDocuments();
        const active = await BannedWord.countDocuments({ isActive: true });
        const byType = await BannedWord.aggregate([
            { $group: { _id: '$type', count: { $sum: 1 } } }
        ]);
        const bySeverity = await BannedWord.aggregate([
            { $group: { _id: '$severity', count: { $sum: 1 } } }
        ]);
        const mostUsed = await BannedWord.find()
            .sort({ usageCount: -1 })
            .limit(10)
            .select('word usageCount');

        res.json({
            success: true,
            data: {
                total,
                active,
                inactive: total - active,
                byType: byType.reduce((acc, item) => {
                    acc[item._id] = item.count;
                    return acc;
                }, {}),
                bySeverity: bySeverity.reduce((acc, item) => {
                    acc[item._id] = item.count;
                    return acc;
                }, {}),
                mostUsed
            }
        });
    } catch (error) {
        console.error('خطأ في جلب الإحصائيات:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في السيرفر',
            error: error.message
        });
    }
});

// @route   POST /api/banned-words
// @desc    إضافة كلمة محظورة جديدة
// @access  Admin
router.post('/', protect, adminOnly, async (req, res) => {
    try {
        const { word, type, severity, action } = req.body;

        if (!word || word.trim().length === 0) {
            return res.status(400).json({
                success: false,
                message: 'الكلمة مطلوبة'
            });
        }

        // التحقق من عدم وجود الكلمة مسبقاً
        const exists = await BannedWord.findOne({ word: word.toLowerCase().trim() });
        if (exists) {
            return res.status(400).json({
                success: false,
                message: 'هذه الكلمة موجودة بالفعل في القائمة'
            });
        }

        const bannedWord = await BannedWord.create({
            word: word.toLowerCase().trim(),
            type: type || 'both',
            severity: severity || 'medium',
            action: action || 'filter',
            addedBy: req.user._id
        });

        res.status(201).json({
            success: true,
            message: 'تم إضافة الكلمة بنجاح',
            data: bannedWord
        });
    } catch (error) {
        console.error('خطأ في إضافة الكلمة:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في السيرفر',
            error: error.message
        });
    }
});

// @route   POST /api/banned-words/bulk
// @desc    إضافة كلمات محظورة متعددة
// @access  Admin
router.post('/bulk', protect, adminOnly, async (req, res) => {
    try {
        const { words, type, severity, action } = req.body;

        if (!words || !Array.isArray(words) || words.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'يجب إرسال مصفوفة من الكلمات'
            });
        }

        const results = {
            added: [],
            skipped: [],
            errors: []
        };

        for (const word of words) {
            try {
                const normalizedWord = word.toLowerCase().trim();
                if (!normalizedWord) continue;

                const exists = await BannedWord.findOne({ word: normalizedWord });
                if (exists) {
                    results.skipped.push(word);
                    continue;
                }

                await BannedWord.create({
                    word: normalizedWord,
                    type: type || 'both',
                    severity: severity || 'medium',
                    action: action || 'filter',
                    addedBy: req.user._id
                });

                results.added.push(word);
            } catch (err) {
                results.errors.push({ word, error: err.message });
            }
        }

        res.status(201).json({
            success: true,
            message: `تم إضافة ${results.added.length} كلمة، تم تخطي ${results.skipped.length} كلمة موجودة`,
            data: results
        });
    } catch (error) {
        console.error('خطأ في إضافة الكلمات:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في السيرفر',
            error: error.message
        });
    }
});

// @route   POST /api/banned-words/check
// @desc    التحقق من نص معين
// @access  Admin
router.post('/check', protect, adminOnly, async (req, res) => {
    try {
        const { text, type } = req.body;

        if (!text) {
            return res.status(400).json({
                success: false,
                message: 'النص مطلوب'
            });
        }

        const result = await BannedWord.checkText(text, type || 'both');

        res.json({
            success: true,
            data: result
        });
    } catch (error) {
        console.error('خطأ في التحقق:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في السيرفر',
            error: error.message
        });
    }
});

// @route   PUT /api/banned-words/:id/toggle
// @desc    تفعيل/إلغاء تفعيل كلمة
// @access  Admin
router.put('/:id/toggle', protect, adminOnly, async (req, res) => {
    try {
        const bannedWord = await BannedWord.findById(req.params.id);
        if (!bannedWord) {
            return res.status(404).json({
                success: false,
                message: 'الكلمة غير موجودة'
            });
        }

        bannedWord.isActive = !bannedWord.isActive;
        await bannedWord.save();

        res.json({
            success: true,
            message: bannedWord.isActive ? 'تم تفعيل الكلمة' : 'تم إلغاء تفعيل الكلمة',
            data: bannedWord
        });
    } catch (error) {
        console.error('خطأ في تحديث الكلمة:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في السيرفر',
            error: error.message
        });
    }
});

// @route   PUT /api/banned-words/:id
// @desc    تعديل كلمة محظورة
// @access  Admin
router.put('/:id', protect, adminOnly, async (req, res) => {
    try {
        const { word, type, severity, action, isActive } = req.body;

        const bannedWord = await BannedWord.findById(req.params.id);
        if (!bannedWord) {
            return res.status(404).json({
                success: false,
                message: 'الكلمة غير موجودة'
            });
        }

        if (word) bannedWord.word = word.toLowerCase().trim();
        if (type) bannedWord.type = type;
        if (severity) bannedWord.severity = severity;
        if (action) bannedWord.action = action;
        if (isActive !== undefined) bannedWord.isActive = isActive;

        await bannedWord.save();

        res.json({
            success: true,
            message: 'تم تحديث الكلمة بنجاح',
            data: bannedWord
        });
    } catch (error) {
        console.error('خطأ في تحديث الكلمة:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في السيرفر',
            error: error.message
        });
    }
});

// @route   DELETE /api/banned-words/:id
// @desc    حذف كلمة محظورة
// @access  Admin
router.delete('/:id', protect, adminOnly, async (req, res) => {
    try {
        const bannedWord = await BannedWord.findById(req.params.id);
        if (!bannedWord) {
            return res.status(404).json({
                success: false,
                message: 'الكلمة غير موجودة'
            });
        }

        await bannedWord.deleteOne();

        res.json({
            success: true,
            message: 'تم حذف الكلمة بنجاح'
        });
    } catch (error) {
        console.error('خطأ في حذف الكلمة:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في السيرفر',
            error: error.message
        });
    }
});

module.exports = router;
