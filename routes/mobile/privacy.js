const express = require('express');
const router = express.Router();
const User = require('../../models/User');
const { protect } = require('../../middleware/auth');
const { requirePremium } = require('../../middleware/premium');
const { uploadVerificationSelfie } = require('./helpers');

// ==========================================
// نظام التوثيق (Verification)
// ==========================================

// @route   POST /api/mobile/verification/submit
// @desc    طلب توثيق الحساب (رفع سيلفي)
// @access  Protected + Premium
router.post('/verification/submit', protect, requirePremium, uploadVerificationSelfie.single('selfie'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'صورة السيلفي مطلوبة' });
        }

        // التحقق من الحالة الحالية
        if (req.user.verification && req.user.verification.status === 'pending') {
            return res.status(400).json({ success: false, message: 'لديك طلب توثيق قيد المراجعة' });
        }

        const selfieUrl = `/uploads/verifications/${req.file.filename}`;

        await User.findByIdAndUpdate(req.user._id, {
            'verification.selfieUrl': selfieUrl,
            'verification.status': 'pending',
            'verification.submittedAt': new Date()
        });

        res.json({
            success: true,
            message: 'تم إرسال طلب التوثيق بنجاح',
            data: { status: 'pending' }
        });
    } catch (error) {
        console.error('خطأ في طلب التوثيق:', error);
        res.status(500).json({ success: false, message: 'فشل في إرسال طلب التوثيق' });
    }
});

// @route   GET /api/mobile/verification/status
// @desc    حالة التوثيق
// @access  Protected
router.get('/verification/status', protect, async (req, res) => {
    try {
        const user = await User.findById(req.user._id).select('verification').lean();
        res.json({
            success: true,
            data: {
                isVerified: user.verification?.isVerified || false,
                status: user.verification?.status || 'none',
                submittedAt: user.verification?.submittedAt || null,
                reviewedAt: user.verification?.reviewedAt || null
            }
        });
    } catch (error) {
        console.error('خطأ في جلب حالة التوثيق:', error);
        res.status(500).json({ success: false, message: 'فشل في جلب حالة التوثيق' });
    }
});

// ==========================================
// وضع التخفي (Stealth Mode)
// ==========================================

// @route   PUT /api/mobile/users/stealth-mode
// @desc    تفعيل/تعطيل وضع التخفي
// @access  Protected + Premium
router.put('/users/stealth-mode', protect, requirePremium, async (req, res) => {
    try {
        const { enabled } = req.body;

        if (typeof enabled !== 'boolean') {
            return res.status(400).json({ success: false, message: 'القيمة مطلوبة (true/false)' });
        }

        await User.findByIdAndUpdate(req.user._id, { stealthMode: enabled });

        res.json({
            success: true,
            message: enabled ? 'تم تفعيل وضع التخفي' : 'تم تعطيل وضع التخفي',
            data: { stealthMode: enabled }
        });
    } catch (error) {
        console.error('خطأ في تغيير وضع التخفي:', error);
        res.status(500).json({ success: false, message: 'فشل في تغيير وضع التخفي' });
    }
});

// ==========================================
// إعدادات الخصوصية (Mobile)
// ==========================================

// @route   GET /api/mobile/privacy/settings
// @desc    جلب إعدادات الخصوصية الحالية
// @access  Private
router.get('/privacy/settings', protect, async (req, res) => {
    try {
        const user = await User.findById(req.user._id)
            .select('privacySettings showDistance showAge showCountry stealthMode acceptingRequests premiumOnlyRequests').lean();

        if (!user) {
            return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
        }

        res.json({
            success: true,
            data: {
                profileVisibility: user.privacySettings?.profileVisibility || 'public',
                showLastSeen: user.privacySettings?.showLastSeen ?? true,
                notificationSound: user.privacySettings?.notificationSound ?? true,
                showDistance: user.showDistance ?? true,
                showAge: user.showAge ?? true,
                showCountry: user.showCountry ?? true,
                stealthMode: user.stealthMode || false,
                acceptingRequests: user.acceptingRequests ?? true,
                premiumOnlyRequests: user.premiumOnlyRequests ?? false
            }
        });
    } catch (error) {
        console.error('خطأ في جلب إعدادات الخصوصية:', error);
        res.status(500).json({ success: false, message: 'حدث خطأ في الخادم' });
    }
});

// @route   PATCH /api/mobile/privacy/accepting-requests
// @desc    تفعيل/تعطيل استقبال طلبات المحادثة
// @access  Private
router.patch('/privacy/accepting-requests', protect, async (req, res) => {
    try {
        const { acceptingRequests } = req.body;

        if (typeof acceptingRequests !== 'boolean') {
            return res.status(400).json({ success: false, message: 'القيمة مطلوبة (true/false)' });
        }

        await User.findByIdAndUpdate(req.user._id, { acceptingRequests });

        res.json({
            success: true,
            message: acceptingRequests ? 'تم تفعيل استقبال الطلبات' : 'تم إيقاف استقبال الطلبات',
            data: { acceptingRequests }
        });
    } catch (error) {
        console.error('خطأ في تغيير إعداد استقبال الطلبات:', error);
        res.status(500).json({ success: false, message: 'فشل في تغيير الإعداد' });
    }
});

