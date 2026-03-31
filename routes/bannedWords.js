// MatchHala - Banned Words Routes
// إدارة الكلمات المحظورة + قائمة المراجعة

const express = require('express');
const router = express.Router();
const BannedWord = require('../models/BannedWord');
const FlaggedMessage = require('../models/FlaggedMessage');
const Message = require('../models/Message');
const User = require('../models/User');
const { protect, adminOnly } = require('../middleware/auth');
const { CACHE_KEYS, CACHE_TTL, get: cacheGet, set: cacheSet, del: cacheDel } = require('../utils/cache');

// ==========================================
// كلمات محظورة - CRUD
// ==========================================

// @route   GET /api/banned-words
// @desc    جلب كل الكلمات المحظورة
// @access  Admin
router.get('/', protect, adminOnly, async (req, res) => {
    try {
        const { page = 1, limit = 50, language, category, search } = req.query;

        const filter = {};
        if (language) filter.language = language;
        if (category) filter.category = category;
        if (search) filter.word = { $regex: search, $options: 'i' };

        const total = await BannedWord.countDocuments(filter);
        const words = await BannedWord.find(filter)
            .sort({ createdAt: -1 })
            .skip((page - 1) * limit)
            .limit(parseInt(limit))
            .populate('addedBy', 'name');

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
        res.status(500).json({ success: false, message: 'خطأ في السيرفر' });
    }
});

// @route   POST /api/banned-words
// @desc    إضافة كلمة أو كلمات محظورة (bulk)
// @access  Admin
router.post('/', protect, adminOnly, async (req, res) => {
    try {
        const { words, word, language = 'other', category = 'other' } = req.body;

        // دعم إرسال كلمة واحدة (word) أو عدة كلمات (words)
        let rawList = words || word;
        if (!rawList || (Array.isArray(rawList) && rawList.length === 0)) {
            return res.status(400).json({
                success: false,
                message: 'يجب تقديم كلمة واحدة على الأقل'
            });
        }

        // تحويل لمصفوفة
        const wordList = Array.isArray(rawList) ? rawList : [rawList];

        const results = { added: 0, duplicates: 0, errors: 0 };
        const addedWords = [];

        for (const w of wordList) {
            // دعم الإرسال كنص أو كائن { word, category, language }
            const isObject = typeof w === 'object' && w !== null;
            const wordText = (isObject ? w.word : w)?.trim?.()?.toLowerCase?.();
            const wordLang = (isObject ? w.language : null) || language;
            const wordCat = (isObject ? w.category : null) || category;

            if (!wordText) continue;

            try {
                const existing = await BannedWord.findOne({ word: wordText });
                if (existing) {
                    results.duplicates++;
                    continue;
                }

                const newWord = await BannedWord.create({
                    word: wordText,
                    language: wordLang,
                    category: wordCat,
                    addedBy: req.user._id
                });
                addedWords.push(newWord);
                results.added++;
            } catch (err) {
                if (err.code === 11000) {
                    results.duplicates++;
                } else {
                    results.errors++;
                }
            }
        }

        // مسح الكاش
        cacheDel('banned_words_list');

        res.status(201).json({
            success: true,
            message: `تمت إضافة ${results.added} كلمة (${results.duplicates} مكررة)`,
            data: { results, addedWords }
        });
    } catch (error) {
        console.error('خطأ في إضافة كلمات محظورة:', error);
        res.status(500).json({ success: false, message: 'خطأ في السيرفر' });
    }
});

// @route   DELETE /api/banned-words/:id
// @desc    حذف كلمة محظورة
// @access  Admin
router.delete('/:id', protect, adminOnly, async (req, res) => {
    try {
        const word = await BannedWord.findByIdAndDelete(req.params.id);
        if (!word) {
            return res.status(404).json({ success: false, message: 'الكلمة غير موجودة' });
        }

        cacheDel('banned_words_list');

        res.json({ success: true, message: 'تم حذف الكلمة' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'خطأ في السيرفر' });
    }
});

