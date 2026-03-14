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

module.exports = router;
