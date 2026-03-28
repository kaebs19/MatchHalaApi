// HalaChat Dashboard - Auth Routes
// المسارات الخاصة بالتسجيل وتسجيل الدخول

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const User = require('../models/User');
const generateToken = require('../utils/generateToken');
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

// Google Auth
const { OAuth2Client } = require('google-auth-library');
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// Apple Auth
const appleSignin = require('apple-signin-auth');

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
                token: generateToken(user._id)
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

        // تحديث آخر تسجيل دخول
        user.lastLogin = new Date();
        await user.save();

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
                token: generateToken(user._id)
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
        const { name, email, profileImage, birthDate, gender, country, bio, defaultAvatar } = req.body;

        const user = await User.findById(req.user.id);

        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'المستخدم غير موجود'
            });
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
        if (name) user.name = name;
        if (email) user.email = email;

        // تحديث حقول الملف الشخصي الجديدة
        if (profileImage !== undefined) user.profileImage = profileImage;
        if (birthDate !== undefined) user.birthDate = birthDate;
        if (gender !== undefined) user.gender = gender;
        if (country !== undefined) user.country = country;
        if (bio !== undefined) user.bio = bio;

        // دعم الصور الافتراضية (avatar_1 إلى avatar_13)
        if (defaultAvatar) {
            // التحقق من صحة اسم الصورة الافتراضية
            const validAvatars = Array.from({ length: 14 }, (_, i) => `avatar_${i + 1}`);
            if (validAvatars.includes(defaultAvatar)) {
                user.profileImage = `/uploads/defaults/${defaultAvatar}.jpg`;
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
        if (user.profileImage) {
            const imagePath = path.join(__dirname, '..', user.profileImage);
            if (fs.existsSync(imagePath)) {
                fs.unlinkSync(imagePath);
            }
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
            // إنشاء مستخدم جديد
            isNewUser = true;
            user = new User({
                name,
                email,
                googleId,
                authProvider: 'google',
                profileImage: picture || null,
                isActive: true
            });
        }

        // تحديث Device Token و معلومات الجهاز
        if (deviceToken) user.deviceToken = deviceToken;
        user.fcmToken = deviceToken;
        if (deviceInfo) user.deviceInfo = deviceInfo;
        user.lastLogin = new Date();

        await user.save();

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

            user = new User({
                name,
                email: email || `apple_${appleId}@private.appleid.com`,
                appleId,
                authProvider: 'apple',
                isActive: true
            });
        }

        // تحديث Device Token و معلومات الجهاز
        if (deviceToken) user.deviceToken = deviceToken;
        user.fcmToken = deviceToken;
        if (deviceInfo) user.deviceInfo = deviceInfo;
        user.lastLogin = new Date();

        await user.save();

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
        const { deviceToken, deviceInfo } = req.body;

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
        if (deviceInfo) user.deviceInfo = deviceInfo;
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

module.exports = router;
