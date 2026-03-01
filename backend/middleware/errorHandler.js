// Error Handler Middleware
// معالج أخطاء محسّن ومركزي

class ErrorResponse extends Error {
    constructor(message, statusCode) {
        super(message);
        this.statusCode = statusCode;
        this.isOperational = true; // خطأ متوقع وليس bug
        Error.captureStackTrace(this, this.constructor);
    }
}

// معالج الأخطاء الرئيسي
const errorHandler = (err, req, res, next) => {
    let error = { ...err };
    error.message = err.message;
    error.statusCode = err.statusCode || 500;

    // Log للأخطاء
    if (process.env.NODE_ENV === 'development') {
        console.error('Error:', {
            message: err.message,
            stack: err.stack,
            statusCode: err.statusCode
        });
    }

    // أخطاء Mongoose - Cast Error (معرف غير صحيح)
    if (err.name === 'CastError') {
        const message = 'المعرف المدخل غير صحيح';
        error = new ErrorResponse(message, 400);
    }

    // أخطاء Mongoose - Duplicate Key (مفتاح مكرر)
    if (err.code === 11000) {
        const field = Object.keys(err.keyValue)[0];
        const message = `${field === 'email' ? 'البريد الإلكتروني' : field} موجود بالفعل`;
        error = new ErrorResponse(message, 400);
    }

    // أخطاء Mongoose - Validation Error
    if (err.name === 'ValidationError') {
        const message = Object.values(err.errors).map(val => val.message).join(', ');
        error = new ErrorResponse(message, 400);
    }

    // أخطاء JWT - Token غير صحيح
    if (err.name === 'JsonWebTokenError') {
        const message = 'رمز التوثيق غير صحيح';
        error = new ErrorResponse(message, 401);
    }

    // أخطاء JWT - Token منتهي الصلاحية
    if (err.name === 'TokenExpiredError') {
        const message = 'انتهت صلاحية الجلسة. يرجى تسجيل الدخول مرة أخرى';
        error = new ErrorResponse(message, 401);
    }

    res.status(error.statusCode).json({
        success: false,
        message: error.message || 'خطأ في السيرفر',
        error: process.env.NODE_ENV === 'development' ? {
            message: err.message,
            stack: err.stack
        } : undefined
    });
};

// معالج للطلبات غير الموجودة (404)
const notFound = (req, res, next) => {
    const error = new ErrorResponse(`المسار ${req.originalUrl} غير موجود`, 404);
    next(error);
};

// Async Handler - لتجنب try/catch في كل route
const asyncHandler = (fn) => (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
};

module.exports = {
    ErrorResponse,
    errorHandler,
    notFound,
    asyncHandler
};
