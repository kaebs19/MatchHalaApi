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

// Google Auth
const { OAuth2Client } = require('google-auth-library');
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

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
    if (appVersion) updateData['deviceInfo.appVersion'] = appVersion;

    await User.findByIdAndUpdate(user._id, updateData);
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

        // التحقق من أن الحساب مفعل
        if (!user.isActive) {
            return res.status(401).json({
                success: false,
                message: 'الحساب غير مفعل، تواصل مع الإدارة'
            });
        }

        // التحقق من حظر الكلمات المحظورة
        if (user.bannedWords?.isBanned) {
            return res.status(403).json({
                success: false,
                message: 'تم حظر حسابك بسبب مخالفات متكررة للكلمات المحظورة. تواصل مع الإدارة',
                code: 'ACCOUNT_BANNED',
                data: { reason: user.bannedWords.banReason, bannedAt: user.bannedWords.bannedAt }
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

        // ✅ فحص cooldown تغيير الاسم (مرة كل 30 يوم)
        if (name && name !== user.name) {
            if (user.lastNameChange) {
                const daysSinceChange = (Date.now() - new Date(user.lastNameChange).getTime()) / (1000 * 60 * 60 * 24);
                if (daysSinceChange < 30) {
                    const remainingDays = Math.ceil(30 - daysSinceChange);
                    return res.status(429).json({
                        success: false,
                        message: `يمكنك تغيير الاسم مرة كل 30 يوم. متبقي ${remainingDays} يوم`,
                        messageEn: `You can change your name once every 30 days. ${remainingDays} days remaining`,
                        code: 'NAME_COOLDOWN',
                        remainingDays
                    });
                }
            }
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
            user.name = name;
            user.lastNameChange = new Date();
        }
        if (email) user.email = email;

        // تحديث حقول الملف الشخصي الجديدة
        if (profileImage !== undefined) user.profileImage = profileImage;
        if (birthDate !== undefined) user.birthDate = birthDate;
        if (gender !== undefined) user.gender = gender;
        if (country !== undefined) user.country = country;
        if (bio !== undefined) user.bio = bio;
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

            // ✅ فحص cooldown تغيير الصورة (مرة كل 24 ساعة)
            if (user.lastPhotoChange) {
                const hoursSinceChange = (Date.now() - new Date(user.lastPhotoChange).getTime()) / (1000 * 60 * 60);
                if (hoursSinceChange < 24) {
                    const remainingHours = Math.ceil(24 - hoursSinceChange);
                    return res.status(429).json({
                        success: false,
                        message: `يمكنك تغيير الصورة مرة كل 24 ساعة. متبقي ${remainingHours} ساعة`,
                        messageEn: `You can change your photo once every 24 hours. ${remainingHours} hours remaining`,
                        code: 'PHOTO_COOLDOWN',
                        remainingHours
                    });
                }
            }

            // التحقق من صحة اسم الصورة الافتراضية
            const validAvatars = Array.from({ length: 29 }, (_, i) => `avatar_${i + 1}`);
            if (validAvatars.includes(defaultAvatar)) {
                user.profileImage = `/uploads/defaults/${defaultAvatar}.jpg`;
                user.lastPhotoChange = new Date();
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
                user: userObj
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

        // ✅ فحص cooldown تغيير الصورة (مرة كل 24 ساعة)
        if (user.lastPhotoChange) {
            const hoursSinceChange = (Date.now() - new Date(user.lastPhotoChange).getTime()) / (1000 * 60 * 60);
            if (hoursSinceChange < 24) {
                fs.unlinkSync(req.file.path);
                const remainingHours = Math.ceil(24 - hoursSinceChange);
                return res.status(429).json({
                    success: false,
                    message: `يمكنك تغيير الصورة مرة كل 24 ساعة. متبقي ${remainingHours} ساعة`,
                    messageEn: `You can change your photo once every 24 hours. ${remainingHours} hours remaining`,
                    code: 'PHOTO_COOLDOWN',
                    remainingHours
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

        // تحديث profileImage (التوافق مع الكود الحالي) + photos
        user.profileImage = processed.original;

        // تحديث أو إضافة الصورة الرئيسية في photos
        const existingMainIndex = user.photos ? user.photos.findIndex(p => p.order === 0) : -1;
        const photoEntry = {
            original: processed.original,
            medium: processed.medium,
            thumbnail: processed.thumbnail,
            order: 0
        };

        if (existingMainIndex >= 0) {
            user.photos[existingMainIndex] = photoEntry;
        } else {
            if (!user.photos) user.photos = [];
            user.photos.push(photoEntry);
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
                return res.status(401).json({
                    success: false,
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
                return res.status(401).json({
                    success: false,
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
router.post('/google', async (req, res) => {
    try {
        const { idToken, deviceToken, deviceInfo } = req.body;

        if (!idToken) {
            return res.status(400).json({
                success: false,
                message: 'Google ID Token مطلوب'
            });
        }

        // التحقق من Google ID Token
        let payload;
        try {
            const ticket = await googleClient.verifyIdToken({
                idToken,
                audience: process.env.GOOGLE_CLIENT_ID
            });
            payload = ticket.getPayload();
        } catch (error) {
            console.error('خطأ في التحقق من Google Token:', error);
            return res.status(401).json({
                success: false,
                message: 'Google Token غير صالح'
            });
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
            return res.status(403).json({
                success: false,
                message: 'تم حظر حسابك بسبب مخالفات متكررة. تواصل مع الإدارة',
                code: 'ACCOUNT_BANNED'
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
router.post('/apple', async (req, res) => {
    try {
        const { identityToken, authorizationCode, fullName, email: appleEmail, deviceToken, deviceInfo } = req.body;

        if (!identityToken) {
            return res.status(400).json({
                success: false,
                message: 'Apple Identity Token مطلوب'
            });
        }

        // التحقق من Apple Identity Token
        let applePayload;
        try {
            applePayload = await appleSignin.verifyIdToken(identityToken, {
                audience: process.env.APPLE_CLIENT_ID || 'com.alsaplel.octadevtn.HalaChat',
                ignoreExpiration: false
            });
        } catch (error) {
            console.error('خطأ في التحقق من Apple Token:', error);
            return res.status(401).json({
                success: false,
                message: 'Apple Token غير صالح'
            });
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
            return res.status(403).json({
                success: false,
                message: 'تم حظر حسابك بسبب مخالفات متكررة. تواصل مع الإدارة',
                code: 'ACCOUNT_BANNED'
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
