// HalaChat Dashboard - JWT Token Generator
// دالة لتوليد Token للمصادقة

const jwt = require('jsonwebtoken');

/**
 * توليد Access Token (للاستخدام اليومي)
 * المدة: 30 يوم (من .env) أو 30d افتراضياً
 */
const generateToken = (userId) => {
    return jwt.sign(
        { id: userId, type: 'access' },
        process.env.JWT_SECRET,
        {
            expiresIn: process.env.JWT_EXPIRE || '30d'
        }
    );
};

/**
 * توليد Refresh Token (لتجديد Access Token بدون إعادة تسجيل الدخول)
 * المدة: 90 يوم — يُخزّن في التطبيق ويُستخدم عند انتهاء Access Token
 */
const generateRefreshToken = (userId) => {
    return jwt.sign(
        { id: userId, type: 'refresh' },
        process.env.JWT_SECRET,
        {
            expiresIn: process.env.JWT_REFRESH_EXPIRE || '90d'
        }
    );
};

module.exports = { generateToken, generateRefreshToken };
