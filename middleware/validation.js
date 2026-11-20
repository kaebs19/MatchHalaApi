// HalaChat Dashboard - Validation Middleware
// التحقق من صحة البيانات المدخلة باستخدام express-validator

const { validationResult } = require('express-validator');

/**
 * Middleware للتحقق من نتائج التحقق من الصحة
 * يتم استخدامه بعد قواعد التحقق في الـ routes
 */
const validate = (req, res, next) => {
    const errors = validationResult(req);

    if (!errors.isEmpty()) {
        // تنسيق الأخطاء بشكل أفضل
        const formattedErrors = errors.array().map(error => ({
            field: error.path || error.param,
            message: error.msg,
            value: error.value
        }));

        return res.status(400).json({
            success: false,
            // السبب الفعلي (أول خطأ) بدل رسالة عامة لا تقول للمستخدم ماذا يصحّح — التطبيق يعرض message
            message: formattedErrors[0]?.message || 'خطأ في البيانات المُدخلة',
            errors: formattedErrors
        });
    }

    next();
};

module.exports = { validate };
