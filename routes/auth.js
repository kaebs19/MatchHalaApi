// HalaChat Dashboard - Auth Routes
// المسارات الخاصة بالتسجيل وتسجيل الدخول

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const User = require('../models/User');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const FlaggedMessage = require('../models/FlaggedMessage');
const { generateToken, generateRefreshToken } = require('../utils/generateToken');
const sendEmail = require('../utils/sendEmail');
const { protect } = require('../middleware/auth');
const { validate } = require('../middleware/validation');
const upload = require('../config/multer');
const { optimizeImage } = require('../middleware/imageOptimizer');
const { processImage } = require('../utils/imageProcessor');
const {
    registerValidation,
    loginValidation,
    updateProfileValidation,
    changePasswordValidation
} = require('../validators/user.validator');

// فلترة الأسماء المحظورة
const { checkBannedWords } = require('./bannedWords');
const { detectExternalPromotion, recordExternalPromoViolation, isBioLocked } = require('../utils/externalPromotionDetector');

// ✅ حظر الأجهزة
const BannedDevice = require('../models/BannedDevice');
const bannedDeviceCheck = require('../middleware/bannedDeviceCheck');
const { isStrictDeviceVersion } = require('../utils/strictDeviceMode');

// ════════════════════════════════════════════════════════════════
// @route   POST /api/auth/check-device-ban
// @desc    فحص إن كان الجهاز محظور — public، بدون auth token
// @access  Public
// يحل مشكلة: iOS لا يستطيع استخدام /auth/me لأنه يحتاج token
// ════════════════════════════════════════════════════════════════
router.post('/check-device-ban', async (req, res) => {
    try {
        const { deviceFingerprint, deviceToken, vendorId } = req.body;
        if (!deviceFingerprint && !deviceToken && !vendorId) {
            return res.status(400).json({ success: false, message: 'بيانات الجهاز مطلوبة' });
        }

        const bannedDevice = await BannedDevice.findOne({
            isActive: true,
            $or: [
                ...(deviceFingerprint ? [{ deviceFingerprint }] : []),
                ...(deviceToken ? [{ keychainToken: deviceToken }] : []),
                ...(vendorId ? [{ vendorId }] : [])
            ]
        }).select('_id reason reasonDetails bannedBy createdAt');

        res.json({
            success: true,
            data: {
                banned: !!bannedDevice,
                bannedDeviceId: bannedDevice?._id.toString() || null,
                reason: bannedDevice?.reasonDetails || null
            }
        });
    } catch (error) {
        console.error('خطأ في فحص حظر الجهاز:', error);
        res.status(500).json({ success: false, message: 'خطأ في السيرفر' });
    }
});

// ✅ إثراء الملف الشخصي (برج، رتبة، عيد ميلاد، VIP)
const { getZodiacSign, computeUserRank, isBirthdayToday, hasVipBadge, getVipBadgeSource } = require('../utils/profileEnrichment');

// Google Auth — iOS + Web clients
const { OAuth2Client } = require('google-auth-library');
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
const googleWebClient = new OAuth2Client(process.env.GOOGLE_WEB_CLIENT_ID);

// Apple Auth
const appleSignin = require('apple-signin-auth');

// Helper: استخراج IP من الطلب
const getClientIP = (req) => {
    return req.headers['x-forwarded-for']?.split(',')[0]?.trim()
        || req.headers['x-real-ip']
        || req.connection?.remoteAddress
        || req.ip
        || null;
};

// Helper: حفظ سجل تسجيل الدخول
const saveLoginRecord = async (user, req) => {
    const ip = getClientIP(req);
    const { deviceModel, platform, appVersion, city, country } = req.body;

    const loginEntry = {
        ip,
        country: country || user.country,
        city: city || user.city,
        deviceModel: deviceModel || user.deviceInfo?.deviceModel,
        platform: platform || user.deviceInfo?.platform,
        appVersion: appVersion || user.deviceInfo?.appVersion,
        loginAt: new Date()
    };

    // تحديث بيانات المستخدم + إضافة سجل الدخول (الاحتفاظ بآخر 20)
    const updateData = {
        lastLogin: new Date(),
        lastIP: ip,
        $push: {
            loginHistory: {
                $each: [loginEntry],
                $slice: -20 // الاحتفاظ بآخر 20 سجل فقط
            }
        }
    };

    if (city) updateData.city = city;
    if (country) updateData.country = country;
    if (deviceModel) updateData['deviceInfo.deviceModel'] = deviceModel;
    if (platform) updateData['deviceInfo.platform'] = platform;

    // ✅ حفظ بصمة الجهاز (Anti-Abuse)
    const deviceFingerprint = req.body.deviceFingerprint || req.headers['x-device-fingerprint'];
    const deviceToken = req.body.deviceToken || req.headers['x-device-token'];
    const vendorId = req.body.vendorId || req.headers['x-vendor-id'];
    // Fingerprint debug removed — production
    if (deviceFingerprint) updateData.deviceFingerprint = deviceFingerprint;
    if (deviceToken) updateData.keychainToken = deviceToken;
    if (vendorId) updateData.vendorId = vendorId;
    if (appVersion) updateData['deviceInfo.appVersion'] = appVersion;

    await User.findByIdAndUpdate(user._id, updateData);

    // ✅ ربط pending bans على هذا المستخدم بالـ fingerprint الجديد
    // (حالة: حُظر الجهاز قبل ما يكون له fingerprint، الآن وصلت بصمة)
    if ((deviceFingerprint || deviceToken || vendorId)) {
        try {
            const setFields = { pendingFingerprint: false };
            if (deviceFingerprint) setFields.deviceFingerprint = deviceFingerprint;
            if (deviceToken) setFields.keychainToken = deviceToken;
            if (vendorId) setFields.vendorId = vendorId;
            await BannedDevice.updateMany(
                { originalUserId: user._id, pendingFingerprint: true },
                { $set: setFields }
            );
        } catch (e) { /* fail-silent */ }
    }
};

// ════════════════════════════════════════════════════════════════
// ✅ Helper: تسجيل/تحديث BannedDevice عند رفض الدخول لحساب موقوف
// يُستدعى في كل نقاط الرفض في /login و /google و /apple
// الهدف: سدّ ثغرة الحسابات القديمة — لو موقوف ودخل من تطبيق محدّث
// نسجّل بصمة جهازه فورًا، حتى لو حاول إنشاء حساب جديد لا يقدر.
// ════════════════════════════════════════════════════════════════
/**
 * يُسجّل/يُحدّث جهاز المستخدم في BannedDevice — فقط للحظر الدائم.
 *
 * ⚠️ السلوك الجديد: حظر الجهاز يُسجَّل فقط في الحالات الدائمة.
 * - تعليق دائم (suspension.suspendedUntil = null AND level >= 5)
 * - تعطيل الحساب يدويًا من admin (isActive = false بسبب admin)
 *
 * الحالات المؤقتة (لا يُسجَّل فيها حظر جهاز):
 * - bannedWords.isBanned: حظر كلامي 24 ساعة → يُلغى تلقائيًا في login
 * - suspension.suspendedUntil != null: تعليق محدد المدة → يُلغى تلقائيًا في liftExpired cron
 */
const recordDeviceBanForUser = async (user, req, reason = 'manual', details = '') => {
    try {
        // ✅ فحص: هل العقوبة دائمة فعليًا؟
        const isPermanentSuspension =
            user?.suspension?.isSuspended === true &&
            !user.suspension.suspendedUntil; // null = دائم

        const isInactiveByAdmin = user?.isActive === false;

        // ✅ bannedWords وحدها لا تستوجب حظر جهاز (24h auto-lift)
        // ✅ suspension مؤقت لا يستوجب حظر جهاز (سينتهي تلقائيًا)
        const isPermanent = isPermanentSuspension || isInactiveByAdmin;

        if (!isPermanent) {
            // الحالة مؤقتة → نكتفي بحظر الحساب فقط
            return;
        }

        const fp = req.body?.deviceFingerprint || req.headers['x-device-fingerprint'] || user?.deviceFingerprint;
        const kt = req.body?.deviceToken || req.headers['x-device-token'] || user?.keychainToken;
        const vid = req.body?.vendorId || req.headers['x-vendor-id'] || user?.vendorId;
        if (!fp && !kt && !vid) return; // لا بصمة → لا شيء نسجّله الآن

        const orConditions = [];
        if (fp) orConditions.push({ deviceFingerprint: fp });
        if (kt) orConditions.push({ keychainToken: kt });
        if (vid) orConditions.push({ vendorId: vid });
        if (user?._id) orConditions.push({ originalUserId: user._id });

        const setOnInsert = {
            originalUserId: user?._id || null,
            reason,
            reasonDetails: details || `auto-recorded on suspended login (${reason})`,
            bannedBy: 'auto',
            isActive: true,
            pendingFingerprint: false
        };
        if (req.body?.deviceInfo) setOnInsert.deviceInfo = req.body.deviceInfo;

        // ضمان أن fp/kt/vid يُكتبا حتى لو كان السجل موجود بدون أحدهم
        const setFields = { isActive: true, pendingFingerprint: false };
        if (fp) setFields.deviceFingerprint = fp;
        if (kt) setFields.keychainToken = kt;
        if (vid) setFields.vendorId = vid;

        await BannedDevice.findOneAndUpdate(
            { $or: orConditions },
            { $set: setFields, $setOnInsert: setOnInsert },
            { upsert: true, new: true }
        );
    } catch (e) {
        console.error('⚠️ recordDeviceBanForUser error:', e.message);
        // fail-silent — ما نُعطّل رفض الدخول
    }
};

