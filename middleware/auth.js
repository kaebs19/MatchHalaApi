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

            // فحص حظر الكلمات المحظورة
            if (req.user.bannedWords?.isBanned) {
                return res.status(403).json({
                    success: false,
                    message: 'تم حظر حسابك بسبب مخالفات متكررة',
                    code: 'ACCOUNT_BANNED'
                });
            }

            // ✅ فحص تعليق العضوية
            if (req.user.suspension?.isSuspended) {
                const now = new Date();
                if (req.user.suspension.suspendedUntil && now >= req.user.suspension.suspendedUntil) {
                    // انتهت مدة التعليق — إلغاء التعليق تلقائياً
                    await User.findByIdAndUpdate(req.user._id, {
                        'suspension.isSuspended': false,
                        isActive: true
                    });
                } else {
                    const until = req.user.suspension.suspendedUntil
                        ? req.user.suspension.suspendedUntil.toISOString()
                        : 'غير محدد';
                    return res.status(403).json({
                        success: false,
                        message: `تم تعليق حسابك حتى ${until}`,
                        code: 'ACCOUNT_SUSPENDED',
                        data: {
                            reason: req.user.suspension.reason,
                            suspendedUntil: req.user.suspension.suspendedUntil
                        }
                    });
                }
            }

            // تحديث آخر ظهور (كل 5 دقائق كحد أقصى لتقليل الحِمل)
            const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
            if (!req.user.lastLogin || req.user.lastLogin < fiveMinAgo) {
                User.findByIdAndUpdate(req.user._id, {
                    lastLogin: new Date(),
                    isOnline: true
                }).exec().catch(() => {});
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
