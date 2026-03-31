// MatchHala - API Version Middleware
// يستخرج إصدار API من URL ويضيفه لـ req
// يُسجّل في الـ logs لتتبع استخدام كل إصدار

/**
 * Middleware: استخراج إصدار API
 * /api/v1/mobile/... → req.apiVersion = 1
 * /api/v2/mobile/... → req.apiVersion = 2
 * /api/mobile/...    → req.apiVersion = 1 (default)
 */
const apiVersion = (req, res, next) => {
    const versionMatch = req.baseUrl.match(/\/v(\d+)\//);
    req.apiVersion = versionMatch ? parseInt(versionMatch[1]) : 1;

    // أضف header في الـ response ليعرف التطبيق أي إصدار استُخدم
    res.setHeader('X-API-Version', `v${req.apiVersion}`);

    next();
};

/**
 * Middleware: رفض الإصدارات غير المدعومة
 * يُستخدم إذا أردت إيقاف إصدار قديم
 */
const SUPPORTED_VERSIONS = [1, 2, 3];
const DEPRECATED_VERSIONS = []; // أضف أرقام الإصدارات المُلغاة هنا

const validateVersion = (req, res, next) => {
    const version = req.apiVersion || 1;

    if (DEPRECATED_VERSIONS.includes(version)) {
        return res.status(410).json({
            success: false,
            message: `API v${version} is no longer supported. Please update your app.`,
            code: 'API_VERSION_DEPRECATED'
        });
    }

    if (!SUPPORTED_VERSIONS.includes(version)) {
        return res.status(400).json({
            success: false,
            message: `API v${version} does not exist.`,
            code: 'API_VERSION_INVALID'
        });
    }

    next();
};

module.exports = { apiVersion, validateVersion, SUPPORTED_VERSIONS };
