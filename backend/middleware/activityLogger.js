// HalaChat Dashboard - Activity Logger Middleware
// Middleware لتسجيل النشاطات تلقائياً

const ActivityLog = require('../models/ActivityLog');

/**
 * Middleware لتسجيل النشاطات بناءً على المسار والطريقة
 */
const activityLogger = (action, description, options = {}) => {
    return async (req, res, next) => {
        // حفظ الدالة الأصلية
        const originalJson = res.json.bind(res);

        // استبدال الدالة لالتقاط النتيجة
        res.json = function(data) {
            // تسجيل النشاط فقط إذا كانت العملية ناجحة
            if (data.success !== false && req.user) {
                // تحديد معلومات الطلب
                const requestInfo = {
                    ipAddress: req.ip || req.connection.remoteAddress,
                    userAgent: req.get('user-agent'),
                    method: req.method,
                    url: req.originalUrl
                };

                // تحديد الهدف
                const targetId = options.getTargetId ? options.getTargetId(req, data) : req.params.id;
                const targetName = options.getTargetName ? options.getTargetName(req, data) : null;

                // تحديد المستوى
                const severity = options.severity || 'low';

                // تسجيل النشاط
                ActivityLog.logActivity({
                    user: req.user._id,
                    action: typeof action === 'function' ? action(req, data) : action,
                    description: typeof description === 'function' ? description(req, data) : description,
                    targetType: options.targetType || null,
                    targetId,
                    targetName,
                    metadata: options.getMetadata ? options.getMetadata(req, data) : {},
                    requestInfo,
                    severity,
                    status: 'success'
                }).catch(err => {
                    console.error('خطأ في تسجيل النشاط:', err);
                });
            }

            // استدعاء الدالة الأصلية
            return originalJson(data);
        };

        next();
    };
};

/**
 * دالة مساعدة لتسجيل نشاط مباشرة
 */
const logActivity = async (req, action, description, options = {}) => {
    if (!req.user) return;

    const requestInfo = {
        ipAddress: req.ip || req.connection.remoteAddress,
        userAgent: req.get('user-agent'),
        method: req.method,
        url: req.originalUrl
    };

    await ActivityLog.logActivity({
        user: req.user._id,
        action,
        description,
        targetType: options.targetType || null,
        targetId: options.targetId || null,
        targetName: options.targetName || null,
        metadata: options.metadata || {},
        requestInfo,
        severity: options.severity || 'low',
        status: options.status || 'success',
        errorMessage: options.errorMessage || null
    });
};

/**
 * Middleware لتسجيل فشل العمليات
 */
const logFailedActivity = (action, description) => {
    return async (err, req, res, next) => {
        if (req.user) {
            await logActivity(req, action, description, {
                status: 'failed',
                errorMessage: err.message,
                severity: 'high',
                metadata: {
                    error: err.message,
                    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
                }
            });
        }
        next(err);
    };
};

module.exports = {
    activityLogger,
    logActivity,
    logFailedActivity
};
