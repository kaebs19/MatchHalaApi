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
            .select('privacySettings showDistance showAge showCountry stealthMode acceptingRequests premiumOnlyRequests discoveryPaused birthDate').lean();

        if (!user) {
            return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
        }

        const dnd = user.privacySettings?.doNotDisturb || {};
        // ✅ إيقاف الاكتشاف يُعتبر منتهياً إذا مرّ until
        const paused = user.discoveryPaused || {};
        const pauseActive = paused.enabled === true &&
            (!paused.until || new Date(paused.until) > new Date());

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
                premiumOnlyRequests: user.premiumOnlyRequests ?? false,
                doNotDisturb: {
                    enabled: dnd.enabled ?? false,
                    startHour: dnd.startHour ?? 23,
                    startMinute: dnd.startMinute ?? 0,
                    endHour: dnd.endHour ?? 7,
                    endMinute: dnd.endMinute ?? 0
                },
                discoveryPaused: {
                    enabled: pauseActive,
                    until: pauseActive ? (paused.until || null) : null
                },
                allowSensitiveContent: user.privacySettings?.allowSensitiveContent ?? false,
                // 👥 نظام الأصدقاء
                friendRequests: user.privacySettings?.friendRequests || 'everyone',
                notifyFriendsOnline: user.privacySettings?.notifyFriendsOnline ?? true
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

// @route   PATCH /api/mobile/privacy/friend-requests
// @desc    👥 من يستطيع إرسال طلب صداقة لي؟ everyone | contacts | nobody
// @access  Private
router.patch('/privacy/friend-requests', protect, async (req, res) => {
    try {
        const { friendRequests } = req.body;

        if (!['everyone', 'contacts', 'nobody'].includes(friendRequests)) {
            return res.status(400).json({ success: false, message: 'قيمة غير صالحة (everyone/contacts/nobody)' });
        }

        await User.findByIdAndUpdate(req.user._id, {
            $set: { 'privacySettings.friendRequests': friendRequests }
        });

        const labels = {
            everyone: 'الجميع يستطيع إرسال طلب صداقة',
            contacts: 'فقط من تحدثت معهم يستطيعون إرسال طلب صداقة',
            nobody: 'تم إيقاف استقبال طلبات الصداقة'
        };

        res.json({ success: true, message: labels[friendRequests], data: { friendRequests } });
    } catch (error) {
        console.error('خطأ في تغيير خصوصية طلبات الصداقة:', error);
        res.status(500).json({ success: false, message: 'فشل في تغيير الإعداد' });
    }
});

// @route   PATCH /api/mobile/privacy/notify-friends-online
// @desc    👥 إشعار أصدقائي عند اتصالي (friend:online)
// @access  Private
router.patch('/privacy/notify-friends-online', protect, async (req, res) => {
    try {
        const { notifyFriendsOnline } = req.body;

        if (typeof notifyFriendsOnline !== 'boolean') {
            return res.status(400).json({ success: false, message: 'القيمة مطلوبة (true/false)' });
        }

        await User.findByIdAndUpdate(req.user._id, {
            $set: { 'privacySettings.notifyFriendsOnline': notifyFriendsOnline }
        });

        res.json({
            success: true,
            message: notifyFriendsOnline
                ? 'سيتم إشعار أصدقائك عند اتصالك'
                : 'لن يتم إشعار أصدقائك عند اتصالك',
            data: { notifyFriendsOnline }
        });
    } catch (error) {
        console.error('خطأ في تغيير إعداد إشعار الأصدقاء:', error);
        res.status(500).json({ success: false, message: 'فشل في تغيير الإعداد' });
    }
});

