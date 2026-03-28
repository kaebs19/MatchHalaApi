// Settings Routes - إدارة الإعدادات
const express = require('express');
const router = express.Router();
const Settings = require('../models/Settings');
const { protect, adminOnly } = require('../middleware/auth');
const { get, set, CACHE_KEYS, CACHE_TTL, invalidateSettings } = require('../utils/cache');

// @route   GET /api/settings
// @desc    الحصول على الإعدادات
// @access  Public (بعض الإعدادات) / Admin (الكل)
router.get('/', async (req, res) => {
    try {
        // التحقق من الـ Cache
        const cachedSettings = get(CACHE_KEYS.SETTINGS);
        if (cachedSettings) {
            console.log('📦 Settings من الـ Cache');
            // إذا لم يكن admin، أرجع فقط المعلومات العامة
            if (!req.user || req.user.role !== 'admin') {
                return res.json({
                    success: true,
                    data: {
                        appName: cachedSettings.appName,
                        appVersion: cachedSettings.appVersion,
                        appLogo: cachedSettings.appLogo,
                        privacyPolicy: cachedSettings.privacyPolicy,
                        termsOfService: cachedSettings.termsOfService,
                        aboutApp: cachedSettings.aboutApp,
                        contactEmail: cachedSettings.contactEmail,
                        websiteUrl: cachedSettings.websiteUrl,
                        socialMedia: cachedSettings.socialMedia
                    }
                });
            }
            return res.json({ success: true, data: cachedSettings });
        }

        const settings = await Settings.getSettings();

        // تخزين في الـ Cache
        set(CACHE_KEYS.SETTINGS, settings, CACHE_TTL.SETTINGS);

        // إذا لم يكن admin، أرجع فقط المعلومات العامة
        if (!req.user || req.user.role !== 'admin') {
            return res.json({
                success: true,
                data: {
                    appName: settings.appName,
                    appVersion: settings.appVersion,
                    appLogo: settings.appLogo,
                    privacyPolicy: settings.privacyPolicy,
                    termsOfService: settings.termsOfService,
                    aboutApp: settings.aboutApp,
                    contactEmail: settings.contactEmail,
                    websiteUrl: settings.websiteUrl,
                    socialMedia: settings.socialMedia
                }
            });
        }

        // للـ admin، أرجع كل الإعدادات
        res.json({
            success: true,
            data: settings
        });
    } catch (error) {
        console.error('خطأ في جلب الإعدادات:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في جلب الإعدادات',
            error: error.message
        });
    }
});

// @route   PUT /api/settings
// @desc    تحديث الإعدادات
// @access  Admin
router.put('/', protect, adminOnly, async (req, res) => {
    try {
        const settings = await Settings.getSettings();

        // تحديث الحقول المسموحة فقط
        const allowedFields = [
            'appName',
            'appVersion',
            'appLogo',
            'privacyPolicy',
            'termsOfService',
            'aboutApp',
            'notificationsEnabled',
            'emailNotifications',
            'maxConversationParticipants',
            'maxMessageLength',
            'allowFileUploads',
            'maxFileSize',
            'requireEmailVerification',
            'allowUserRegistration',
            'sessionTimeout',
            'contactEmail',
            'contactPhone',
            'websiteUrl',
            'socialMedia'
        ];

        allowedFields.forEach(field => {
            if (req.body[field] !== undefined) {
                settings[field] = req.body[field];
            }
        });

        settings.lastUpdated = Date.now();
        settings.updatedBy = req.user._id;

        await settings.save();

        // إبطال الـ Cache
        invalidateSettings();

        res.json({
            success: true,
            message: 'تم تحديث الإعدادات بنجاح',
            data: settings
        });
    } catch (error) {
        console.error('خطأ في تحديث الإعدادات:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في تحديث الإعدادات',
            error: error.message
        });
    }
});