// @route   DELETE /api/banned-words/bulk/delete
// @desc    حذف عدة كلمات
// @access  Admin
router.post('/bulk/delete', protect, adminOnly, async (req, res) => {
    try {
        const { ids } = req.body;
        if (!ids || !Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ success: false, message: 'يجب تقديم معرفات الكلمات' });
        }

        const result = await BannedWord.deleteMany({ _id: { $in: ids } });
        cacheDel('banned_words_list');

        res.json({
            success: true,
            message: `تم حذف ${result.deletedCount} كلمة`
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'خطأ في السيرفر' });
    }
});

// @route   PUT /api/banned-words/:id
// @desc    تعديل كلمة محظورة
// @access  Admin
router.put('/:id', protect, adminOnly, async (req, res) => {
    try {
        const { word, language, category, isActive } = req.body;
        const updates = {};
        if (word !== undefined) updates.word = word.trim().toLowerCase();
        if (language !== undefined) updates.language = language;
        if (category !== undefined) updates.category = category;
        if (isActive !== undefined) updates.isActive = isActive;

        const updated = await BannedWord.findByIdAndUpdate(req.params.id, updates, { new: true });
        if (!updated) {
            return res.status(404).json({ success: false, message: 'الكلمة غير موجودة' });
        }

        cacheDel('banned_words_list');
        res.json({ success: true, data: updated });
    } catch (error) {
        res.status(500).json({ success: false, message: 'خطأ في السيرفر' });
    }
});

// @route   POST /api/banned-words/seed
// @desc    إضافة الكلمات الافتراضية
// @access  Admin
router.post('/seed', protect, adminOnly, async (req, res) => {
    try {
        const defaultWords = getDefaultBannedWords();
        let added = 0;
        let duplicates = 0;

        for (const item of defaultWords) {
            try {
                const existing = await BannedWord.findOne({ word: item.word });
                if (existing) {
                    duplicates++;
                    continue;
                }
                await BannedWord.create({
                    ...item,
                    addedBy: req.user._id
                });
                added++;
            } catch (err) {
                if (err.code === 11000) duplicates++;
            }
        }

        cacheDel('banned_words_list');

        res.json({
            success: true,
            message: `تمت إضافة ${added} كلمة افتراضية (${duplicates} مكررة)`,
            data: { added, duplicates, total: defaultWords.length }
        });
    } catch (error) {
        console.error('خطأ في إضافة الكلمات الافتراضية:', error);
        res.status(500).json({ success: false, message: 'خطأ في السيرفر' });
    }
});