// @route   PATCH /api/mobile/privacy/show-age
// @desc    إظهار/إخفاء العمر في الاكتشاف والملف الشخصي
// @access  Private
router.patch('/privacy/show-age', protect, async (req, res) => {
    try {
        const { showAge } = req.body;

        if (typeof showAge !== 'boolean') {
            return res.status(400).json({ success: false, message: 'القيمة مطلوبة (true/false)' });
        }

        await User.findByIdAndUpdate(req.user._id, { showAge });

        res.json({
            success: true,
            message: showAge ? 'تم إظهار العمر' : 'تم إخفاء العمر',
            data: { showAge }
        });
    } catch (error) {
        console.error('خطأ في تغيير إعداد العمر:', error);
        res.status(500).json({ success: false, message: 'فشل في تغيير الإعداد' });
    }
});

// @route   PATCH /api/mobile/privacy/show-country
// @desc    إظهار/إخفاء الدولة في الاكتشاف والملف الشخصي
// @access  Private
router.patch('/privacy/show-country', protect, async (req, res) => {
    try {
        const { showCountry } = req.body;

        if (typeof showCountry !== 'boolean') {
            return res.status(400).json({ success: false, message: 'القيمة مطلوبة (true/false)' });
        }

        await User.findByIdAndUpdate(req.user._id, { showCountry });

        res.json({
            success: true,
            message: showCountry ? 'تم إظهار الدولة' : 'تم إخفاء الدولة',
            data: { showCountry }
        });
    } catch (error) {
        console.error('خطأ في تغيير إعداد الدولة:', error);
        res.status(500).json({ success: false, message: 'فشل في تغيير الإعداد' });
    }
});

// @route   PATCH /api/mobile/privacy/premium-only-requests
// @desc    قبول طلبات المحادثة من المشتركين فقط (ميزة للمشتركين)
// @access  Private + Premium (عند التفعيل)
router.patch('/privacy/premium-only-requests', protect, async (req, res) => {
    try {
        const { premiumOnlyRequests } = req.body;

        if (typeof premiumOnlyRequests !== 'boolean') {
            return res.status(400).json({ success: false, message: 'القيمة مطلوبة (true/false)' });
        }

        // التفعيل ميزة للمشتركين فقط؛ الإيقاف متاح للجميع
        if (premiumOnlyRequests && !req.user.isPremium) {
            return res.status(403).json({
                success: false,
                message: 'هذه الميزة للمشتركين فقط',
                premiumRequired: true
            });
        }

        await User.findByIdAndUpdate(req.user._id, { premiumOnlyRequests });

        res.json({
            success: true,
            message: premiumOnlyRequests ? 'تم تفعيل استقبال الدعوات من المشتركين فقط' : 'تم إيقاف هذا الإعداد',
            data: { premiumOnlyRequests }
        });
    } catch (error) {
        console.error('خطأ في تغيير إعداد دعوات المشتركين:', error);
        res.status(500).json({ success: false, message: 'فشل في تغيير الإعداد' });
    }
});

// @route   PATCH /api/mobile/privacy/distance
// @desc    تفعيل/تعطيل إظهار المسافة
// @access  Private
router.patch('/privacy/distance', protect, async (req, res) => {
    try {
        const { showDistance } = req.body;

        if (typeof showDistance !== 'boolean') {
            return res.status(400).json({ success: false, message: 'القيمة مطلوبة (true/false)' });
        }

        await User.findByIdAndUpdate(req.user._id, { showDistance });

        res.json({
            success: true,
            message: showDistance ? 'تم إظهار المسافة' : 'تم إخفاء المسافة'
        });
    } catch (error) {
        console.error('خطأ في تغيير إعداد المسافة:', error);
        res.status(500).json({ success: false, message: 'فشل في تغيير الإعداد' });
    }
});

// @route   PATCH /api/mobile/privacy/stealth
// @desc    تفعيل/تعطيل وضع التخفي
// @access  Private + Premium
router.patch('/privacy/stealth', protect, requirePremium, async (req, res) => {
    try {
        const { stealthMode } = req.body;

        if (typeof stealthMode !== 'boolean') {
            return res.status(400).json({ success: false, message: 'القيمة مطلوبة (true/false)' });
        }

        await User.findByIdAndUpdate(req.user._id, { stealthMode });

        res.json({
            success: true,
            message: stealthMode ? 'تم تفعيل وضع التخفي' : 'تم تعطيل وضع التخفي'
        });
    } catch (error) {
        console.error('خطأ في تغيير وضع التخفي:', error);
        res.status(500).json({ success: false, message: 'فشل في تغيير وضع التخفي' });
    }
});

module.exports = router;