// @route   POST /api/auth/register
// @desc    تسجيل مستخدم جديد
// @access  Public
router.post('/register', registerValidation, validate, async (req, res) => {
    try {
        const { name, email, password } = req.body;

        // التحقق من البيانات
        if (!name || !email || !password) {
            return res.status(400).json({
                success: false,
                message: 'جميع الحقول مطلوبة'
            });
        }

        // فحص الاسم ضد الكلمات المحظورة
        const nameCheck = await checkBannedWords(name);
        if (nameCheck.hasBannedWords) {
            return res.status(400).json({
                success: false,
                message: 'الاسم يحتوي على كلمات غير مسموح بها',
                code: 'BANNED_NAME'
            });
        }

        // ✅ فحص الاسم ضد قائمة الأسماء المحظورة في الإعدادات
        const Settings = require('../models/Settings');
        const appSettings = await Settings.getSettings();
        const nameLower = name.trim().toLowerCase();
        const isBannedName = appSettings.bannedNames?.some(bn =>
            nameLower === bn.name || nameLower.includes(bn.name)
        );
        if (isBannedName) {
            return res.status(400).json({
                success: false,
                message: 'هذا الاسم غير مسموح به',
                code: 'BANNED_NAME'
            });
        }

        // ✅ فحص حظر الجهاز (Device Ban Check)
        const { deviceFingerprint, deviceToken, deviceInfo, vendorId } = req.body;

        // ✅ Strict Mode للنسخ ≥ 5.4 — إلزام بصمة الجهاز
        if (isStrictDeviceVersion(req) && !deviceFingerprint && !deviceToken && !vendorId) {
            return res.status(400).json({
                success: false,
                message: 'بيانات الجهاز مطلوبة لإنشاء الحساب',
                code: 'MISSING_DEVICE_INFO'
            });
        }

        if (deviceFingerprint || deviceToken || vendorId) {
            const bannedDevice = await BannedDevice.findOne({
                isActive: true,
                $or: [
                    ...(deviceFingerprint ? [{ deviceFingerprint }] : []),
                    ...(deviceToken ? [{ keychainToken: deviceToken }] : []),
                    ...(vendorId ? [{ vendorId }] : [])
                ]
            });

            if (bannedDevice) {
                // تسجيل محاولة التسجيل المرفوضة (action: register)
                bannedDevice.rejectedAttempts.push({
                    email, name, ip: getClientIP(req), action: 'register'
                });
                await bannedDevice.save();

                return res.status(403).json({
                    success: false,
                    message: 'لا يمكن إنشاء حساب من هذا الجهاز',
                    code: 'DEVICE_BANNED'
                });
            }
        }

        // التحقق من أن البريد غير مستخدم
        const userExists = await User.findOne({ email });
        if (userExists) {
            return res.status(400).json({
                success: false,
                message: 'البريد الإلكتروني مستخدم بالفعل'
            });
        }

        // إنشاء المستخدم
        const user = await User.create({
            name,
            email,
            password
        });

        // ✅ حفظ بصمة الجهاز في سجل المستخدم
        if (deviceFingerprint || deviceToken || vendorId) {
            user.deviceFingerprint = deviceFingerprint;
            user.keychainToken = deviceToken;
            user.vendorId = vendorId;
            if (deviceInfo) user.deviceDetails = deviceInfo;
            await user.save();
        }

        // إرجاع البيانات مع Token
        res.status(201).json({
            success: true,
            message: 'تم التسجيل بنجاح',
            data: {
                user: {
                    id: user._id,
                    name: user.name,
                    email: user.email,
                    role: user.role,
                    profileImage: getFullUrl(user.profileImage) || null
                },
                token: generateToken(user._id),
                refreshToken: generateRefreshToken(user._id)
            }
        });

    } catch (error) {
        console.error('خطأ في التسجيل:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في السيرفر',
            error: error.message
        });
    }
});

// @route   POST /api/auth/login
// @desc    تسجيل الدخول
// @access  Public
router.post('/login', loginValidation, validate, async (req, res) => {
    try {
        const { email, password } = req.body;

        // التحقق من البيانات
        if (!email || !password) {
            return res.status(400).json({
                success: false,
                message: 'البريد الإلكتروني وكلمة المرور مطلوبة'
            });
        }

        // ✅ Strict Mode للنسخ ≥ 5.4 — إلزام بصمة الجهاز قبل أي شيء
        if (isStrictDeviceVersion(req) && !req.body.deviceFingerprint && !req.body.deviceToken && !req.body.vendorId) {
            return res.status(400).json({
                success: false,
                message: 'بيانات الجهاز مطلوبة لتسجيل الدخول',
                code: 'MISSING_DEVICE_INFO'
            });
        }

        // البحث عن المستخدم (مع كلمة المرور)
        const user = await User.findOne({ email }).select('+password');

        if (!user) {
            return res.status(401).json({
                success: false,
                message: 'البريد الإلكتروني أو كلمة المرور خاطئة'
            });
        }

        // التحقق من كلمة المرور
        const isPasswordMatch = await user.comparePassword(password);

        if (!isPasswordMatch) {
            return res.status(401).json({
                success: false,
                message: 'البريد الإلكتروني أو كلمة المرور خاطئة'
            });
        }

        // ✅ فحص حظر الجهاز عند تسجيل الدخول
        const { deviceFingerprint, deviceToken, vendorId } = req.body;

        if (deviceFingerprint || deviceToken || vendorId) {
            const bannedDevice = await BannedDevice.findOne({
                isActive: true,
                $or: [
                    ...(deviceFingerprint ? [{ deviceFingerprint }] : []),
                    ...(deviceToken ? [{ keychainToken: deviceToken }] : []),
                    ...(vendorId ? [{ vendorId }] : [])
                ]
            });

            if (bannedDevice) {
                bannedDevice.rejectedAttempts.push({
                    email, ip: getClientIP(req), action: 'login'
                });
                await bannedDevice.save();

                return res.status(403).json({
                    success: false,
                    message: 'هذا الجهاز محظور من استخدام التطبيق',
                    code: 'DEVICE_BANNED'
                });
            }

            // تحديث بصمة الجهاز
            user.deviceFingerprint = deviceFingerprint;
            user.keychainToken = deviceToken;
            if (vendorId) user.vendorId = vendorId;
        }

        // ✅ فحص الحظر والتعليق قبل isActive (لأنهم يغيّرون isActive=false)
        if (user.bannedWords?.isBanned) {
            // ✅ فك الحظر تلقائياً بعد 24 ساعة
            const bannedAt = user.bannedWords.bannedAt;
            const hoursSinceBan = bannedAt ? (Date.now() - new Date(bannedAt).getTime()) / (1000 * 60 * 60) : 0;

            if (bannedAt && hoursSinceBan >= 24) {
                await User.findByIdAndUpdate(user._id, {
                    'bannedWords.isBanned': false,
                    'bannedWords.bannedAt': null,
                    'bannedWords.banReason': null,
                    'bannedWords.violations': 0,
                    'bannedWords.lastViolationDate': null,
                    isActive: true
                });
                // فُكّ الحظر — يتابع تسجيل الدخول
            } else {
                // ✅ سدّ ثغرة الحسابات القديمة — سجّل/حدّث جهاز الموقوف
                await recordDeviceBanForUser(user, req, 'violation', user.bannedWords.banReason || 'banned_words');
                return res.status(403).json({
                    success: false,
                    message: 'تم حظر حسابك بسبب مخالفات متكررة للكلمات المحظورة. تواصل مع الإدارة',
                    code: 'ACCOUNT_BANNED',
                    data: { reason: user.bannedWords.banReason, bannedAt: user.bannedWords.bannedAt }
                });
            }
        }

        // فحص التعليق
        if (user.suspension?.isSuspended) {
            const now = new Date();
            if (user.suspension.suspendedUntil && now >= user.suspension.suspendedUntil) {
                // انتهت مدة التعليق — إلغاء تلقائي
                await User.findByIdAndUpdate(user._id, {
                    'suspension.isSuspended': false,
                    'suspension.suspendedUntil': null,
                    'suspension.reason': null,
                    isActive: true
                });
            } else {
                const untilFormatted = user.suspension.suspendedUntil
                    ? user.suspension.suspendedUntil.toLocaleDateString('ar-SA', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
                    : 'غير محدد';
                // ✅ تعليق دائم (suspendedUntil = null) → احظر الجهاز تلقائيًا
                if (!user.suspension.suspendedUntil) {
                    await recordDeviceBanForUser(user, req, 'manual', user.suspension.reason || 'permanent_suspension');
                }
                return res.status(403).json({
                    success: false,
                    message: user.suspension.suspendedUntil ? `تم تعليق حسابك حتى ${untilFormatted}` : 'تم تعليق حسابك بشكل دائم',
                    code: 'ACCOUNT_SUSPENDED',
                    token: require('jsonwebtoken').sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '1h' }),
                    user: {
                        _id: user._id,
                        name: user.name,
                        email: user.email,
                        profileImage: user.profileImage
                    },
                    data: {
                        reason: user.suspension.reason,
                        suspendedUntil: user.suspension.suspendedUntil,
                        level: user.suspension.level || 0
                    }
                });
            }
        }

        // التحقق من أن الحساب مفعل
        if (!user.isActive) {
            // ✅ حساب معطّل بالكامل (admin أو نظام) → احظر الجهاز
            await recordDeviceBanForUser(user, req, 'manual', 'inactive_account');
            return res.status(401).json({
                success: false,
                message: 'الحساب غير مفعل، تواصل مع الإدارة'
            });
        }

        // تحديث آخر تسجيل دخول + حفظ السجل
        await saveLoginRecord(user, req);

        // إرجاع البيانات مع Token
        res.status(200).json({
            success: true,
            message: 'تم تسجيل الدخول بنجاح',
            data: {
                user: {
                    id: user._id,
                    name: user.name,
                    email: user.email,
                    role: user.role,
                    profileImage: getFullUrl(user.profileImage),
                    lastLogin: user.lastLogin
                },
                token: generateToken(user._id),
                refreshToken: generateRefreshToken(user._id)
            }
        });

    } catch (error) {
        console.error('خطأ في تسجيل الدخول:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في السيرفر',
            error: error.message
        });
    }
});