// @route   GET /api/banned-words/stats
// @desc    إحصائيات الكلمات المحظورة
// @access  Admin
router.get('/stats', protect, adminOnly, async (req, res) => {
    try {
        const now = new Date();
        const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);
        const thirtyDaysAgo = new Date(now - 30 * 24 * 60 * 60 * 1000);

        const [totalWords, activeWords, flaggedPending, flaggedTotal, flagged7d, flagged30d] = await Promise.all([
            BannedWord.countDocuments(),
            BannedWord.countDocuments({ isActive: true }),
            FlaggedMessage.countDocuments({ status: 'pending' }),
            FlaggedMessage.countDocuments(),
            FlaggedMessage.countDocuments({ createdAt: { $gte: sevenDaysAgo } }),
            FlaggedMessage.countDocuments({ createdAt: { $gte: thirtyDaysAgo } })
        ]);

        const byLanguage = await BannedWord.aggregate([
            { $group: { _id: '$language', count: { $sum: 1 } } }
        ]);

        const byCategory = await BannedWord.aggregate([
            { $group: { _id: '$category', count: { $sum: 1 } } }
        ]);

        // أكثر المخالفين - Top 5
        const topViolators = await User.find(
            { 'bannedWords.violations': { $gt: 0 } },
            'name bannedWords.violations bannedWords.isBanned bannedWords.accountStatus profileImage'
        ).sort({ 'bannedWords.violations': -1 }).limit(5);

        // المخالفات في آخر 7 و 30 يوم (بناءً على FlaggedMessage)
        const violationsLast7Days = await FlaggedMessage.countDocuments({ createdAt: { $gte: sevenDaysAgo } });
        const violationsLast30Days = await FlaggedMessage.countDocuments({ createdAt: { $gte: thirtyDaysAgo } });

        // أكثر الكلمات المطابقة
        const topMatchedWords = await FlaggedMessage.aggregate([
            { $unwind: '$matchedWords' },
            { $group: { _id: '$matchedWords', count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $limit: 10 }
        ]);

        // المستخدمين المحظورين تلقائياً
        const autoBannedCount = await User.countDocuments({ 'bannedWords.isBanned': true });

        res.json({
            success: true,
            data: {
                totalWords,
                activeWords,
                flaggedMessages: {
                    pending: flaggedPending,
                    total: flaggedTotal,
                    last7Days: flagged7d,
                    last30Days: flagged30d
                },
                byLanguage,
                byCategory,
                topViolators,
                topMatchedWords,
                autoBannedCount,
                violationsLast7Days,
                violationsLast30Days
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'خطأ في السيرفر' });
    }
});

// ==========================================
// قائمة المراجعة - Flagged Messages
// ==========================================

// @route   GET /api/banned-words/flagged
// @desc    جلب الرسائل المبلغ عنها
// @access  Admin
router.get('/flagged', protect, adminOnly, async (req, res) => {
    try {
        const { page = 1, limit = 20, status = 'pending', search, matchedWord, dateRange, sort = 'newest' } = req.query;

        const filter = {};
        if (status !== 'all') filter.status = status;

        // فلتر حسب كلمة محددة
        if (matchedWord) {
            filter.matchedWords = matchedWord;
        }

        // فلتر حسب التاريخ
        if (dateRange && dateRange !== 'all') {
            const now = new Date();
            let dateFrom;
            if (dateRange === 'today') {
                dateFrom = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            } else if (dateRange === '7days') {
                dateFrom = new Date(now - 7 * 24 * 60 * 60 * 1000);
            } else if (dateRange === '30days') {
                dateFrom = new Date(now - 30 * 24 * 60 * 60 * 1000);
            }
            if (dateFrom) filter.createdAt = { $gte: dateFrom };
        }

        // بحث بالاسم - نحتاج lookup
        let pipeline = [];
        if (search) {
            pipeline = [
                { $match: filter },
                { $lookup: { from: 'users', localField: 'sender', foreignField: '_id', as: 'senderInfo' } },
                { $unwind: '$senderInfo' },
                { $match: { 'senderInfo.name': { $regex: search, $options: 'i' } } },
                { $sort: { createdAt: sort === 'oldest' ? 1 : -1 } },
                { $facet: {
                    metadata: [{ $count: 'total' }],
                    data: [
                        { $skip: (parseInt(page) - 1) * parseInt(limit) },
                        { $limit: parseInt(limit) }
                    ]
                }}
            ];

            const result = await FlaggedMessage.aggregate(pipeline);
            const total = result[0]?.metadata[0]?.total || 0;
            const flaggedIds = result[0]?.data.map(f => f._id) || [];

            const flagged = await FlaggedMessage.find({ _id: { $in: flaggedIds } })
                .sort({ createdAt: sort === 'oldest' ? 1 : -1 })
                .populate('sender', 'name email profileImage')
                .populate('receiver', 'name email profileImage')
                .populate('conversation', 'participants')
                .populate('reviewedBy', 'name');

            return res.json({
                success: true,
                data: {
                    flagged,
                    pagination: {
                        total,
                        page: parseInt(page),
                        pages: Math.ceil(total / parseInt(limit))
                    }
                }
            });
        }

        const sortOrder = sort === 'oldest' ? 1 : -1;
        const total = await FlaggedMessage.countDocuments(filter);
        const flagged = await FlaggedMessage.find(filter)
            .sort({ createdAt: sortOrder })
            .skip((page - 1) * limit)
            .limit(parseInt(limit))
            .populate('sender', 'name email profileImage')
            .populate('receiver', 'name email profileImage')
            .populate('conversation', 'participants')
            .populate('reviewedBy', 'name');

        res.json({
            success: true,
            data: {
                flagged,
                pagination: {
                    total,
                    page: parseInt(page),
                    pages: Math.ceil(total / limit)
                }
            }
        });
    } catch (error) {
        console.error('خطأ في جلب الرسائل المبلغ عنها:', error);
        res.status(500).json({ success: false, message: 'خطأ في السيرفر' });
    }
});

// @route   PUT /api/banned-words/flagged/:id
// @desc    مراجعة رسالة مبلغ عنها + اتخاذ إجراء
// @access  Admin
router.put('/flagged/:id', protect, adminOnly, async (req, res) => {
    try {
        const { status, action = 'none', notes } = req.body;

        const flagged = await FlaggedMessage.findById(req.params.id);
        if (!flagged) {
            return res.status(404).json({ success: false, message: 'الرسالة غير موجودة' });
        }

        flagged.status = status || 'reviewed';
        flagged.action = action;
        flagged.reviewedBy = req.user._id;
        flagged.reviewedAt = new Date();
        if (notes) flagged.notes = notes;

        // تنفيذ الإجراء
        const suspensionDurations = {
            'user_suspended_1h': 1 * 60 * 60 * 1000,
            'user_suspended_24h': 24 * 60 * 60 * 1000,
            'user_suspended_3d': 3 * 24 * 60 * 60 * 1000,
            'user_suspended_7d': 7 * 24 * 60 * 60 * 1000
        };

        if (action === 'dismiss') {
            flagged.status = 'dismissed';
        } else if (action === 'warning') {
            flagged.status = 'reviewed';
        } else if (action === 'message_deleted') {
            await Message.findByIdAndUpdate(flagged.message, { isDeleted: true, deletedAt: new Date() });
            flagged.status = 'action_taken';
        } else if (suspensionDurations[action]) {
            const duration = suspensionDurations[action];
            const suspendedUntil = new Date(Date.now() + duration);
            await User.findByIdAndUpdate(flagged.sender, {
                isActive: false,
                'bannedWords.isSuspended': true,
                'bannedWords.suspendedAt': new Date(),
                'bannedWords.suspendedUntil': suspendedUntil,
                'bannedWords.suspendedBy': req.user._id,
                'bannedWords.accountStatus': 'suspended'
            });
            flagged.status = 'action_taken';
        } else if (action === 'user_suspended') {
            await User.findByIdAndUpdate(flagged.sender, { isActive: false });
            flagged.status = 'action_taken';
        } else if (action === 'user_banned') {
            await User.findByIdAndUpdate(flagged.sender, {
                isActive: false,
                'bannedWords.isBanned': true,
                'bannedWords.bannedAt': new Date(),
                'bannedWords.banReason': 'حظر يدوي من الأدمن',
                'bannedWords.accountStatus': 'banned'
            });
            flagged.status = 'action_taken';
        } else if (action === 'delete_account') {
            await User.findByIdAndUpdate(flagged.sender, {
                isActive: false,
                isDeleted: true,
                deletedAt: new Date(),
                'bannedWords.isBanned': true,
                'bannedWords.banReason': 'حذف الحساب بسبب مخالفة كلمات محظورة'
            });
            flagged.status = 'action_taken';
        }

        await flagged.save();

        // Populate before returning
        await flagged.populate('sender', 'name email profileImage');
        await flagged.populate('reviewedBy', 'name');

        res.json({
            success: true,
            message: 'تم مراجعة الرسالة',
            data: flagged
        });
    } catch (error) {
        console.error('خطأ في مراجعة الرسالة:', error);
        res.status(500).json({ success: false, message: 'خطأ في السيرفر' });
    }
});

// ==========================================
// دالة فحص الكلمات المحظورة (تُستخدم من routes أخرى)
// ==========================================

/**
 * فحص النص بحثاً عن كلمات محظورة
 * @param {string} text - النص المراد فحصه
 * @returns {object} { hasBannedWords, matchedWords, censoredText }
 */
async function checkBannedWords(text) {
    if (!text || typeof text !== 'string') {
        return { hasBannedWords: false, matchedWords: [], censoredText: text };
    }

    // جلب الكلمات من الكاش أو قاعدة البيانات
    let bannedWords = cacheGet('banned_words_list');
    if (!bannedWords) {
        bannedWords = await BannedWord.find({ isActive: true }).select('word').lean();
        cacheSet('banned_words_list', bannedWords, 300); // 5 دقائق
    }

    if (!bannedWords || bannedWords.length === 0) {
        return { hasBannedWords: false, matchedWords: [], censoredText: text };
    }

    const lowerText = text.toLowerCase();
    const matchedWords = [];
    let censoredText = text;

    for (const bw of bannedWords) {
        const word = bw.word;
        const escaped = escapeRegex(word);
        // مطابقة كلمة كاملة: للعربية نستخدم حدود الحروف العربية، للإنجليزية نستخدم \b
        const isArabic = /[\u0600-\u06FF]/.test(word);
        const regex = isArabic
            ? new RegExp(`(?<![\\u0600-\\u06FF\\u0750-\\u077F\\uFB50-\\uFDFF\\uFE70-\\uFEFF])${escaped}(?![\\u0600-\\u06FF\\u0750-\\u077F\\uFB50-\\uFDFF\\uFE70-\\uFEFF])`, 'gi')
            : new RegExp(`\\b${escaped}\\b`, 'gi');
        if (regex.test(lowerText)) {
            matchedWords.push(word);
            // استبدال بنجوم
            censoredText = censoredText.replace(regex, '*'.repeat(word.length));
        }
    }

    return {
        hasBannedWords: matchedWords.length > 0,
        matchedWords,
        censoredText
    };
}

function escapeRegex(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ==========================================
// الكلمات الافتراضية
// ==========================================

function getDefaultBannedWords() {
    const words = [];

    // English sexual/inappropriate words
    const englishSexual = [
        'fuck', 'shit', 'ass', 'bitch', 'dick', 'pussy', 'cock', 'cum',
        'porn', 'sex', 'nude', 'naked', 'boobs', 'tits', 'whore', 'slut',
        'hoe', 'blowjob', 'handjob', 'masturbat', 'orgasm', 'erotic',
        'xxx', 'milf', 'dildo', 'vibrator', 'penis', 'vagina', 'anal',
        'horny', 'sexy', 'nudes', 'onlyfans', 'stripper', 'escort',
        'prostitut', 'brothel', 'fetish', 'bondage', 'threesome',
        'gangbang', 'incest', 'pedophil', 'rape', 'molest'
    ];

    for (const w of englishSexual) {
        words.push({ word: w, language: 'en', category: 'sexual' });
    }

    // Arabic sexual/inappropriate words
    const arabicSexual = [
        'سكس', 'نيك', 'طيز', 'زب', 'كس', 'شرموطة', 'عاهرة', 'قحبة',
        'منيك', 'متناك', 'زاني', 'زانية', 'فاجرة', 'داعرة',
        'لعن', 'ابن الكلب', 'حمار', 'خنزير', 'ملعون',
        'اباحي', 'اباحية', 'بورن', 'سحاق', 'لواط',
        'عري', 'عارية', 'تعري', 'جنسي', 'جنسية',
        'نيج', 'احا', 'كسمك', 'كسامك', 'يلعن',
        'خول', 'مخنث', 'عرص', 'ديوث', 'قواد',
        'حقير', 'وسخ', 'وسخة', 'منيوك', 'منيوكة',
        'نجس', 'نجسة', 'كلب', 'حيوان', 'بهيمة'
    ];

    for (const w of arabicSexual) {
        words.push({ word: w, language: 'ar', category: 'sexual' });
    }

    return words;
}

module.exports = router;
module.exports.checkBannedWords = checkBannedWords;
