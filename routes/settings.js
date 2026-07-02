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
            'socialMedia',
            'ads'
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
            enforceUpdate,
            android,
            ios
        } = req.body;

        const settings = await Settings.getSettings();

        if (minRequiredVersion !== undefined) settings.appVersionControl.minRequiredVersion = minRequiredVersion;
        if (latestVersion !== undefined) settings.appVersionControl.latestVersion = latestVersion;
        if (iosStoreURL !== undefined) settings.appVersionControl.iosStoreURL = iosStoreURL;
        if (updateMessageAr !== undefined) settings.appVersionControl.updateMessageAr = updateMessageAr;
        if (updateMessageEn !== undefined) settings.appVersionControl.updateMessageEn = updateMessageEn;
        if (enforceUpdate !== undefined) settings.appVersionControl.enforceUpdate = enforceUpdate;

        // ✅ إعدادات أندرويد الخاصة بالمنصّة
        if (android && typeof android === 'object') {
            if (android.minRequiredVersion !== undefined) settings.appVersionControl.android.minRequiredVersion = android.minRequiredVersion;
            if (android.enforceUpdate !== undefined) settings.appVersionControl.android.enforceUpdate = android.enforceUpdate;
            if (android.storeURL !== undefined) settings.appVersionControl.android.storeURL = android.storeURL;
        }

        // ✅ إعدادات iOS الخاصة بالمنصّة
        if (ios && typeof ios === 'object') {
            if (ios.minRequiredVersion !== undefined) settings.appVersionControl.ios.minRequiredVersion = ios.minRequiredVersion;
            if (ios.enforceUpdate !== undefined) settings.appVersionControl.ios.enforceUpdate = ios.enforceUpdate;
            if (ios.storeURL !== undefined) settings.appVersionControl.ios.storeURL = ios.storeURL;
        }

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
        const platformKey = (req.headers['x-app-platform'] || req.query.platform || '').toLowerCase();
        const settings = await Settings.getSettings();
        const vc = settings.appVersionControl;

        const { compareVersions } = require('../middleware/versionCheck');

        // ✅ حلّ الإعدادات الخاصة بالمنصّة مع fallback للقيمة المشتركة
        const platformVC = (platformKey === 'android' || platformKey === 'ios') ? vc[platformKey] : null;
        const minRequired = (platformVC && platformVC.minRequiredVersion) || vc.minRequiredVersion;
        const storeURL = (platformVC && platformVC.storeURL) || vc.iosStoreURL || null;
        // الفرض يتطلب master switch + ألّا تكون المنصّة معطّلة لنفسها
        const enforceForPlatform = vc.enforceUpdate && !(platformVC && platformVC.enforceUpdate === false);

        const isOutdated = appVersion && minRequired
            ? compareVersions(appVersion, minRequired) < 0
            : false;

        const hasUpdate = appVersion && vc.latestVersion
            ? compareVersions(appVersion, vc.latestVersion) < 0
            : false;

        res.json({
            success: true,
            data: {
                currentVersion: appVersion || null,
                latestVersion: vc.latestVersion,
                minRequiredVersion: minRequired,
                updateRequired: enforceForPlatform && isOutdated,
                updateAvailable: hasUpdate,
                storeURL,
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

// @route   POST /api/settings/banned-names/seed
// @desc    إضافة أسماء مشهورة محظورة (عربي + إنجليزي)
// @access  Admin
router.post('/banned-names/seed', protect, adminOnly, async (req, res) => {
    try {
        const settings = await Settings.getSettings();
        if (!settings.bannedNames) settings.bannedNames = [];

        // أسماء مشهورة عربية + إنجليزية
        const famousNames = [
            // شخصيات عربية مشهورة
            'محمد بن سلمان', 'الملك سلمان', 'الملك عبدالله', 'محمد بن راشد', 'محمد بن زايد',
            'أمير قطر', 'تميم بن حمد', 'السيسي', 'عبدالفتاح السيسي', 'الأسد', 'بشار الأسد',
            'الملك حمد', 'صدام حسين', 'القذافي', 'معمر القذافي', 'حسني مبارك',
            // ممثلين ومشاهير عرب
            'عادل إمام', 'محمد رمضان', 'عمرو دياب', 'تامر حسني', 'محمد صلاح', 'ميسي',
            'كريستيانو', 'رونالدو', 'نيمار', 'مبابي', 'هيفاء وهبي', 'نانسي عجرم',
            'اليسا', 'أحلام', 'محمد عبده', 'عبدالمجيد عبدالله', 'راشد الماجد',
            'ماجد المهندس', 'حسين الجسمي', 'بلقيس', 'أصالة', 'شيرين',
            // مشاهير يوتيوب وسوشيال
            'أبو فله', 'بندريتا', 'سعود الهوساوي', 'فيحان', 'أنس مروة',
            // شخصيات دينية
            'النبي محمد', 'عيسى', 'موسى', 'إبراهيم',
            // شخصيات عالمية
            'ترامب', 'بايدن', 'أوباما', 'بوتين', 'إيلون ماسك',
            // English celebrities
            'trump', 'biden', 'obama', 'putin', 'elon musk', 'jeff bezos', 'bill gates',
            'kim kardashian', 'taylor swift', 'beyonce', 'rihanna', 'drake', 'kanye west',
            'ariana grande', 'selena gomez', 'justin bieber', 'ed sheeran',
            'cristiano ronaldo', 'lionel messi', 'neymar', 'mbappe', 'mohamed salah',
            'lebron james', 'michael jordan',
            'tom cruise', 'brad pitt', 'leonardo dicaprio', 'will smith', 'dwayne johnson',
            'scarlett johansson', 'jennifer lawrence', 'angelina jolie',
            'mark zuckerberg', 'tim cook', 'jack dorsey',
            'queen elizabeth', 'prince harry', 'meghan markle', 'king charles',
            'mbs', 'mbz',
            // أسماء حساسة / ألقاب
            'admin', 'administrator', 'مدير', 'ادمن', 'مشرف', 'moderator',
            'support', 'الدعم', 'دعم فني', 'خدمة العملاء',
            'matchhala', 'ماتش هلا', 'هلا شات', 'halachat',
            'الله', 'god', 'allah', 'jesus', 'prophet',
            // ألقاب ملكية
            'الأمير', 'الملك', 'الشيخ', 'السلطان', 'الرئيس',
            'prince', 'king', 'sheikh', 'sultan', 'president'
        ];

        let added = 0;
        let skipped = 0;

        for (const name of famousNames) {
            const trimmed = name.trim().toLowerCase();
            if (!trimmed) continue;

            const exists = settings.bannedNames.some(bn => bn.name === trimmed);
            if (exists) {
                skipped++;
            } else {
                settings.bannedNames.push({
                    name: trimmed,
                    reason: 'اسم مشهور / حساس',
                    addedBy: req.user._id,
                    addedAt: new Date()
                });
                added++;
            }
        }

        await settings.save();
        invalidateSettings();

        res.json({
            success: true,
            message: `تم إضافة ${added} اسم (${skipped} موجود مسبقاً)`,
            data: { added, skipped, total: settings.bannedNames.length }
        });
    } catch (error) {
        console.error('خطأ في إضافة الأسماء المشهورة:', error);
        res.status(500).json({ success: false, message: 'خطأ في السيرفر' });
    }
});

// ==========================================
// ✅ Phase 1.4: Sensitive Content Admin API
// ==========================================

// @route   GET /api/settings/sensitive-content
// @desc    قراءة إعدادات المحتوى الحساس (للأدمن)
// @access  Admin
router.get('/sensitive-content', protect, adminOnly, async (req, res) => {
    try {
        const settings = await Settings.getSettings();
        const sc = settings.sensitiveContent || {};
        res.json({
            success: true,
            data: {
                featureEnabled: sc.featureEnabled ?? false,
                affectedCategories: sc.affectedCategories ?? ['sexual'],
                minAge: sc.minAge ?? 18,
                requireDoubleConfirm: sc.requireDoubleConfirm ?? true,
                minClientVersion: sc.minClientVersion ?? '6.3'
            }
        });
    } catch (error) {
        console.error('Get sensitive-content settings error:', error);
        res.status(500).json({ success: false, message: 'خطأ في السيرفر' });
    }
});

// @route   PUT /api/settings/sensitive-content
// @desc    تحديث إعدادات المحتوى الحساس
// @access  Admin
router.put('/sensitive-content', protect, adminOnly, async (req, res) => {
    try {
        const { featureEnabled, affectedCategories, minAge, requireDoubleConfirm, minClientVersion } = req.body;

        // Validation
        if (minAge !== undefined && (typeof minAge !== 'number' || minAge < 18)) {
            return res.status(400).json({ success: false, message: 'الحد الأدنى للعمر يجب أن يكون 18 أو أكثر' });
        }
        if (affectedCategories !== undefined) {
            if (!Array.isArray(affectedCategories)) {
                return res.status(400).json({ success: false, message: 'affectedCategories يجب أن تكون مصفوفة' });
            }
            const validCats = ['sexual', 'violence', 'hate', 'spam', 'other'];
            const invalid = affectedCategories.find(c => !validCats.includes(c));
            if (invalid) {
                return res.status(400).json({ success: false, message: `category غير صالحة: ${invalid}` });
            }
        }

        const settings = await Settings.getSettings();
        if (!settings.sensitiveContent) settings.sensitiveContent = {};

        if (featureEnabled !== undefined) settings.sensitiveContent.featureEnabled = !!featureEnabled;
        if (affectedCategories !== undefined) settings.sensitiveContent.affectedCategories = affectedCategories;
        if (minAge !== undefined) settings.sensitiveContent.minAge = minAge;
        if (requireDoubleConfirm !== undefined) settings.sensitiveContent.requireDoubleConfirm = !!requireDoubleConfirm;
        if (minClientVersion !== undefined) settings.sensitiveContent.minClientVersion = String(minClientVersion);

        settings.markModified('sensitiveContent');   // Mongoose mixed type — لازم
        settings.lastUpdated = Date.now();
        settings.updatedBy = req.user._id;
        await settings.save();
        invalidateSettings();

        res.json({
            success: true,
            message: 'تم تحديث إعدادات المحتوى الحساس',
            data: settings.sensitiveContent
        });
    } catch (error) {
        console.error('Update sensitive-content settings error:', error);
        res.status(500).json({ success: false, message: 'خطأ في السيرفر' });
    }
});

// @route   GET /api/settings/sensitive-content/stats
// @desc    إحصائيات المحتوى الحساس (للأدمن dashboard)
// @access  Admin
router.get('/sensitive-content/stats', protect, adminOnly, async (req, res) => {
    try {
        const days = Math.min(parseInt(req.query.days) || 30, 90);
        const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

        const User = require('../models/User');
        const Message = require('../models/Message');
        const Reveal = require('../models/SensitiveContentReveal');

        const [
            usersWithSettingOn,
            totalMessagesFlagged,
            recentMessagesFlagged,
            totalReveals,
            recentReveals,
            uniqueRevealUsers,
            byCategoryRaw
        ] = await Promise.all([
            User.countDocuments({ 'privacySettings.allowSensitiveContent': true }),
            Message.countDocuments({ hasFlaggedContent: true }),
            Message.countDocuments({ hasFlaggedContent: true, createdAt: { $gte: since } }),
            Reveal.countDocuments({}),
            Reveal.countDocuments({ revealedAt: { $gte: since } }),
            Reveal.distinct('user', { revealedAt: { $gte: since } }),
            Reveal.aggregate([
                { $match: { revealedAt: { $gte: since } } },
                { $group: { _id: '$category', count: { $sum: 1 } } },
                { $sort: { count: -1 } }
            ])
        ]);

        // daily trend (آخر days يوم)
        const dailyTrend = await Reveal.aggregate([
            { $match: { revealedAt: { $gte: since } } },
            { $group: {
                _id: { $dateToString: { format: '%Y-%m-%d', date: '$revealedAt' } },
                count: { $sum: 1 }
            }},
            { $sort: { _id: 1 } }
        ]);

        res.json({
            success: true,
            data: {
                period: `last ${days} days`,
                users: {
                    enabledSetting: usersWithSettingOn
                },
                messages: {
                    totalFlagged: totalMessagesFlagged,
                    recentFlagged: recentMessagesFlagged
                },
                reveals: {
                    total: totalReveals,
                    recent: recentReveals,
                    uniqueUsers: uniqueRevealUsers.length,
                    byCategory: byCategoryRaw,
                    dailyTrend
                }
            }
        });
    } catch (error) {
        console.error('Sensitive-content stats error:', error);
        res.status(500).json({ success: false, message: 'خطأ في السيرفر' });
    }
});

// @route   GET /api/settings/sensitive-content/reveals
// @desc    سجل الكشف (audit log) — مع pagination
// @access  Admin
router.get('/sensitive-content/reveals', protect, adminOnly, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = Math.min(parseInt(req.query.limit) || 50, 200);
        const category = req.query.category;
        const userId = req.query.userId;

        const filter = {};
        if (category) filter.category = category;
        if (userId) filter.user = userId;

        const Reveal = require('../models/SensitiveContentReveal');
        const [items, total] = await Promise.all([
            Reveal.find(filter)
                .sort({ revealedAt: -1 })
                .skip((page - 1) * limit)
                .limit(limit)
                .populate('user', 'name email halaId profileImage')
                .lean(),
            Reveal.countDocuments(filter)
        ]);

        res.json({
            success: true,
            data: {
                reveals: items,
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit)
            }
        });
    } catch (error) {
        console.error('Sensitive-content reveals error:', error);
        res.status(500).json({ success: false, message: 'خطأ في السيرفر' });
    }
});

module.exports = router;