// Helper: تحويل المسار النسبي إلى URL كامل
const getFullUrl = (imgPath) => {
    if (!imgPath) return null;
    if (imgPath.startsWith('http')) return imgPath;
    const baseUrl = process.env.BASE_URL || 'https://matchhala.chathala.com';
    return `${baseUrl}${imgPath}`;
};

// @route   GET /api/auth/me
// @desc    الحصول على بيانات المستخدم الحالي
// @access  Private
router.get('/me', protect, async (req, res) => {
    try {
        // ✅ حفظ بصمة الجهاز من headers (لو ما وصلت من login)
        const fpFromHeader = req.headers['x-device-fingerprint'];
        const dtFromHeader = req.headers['x-device-token'];
        if (fpFromHeader || dtFromHeader) {
            const updateFields = {};
            if (fpFromHeader && !req.user.deviceFingerprint) updateFields.deviceFingerprint = fpFromHeader;
            if (dtFromHeader && !req.user.keychainToken) updateFields.keychainToken = dtFromHeader;
            if (Object.keys(updateFields).length > 0) {
                await User.findByIdAndUpdate(req.user._id, updateFields);
                // Fingerprint saved silently
            }
        }

        const userObj = req.user.toObject ? req.user.toObject() : { ...req.user };

        // ✅ تحويل profileImage إلى URL كامل
        if (userObj.profileImage) {
            userObj.profileImage = getFullUrl(userObj.profileImage);
        }

        // ✅ تحويل photos إلى مصفوفة strings (URLs كاملة)
        // الباكند يخزنها كـ objects {original, medium, thumbnail, order}
        // iOS يتوقعها كـ [String] — نرسل الـ medium أو original
        if (userObj.photos && Array.isArray(userObj.photos)) {
            userObj.photos = userObj.photos.map(photo => {
                if (typeof photo === 'string') {
                    return getFullUrl(photo);
                }
                // photo object: استخدم medium أو original
                const imgPath = photo.medium || photo.original || photo.thumbnail;
                return getFullUrl(imgPath);
            }).filter(Boolean);
        }

        // ✅ حقول محسوبة: برج + رتبة + عيد ميلاد + VIP + تاريخ الانضمام
        userObj.joinDate = userObj.createdAt;
        userObj.zodiacSign = getZodiacSign(userObj.birthDate);
        userObj.userRank = computeUserRank(userObj);
        userObj.isBirthdayToday = isBirthdayToday(userObj.birthDate);
        userObj.hasVipBadge = hasVipBadge(userObj);
        userObj.vipBadgeSource = getVipBadgeSource(userObj);

        // ✅ isPremium محسوب لحظياً (لا نعتمد على الحقل المخزن — قد يكون stale)
        // الـ cron الساعي يصلحها لكن قد لا يكون شغّل بعد
        const now = new Date();
        const expiresAt = userObj.premiumExpiresAt ? new Date(userObj.premiumExpiresAt) : null;
        const isPremiumValid = !!(userObj.isPremium && expiresAt && expiresAt > now);
        userObj.isPremium = isPremiumValid;
        // حقل صريح للوضوح (في حال احتاج iOS)
        userObj.premiumActive = isPremiumValid;

        res.status(200).json({
            success: true,
            data: {
                user: userObj
            }
        });
    } catch (error) {
        console.error('خطأ في جلب البيانات:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في السيرفر'
        });
    }
});

