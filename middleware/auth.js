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

            // ✅ فحص استثناء مسار الاستئناف (مرة واحدة لجميع الفحوصات أدناه)
            const isAppealRequest = req.originalUrl.includes('/appeals');

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
                } else if (!isAppealRequest) {
                    // ✅ السماح بالاستئناف فقط — أي مسار آخر يُمنع
                    return res.status(403).json({
                        success: false,
                        message: 'تم حظر حسابك بسبب مخالفات متكررة',
                        code: 'ACCOUNT_BANNED'
                    });
                }
                // لو isAppealRequest → نتركه يمر لتقديم الاستئناف
            }

            // ✅ فحص تعليق العضوية (قبل isActive لأن التعليق يغيّر isActive)
            // السماح للمعلّقين بتقديم الاستئناف
            if (isAppealRequest) {
                // تخطي فحص التعليق — المستخدم يحق له يستأنف
            } else
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

            // ✅ فحص تقييد المراسلة (auto-lift)
            if (req.user.restrictions?.messagingRestricted) {
                const now = new Date();
                if (req.user.restrictions.messagingRestrictedUntil && now >= req.user.restrictions.messagingRestrictedUntil) {
                    // انتهت مدة التقييد — فك تلقائي
                    await User.findByIdAndUpdate(req.user._id, {
                        'restrictions.messagingRestricted': false,
                        'restrictions.messagingRestrictedUntil': null,
                        'restrictions.messagingRestrictedLevel': null,
                        'restrictions.restrictionReason': null
                    });
                } else {
                    // لا يزال مقيّد — نضيف headers (لا نوقف الطلب)
                    res.set('X-Restriction-Level', req.user.restrictions.messagingRestrictedLevel || 'none');
                    res.set('X-Restriction-Until', req.user.restrictions.messagingRestrictedUntil?.toISOString() || '');
                }
            }

            // ✅ إضافة مستوى التحذير في headers (للبانر في التطبيق)
            if (req.user.warnings?.level > 0) {
                res.set('X-Warning-Level', String(req.user.warnings.level));
            }

            // ✅ فحص انتهاء الاشتراك المميز (auto-expire on every request)
            if (req.user.isPremium && req.user.premiumExpiresAt) {
                const now = new Date();
                if (now >= new Date(req.user.premiumExpiresAt)) {
                    // اشتراك منتهي — إلغاء فوري
                    await User.findByIdAndUpdate(req.user._id, {
                        isPremium: false,
                        premiumPlan: null,
                        'privacySettings.invisibleRead': false,
                        'privacySettings.stealthMode': false,
                        'privacySettings.premiumOnlyRequests': false,
                        customNameColor: null
                    });
                    req.user.isPremium = false;
                    req.user.premiumPlan = null;
                    // نضيف header عشان التطبيق يعرف
                    res.set('X-Premium-Expired', 'true');
                }
            }

            // فحص isActive (بعد الحظر والتعليق — لأنهم يغيّرون isActive)
            // ✅ السماح للمستخدمين المعلّقين بتقديم الاستئناف
            if (!req.user.isActive && !isAppealRequest) {
                return res.status(401).json({
                    success: false,
                    message: 'الحساب غير مفعل'
                });
            }

            // ✅ تحديث isOnline دائماً لو false — الكرون قد يكون قلبه stale
            // (lastLogin يبقى throttled كل 10 دقائق لتقليل الحِمل)
            const updates = {};
            if (req.user.isOnline !== true) {
                updates.isOnline = true;
            }
            const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000);
            if (!req.user.lastLogin || req.user.lastLogin < tenMinAgo) {
                updates.lastLogin = new Date();
                if (!('isOnline' in updates)) updates.isOnline = true;
            }

            // ✅ Lazy cleanup للـ messaging restriction المنتهي (أي سبب)
            // الوقت انتهى = القيد يجب أن يُلغى، بصرف النظر عن السبب
            // (external_promotion، spam reports، admin manual، إلخ)
            const now = new Date();
            if (req.user.restrictions?.messagingRestricted &&
                req.user.restrictions?.messagingRestrictedUntil &&
                req.user.restrictions.messagingRestrictedUntil < now) {
                updates['restrictions.messagingRestricted'] = false;
                updates['restrictions.messagingRestrictedUntil'] = null;
                updates['restrictions.messagingRestrictedLevel'] = null;
                updates['restrictions.restrictionReason'] = null;
                req.user.restrictions.messagingRestricted = false;
                req.user.restrictions.messagingRestrictedUntil = null;
            }
            // نفس الشيء للـ bio lock من external promo
            if (req.user.externalPromo?.bioLockedUntil &&
                req.user.externalPromo.bioLockedUntil < now) {
                updates['externalPromo.bioLockedUntil'] = null;
                req.user.externalPromo.bioLockedUntil = null;
            }

            if (Object.keys(updates).length > 0) {
                User.findByIdAndUpdate(req.user._id, updates).exec().catch(err => {
                    console.error('⚠️ خطأ في تحديث isOnline/lastLogin:', err.message);
                });
            }

            // ✅ تحديث بصمة الجهاز تلقائياً عند وصولها من التطبيق المحدّث
            // (نقرأ من headers أولاً، ثم body — بدون تعطيل الـ request)
            const incomingFp = (req.headers['x-device-fingerprint'] || (req.body && req.body.deviceFingerprint) || '').toString().trim();
            const incomingKt = (req.headers['x-keychain-token'] || (req.body && req.body.keychainToken) || '').toString().trim();
            if (incomingFp || incomingKt) {
                // نقرأ القيم الحالية من DB (select: false تمنع الوصول عبر req.user)
                User.findById(req.user._id).select('+deviceFingerprint +keychainToken lastFingerprintUpdate')
                    .then(full => {
                        if (!full) return;
                        const updates = {};
                        if (incomingFp && full.deviceFingerprint !== incomingFp) updates.deviceFingerprint = incomingFp;
                        if (incomingKt && full.keychainToken !== incomingKt) updates.keychainToken = incomingKt;
                        const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
                        const needsTimestamp = !full.lastFingerprintUpdate || full.lastFingerprintUpdate < dayAgo;
                        if (Object.keys(updates).length > 0 || needsTimestamp) {
                            updates.lastFingerprintUpdate = new Date();
                            User.findByIdAndUpdate(req.user._id, updates).exec().catch(() => {});
                        }
                    })
                    .catch(() => {});
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
