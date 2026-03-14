// HalaChat Dashboard - User Validators
// قواعد التحقق من صحة بيانات المستخدمين

const { body, param, query } = require('express-validator');

/**
 * قواعد التحقق لتسجيل مستخدم جديد
 */
const registerValidation = [
    body('name')
        .trim()
        .notEmpty().withMessage('الاسم مطلوب')
        .isLength({ min: 2, max: 50 }).withMessage('الاسم يجب أن يكون بين 2-50 حرف')
        .matches(/^[\u0600-\u06FFa-zA-Z\s]+$/).withMessage('الاسم يجب أن يحتوي على أحرف فقط'),

    body('email')
        .trim()
        .notEmpty().withMessage('البريد الإلكتروني مطلوب')
        .isEmail().withMessage('البريد الإلكتروني غير صالح')
        .normalizeEmail(),

    body('password')
        .notEmpty().withMessage('كلمة المرور مطلوبة')
        .isLength({ min: 6, max: 100 }).withMessage('كلمة المرور يجب أن تكون على الأقل 6 أحرف')
        .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/).withMessage('كلمة المرور يجب أن تحتوي على حرف كبير وحرف صغير ورقم'),

    body('role')
        .optional()
        .isIn(['admin', 'user']).withMessage('الدور يجب أن يكون admin أو user')
];

/**
 * قواعد التحقق لتسجيل الدخول
 */
const loginValidation = [
    body('email')
        .trim()
        .notEmpty().withMessage('البريد الإلكتروني مطلوب')
        .isEmail().withMessage('البريد الإلكتروني غير صالح')
        .normalizeEmail(),

    body('password')
        .notEmpty().withMessage('كلمة المرور مطلوبة')
];

/**
 * قواعد التحقق لتحديث ملف المستخدم
 */
const updateProfileValidation = [
    body('name')
        .optional()
        .trim()
        .isLength({ min: 2, max: 50 }).withMessage('الاسم يجب أن يكون بين 2-50 حرف')
        .matches(/^[\u0600-\u06FFa-zA-Z\s]+$/).withMessage('الاسم يجب أن يحتوي على أحرف فقط'),

    body('email')
        .optional()
        .trim()
        .isEmail().withMessage('البريد الإلكتروني غير صالح')
        .normalizeEmail(),

    body('profileImage')
        .optional()
        .trim(),

    body('birthDate')
        .optional()
        .isISO8601().withMessage('تاريخ الميلاد غير صالح'),

    body('gender')
        .optional()
        .isIn(['male', 'female', null]).withMessage('الجنس يجب أن يكون male أو female'),

    body('country')
        .optional()
        .trim()
        .isLength({ min: 2, max: 50 }).withMessage('اسم الدولة يجب أن يكون بين 2-50 حرف'),

    body('bio')
        .optional()
        .trim()
        .isLength({ max: 500 }).withMessage('النبذة لا يجب أن تتجاوز 500 حرف')
];

/**
 * قواعد التحقق لتغيير كلمة المرور
 */
const changePasswordValidation = [
    body('currentPassword')
        .notEmpty().withMessage('كلمة المرور الحالية مطلوبة'),

    body('newPassword')
        .notEmpty().withMessage('كلمة المرور الجديدة مطلوبة')
        .isLength({ min: 6, max: 100 }).withMessage('كلمة المرور الجديدة يجب أن تكون على الأقل 6 أحرف')
        .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/).withMessage('كلمة المرور يجب أن تحتوي على حرف كبير وحرف صغير ورقم')
        .custom((value, { req }) => {
            if (value === req.body.currentPassword) {
                throw new Error('كلمة المرور الجديدة يجب أن تكون مختلفة عن القديمة');
            }
            return true;
        })
];

/**
 * قواعد التحقق لتحديث مستخدم من قبل Admin
 */
const updateUserValidation = [
    param('id')
        .isMongoId().withMessage('معرف المستخدم غير صالح'),

    body('name')
        .optional()
        .trim()
        .isLength({ min: 2, max: 50 }).withMessage('الاسم يجب أن يكون بين 2-50 حرف'),

    body('email')
        .optional()
        .trim()
        .isEmail().withMessage('البريد الإلكتروني غير صالح')
        .normalizeEmail(),

    body('role')
        .optional()
        .isIn(['admin', 'user']).withMessage('الدور يجب أن يكون admin أو user'),

    body('isActive')
        .optional()
        .isBoolean().withMessage('حالة التفعيل يجب أن تكون true أو false')
];

/**
 * قواعد التحقق لـ Query Parameters للمستخدمين
 */
const userQueryValidation = [
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

    query('role')
        .optional()
        .isIn(['admin', 'user', 'all']).withMessage('الدور غير صالح'),

    query('isActive')
        .optional()
        .isIn(['true', 'false', 'all']).withMessage('حالة التفعيل غير صالحة'),

    query('sortBy')
        .optional()
        .isIn(['name', 'email', 'createdAt', 'lastLogin']).withMessage('طريقة الترتيب غير صالحة'),

    query('sortOrder')
        .optional()
        .isIn(['asc', 'desc']).withMessage('اتجاه الترتيب غير صالح')
];

module.exports = {
    registerValidation,
    loginValidation,
    updateProfileValidation,
    changePasswordValidation,
    updateUserValidation,
    userQueryValidation
};