// @route   PUT /api/auth/update-profile
// @desc    تحديث الملف الشخصي
// @access  Private
router.put('/update-profile', protect, updateProfileValidation, validate, async (req, res) => {
    try {
        const { name, email, profileImage, birthDate, gender, country, bio, defaultAvatar, interests } = req.body;

        const user = await User.findById(req.user.id);

        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'المستخدم غير موجود'
            });
        }

        // ✅ فحص قيود الأدمن على تغيير الاسم
        if (name && name !== user.name && user.restrictions?.nameBlocked) {
            if (!user.restrictions.nameBlockedUntil || user.restrictions.nameBlockedUntil > new Date()) {
                const until = user.restrictions.nameBlockedUntil
                    ? new Date(user.restrictions.nameBlockedUntil).toLocaleDateString('ar-SA')
                    : 'غير محدد';
                return res.status(403).json({
                    success: false,
                    message: `تم منعك من تغيير الاسم حتى: ${until}. السبب: ${user.restrictions.nameBlockedReason || 'مخالفة'}`,
                    code: 'NAME_BLOCKED'
                });
            } else {
                // انتهت فترة المنع — رفع القيد
                user.restrictions.nameBlocked = false;
                user.restrictions.nameBlockedUntil = null;
                user.restrictions.nameBlockedReason = null;
            }
        }

        // ✅ فحص cooldown تغيير الاسم (3 مرات كل 30 يوم)
        const NAME_CHANGE_WINDOW_DAYS = 30;
        const NAME_CHANGE_MAX = 3;
        if (name && name !== user.name) {
            const windowMs = NAME_CHANGE_WINDOW_DAYS * 24 * 60 * 60 * 1000;
            const cutoff = new Date(Date.now() - windowMs);

            // فلترة التاريخ → احتفظ فقط بالتعديلات داخل النافذة
            let history = (user.nameChangeHistory || [])
                .map(d => new Date(d))
                .filter(d => d > cutoff);

            // Migration: إذا الـ history فاضي + lastNameChange قديم داخل النافذة → ضمّه
            if (history.length === 0 && user.lastNameChange) {
                const last = new Date(user.lastNameChange);
                if (last > cutoff) history = [last];
            }

            if (history.length >= NAME_CHANGE_MAX) {
                // أقدم تعديل في النافذة + 30 يوم = متى تتوفر محاولة جديدة
                const oldest = new Date(Math.min(...history.map(d => d.getTime())));
                const nextAvailable = new Date(oldest.getTime() + windowMs);
                const remainingDays = Math.max(1, Math.ceil((nextAvailable - Date.now()) / (24 * 60 * 60 * 1000)));
                return res.status(429).json({
                    success: false,
                    message: `يمكنك تغيير الاسم ${NAME_CHANGE_MAX} مرات كل ${NAME_CHANGE_WINDOW_DAYS} يوم. استنفدت المحاولات — تتوفر محاولة جديدة بعد ${remainingDays} يوم`,
                    messageEn: `You can change your name ${NAME_CHANGE_MAX} times every ${NAME_CHANGE_WINDOW_DAYS} days. Limit reached — new attempt available in ${remainingDays} days`,
                    code: 'NAME_COOLDOWN',
                    remainingDays,
                    used: history.length,
                    max: NAME_CHANGE_MAX
                });
            }

            // مرّر الـ history المنظّف للأمام لاستخدامه عند الحفظ
            req._nameChangeHistory = history;
        }

        // فحص الاسم ضد الكلمات المحظورة
        if (name && name !== user.name) {
            const nameCheck = await checkBannedWords(name);
            if (nameCheck.hasBannedWords) {
                return res.status(400).json({
                    success: false,
                    message: 'الاسم يحتوي على كلمات غير مسموح بها',
                    code: 'BANNED_NAME'
                });
            }

            // ✅ فحص الاسم ضد قائمة الأسماء المحظورة في الإعدادات
            const Settings = require('../models/Settings');
            const appSettings = await Settings.getSettings();
            const nameLower = name.trim().toLowerCase();
            const isBannedName = appSettings.bannedNames?.some(bn =>
                nameLower === bn.name || nameLower.includes(bn.name)
            );
            if (isBannedName) {
                return res.status(400).json({
                    success: false,
                    message: 'هذا الاسم غير مسموح به',
                    code: 'BANNED_NAME'
                });
            }
        }

        // التحقق من عدم تكرار البريد الإلكتروني
        if (email && email !== user.email) {
            const emailExists = await User.findOne({ email });
            if (emailExists) {
                return res.status(400).json({
                    success: false,
                    message: 'البريد الإلكتروني مستخدم بالفعل'
                });
            }
        }

        // تحديث الحقول الأساسية
        if (name && name !== user.name) {
            const oldName = user.name;
            user.name = name;
            const now = new Date();
            user.lastNameChange = now;
            // ✅ سجّل التعديل في الـ rate-limit history (تواريخ فقط)
            const cleanHistory = req._nameChangeHistory || [];
            user.nameChangeHistory = [...cleanHistory, now].slice(-NAME_CHANGE_MAX);

            // ✅ سجّل في الـ audit log التفصيلي (للأدمن)
            if (!user.nameHistory) user.nameHistory = [];
            user.nameHistory.push({
                from: oldName || '',
                to: name,
                changedAt: now,
                source: 'user',
                changedBy: null,
                reason: null
            });
            // الاحتفاظ بآخر 50 entry فقط (تجنب النمو غير المحدود)
            if (user.nameHistory.length > 50) {
                user.nameHistory = user.nameHistory.slice(-50);
            }
        }
        if (email) user.email = email;

        // تحديث حقول الملف الشخصي الجديدة
        if (profileImage !== undefined) user.profileImage = profileImage;
        if (birthDate !== undefined) user.birthDate = birthDate;
        if (gender !== undefined) user.gender = gender;
        if (country !== undefined) user.country = country;

        // ✅ فحص الكلمات المحظورة + الترويج الخارجي (Snap/Insta) على النبذة
        let bioRedactedNotice = null;
        if (bio !== undefined && bio !== user.bio) {
            // ✅ Phase 2: لو bio مقفول بسبب مخالفات متكررة → ارفض التعديل
            if (isBioLocked(user)) {
                const lockedUntil = user.externalPromo.bioLockedUntil;
                const hoursLeft = Math.ceil((lockedUntil.getTime() - Date.now()) / (60 * 60 * 1000));
                return res.status(403).json({
                    success: false,
                    message: `تم تقييد تعديل النبذة لمدة ${hoursLeft} ساعة بسبب محاولات متكررة لمشاركة حسابات خارجية`,
                    code: 'BIO_LOCKED_PROMO',
                    lockedUntil
                });
            }

            let trimmedBio = (bio || '').trim();
            if (trimmedBio.length > 0) {
                // 1. فحص كلمات محظورة (يرفض الحفظ)
                const bioCheck = await checkBannedWords(trimmedBio);
                if (bioCheck.hasBannedWords) {
                    return res.status(400).json({
                        success: false,
                        message: 'النبذة تحتوي على كلمات غير مسموح بها',
                        code: 'BANNED_BIO',
                        words: bioCheck.matchedWords || []
                    });
                }

                // 2. فحص ترويج خارجي (Snap/Insta/...) — auto-redact + record violation
                const promo = detectExternalPromotion(trimmedBio);
                if (promo.detected) {
                    trimmedBio = promo.redacted;
                    const violationResult = await recordExternalPromoViolation(user);
                    bioRedactedNotice = {
                        message: violationResult.message
                            || 'تم حذف معلومات تواصل خارجي من نبذتك',
                        categories: promo.categories,
                        violations: violationResult.violations,
                        threshold: violationResult.threshold,
                        lockApplied: violationResult.lockApplied,
                        suspended: violationResult.suspended
                    };
                }
            }
            user.bio = trimmedBio;
        }

        if (interests !== undefined) user.interests = interests;

        // دعم الصور الافتراضية (avatar_1 إلى avatar_13)
        if (defaultAvatar) {
            // ✅ فحص قيود الأدمن على تغيير الصورة
            if (user.restrictions?.photoBlocked) {
                if (!user.restrictions.photoBlockedUntil || user.restrictions.photoBlockedUntil > new Date()) {
                    const until = user.restrictions.photoBlockedUntil
                        ? new Date(user.restrictions.photoBlockedUntil).toLocaleDateString('ar-SA')
                        : 'غير محدد';
                    return res.status(403).json({
                        success: false,
                        message: `تم منعك من تغيير الصورة حتى: ${until}. السبب: ${user.restrictions.photoBlockedReason || 'مخالفة'}`,
                        code: 'PHOTO_BLOCKED'
                    });
                } else {
                    user.restrictions.photoBlocked = false;
                    user.restrictions.photoBlockedUntil = null;
                    user.restrictions.photoBlockedReason = null;
                    await user.save();
                }
            }

            // ✅ الصور الافتراضية — بدون cooldown (مسموح دائماً)
            const validAvatars = Array.from({ length: 29 }, (_, i) => `avatar_${i + 1}`);
            if (validAvatars.includes(defaultAvatar)) {
                user.profileImage = `/uploads/defaults/${defaultAvatar}.jpg`;
                // لا نحدّث lastPhotoChange — cooldown فقط لرفع صور جديدة
            }
        }

        await user.save();

        // تحويل الصور لـ URLs كاملة
        const userObj = user.toObject ? user.toObject() : { ...user._doc };
        if (userObj.profileImage) {
            userObj.profileImage = getFullUrl(userObj.profileImage);
        }
        if (userObj.photos && Array.isArray(userObj.photos)) {
            userObj.photos = userObj.photos.map(photo => {
                if (typeof photo === 'string') return getFullUrl(photo);
                const imgPath = photo.medium || photo.original || photo.thumbnail;
                return getFullUrl(imgPath);
            }).filter(Boolean);
        }

        res.status(200).json({
            success: true,
            message: 'تم تحديث البيانات بنجاح',
            data: {
                user: userObj,
                bioRedacted: bioRedactedNotice  // ✅ {message, categories} لو تمّ حذف ترويج خارجي
            }
        });

    } catch (error) {
        console.error('خطأ في التحديث:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في السيرفر',
            error: error.message
        });
    }
});

// @route   PUT /api/auth/change-password
// @desc    تغيير كلمة المرور
// @access  Private
router.put('/change-password', protect, async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;

        // التحقق من البيانات
        if (!currentPassword || !newPassword) {
            return res.status(400).json({
                success: false,
                message: 'كلمة المرور الحالية والجديدة مطلوبة'
            });
        }

        // التحقق من طول كلمة المرور الجديدة
        if (newPassword.length < 6) {
            return res.status(400).json({
                success: false,
                message: 'كلمة المرور يجب أن تكون 6 أحرف على الأقل'
            });
        }

        const user = await User.findById(req.user.id).select('+password');

        // التحقق من كلمة المرور الحالية
        const isMatch = await user.comparePassword(currentPassword);
        if (!isMatch) {
            return res.status(400).json({
                success: false,
                message: 'كلمة المرور الحالية غير صحيحة'
            });
        }

        // تحديث كلمة المرور
        user.password = newPassword;
        await user.save();

        res.status(200).json({
            success: true,
            message: 'تم تغيير كلمة المرور بنجاح'
        });

    } catch (error) {
        console.error('خطأ في تغيير كلمة المرور:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في السيرفر',
            error: error.message
        });
    }
});

