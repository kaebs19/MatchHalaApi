// MatchHala - Version Check Middleware
// فحص إصدار التطبيق — يرجع 426 إذا الإصدار أقدم من الحد الأدنى
// ✅ يقرأ X-App-Version من Headers ويقارن مع الإعدادات

const Settings = require('../models/Settings');

// كاش بسيط لتقليل الاستعلامات (5 دقائق)
let cachedSettings = null;
let cacheTime = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 دقائق

/**
 * مقارنة إصدارين (مثل "2.4" و "2.3")
 * يرجع: -1 إذا a < b، 0 إذا متساوي، 1 إذا a > b
 */
function compareVersions(a, b) {
    if (!a || !b) return 0;
    const partsA = a.split('.').map(Number);
    const partsB = b.split('.').map(Number);
    const len = Math.max(partsA.length, partsB.length);

    for (let i = 0; i < len; i++) {
        const numA = partsA[i] || 0;
        const numB = partsB[i] || 0;
        if (numA < numB) return -1;
        if (numA > numB) return 1;
    }
    return 0;
}

/**
 * Middleware: فحص إصدار التطبيق
 * يقرأ X-App-Version header ويقارن مع minRequiredVersion
 * يمرر الطلب إذا كان الإصدار أحدث أو لا يوجد header
 */
const versionCheck = async (req, res, next) => {
    try {
        const appVersion = req.headers['x-app-version'];
        const platform = req.headers['x-app-platform'];

        // إذا لا يوجد header → تخطي (مثلاً: طلب من المتصفح أو Postman)
        if (!appVersion) {
            return next();
        }

        // حفظ في req لاستخدامه لاحقاً
        req.appVersion = appVersion;
        req.appBuild = req.headers['x-app-build'];
        req.appPlatform = platform;

        // جلب الإعدادات (من الكاش أو قاعدة البيانات)
        const now = Date.now();
        if (!cachedSettings || (now - cacheTime) > CACHE_TTL) {
            cachedSettings = await Settings.getSettings();
            cacheTime = now;
        }

        const versionControl = cachedSettings.appVersionControl;

        // إذا فحص الإصدار معطل → تخطي
        if (!versionControl || !versionControl.enforceUpdate) {
            return next();
        }

        const minRequired = versionControl.minRequiredVersion;

        // مقارنة الإصدارات
        if (minRequired && compareVersions(appVersion, minRequired) < 0) {
            // الإصدار أقدم من الحد الأدنى المطلوب
            const lang = req.headers['accept-language'] || '';
            const isArabic = lang.includes('ar');

            console.log(`🚫 Version Check Failed: app=${appVersion}, required=${minRequired}, platform=${platform}`);

            return res.status(426).json({
                success: false,
                message: isArabic
                    ? (versionControl.updateMessageAr || 'يجب تحديث التطبيق للاستمرار')
                    : (versionControl.updateMessageEn || 'Please update the app to continue'),
                code: 'UPDATE_REQUIRED',
                data: {
                    currentVersion: appVersion,
                    minRequiredVersion: minRequired,
                    latestVersion: versionControl.latestVersion,
                    storeURL: versionControl.iosStoreURL || null
                }
            });
        }

        next();
    } catch (error) {
        // في حالة خطأ — لا نوقف التطبيق، نمرر الطلب
        console.error('⚠️ Version check error:', error.message);
        next();
    }
};

/**
 * إبطال كاش الإعدادات (يُستدعى عند تحديث الإعدادات)
 */
const invalidateVersionCache = () => {
    cachedSettings = null;
    cacheTime = 0;
};

module.exports = { versionCheck, compareVersions, invalidateVersionCache };
