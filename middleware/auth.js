// HalaChat Dashboard - Authentication Middleware
// للتحقق من صلاحية Token
//
// ✅ نظام التعليق التدريجي (Updated: 02/04/2026)
// ─────────────────────────────────────────────
// عند فحص تعليق العضوية:
// 1. إذا انتهت مدة التعليق → يُلغى تلقائياً + Socket.IO event
// 2. إذا لا يزال معلّقاً → يرد 403 مع:
//    - reason: سبب التعليق
//    - suspendedUntil: تاريخ انتهاء التعليق (ISO8601)
//    - level: مستوى التعليق (1=24h, 2=48h, 3=3d, 4=7d, 5=دائم)
//    - violationCount: عدد البلاغات من مستخدمين مختلفين
//

const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Report = require('../models/Report');

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

            // ✅ فحص حظر الكلمات المحظورة (قبل isActive لأن الحظر يغيّر isActive)
            if (req.user.bannedWords?.isBanned) {
                // ✅ فك الحظر تلقائياً بعد 24 ساعة + إعادة العدّاد
                const bannedAt = req.user.bannedWords.bannedAt;
                const hoursSinceBan = bannedAt ? (Date.now() - new Date(bannedAt).getTime()) / (1000 * 60 * 60) : 0;

                if (bannedAt && hoursSinceBan >= 24) {
                    await User.findByIdAndUpdate(req.user._id, {
                        'bannedWords.isBanned': false,
                        'bannedWords.bannedAt': null,
                        'bannedWords.banReason': null,
                        'bannedWords.violations': 0,
                        'bannedWords.lastViolationDate': null,
                        isActive: true
                    });
                    // المستخدم فُكّ حظره — يتابع عادي
                } else {
                    return res.status(403).json({
                        success: false,
                        message: 'تم حظر حسابك بسبب مخالفات متكررة',
                        code: 'ACCOUNT_BANNED'
                    });
                }
            }

            // ✅ فحص تعليق العضوية (قبل isActive لأن التعليق يغيّر isActive)
            if (req.user.suspension?.isSuspended) {
                const now = new Date();
                if (req.user.suspension.suspendedUntil && now >= req.user.suspension.suspendedUntil) {
                    // انتهت مدة التعليق — إلغاء التعليق تلقائياً
                    await User.findByIdAndUpdate(req.user._id, {
                        'suspension.isSuspended': false,
                        'suspension.suspendedUntil': null,
                        'suspension.reason': null,
                        isActive: true
                    });

                    // ✅ Socket.IO — إبلاغ التطبيق فوراً بفك التعليق
                    if (global.io) {
                        global.io.to(`user:${req.user._id}`).emit('account-unsuspended');
                    }
                } else {
                    const untilISO = req.user.suspension.suspendedUntil
                        ? req.user.suspension.suspendedUntil.toISOString()
                        : null;
                    // تنسيق التاريخ للعرض
                    const untilFormatted = req.user.suspension.suspendedUntil
                        ? req.user.suspension.suspendedUntil.toLocaleDateString('ar-SA', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
                        : 'غير محدد';

                    // حساب عدد البلاغات من مستخدمين مختلفين
                    let violationCount = 0;
                    try {
                        const uniqueReporters = await Report.distinct('reportedBy', {
                            reportedUser: req.user._id,
                            status: { $in: ['pending', 'reviewing'] }
                        });
                        violationCount = uniqueReporters.length;
                    } catch (e) { /* ignore */ }

                    return res.status(403).json({
                        success: false,
                        message: untilISO ? `تم تعليق حسابك حتى ${untilFormatted}` : 'تم تعليق حسابك بشكل دائم',
                        code: 'ACCOUNT_SUSPENDED',
                        data: {
                            reason: req.user.suspension.reason,
                            suspendedUntil: req.user.suspension.suspendedUntil,
                            level: req.user.suspension.level || 0,
                            violationCount
                        }
                    });
                }
            }

            // فحص isActive (بعد الحظر والتعليق — لأنهم يغيّرون isActive)
            if (!req.user.isActive) {
                return res.status(401).json({
                    success: false,
                    message: 'الحساب غير مفعل'
                });
            }

            // تحديث آخر ظهور (كل 10 دقائق كحد أقصى لتقليل الحِمل)
            const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000);
            if (!req.user.lastLogin || req.user.lastLogin < tenMinAgo) {
                // ✅ fire-and-forget لكن مع logging عند الخطأ
                User.findByIdAndUpdate(req.user._id, {
                    lastLogin: new Date(),
                    isOnline: true
                }).exec().catch(err => {
                    console.error('⚠️ خطأ في تحديث lastLogin:', err.message);
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