// @route   POST /api/auth/forgot-password
// @desc    طلب إعادة تعيين كلمة المرور (إرسال رمز التحقق)
// @access  Public
router.post('/forgot-password', async (req, res) => {
    try {
        const { email } = req.body;

        // التحقق من البيانات
        if (!email) {
            return res.status(400).json({
                success: false,
                message: 'البريد الإلكتروني مطلوب'
            });
        }

        // البحث عن المستخدم
        const user = await User.findOne({ email });

        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'لا يوجد مستخدم بهذا البريد الإلكتروني'
            });
        }

        // توليد رمز إعادة التعيين
        const resetToken = user.generateResetToken();
        await user.save();

        // إرسال البريد الإلكتروني
        const message = `
            <div dir="rtl" style="font-family: Arial, sans-serif; padding: 20px; background-color: #f4f4f4;">
                <div style="max-width: 600px; margin: 0 auto; background-color: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
                    <h2 style="color: #333; text-align: center;">إعادة تعيين كلمة المرور</h2>
                    <p style="color: #666; font-size: 16px;">مرحباً ${user.name},</p>
                    <p style="color: #666; font-size: 16px;">لقد تلقينا طلباً لإعادة تعيين كلمة المرور الخاصة بحسابك.</p>
                    <div style="background-color: #f8f9fa; padding: 20px; border-radius: 5px; text-align: center; margin: 20px 0;">
                        <p style="color: #666; margin-bottom: 10px;">رمز التحقق الخاص بك:</p>
                        <h1 style="color: #007bff; font-size: 36px; letter-spacing: 5px; margin: 10px 0;">${resetToken}</h1>
                    </div>
                    <p style="color: #666; font-size: 14px;">هذا الرمز صالح لمدة 10 دقائق فقط.</p>
                    <p style="color: #999; font-size: 12px; margin-top: 30px; text-align: center;">إذا لم تطلب إعادة تعيين كلمة المرور، يرجى تجاهل هذه الرسالة.</p>
                </div>
            </div>
        `;

        await sendEmail({
            email: user.email,
            subject: 'إعادة تعيين كلمة المرور - HalaChat',
            message: `رمز إعادة تعيين كلمة المرور الخاص بك هو: ${resetToken}\n\nهذا الرمز صالح لمدة 10 دقائق.`,
            html: message
        });

        res.status(200).json({
            success: true,
            message: 'تم إرسال رمز إعادة تعيين كلمة المرور إلى بريدك الإلكتروني'
        });

    } catch (error) {
        console.error('خطأ في طلب إعادة تعيين كلمة المرور:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في إرسال البريد الإلكتروني',
            error: error.message
        });
    }
});

// @route   POST /api/auth/reset-password
// @desc    إعادة تعيين كلمة المرور باستخدام الرمز
// @access  Public
router.post('/reset-password', async (req, res) => {
    try {
        const { email, resetToken, newPassword } = req.body;

        // التحقق من البيانات
        if (!email || !resetToken || !newPassword) {
            return res.status(400).json({
                success: false,
                message: 'جميع الحقول مطلوبة'
            });
        }

        // التحقق من طول كلمة المرور
        if (newPassword.length < 6) {
            return res.status(400).json({
                success: false,
                message: 'كلمة المرور يجب أن تكون 6 أحرف على الأقل'
            });
        }

        // تشفير الرمز للمقارنة
        const hashedToken = crypto
            .createHash('sha256')
            .update(resetToken)
            .digest('hex');

        // البحث عن المستخدم بالبريد والرمز والتأكد من صلاحية الرمز
        const user = await User.findOne({
            email,
            resetPasswordToken: hashedToken,
            resetPasswordExpire: { $gt: Date.now() }
        }).select('+resetPasswordToken +resetPasswordExpire');

        if (!user) {
            return res.status(400).json({
                success: false,
                message: 'رمز التحقق غير صحيح أو منتهي الصلاحية'
            });
        }

        // تحديث كلمة المرور
        user.password = newPassword;
        user.resetPasswordToken = undefined;
        user.resetPasswordExpire = undefined;
        await user.save();

        res.status(200).json({
            success: true,
            message: 'تم إعادة تعيين كلمة المرور بنجاح'
        });

    } catch (error) {
        console.error('خطأ في إعادة تعيين كلمة المرور:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في السيرفر',
            error: error.message
        });
    }
});

// @route   PUT /api/auth/upload-profile-image
// @desc    رفع صورة الملف الشخصي
// @access  Private
router.put('/upload-profile-image', protect, upload.single('profileImage'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: 'لم يتم رفع أي صورة'
            });
        }

        const user = await User.findById(req.user.id);

        if (!user) {
            fs.unlinkSync(req.file.path);
            return res.status(404).json({
                success: false,
                message: 'المستخدم غير موجود'
            });
        }

        // ✅ فحص قيود الأدمن على تغيير الصورة
        if (user.restrictions?.photoBlocked) {
            if (!user.restrictions.photoBlockedUntil || user.restrictions.photoBlockedUntil > new Date()) {
                fs.unlinkSync(req.file.path);
                const until = user.restrictions.photoBlockedUntil
                    ? new Date(user.restrictions.photoBlockedUntil).toLocaleDateString('ar-SA')
                    : 'غير محدد';
                return res.status(403).json({
                    success: false,
                    message: `تم منعك من تغيير الصورة حتى: ${until}. السبب: ${user.restrictions.photoBlockedReason || 'مخالفة'}`,
                    code: 'PHOTO_BLOCKED'
                });
            } else {
                user.restrictions.photoBlocked = false;
                user.restrictions.photoBlockedUntil = null;
                user.restrictions.photoBlockedReason = null;
                await user.save();
            }
        }

        // ✅ cooldown قصير لمنع spam (60 ثانية بين التغييرات)
        // (تم إلغاء الحد الطويل 24 ساعة — كان يزعج المستخدمين)
        if (user.lastPhotoChange) {
            const secondsSinceChange = (Date.now() - new Date(user.lastPhotoChange).getTime()) / 1000;
            const MIN_INTERVAL_SECONDS = 60;
            if (secondsSinceChange < MIN_INTERVAL_SECONDS) {
                fs.unlinkSync(req.file.path);
                const remainingSeconds = Math.ceil(MIN_INTERVAL_SECONDS - secondsSinceChange);
                return res.status(429).json({
                    success: false,
                    message: `انتظر ${remainingSeconds} ثانية قبل تغيير الصورة مجدداً`,
                    messageEn: `Please wait ${remainingSeconds} seconds before changing photo again`,
                    code: 'PHOTO_COOLDOWN',
                    remainingSeconds
                });
            }
        }

        // معالجة الصورة بأحجام متعددة (thumb, medium, original)
        const processed = await processImage(req.file.path, { prefix: 'profile' });

        // حذف النسخ القديمة (thumb/medium/original)
        if (user.photos && user.photos.length > 0) {
            const mainPhoto = user.photos.find(p => p.order === 0);
            if (mainPhoto) {
                for (const size of ['thumbnail', 'medium', 'original']) {
                    if (mainPhoto[size]) {
                        const oldPath = path.join(__dirname, '..', mainPhoto[size]);
                        if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
                    }
                }
            }
        }
        // حذف profileImage القديمة
        if (user.profileImage && !user.profileImage.includes('/defaults/')) {
            const oldImagePath = path.join(__dirname, '..', user.profileImage);
            if (fs.existsSync(oldImagePath)) fs.unlinkSync(oldImagePath);
        }

        // ✅ تحديث profileImage فقط (بدون تكرار في photos[])
        user.profileImage = processed.original;

        // إزالة الصورة الرئيسية من photos[] لو موجودة (منع التكرار)
        if (user.photos && user.photos.length > 0) {
            user.photos = user.photos.filter(p => p.order !== 0);
        }

        // ✅ تسجيل وقت تغيير الصورة
        user.lastPhotoChange = new Date();

        await user.save();

        res.status(200).json({
            success: true,
            message: 'تم رفع الصورة بنجاح',
            data: {
                profileImage: processed.original,
                photos: {
                    thumbnail: processed.thumbnail,
                    medium: processed.medium,
                    original: processed.original
                },
                user
            }
        });

    } catch (error) {
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }

        console.error('خطأ في رفع الصورة:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'خطأ في السيرفر'
        });
    }
});

