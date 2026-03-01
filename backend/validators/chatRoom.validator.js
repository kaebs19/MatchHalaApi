// HalaChat Dashboard - ChatRoom Validators
// قواعد التحقق من صحة بيانات الغرف

const { body, param, query } = require('express-validator');

/**
 * قواعد التحقق لإنشاء غرفة جديدة
 */
const createChatRoomValidation = [
    body('name')
        .trim()
        .notEmpty().withMessage('اسم الغرفة مطلوب')
        .isLength({ min: 3, max: 50 }).withMessage('اسم الغرفة يجب أن يكون بين 3-50 حرف')
        .matches(/^[\u0600-\u06FFa-zA-Z0-9\s\-\_]+$/).withMessage('اسم الغرفة يحتوي على أحرف غير مسموحة'),

    body('description')
        .optional()
        .trim()
        .isLength({ max: 500 }).withMessage('الوصف لا يجب أن يتجاوز 500 حرف'),

    body('accessType')
        .notEmpty().withMessage('نوع الوصول مطلوب')
        .isIn(['public', 'private']).withMessage('نوع الوصول يجب أن يكون public أو private'),

    body('image')
        .optional()
        .trim()
        .custom((value) => {
            // السماح بالروابط العادية أو المسارات المحلية
            if (!value) return true;
            if (value.startsWith('/uploads/')) return true;
            if (value.startsWith('http://') || value.startsWith('https://')) return true;
            throw new Error('رابط الصورة غير صالح');
        }),

    body('category')
        .optional()
        .trim()
        .isLength({ max: 50 }).withMessage('التصنيف لا يجب أن يتجاوز 50 حرف'),

    body('tags')
        .optional()
        .isArray().withMessage('الوسوم يجب أن تكون مصفوفة')
        .custom((tags) => {
            if (tags && tags.length > 10) {
                throw new Error('لا يمكن إضافة أكثر من 10 وسوم');
            }
            return true;
        }),

    body('tags.*')
        .optional()
        .trim()
        .isLength({ min: 2, max: 20 }).withMessage('كل وسم يجب أن يكون بين 2-20 حرف'),

    body('capacity')
        .optional()
        .isInt({ min: 2, max: 10000 }).withMessage('السعة يجب أن تكون بين 2-10000'),

    body('settings.allowImages')
        .optional()
        .isBoolean().withMessage('allowImages يجب أن يكون true أو false'),

    body('settings.allowVideos')
        .optional()
        .isBoolean().withMessage('allowVideos يجب أن يكون true أو false'),

    body('settings.allowFiles')
        .optional()
        .isBoolean().withMessage('allowFiles يجب أن يكون true أو false'),

    body('settings.allowLinks')
        .optional()
        .isBoolean().withMessage('allowLinks يجب أن يكون true أو false'),

    body('settings.maxMessageLength')
        .optional()
        .isInt({ min: 1, max: 10000 }).withMessage('طول الرسالة يجب أن يكون بين 1-10000'),

    body('settings.slowMode')
        .optional()
        .isInt({ min: 0, max: 300 }).withMessage('وضع البطيء يجب أن يكون بين 0-300 ثانية'),

    body('settings.requireApproval')
        .optional()
        .isBoolean().withMessage('requireApproval يجب أن يكون true أو false'),

    body('settings.autoModeration')
        .optional()
        .isBoolean().withMessage('autoModeration يجب أن يكون true أو false')
];

/**
 * قواعد التحقق لتحديث غرفة
 */
const updateChatRoomValidation = [
    param('id')
        .isMongoId().withMessage('معرف الغرفة غير صالح'),

    body('name')
        .optional()
        .trim()
        .isLength({ min: 3, max: 50 }).withMessage('اسم الغرفة يجب أن يكون بين 3-50 حرف')
        .matches(/^[\u0600-\u06FFa-zA-Z0-9\s\-\_]+$/).withMessage('اسم الغرفة يحتوي على أحرف غير مسموحة'),

    body('description')
        .optional()
        .trim()
        .isLength({ max: 500 }).withMessage('الوصف لا يجب أن يتجاوز 500 حرف'),

    body('accessType')
        .optional()
        .isIn(['public', 'private']).withMessage('نوع الوصول يجب أن يكون public أو private'),

    body('image')
        .optional()
        .trim()
        .custom((value) => {
            // السماح بالروابط العادية أو المسارات المحلية
            if (!value) return true;
            if (value.startsWith('/uploads/')) return true;
            if (value.startsWith('http://') || value.startsWith('https://')) return true;
            throw new Error('رابط الصورة غير صالح');
        }),

    body('category')
        .optional()
        .trim()
        .isLength({ max: 50 }).withMessage('التصنيف لا يجب أن يتجاوز 50 حرف'),

    body('tags')
        .optional()
        .isArray().withMessage('الوسوم يجب أن تكون مصفوفة')
        .custom((tags) => {
            if (tags && tags.length > 10) {
                throw new Error('لا يمكن إضافة أكثر من 10 وسوم');
            }
            return true;
        }),

    body('capacity')
        .optional()
        .isInt({ min: 2, max: 10000 }).withMessage('السعة يجب أن تكون بين 2-10000')
];

/**
 * قواعد التحقق لـ MongoDB ID في المعاملات
 */
const mongoIdValidation = [
    param('id')
        .isMongoId().withMessage('المعرف غير صالح')
];

/**
 * قواعد التحقق لـ Query Parameters
 */
const queryValidation = [
    query('page')
        .optional()
        .isInt({ min: 1 }).withMessage('رقم الصفحة يجب أن يكون رقم موجب'),

    query('limit')
        .optional()
        .isInt({ min: 1, max: 100 }).withMessage('الحد الأقصى للعناصر يجب أن يكون بين 1-100'),

    query('search')
        .optional()
        .trim()
        .isLength({ max: 100 }).withMessage('البحث لا يجب أن يتجاوز 100 حرف'),

    query('accessType')
        .optional()
        .isIn(['public', 'private', 'all']).withMessage('نوع الوصول غير صالح'),

    query('isActive')
        .optional()
        .isIn(['true', 'false', 'all']).withMessage('حالة التفعيل غير صالحة'),

    query('sortBy')
        .optional()
        .isIn(['name', 'createdAt', 'memberCount', 'messageCount']).withMessage('طريقة الترتيب غير صالحة'),

    query('sortOrder')
        .optional()
        .isIn(['asc', 'desc']).withMessage('اتجاه الترتيب غير صالح')
];

module.exports = {
    createChatRoomValidation,
    updateChatRoomValidation,
    mongoIdValidation,
    queryValidation
};