// @route   GET /api/settings/privacy-policy
// @desc    الحصول على سياسة الخصوصية
// @access  Public
router.get('/privacy-policy', async (req, res) => {
    try {
        const settings = await Settings.getSettings();
        res.json({
            success: true,
            data: {
                content: settings.privacyPolicy,
                lastUpdated: settings.lastUpdated
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'خطأ في جلب سياسة الخصوصية',
            error: error.message
        });
    }
});

// @route   GET /api/settings/terms
// @desc    الحصول على شروط الاستخدام
// @access  Public
router.get('/terms', async (req, res) => {
    try {
        const settings = await Settings.getSettings();
        res.json({
            success: true,
            data: {
                content: settings.termsOfService,
                lastUpdated: settings.lastUpdated
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'خطأ في جلب شروط الاستخدام',
            error: error.message
        });
    }
});

// @route   GET /api/settings/about
// @desc    الحصول على معلومات التطبيق
// @access  Public
router.get('/about', async (req, res) => {
    try {
        const settings = await Settings.getSettings();
        res.json({
            success: true,
            data: {
                content: settings.aboutApp,
                appName: settings.appName,
                appVersion: settings.appVersion,
                lastUpdated: settings.lastUpdated
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'خطأ في جلب معلومات التطبيق',
            error: error.message
        });
    }
});

// @route   GET /api/settings/contact-us
// @desc    الحصول على صفحة اتصل بنا
// @access  Public
router.get('/contact-us', async (req, res) => {
    try {
        const settings = await Settings.getSettings();
        res.json({
            success: true,
            data: {
                content: settings.contactUs,
                contactEmail: settings.contactEmail,
                contactPhone: settings.contactPhone,
                websiteUrl: settings.websiteUrl,
                socialMedia: settings.socialMedia,
                lastUpdated: settings.lastUpdated
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'خطأ في جلب معلومات الاتصال',
            error: error.message
        });
    }
});

// @route   PUT /api/settings/content/:type
// @desc    تحديث محتوى صفحة محددة (privacy/terms/about)
// @access  Admin
router.put('/content/:type', protect, adminOnly, async (req, res) => {
    try {
        const { type } = req.params;
        const { content } = req.body;

        if (!content) {
            return res.status(400).json({
                success: false,
                message: 'المحتوى مطلوب'
            });
        }

        const settings = await Settings.getSettings();

        switch (type) {
            case 'privacy':
                settings.privacyPolicy = content;
                break;
            case 'terms':
                settings.termsOfService = content;
                break;
            case 'about':
                settings.aboutApp = content;
                break;
            case 'contact':
                settings.contactUs = content;
                break;
            default:
                return res.status(400).json({
                    success: false,
                    message: 'نوع المحتوى غير صحيح. استخدم: privacy, terms, about, أو contact'
                });
        }

        settings.lastUpdated = Date.now();
        settings.updatedBy = req.user._id;
        await settings.save();

        // إبطال الـ Cache
        invalidateSettings();

        res.json({
            success: true,
            message: 'تم تحديث المحتوى بنجاح',
            data: settings
        });
    } catch (error) {
        console.error('خطأ في تحديث المحتوى:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في تحديث المحتوى',
            error: error.message
        });
    }
});

// ═══════════════════════════════════════════════════════════════════
// ✅ التحكم بإصدارات التطبيق
// ═══════════════════════════════════════════════════════════════════

const { invalidateVersionCache } = require('../middleware/versionCheck');

// @route   GET /api/settings/version-control
// @desc    الحصول على إعدادات التحكم بالإصدار
// @access  Admin
router.get('/version-control', protect, adminOnly, async (req, res) => {
    try {
        const settings = await Settings.getSettings();
        res.json({
            success: true,
            data: { appVersionControl: settings.appVersionControl }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'خطأ في جلب إعدادات الإصدار' });
    }
});

// @route   PUT /api/settings/version-control
// @desc    تحديث إعدادات التحكم بالإصدار
// @access  Admin
router.put('/version-control', protect, adminOnly, async (req, res) => {
    try {
        const {
            minRequiredVersion,
            latestVersion,
            iosStoreURL,
            updateMessageAr,
            updateMessageEn,
            enforceUpdate
        } = req.body;

        const settings = await Settings.getSettings();

        if (minRequiredVersion !== undefined) settings.appVersionControl.minRequiredVersion = minRequiredVersion;
        if (latestVersion !== undefined) settings.appVersionControl.latestVersion = latestVersion;
        if (iosStoreURL !== undefined) settings.appVersionControl.iosStoreURL = iosStoreURL;
        if (updateMessageAr !== undefined) settings.appVersionControl.updateMessageAr = updateMessageAr;
        if (updateMessageEn !== undefined) settings.appVersionControl.updateMessageEn = updateMessageEn;
        if (enforceUpdate !== undefined) settings.appVersionControl.enforceUpdate = enforceUpdate;

        settings.lastUpdated = Date.now();
        settings.updatedBy = req.user._id;
        await settings.save();

        // ✅ إبطال كاش الإصدار في الـ middleware
        invalidateVersionCache();
        invalidateSettings();

        res.json({
            success: true,
            message: 'تم تحديث إعدادات الإصدار',
            data: { appVersionControl: settings.appVersionControl }
        });
    } catch (error) {
        console.error('خطأ في تحديث إعدادات الإصدار:', error);
        res.status(500).json({ success: false, message: 'خطأ في السيرفر' });
    }
});

// @route   GET /api/settings/check-version
// @desc    فحص إصدار التطبيق (يستخدمه التطبيق عند التشغيل)
// @access  Public
router.get('/check-version', async (req, res) => {
    try {
        const appVersion = req.headers['x-app-version'] || req.query.version;
        const settings = await Settings.getSettings();
        const vc = settings.appVersionControl;

        const { compareVersions } = require('../middleware/versionCheck');

        const isOutdated = appVersion && vc.minRequiredVersion
            ? compareVersions(appVersion, vc.minRequiredVersion) < 0
            : false;

        const hasUpdate = appVersion && vc.latestVersion
            ? compareVersions(appVersion, vc.latestVersion) < 0
            : false;

        res.json({
            success: true,
            data: {
                currentVersion: appVersion || null,
                latestVersion: vc.latestVersion,
                minRequiredVersion: vc.minRequiredVersion,
                updateRequired: vc.enforceUpdate && isOutdated,
                updateAvailable: hasUpdate,
                storeURL: vc.iosStoreURL || null,
                message: isOutdated
                    ? (vc.updateMessageAr || 'يجب تحديث التطبيق')
                    : null
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'خطأ في فحص الإصدار' });
    }
});

// ═══════════════════════════════════════════════════════════════════
// ✅ الأسماء المحظورة
// ═══════════════════════════════════════════════════════════════════

// @route   GET /api/settings/banned-names
// @desc    الحصول على قائمة الأسماء المحظورة
// @access  Admin
router.get('/banned-names', protect, adminOnly, async (req, res) => {
    try {
        const settings = await Settings.getSettings();
        res.json({
            success: true,
            count: settings.bannedNames?.length || 0,
            data: { bannedNames: settings.bannedNames || [] }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'خطأ في جلب الأسماء المحظورة' });
    }
});

// @route   POST /api/settings/banned-names
// @desc    إضافة أسماء محظورة
// @access  Admin
router.post('/banned-names', protect, adminOnly, async (req, res) => {
    try {
        const { names, reason } = req.body;
        // names: اسم واحد (string) أو مصفوفة أسماء

        if (!names) {
            return res.status(400).json({ success: false, message: 'الأسماء مطلوبة' });
        }

        const nameList = Array.isArray(names) ? names : [names];
        const settings = await Settings.getSettings();

        if (!settings.bannedNames) settings.bannedNames = [];

        const added = [];
        const duplicates = [];

        for (const name of nameList) {
            const trimmed = name.trim().toLowerCase();
            if (!trimmed) continue;

            const exists = settings.bannedNames.some(bn => bn.name === trimmed);
            if (exists) {
                duplicates.push(trimmed);
            } else {
                settings.bannedNames.push({
                    name: trimmed,
                    reason: reason || 'اسم غير لائق',
                    addedBy: req.user._id,
                    addedAt: new Date()
                });
                added.push(trimmed);
            }
        }

        await settings.save();
        invalidateSettings();

        res.json({
            success: true,
            message: `تم إضافة ${added.length} اسم محظور`,
            data: { added, duplicates, total: settings.bannedNames.length }
        });
    } catch (error) {
        console.error('خطأ في إضافة أسماء محظورة:', error);
        res.status(500).json({ success: false, message: 'خطأ في السيرفر' });
    }
});

// @route   DELETE /api/settings/banned-names/:name
// @desc    حذف اسم محظور
// @access  Admin
router.delete('/banned-names/:name', protect, adminOnly, async (req, res) => {
    try {
        const settings = await Settings.getSettings();
        const nameToRemove = req.params.name.toLowerCase().trim();

        const idx = settings.bannedNames?.findIndex(bn => bn.name === nameToRemove);
        if (idx === -1 || idx === undefined) {
            return res.status(404).json({ success: false, message: 'الاسم غير موجود' });
        }

        settings.bannedNames.splice(idx, 1);
        await settings.save();
        invalidateSettings();

        res.json({
            success: true,
            message: `تم حذف الاسم المحظور: ${nameToRemove}`,
            data: { total: settings.bannedNames.length }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'خطأ في السيرفر' });
    }
});

// @route   PUT /api/settings/max-violations
// @desc    تحديث حد المخالفات قبل الحظر التلقائي
// @access  Admin
router.put('/max-violations', protect, adminOnly, async (req, res) => {
    try {
        const { maxViolations } = req.body;

        if (!maxViolations || maxViolations < 1) {
            return res.status(400).json({ success: false, message: 'الحد الأدنى 1 مخالفة' });
        }

        const settings = await Settings.getSettings();
        settings.maxBannedWordViolations = maxViolations;
        settings.lastUpdated = Date.now();
        settings.updatedBy = req.user._id;
        await settings.save();
        invalidateSettings();

        res.json({
            success: true,
            message: `تم تحديث حد المخالفات إلى ${maxViolations}`,
            data: { maxBannedWordViolations: maxViolations }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'خطأ في السيرفر' });
    }
});

module.exports = router;