// ══════════════════════════════════════════════════════════
// @route   DELETE /api/auth/profile-image
// @desc    حذف الصورة الشخصية (المستخدم نفسه) — تُنقل لمجلد محمي بدل الحذف النهائي
// @access  Private
// ══════════════════════════════════════════════════════════
router.delete('/profile-image', protect, async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        if (!user) {
            return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
        }

        // فحص قيود الأدمن
        if (user.restrictions?.photoBlocked) {
            if (!user.restrictions.photoBlockedUntil || user.restrictions.photoBlockedUntil > new Date()) {
                const until = user.restrictions.photoBlockedUntil
                    ? new Date(user.restrictions.photoBlockedUntil).toLocaleDateString('ar-SA')
                    : 'غير محدد';
                return res.status(403).json({
                    success: false,
                    message: `تم منعك من تغيير الصورة حتى: ${until}. السبب: ${user.restrictions.photoBlockedReason || 'مخالفة'}`,
                    code: 'PHOTO_BLOCKED'
                });
            }
        }

        if (!user.profileImage) {
            return res.json({ success: true, message: 'لا توجد صورة لحذفها', data: { profileImage: null } });
        }

        const oldImage = user.profileImage;

        // حذف الملف الفعلي (مش مخالفة، ارسي من المستخدم نفسه)
        if (!oldImage.includes('/defaults/')) {
            const filePath = path.join(__dirname, '..', oldImage);
            if (fs.existsSync(filePath)) {
                try { fs.unlinkSync(filePath); } catch(e) { /* ignore */ }
            }
        }

        user.profileImage = null;
        user.lastPhotoChange = new Date();
        await user.save();

        res.json({
            success: true,
            message: 'تم حذف الصورة الشخصية',
            data: {
                profileImage: null,
                user
            }
        });
    } catch (error) {
        console.error('خطأ في حذف الصورة الشخصية:', error);
        res.status(500).json({ success: false, message: error.message || 'خطأ في السيرفر' });
    }
});

// ══════════════════════════════════════════════════════════
// @route   POST /api/auth/upload-gallery-photo
// @desc    رفع صورة إضافية للمعرض (مشتركين فقط — حد 5 صور)
// @access  Private (Premium)
// ══════════════════════════════════════════════════════════
router.post('/upload-gallery-photo', protect, upload.single('galleryPhoto'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'لم يتم رفع أي صورة' });
        }

        const user = await User.findById(req.user.id);
        if (!user) {
            fs.unlinkSync(req.file.path);
            return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
        }

        // ✅ فحص الاشتراك
        if (!user.isPremium) {
            fs.unlinkSync(req.file.path);
            return res.status(403).json({
                success: false,
                message: 'إضافة صور إضافية متاحة للمشتركين فقط',
                code: 'PREMIUM_REQUIRED'
            });
        }

        // ✅ فحص الحد الأقصى (5 صور إضافية + 1 رئيسية = 6)
        const MAX_GALLERY = 5;
        const currentGallery = (user.photos || []).filter(p => p.order > 0);
        if (currentGallery.length >= MAX_GALLERY) {
            fs.unlinkSync(req.file.path);
            return res.status(400).json({
                success: false,
                message: `الحد الأقصى ${MAX_GALLERY} صور إضافية`,
                code: 'MAX_PHOTOS'
            });
        }

        // ✅ فحص قيود الأدمن
        if (user.restrictions?.photoBlocked) {
            if (!user.restrictions.photoBlockedUntil || user.restrictions.photoBlockedUntil > new Date()) {
                fs.unlinkSync(req.file.path);
                return res.status(403).json({ success: false, message: 'تم منعك من رفع الصور', code: 'PHOTO_BLOCKED' });
            }
        }

        // معالجة الصورة
        const processed = await processImage(req.file.path, { prefix: 'gallery' });

        // إضافة الصورة بالترتيب التالي
        const nextOrder = currentGallery.length > 0
            ? Math.max(...currentGallery.map(p => p.order)) + 1
            : 1;

        if (!user.photos) user.photos = [];
        user.photos.push({
            original: processed.original,
            medium: processed.medium,
            thumbnail: processed.thumbnail,
            order: nextOrder
        });

        await user.save();

        res.status(201).json({
            success: true,
            message: 'تم إضافة الصورة للمعرض',
            data: {
                photo: { original: processed.original, medium: processed.medium, thumbnail: processed.thumbnail, order: nextOrder },
                totalPhotos: user.photos.length,
                user
            }
        });

    } catch (error) {
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        console.error('خطأ في رفع صورة المعرض:', error);
        res.status(500).json({ success: false, message: error.message || 'خطأ في السيرفر' });
    }
});

// @route   DELETE /api/auth/gallery-photo/:order
// @desc    حذف صورة من المعرض
// @access  Private
router.delete('/gallery-photo/:order', protect, async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        if (!user) return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });

        const order = parseInt(req.params.order);
        if (order === 0) return res.status(400).json({ success: false, message: 'لا يمكن حذف الصورة الرئيسية من هنا' });

        const photoIndex = (user.photos || []).findIndex(p => p.order === order);
        if (photoIndex === -1) return res.status(404).json({ success: false, message: 'الصورة غير موجودة' });

        // حذف الملفات
        const photo = user.photos[photoIndex];
        for (const size of ['thumbnail', 'medium', 'original']) {
            if (photo[size]) {
                const filePath = path.join(__dirname, '..', photo[size]);
                if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
            }
        }

        user.photos.splice(photoIndex, 1);
        await user.save();

        res.json({
            success: true,
            message: 'تم حذف الصورة',
            data: { totalPhotos: user.photos.length }
        });

    } catch (error) {
        console.error('خطأ في حذف صورة المعرض:', error);
        res.status(500).json({ success: false, message: 'خطأ في السيرفر' });
    }
});

// @route   POST /api/auth/reset-account
// @desc    إعادة تعيين الحساب (مستويات متعددة)
// @access  Private
router.post('/reset-account', protect, async (req, res) => {
    try {
        const { level, password } = req.body;
        // level: "chats" | "profile" | "full"

        if (!['chats', 'profile', 'full'].includes(level)) {
            return res.status(400).json({
                success: false,
                message: 'مستوى إعادة التعيين غير صالح'
            });
        }

        const user = await User.findById(req.user.id).select('+password');
        if (!user) {
            return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
        }

        // التحقق من كلمة المرور (لمستخدمي app)
        if (user.authProvider === 'app') {
            if (!password) {
                return res.status(400).json({
                    success: false,
                    message: 'كلمة المرور مطلوبة لتأكيد إعادة التعيين'
                });
            }
            const isMatch = await user.comparePassword(password);
            if (!isMatch) {
                // ✅ 400 بدل 401 لمنع iOS interceptor من retry auto token refresh
                return res.status(400).json({
                    success: false,
                    code: 'WRONG_PASSWORD',
                    message: 'كلمة المرور غير صحيحة'
                });
            }
        }

        const results = { level };

        // ── مسح المحادثات ──
        if (level === 'chats' || level === 'full') {
            const userConversations = await Conversation.find({
                participants: req.user.id
            }).select('_id');

            const convIds = userConversations.map(c => c._id);

            // حذف جميع الرسائل
            const deletedMessages = await Message.deleteMany({
                conversation: { $in: convIds }
            });

            // حذف جميع المحادثات
            const deletedConversations = await Conversation.deleteMany({
                _id: { $in: convIds }
            });

            // حذف البلاغات المرتبطة
            await FlaggedMessage.deleteMany({
                conversation: { $in: convIds }
            });

            results.deletedMessages = deletedMessages.deletedCount;
            results.deletedConversations = deletedConversations.deletedCount;
        }

        // ── إعادة تعيين الملف الشخصي ──
        if (level === 'profile' || level === 'full') {
            // حذف صورة الملف الشخصي
            if (user.profileImage && !user.profileImage.includes('/defaults/')) {
                const imagePath = path.join(__dirname, '..', user.profileImage);
                if (fs.existsSync(imagePath)) fs.unlinkSync(imagePath);
            }
            // حذف صور الألبوم
            if (user.photos && user.photos.length > 0) {
                for (const photo of user.photos) {
                    for (const size of ['thumbnail', 'medium', 'original']) {
                        if (photo[size]) {
                            const photoPath = path.join(__dirname, '..', photo[size]);
                            if (fs.existsSync(photoPath)) fs.unlinkSync(photoPath);
                        }
                    }
                }
            }

            user.profileImage = null;
            user.photos = [];
            user.bio = null;
            user.gender = null;
            user.birthDate = null;
            user.country = null;
            user.lastPhotoChange = null;
            user.lastNameChange = null;
            user.nameChangeHistory = [];

            results.profileReset = true;
        }

        // ── إعادة تعيين كامل (إضافي) ──
        if (level === 'full') {
            // إلغاء التوثيق
            user.verification = {
                isVerified: false,
                selfieUrl: null,
                status: 'none',
                submittedAt: null,
                reviewedAt: null
            };

            // إعادة تعيين Premium (لا نلغي من Apple — فقط نمسح من السيرفر)
            user.isPremium = false;
            user.premiumPlan = null;
            user.premiumExpiresAt = null;
            user.subscriptionTransactionId = null;
            user.subscriptionOriginalTransactionId = null;

            // إعادة تعيين البيانات الأخرى
            user.stealthMode = false;
            user.blockedUsers = [];
            user.mutedConversations = [];
            user.superLikes = { daily: 0, lastReset: new Date() };
            user.bannedWords = { violations: 0, isBanned: false, bannedAt: null, banReason: null };

            results.fullReset = true;
        }

        await user.save();

        res.json({
            success: true,
            message: level === 'chats'
                ? 'تم مسح جميع المحادثات بنجاح'
                : level === 'profile'
                    ? 'تم إعادة تعيين الملف الشخصي بنجاح'
                    : 'تم إعادة تعيين الحساب بالكامل',
            data: results
        });

    } catch (error) {
        console.error('خطأ في إعادة تعيين الحساب:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في السيرفر',
            error: error.message
        });
    }
});

