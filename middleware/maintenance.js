// middleware/maintenance.js
// 🔧 Maintenance Mode Middleware
// يفحص قبل أي request إذا التطبيق في وضع صيانة → يرجع 503

const Settings = require('../models/Settings');
const NodeCache = require('node-cache');

// Cache للـ settings (تحديث كل 10 ثوان فقط لتقليل DB hits)
const settingsCache = new NodeCache({ stdTTL: 10 });

const maintenanceMiddleware = async (req, res, next) => {
    try {
        // المسارات المسموحة دائماً (حتى في وضع الصيانة)
        const ALLOWED_PATHS = [
            '/api/health',
            '/api/maintenance/status',
            '/api/admin/maintenance',
            '/api/admin/login',
            '/api/auth/login'  // السماح للأدمن بالدخول
        ];

        // إذا المسار مسموح → اعبر
        if (ALLOWED_PATHS.some(p => req.path.startsWith(p))) {
            return next();
        }

        // جلب الإعدادات (من cache أو DB)
        let settings = settingsCache.get('app_settings');
        if (!settings) {
            settings = await Settings.findOne().select('maintenanceMode').lean();
            if (settings) settingsCache.set('app_settings', settings);
        }

        const maint = settings && settings.maintenanceMode;
        if (!maint || !maint.enabled) {
            return next();
        }

        // ✅ السماح للأدمن إذا allowAdmin = true
        if (maint.allowAdmin && req.user && req.user.role === 'admin') {
            return next();
        }

        // الرد بـ 503 + معلومات الصيانة
        return res.status(503).json({
            success: false,
            maintenanceMode: true,
            code: 'MAINTENANCE_MODE',
            message: maint.messageAr || 'وضع الصيانة',
            data: {
                enabled: true,
                messageAr: maint.messageAr,
                messageEn: maint.messageEn,
                estimatedEndAt: maint.estimatedEndAt,
                startedAt: maint.startedAt,
                triggerType: maint.triggerType
            }
        });
    } catch (error) {
        console.error('maintenance middleware error:', error.message);
        // عند الخطأ، اسمح بالعبور (fail-open)
        return next();
    }
};

// دالة لمسح الـ cache يدوياً عند تحديث الإعدادات
const invalidateMaintenanceCache = () => {
    settingsCache.del('app_settings');
};

module.exports = { maintenanceMiddleware, invalidateMaintenanceCache };
