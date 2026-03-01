// HalaChat Dashboard - Authentication Middleware
// للتحقق من صلاحية Token

const jwt = require('jsonwebtoken');
const User = require('../models/User');

const protect = async (req, res, next) => {
    let token;

    // التحقق من وجود Token في Headers
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
        try {
            // الحصول على Token
            token = req.headers.authorization.split(' ')[1];

            // التحقق من Token
            const decoded = jwt.verify(token, process.env.JWT_SECRET);

            // الحصول على بيانات المستخدم (بدون كلمة المرور)
            req.user = await User.findById(decoded.id).select('-password');

            if (!req.user) {
                return res.status(401).json({
                    success: false,
                    message: 'المستخدم غير موجود'
                });
            }

            if (!req.user.isActive) {
                return res.status(401).json({
                    success: false,
                    message: 'الحساب غير مفعل'
                });
            }

            next();
        } catch (error) {
            console.error('خطأ في التحقق من Token:', error.message);
            return res.status(401).json({
                success: false,
                message: 'غير مصرح، Token غير صالح'
            });
        }
    } else {
        return res.status(401).json({
            success: false,
            message: 'غير مصرح، لا يوجد Token'
        });
    }
};

// التحقق من صلاحيات الأدمن
const adminOnly = (req, res, next) => {
    if (req.user && req.user.role === 'admin') {
        next();
    } else {
        res.status(403).json({
            success: false,
            message: 'غير مصرح، مطلوب صلاحيات أدمن'
        });
    }
};

module.exports = { protect, adminOnly };