// @route   DELETE /api/auth/delete-account
// @desc    حذف حساب المستخدم
// @access  Private
router.delete('/delete-account', protect, async (req, res) => {
    try {
        const { password } = req.body;

        const user = await User.findById(req.user.id).select('+password');

        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'المستخدم غير موجود'
            });
        }

        // التحقق من كلمة المرور (فقط لمستخدمي app)
        if (user.authProvider === 'app') {
            if (!password) {
                return res.status(400).json({
                    success: false,
                    message: 'كلمة المرور مطلوبة لتأكيد حذف الحساب'
                });
            }
            const isMatch = await user.comparePassword(password);
            if (!isMatch) {
                // ✅ 400 بدل 401 لمنع iOS interceptor من retry auto token refresh loop
                return res.status(400).json({
                    success: false,
                    code: 'WRONG_PASSWORD',
                    message: 'كلمة المرور غير صحيحة'
                });
            }
        }
        // حذف صورة الملف الشخصي إذا كانت موجودة
        if (user.profileImage && !user.profileImage.includes('/defaults/')) {
            const imagePath = path.join(__dirname, '..', user.profileImage);
            if (fs.existsSync(imagePath)) {
                fs.unlinkSync(imagePath);
            }
        }

        // ✅ حذف المحادثات والرسائل المرتبطة
        const userConversations = await Conversation.find({
            participants: req.user.id
        }).select('_id');
        const convIds = userConversations.map(c => c._id);

        if (convIds.length > 0) {
            await Message.deleteMany({ conversation: { $in: convIds } });
            await Conversation.deleteMany({ _id: { $in: convIds } });
            await FlaggedMessage.deleteMany({ conversation: { $in: convIds } });
        }

        // حذف المستخدم
        await user.deleteOne();

        res.status(200).json({
            success: true,
            message: 'تم حذف الحساب بنجاح'
        });

    } catch (error) {
        console.error('خطأ في حذف الحساب:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في السيرفر',
            error: error.message
        });
    }
});

// @route   POST /api/auth/google
// @desc    تسجيل/دخول عبر Google
// @access  Public
router.post('/google', bannedDeviceCheck, async (req, res) => {
    try {
        const { idToken, deviceToken, deviceInfo, googleUserInfo } = req.body;

        if (!idToken && !googleUserInfo) {
            return res.status(400).json({
                success: false,
                message: 'Google ID Token مطلوب'
            });
        }

        // التحقق من Google ID Token (iOS أو Web)
        const platform = req.body.platform || 'ios';
        let payload;
        try {
            // جرب iOS client أولاً، ثم Web client
            const clients = platform === 'web'
                ? [{ client: googleWebClient, audience: process.env.GOOGLE_WEB_CLIENT_ID }]
                : [{ client: googleClient, audience: process.env.GOOGLE_CLIENT_ID }];

            for (const { client, audience } of clients) {
                try {
                    const ticket = await client.verifyIdToken({ idToken, audience });
                    payload = ticket.getPayload();
                    break;
                } catch { /* try next */ }
            }

            if (!payload) {
                // fallback: جرب الثاني
                const fallback = platform === 'web' ? googleClient : googleWebClient;
                const fallbackAudience = platform === 'web' ? process.env.GOOGLE_CLIENT_ID : process.env.GOOGLE_WEB_CLIENT_ID;
                const ticket = await fallback.verifyIdToken({ idToken, audience: fallbackAudience });
                payload = ticket.getPayload();
            }
        } catch (error) {
            console.error('خطأ في التحقق من Google Token:', error);
            // ✅ Web flow: إذا فيه googleUserInfo مباشرة (من access_token)
            if (googleUserInfo && googleUserInfo.sub && googleUserInfo.email) {
                payload = googleUserInfo;
            } else {
                return res.status(401).json({
                    success: false,
                    message: 'Google Token غير صالح'
                });
            }
        }

        const { sub: googleId, email, name, picture } = payload;

        // البحث عن المستخدم أو إنشاؤه
        let user = await User.findOne({
            $or: [
                { googleId },
                { email }
            ]
        });

        let isNewUser = false;

        if (user) {
            // تحديث معلومات Google إذا لم تكن موجودة
            if (!user.googleId) {
                user.googleId = googleId;
                user.authProvider = 'google';
            }
            // تحديث الصورة إذا لم تكن موجودة
            if (!user.profileImage && picture) {
                user.profileImage = picture;
            }
        } else {
            // فحص الاسم ضد الكلمات المحظورة
            let safeName = name;
            if (name) {
                const nameCheck = await checkBannedWords(name);
                if (nameCheck.hasBannedWords) safeName = nameCheck.censoredText;
            }

            // إنشاء مستخدم جديد
            isNewUser = true;
            user = new User({
                name: safeName,
                email,
                googleId,
                authProvider: 'google',
                profileImage: picture || null,
                isActive: true
            });
        }

        // فحص الحظر
        if (!isNewUser && user.bannedWords?.isBanned) {
            await recordDeviceBanForUser(user, req, 'violation', user.bannedWords.banReason || 'banned_words');
            return res.status(403).json({
                success: false,
                message: 'تم حظر حسابك بسبب مخالفات متكررة. تواصل مع الإدارة',
                code: 'ACCOUNT_BANNED'
            });
        }

        // ✅ فحص التعليق + isActive (كان مفقودًا في /google!)
        if (!isNewUser && user.suspension?.isSuspended) {
            const now = new Date();
            const stillSuspended = !user.suspension.suspendedUntil || now < user.suspension.suspendedUntil;
            if (stillSuspended) {
                if (!user.suspension.suspendedUntil) {
                    await recordDeviceBanForUser(user, req, 'manual', user.suspension.reason || 'permanent_suspension');
                }
                return res.status(403).json({
                    success: false,
                    message: user.suspension.suspendedUntil ? 'تم تعليق حسابك مؤقتًا' : 'تم تعليق حسابك بشكل دائم',
                    code: 'ACCOUNT_SUSPENDED',
                    data: {
                        reason: user.suspension.reason,
                        suspendedUntil: user.suspension.suspendedUntil,
                        level: user.suspension.level || 0
                    }
                });
            }
        }
        if (!isNewUser && user.isActive === false) {
            await recordDeviceBanForUser(user, req, 'manual', 'inactive_account');
            return res.status(401).json({
                success: false,
                message: 'الحساب غير مفعل، تواصل مع الإدارة'
            });
        }

        if (deviceToken) user.deviceToken = deviceToken;
        user.fcmToken = deviceToken;
        if (deviceInfo) user.deviceInfo = deviceInfo;

        await user.save();
        await saveLoginRecord(user, req);

        res.status(200).json({
            success: true,
            message: isNewUser ? 'تم التسجيل بنجاح عبر Google' : 'تم تسجيل الدخول بنجاح عبر Google',
            data: {
                user: {
                    id: user._id,
                    name: user.name,
                    email: user.email,
                    role: user.role,
                    profileImage: user.profileImage,
                    authProvider: user.authProvider,
                    lastLogin: user.lastLogin
                },
                token: generateToken(user._id),
                refreshToken: generateRefreshToken(user._id),
                isNewUser
            }
        });

    } catch (error) {
        console.error('خطأ في تسجيل الدخول عبر Google:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في السيرفر',
            error: error.message
        });
    }
});