// @route   PATCH /api/mobile/privacy/do-not-disturb
// @desc    تفعيل/تعطيل ساعات الهدوء وتحديد نافذتها
// @access  Private
router.patch('/privacy/do-not-disturb', protect, async (req, res) => {
    try {
        const { enabled, startHour, startMinute, endHour, endMinute } = req.body;

        if (typeof enabled !== 'boolean') {
            return res.status(400).json({ success: false, message: 'القيمة مطلوبة (true/false)' });
        }

        const set = { 'privacySettings.doNotDisturb.enabled': enabled };

        // تحقق من الأوقات إن أُرسلت
        const inRange = (v, max) => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= max;
        if (startHour !== undefined) {
            if (!inRange(startHour, 23)) return res.status(400).json({ success: false, message: 'ساعة البداية غير صالحة' });
            set['privacySettings.doNotDisturb.startHour'] = startHour;
        }
        if (startMinute !== undefined) {
            if (!inRange(startMinute, 59)) return res.status(400).json({ success: false, message: 'دقيقة البداية غير صالحة' });
            set['privacySettings.doNotDisturb.startMinute'] = startMinute;
        }
        if (endHour !== undefined) {
            if (!inRange(endHour, 23)) return res.status(400).json({ success: false, message: 'ساعة النهاية غير صالحة' });
            set['privacySettings.doNotDisturb.endHour'] = endHour;
        }
        if (endMinute !== undefined) {
            if (!inRange(endMinute, 59)) return res.status(400).json({ success: false, message: 'دقيقة النهاية غير صالحة' });
            set['privacySettings.doNotDisturb.endMinute'] = endMinute;
        }

        await User.findByIdAndUpdate(req.user._id, { $set: set });

        const user = await User.findById(req.user._id).select('privacySettings.doNotDisturb').lean();
        const dnd = user.privacySettings?.doNotDisturb || {};

        res.json({
            success: true,
            message: enabled ? 'تم تفعيل ساعات الهدوء' : 'تم إيقاف ساعات الهدوء',
            data: {
                enabled: dnd.enabled ?? false,
                startHour: dnd.startHour ?? 23,
                startMinute: dnd.startMinute ?? 0,
                endHour: dnd.endHour ?? 7,
                endMinute: dnd.endMinute ?? 0
            }
        });
    } catch (error) {
        console.error('خطأ في تغيير ساعات الهدوء:', error);
        res.status(500).json({ success: false, message: 'فشل في تغيير الإعداد' });
    }
});

// @route   PATCH /api/mobile/privacy/pause-discovery
// @desc    إيقاف/استئناف ظهوري في الاكتشاف مؤقتاً (للمشتركين عند التفعيل)
// @access  Private + Premium (عند التفعيل)
router.patch('/privacy/pause-discovery', protect, async (req, res) => {
    try {
        const { enabled, durationHours } = req.body;

        if (typeof enabled !== 'boolean') {
            return res.status(400).json({ success: false, message: 'القيمة مطلوبة (true/false)' });
        }

        if (enabled) {
            // التفعيل ميزة للمشتركين فقط
            if (!req.user.isPremium) {
                return res.status(403).json({
                    success: false,
                    message: 'هذه الميزة للمشتركين فقط',
                    premiumRequired: true
                });
            }

            // durationHours: رقم موجب أو null/0 = حتى يُعيد التفعيل يدوياً
            let until = null;
            if (durationHours !== undefined && durationHours !== null && durationHours !== 0) {
                if (typeof durationHours !== 'number' || durationHours <= 0 || durationHours > 24 * 30) {
                    return res.status(400).json({ success: false, message: 'مدة غير صالحة' });
                }
                until = new Date(Date.now() + durationHours * 60 * 60 * 1000);
            }

            await User.findByIdAndUpdate(req.user._id, {
                $set: { 'discoveryPaused.enabled': true, 'discoveryPaused.until': until }
            });

            return res.json({
                success: true,
                message: 'تم إيقاف ظهورك في الاكتشاف',
                data: { enabled: true, until }
            });
        }

        // الاستئناف متاح للجميع
        await User.findByIdAndUpdate(req.user._id, {
            $set: { 'discoveryPaused.enabled': false, 'discoveryPaused.until': null }
        });

        res.json({
            success: true,
            message: 'تم استئناف ظهورك في الاكتشاف',
            data: { enabled: false, until: null }
        });
    } catch (error) {
        console.error('خطأ في تغيير إيقاف الاكتشاف:', error);
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

// @route   PATCH /api/mobile/privacy/allow-sensitive-content
// @desc    تفعيل/تعطيل عرض المحتوى الحساس
// @access  Private (18+)
router.patch('/privacy/allow-sensitive-content', protect, async (req, res) => {
    try {
        const { enabled } = req.body;
        if (typeof enabled !== 'boolean') {
            return res.status(400).json({ success: false, message: 'القيمة مطلوبة (true/false)' });
        }

        // التحقق من العمر عند التفعيل
        if (enabled) {
            let userAge = null;
            if (req.user.birthDate) {
                const ageMs = Date.now() - new Date(req.user.birthDate).getTime();
                userAge = Math.floor(ageMs / (365.25 * 24 * 60 * 60 * 1000));
            }
            if (userAge === null || userAge < 18) {
                return res.status(403).json({
                    success: false,
                    message: 'هذا الخيار للبالغين فقط (+18)',
                    code: 'AGE_RESTRICTED'
                });
            }
        }

        await User.findByIdAndUpdate(req.user._id, {
            'privacySettings.allowSensitiveContent': enabled
        });

        res.json({
            success: true,
            message: enabled ? 'تم تفعيل عرض المحتوى الحساس' : 'تم تعطيل عرض المحتوى الحساس',
            enabled
        });
    } catch (error) {
        console.error('خطأ في تغيير إعداد المحتوى الحساس:', error);
        res.status(500).json({ success: false, message: 'فشل في تغيير الإعداد' });
    }
});

module.exports = router;