// @route   POST /api/auth/apple
// @desc    تسجيل/دخول عبر Apple
// @access  Public
router.post('/apple', bannedDeviceCheck, async (req, res) => {
    try {
        const { identityToken, authorizationCode, fullName, email: appleEmail, deviceToken, deviceInfo } = req.body;

        if (!identityToken) {
            return res.status(400).json({
                success: false,
                message: 'Apple Identity Token مطلوب'
            });
        }

        // التحقق من Apple Identity Token (iOS أو Web)
        const platform = req.body.platform || 'ios';
        const appleAudience = platform === 'web'
            ? (process.env.APPLE_WEB_CLIENT_ID || 'com.app.hala.web')
            : (process.env.APPLE_CLIENT_ID || 'com.app.hala');

        let applePayload;
        try {
            applePayload = await appleSignin.verifyIdToken(identityToken, {
                audience: appleAudience,
                ignoreExpiration: false
            });
        } catch (error) {
            // fallback: جرب الـ audience الثاني
            try {
                const fallbackAudience = platform === 'web'
                    ? (process.env.APPLE_CLIENT_ID || 'com.app.hala')
                    : (process.env.APPLE_WEB_CLIENT_ID || 'com.app.hala.web');
                applePayload = await appleSignin.verifyIdToken(identityToken, {
                    audience: fallbackAudience,
                    ignoreExpiration: false
                });
            } catch (err2) {
                console.error('خطأ في التحقق من Apple Token:', error);
                return res.status(401).json({
                    success: false,
                    message: 'Apple Token غير صالح'
                });
            }
        }

        const appleId = applePayload.sub;
        const email = appleEmail || applePayload.email;

        // البحث عن المستخدم
        let user = await User.findOne({
            $or: [
                { appleId },
                ...(email ? [{ email }] : [])
            ]
        });

        let isNewUser = false;

        if (user) {
            // تحديث معلومات Apple إذا لم تكن موجودة
            if (!user.appleId) {
                user.appleId = appleId;
                user.authProvider = 'apple';
            }
        } else {
            // إنشاء مستخدم جديد
            isNewUser = true;

            // تحديد الاسم
            let name = 'مستخدم Apple';
            if (fullName) {
                const firstName = fullName.givenName || '';
                const lastName = fullName.familyName || '';
                name = `${firstName} ${lastName}`.trim();
                if (name.length < 2) name = 'مستخدم Apple';
            }

            // فحص الاسم ضد الكلمات المحظورة
            if (name !== 'مستخدم Apple') {
                const nameCheck = await checkBannedWords(name);
                if (nameCheck.hasBannedWords) name = nameCheck.censoredText;
            }

            user = new User({
                name,
                email: email || `apple_${appleId}@private.appleid.com`,
                appleId,
                authProvider: 'apple',
                isActive: true
            });
        }

        // فحص الحظر
        if (!isNewUser && user.bannedWords?.isBanned) {
            await recordDeviceBanForUser(user, req, 'violation', user.bannedWords.banReason || 'banned_words');
            return res.status(403).json({
                success: false,
                message: 'تم حظر حسابك بسبب مخالفات متكررة. تواصل مع الإدارة',
                code: 'ACCOUNT_BANNED'
            });
        }

        // ✅ فحص التعليق + isActive (كان مفقودًا في /apple!)
        if (!isNewUser && user.suspension?.isSuspended) {
            const now = new Date();
            const stillSuspended = !user.suspension.suspendedUntil || now < user.suspension.suspendedUntil;
            if (stillSuspended) {
                if (!user.suspension.suspendedUntil) {
                    await recordDeviceBanForUser(user, req, 'manual', user.suspension.reason || 'permanent_suspension');
                }
                return res.status(403).json({
                    success: false,
                    message: user.suspension.suspendedUntil ? 'تم تعليق حسابك مؤقتًا' : 'تم تعليق حسابك بشكل دائم',
                    code: 'ACCOUNT_SUSPENDED',
                    data: {
                        reason: user.suspension.reason,
                        suspendedUntil: user.suspension.suspendedUntil,
                        level: user.suspension.level || 0
                    }
                });
            }
        }
        if (!isNewUser && user.isActive === false) {
            await recordDeviceBanForUser(user, req, 'manual', 'inactive_account');
            return res.status(401).json({
                success: false,
                message: 'الحساب غير مفعل، تواصل مع الإدارة'
            });
        }

        // تحديث Device Token و معلومات الجهاز
        if (deviceToken) user.deviceToken = deviceToken;
        user.fcmToken = deviceToken;
        if (deviceInfo) user.deviceInfo = deviceInfo;

        await user.save();
        await saveLoginRecord(user, req);

        // هل يحتاج إدخال اسم؟ (مستخدمي Apple اللي ما أدخلوا اسمهم)
        const needsName = !user.name || user.name === 'مستخدم Apple' || user.name.trim().length < 2;

        res.status(200).json({
            success: true,
            message: isNewUser ? 'تم التسجيل بنجاح عبر Apple' : 'تم تسجيل الدخول بنجاح عبر Apple',
            data: {
                user: {
                    id: user._id,
                    name: user.name,
                    email: user.email,
                    role: user.role,
                    profileImage: user.profileImage ? getFullUrl(user.profileImage) : null,
                    authProvider: user.authProvider,
                    lastLogin: user.lastLogin
                },
                token: generateToken(user._id),
                refreshToken: generateRefreshToken(user._id),
                isNewUser,
                needsName
            }
        });

    } catch (error) {
        console.error('خطأ في تسجيل الدخول عبر Apple:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في السيرفر',
            error: error.message
        });
    }
});

// @route   PUT /api/auth/device-token
// @desc    تحديث Device Token للإشعارات
// @access  Private
router.put('/device-token', protect, async (req, res) => {
    try {
        const { deviceToken, deviceInfo, platform, osVersion, appVersion, deviceModel, language } = req.body;

        if (!deviceToken) {
            return res.status(400).json({
                success: false,
                message: 'Device Token مطلوب'
            });
        }

        const user = await User.findById(req.user.id);

        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'المستخدم غير موجود'
            });
        }

        user.deviceToken = deviceToken;
        user.fcmToken = deviceToken;

        // تحديث معلومات الجهاز (من body مباشرة أو من deviceInfo object)
        const info = deviceInfo || {};
        user.deviceInfo = {
            platform: platform || info.platform || user.deviceInfo?.platform,
            osVersion: osVersion || info.osVersion || user.deviceInfo?.osVersion,
            appVersion: appVersion || info.appVersion || user.deviceInfo?.appVersion,
            deviceModel: deviceModel || info.deviceModel || user.deviceInfo?.deviceModel,
            language: language || info.language || user.deviceInfo?.language
        };

        // حفظ IP
        user.lastIP = getClientIP(req);
        await user.save();

        res.status(200).json({
            success: true,
            message: 'تم تحديث Device Token بنجاح'
        });

    } catch (error) {
        console.error('خطأ في تحديث Device Token:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في السيرفر',
            error: error.message
        });
    }
});

// @route   POST /api/auth/refresh-token
// @desc    تجديد Access Token باستخدام Refresh Token (بدون إعادة تسجيل الدخول)
// @access  Public
router.post('/refresh-token', async (req, res) => {
    try {
        const { refreshToken } = req.body;

        if (!refreshToken) {
            return res.status(400).json({
                success: false,
                message: 'Refresh Token مطلوب'
            });
        }

        // التحقق من Refresh Token
        const jwt = require('jsonwebtoken');
        let decoded;
        try {
            decoded = jwt.verify(refreshToken, process.env.JWT_SECRET);
        } catch (err) {
            return res.status(401).json({
                success: false,
                message: 'Refresh Token منتهي أو غير صالح — يرجى إعادة تسجيل الدخول',
                code: 'REFRESH_TOKEN_EXPIRED'
            });
        }

        // التأكد أنه refresh token وليس access token
        if (decoded.type !== 'refresh') {
            return res.status(401).json({
                success: false,
                message: 'Token غير صالح للتجديد'
            });
        }

        // التأكد أن المستخدم لا يزال نشطاً
        const user = await User.findById(decoded.id).select('isActive name email role profileImage bannedWords suspension');

        if (!user || !user.isActive) {
            return res.status(401).json({
                success: false,
                message: 'الحساب غير نشط أو غير موجود'
            });
        }

        if (user.bannedWords?.isBanned) {
            return res.status(403).json({
                success: false,
                message: 'تم حظر حسابك',
                code: 'ACCOUNT_BANNED'
            });
        }

        // توليد tokens جديدة
        res.json({
            success: true,
            data: {
                token: generateToken(user._id),
                refreshToken: generateRefreshToken(user._id),
                user: {
                    id: user._id,
                    name: user.name,
                    email: user.email,
                    role: user.role
                }
            }
        });

    } catch (error) {
        console.error('خطأ في تجديد Token:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في السيرفر'
        });
    }
});

module.exports = router;
