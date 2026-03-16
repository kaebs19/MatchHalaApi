// HalaChat - Mobile API Routes
// مسارات API للتطبيق (المستخدمين العاديين)
const mongoose = require("mongoose");

const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const User = require('../models/User');
const Message = require('../models/Message');
const Conversation = require('../models/Conversation');
const Report = require('../models/Report');
const Notification = require('../models/Notification');
const { protect } = require('../middleware/auth');
const { requirePremium } = require('../middleware/premium');
const notificationService = require('../services/notificationService');
const pushNotificationService = require('../services/pushNotificationService');
const ProfileView = require('../models/ProfileView');
const SuperLike = require('../models/SuperLike');

// Helper: تحويل المسار النسبي إلى URL كامل
const getFullUrl = (path) => {
    if (!path) return null;
    if (path.startsWith('http')) return path;
    const baseUrl = process.env.BASE_URL || 'https://halachat.khalafiati.io';
    return `${baseUrl}${path}`;
};

// إعداد multer لرفع صور الرسائل
const messagesUploadDir = path.join(__dirname, '..', 'uploads', 'messages');
if (!fs.existsSync(messagesUploadDir)) {
    fs.mkdirSync(messagesUploadDir, { recursive: true });
}

const messageStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, messagesUploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueName = `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}${path.extname(file.originalname)}`;
        cb(null, uniqueName);
    }
});

const uploadMessageImage = multer({
    storage: messageStorage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
    fileFilter: (req, file, cb) => {
        const allowedTypes = /jpeg|jpg|png|gif|webp/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);
        if (extname && mimetype) {
            cb(null, true);
        } else {
            cb(new Error('فقط الصور مسموحة (JPEG, PNG, GIF, WEBP)'));
        }
    }
});

// إعداد multer لرفع صور التوثيق (Verification Selfies)
const verificationsUploadDir = path.join(__dirname, '..', 'uploads', 'verifications');
if (!fs.existsSync(verificationsUploadDir)) {
    fs.mkdirSync(verificationsUploadDir, { recursive: true });
}

const verificationStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, verificationsUploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueName = `verify-${Date.now()}-${Math.random().toString(36).substr(2, 9)}${path.extname(file.originalname)}`;
        cb(null, uniqueName);
    }
});

const uploadVerificationSelfie = multer({
    storage: verificationStorage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
    fileFilter: (req, file, cb) => {
        const allowedTypes = /jpeg|jpg|png/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);
        if (extname && mimetype) {
            cb(null, true);
        } else {
            cb(new Error('فقط الصور مسموحة (JPEG, PNG)'));
        }
    }
});

// ==========================================
// نظام الموقع الجغرافي
// ==========================================

// @route   PUT /api/mobile/users/location
// @desc    تحديث الموقع الجغرافي
// @access  Protected
router.put('/users/location', protect, async (req, res) => {
    try {
        const { latitude, longitude } = req.body;

        if (typeof latitude !== 'number' || typeof longitude !== 'number') {
            return res.status(400).json({
                success: false,
                message: 'الإحداثيات مطلوبة (latitude, longitude) كأرقام'
            });
        }

        if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
            return res.status(400).json({
                success: false,
                message: 'الإحداثيات غير صحيحة'
            });
        }

        await User.findByIdAndUpdate(req.user._id, {
            location: {
                type: 'Point',
                coordinates: [longitude, latitude] // GeoJSON: [lng, lat]
            }
        });

        res.json({ success: true, message: 'تم تحديث الموقع بنجاح' });
    } catch (error) {
        console.error('خطأ في تحديث الموقع:', error);
        res.status(500).json({ success: false, message: 'فشل في تحديث الموقع' });
    }
});

// ==========================================
// نظام البحث عن المستخدمين
// ==========================================

// @route   GET /api/mobile/users/search
// @desc    البحث عن مستخدمين مع فلاتر متقدمة
// @access  Private
router.get('/users/search', protect, async (req, res) => {
    try {
        const {
            q,           // بحث بالاسم (اختياري)
            page = 1,
            limit = 20,
            gender,      // male / female
            country,     // كود الدولة: SA, AE, EG
            minAge,      // أقل عمر
            maxAge,      // أكبر عمر
            latitude,    // خط العرض (اختياري)
            longitude,   // خط الطول (اختياري)
            maxDistance = 50 // أقصى مسافة بالكيلومتر
        } = req.query;

        // بناء الفلتر
        const filter = {
            _id: { $ne: req.user._id },
            isActive: true
            // Stealth Mode لا يخفي من الاكتشاف — فقط يمنع تسجيل زيارات البروفايل ويخفي آخر ظهور
        };

        // استثناء المستخدمين المحظورين
        if (req.user.blockedUsers && req.user.blockedUsers.length > 0) {
            filter._id = {
                $ne: req.user._id,
                $nin: req.user.blockedUsers
            };
        }

        // فلتر الاسم (اختياري)
        if (q && q.length >= 2) {
            filter.name = { $regex: q, $options: 'i' };
        }

        // فلتر الجنس
        if (gender && ['male', 'female'].includes(gender)) {
            filter.gender = gender;
        }

        // فلتر الدولة
        if (country) {
            filter.country = country.toUpperCase();
        }

        // فلتر العمر (من birthDate)
        if (minAge || maxAge) {
            filter.birthDate = {};
            if (maxAge) {
                const minDate = new Date();
                minDate.setFullYear(minDate.getFullYear() - parseInt(maxAge) - 1);
                filter.birthDate.$gte = minDate;
            }
            if (minAge) {
                const maxDate = new Date();
                maxDate.setFullYear(maxDate.getFullYear() - parseInt(minAge));
                filter.birthDate.$lte = maxDate;
            }
        }

        const pageNum = parseInt(page);
        const limitNum = parseInt(limit);
        const skipNum = (pageNum - 1) * limitNum;

        // Helper: حساب وصف المسافة
        const getDistanceLabel = (distanceInMeters) => {
            const km = distanceInMeters / 1000;
            if (km < 1) return 'قريب جداً';
            if (km <= 10) return 'قريب منك';
            if (km <= 50) return 'في مدينتك';
            if (km <= 200) return 'في منطقتك';
            return 'بعيد';
        };

        let users, totalUsers;

        // إذا فيه إحداثيات → استخدام $geoNear
        if (latitude && longitude) {
            const lat = parseFloat(latitude);
            const lng = parseFloat(longitude);
            const maxDist = parseFloat(maxDistance) * 1000; // تحويل كم إلى متر

            const pipeline = [
                {
                    $geoNear: {
                        near: { type: 'Point', coordinates: [lng, lat] },
                        distanceField: 'distance',
                        maxDistance: maxDist,
                        query: filter,
                        spherical: true
                    }
                },
                {
                    $project: {
                        name: 1, email: 1, profileImage: 1, birthDate: 1,
                        gender: 1, country: 1, bio: 1, isOnline: 1, lastLogin: 1,
                        isVerified: '$verification.isVerified', isPremium: 1, stealthMode: 1, distance: 1
                    }
                },
                { $sort: { isOnline: -1, distance: 1 } },
                { $skip: skipNum },
                { $limit: limitNum }
            ];

            users = await User.aggregate(pipeline);

            // حساب distanceLabel + إخفاء lastLogin للمتخفين
            users = users.map(u => {
                const result = {
                    ...u,
                    distance: Math.round(u.distance / 100) / 10,
                    distanceLabel: getDistanceLabel(u.distance),
                    lastActive: u.stealthMode ? null : u.lastLogin
                };
                result.profileImage = getFullUrl(u.profileImage);
                delete result.lastLogin;
                delete result.stealthMode;
                return result;
            });

            // حساب الإجمالي
            const countPipeline = [
                {
                    $geoNear: {
                        near: { type: 'Point', coordinates: [lng, lat] },
                        distanceField: 'distance',
                        maxDistance: maxDist,
                        query: filter,
                        spherical: true
                    }
                },
                { $count: 'total' }
            ];
            const countResult = await User.aggregate(countPipeline);
            totalUsers = countResult.length > 0 ? countResult[0].total : 0;

        } else {
            // بدون موقع — البحث العادي
            users = await User.find(filter)
                .select('name email profileImage birthDate gender country bio isOnline lastLogin verification.isVerified isPremium stealthMode')
                .sort({ isOnline: -1, lastLogin: -1 })
                .limit(limitNum)
                .skip(skipNum);

            totalUsers = await User.countDocuments(filter);

            // إخفاء lastLogin للمتخفين + إضافة distance: null + حذف stealthMode
            users = users.map(u => {
                const userObj = u.toObject();
                userObj.lastActive = userObj.stealthMode ? null : userObj.lastLogin;
                delete userObj.lastLogin;
                delete userObj.stealthMode;
                userObj.profileImage = getFullUrl(userObj.profileImage);
                userObj.isVerified = userObj.verification?.isVerified || false;
                delete userObj.verification;
                userObj.distance = null;
                userObj.distanceLabel = null;
                return userObj;
            });
        }

        res.status(200).json({
            success: true,
            data: {
                users,
                page: pageNum,
                limit: limitNum,
                total: totalUsers
            }
        });

    } catch (error) {
        console.error('خطأ في البحث عن المستخدمين:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في السيرفر',
            error: error.message
        });
    }
});

// ==========================================
// عرض بروفايل مستخدم
// ==========================================

// @route   GET /api/mobile/users/:id/profile
// @desc    جلب بيانات بروفايل مستخدم بالـ ID
// @access  Protected
router.get('/users/:id/profile', protect, async (req, res) => {
    try {
        const { id } = req.params;

        if (!id.match(/^[0-9a-fA-F]{24}$/)) {
            return res.status(400).json({ success: false, message: 'معرف المستخدم غير صالح' });
        }

        const user = await User.findById(id).select(
            'name profileImage birthDate gender country bio isOnline lastLogin isPremium verification location blockedUsers isActive'
        );

        if (!user || !user.isActive) {
            return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
        }

        // تحقق إذا الطالب محظور
        if (user.blockedUsers && user.blockedUsers.some(blockedId => blockedId.toString() === req.user._id.toString())) {
            return res.status(403).json({ success: false, message: 'لا يمكنك عرض هذا البروفايل' });
        }

        // حساب المسافة إذا كلا المستخدمين لديهم موقع
        let distance = null;
        if (
            req.user.location && req.user.location.coordinates &&
            user.location && user.location.coordinates
        ) {
            const [lng1, lat1] = req.user.location.coordinates;
            const [lng2, lat2] = user.location.coordinates;
            const R = 6371; // نصف قطر الأرض بالكيلومتر
            const dLat = (lat2 - lat1) * Math.PI / 180;
            const dLng = (lng2 - lng1) * Math.PI / 180;
            const a = Math.sin(dLat / 2) ** 2 +
                Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                Math.sin(dLng / 2) ** 2;
            distance = Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 10) / 10;
        }

        const profileData = {
            _id: user._id,
            name: user.name,
            profileImage: getFullUrl(user.profileImage),
            birthDate: user.birthDate,
            gender: user.gender,
            country: user.country,
            bio: user.bio,
            isOnline: user.isOnline,
            lastLogin: user.lastLogin,
            isPremium: user.isPremium,
            verification: {
                isVerified: user.verification?.isVerified || false,
                status: user.verification?.status || 'none'
            },
            distance
        };

        res.json({ success: true, data: { user: profileData } });
    } catch (err) {
        console.error('خطأ في جلب البروفايل:', err);
        res.status(500).json({ success: false, message: 'خطأ في السيرفر' });
    }
});

// ==========================================
// نظام زيارات البروفايل
// ==========================================

// @route   POST /api/mobile/profile-views
// @desc    تسجيل زيارة بروفايل
// @access  Protected
router.post('/profile-views', protect, async (req, res) => {
    try {
        const { viewedUserId } = req.body;
        const viewerId = req.user._id;

        if (!viewedUserId) {
            return res.status(400).json({ success: false, message: 'معرف المستخدم مطلوب' });
        }

        if (viewedUserId === viewerId.toString()) {
            return res.status(400).json({ success: false, message: 'لا يمكن تسجيل زيارة لنفسك' });
        }

        // التحقق من وجود المستخدم
        const viewedUser = await User.findById(viewedUserId);
        if (!viewedUser) {
            return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
        }

        // لا تسجل زيارة مكررة خلال 24 ساعة
        const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const existingView = await ProfileView.findOne({
            viewer: viewerId,
            viewed: viewedUserId,
            createdAt: { $gte: twentyFourHoursAgo }
        });

        if (existingView) {
            return res.json({ success: true, message: 'الزيارة مسجلة مسبقاً' });
        }

        // إنشاء زيارة جديدة
        const isHidden = req.user.stealthMode || false;
        const profileView = await ProfileView.create({
            viewer: viewerId,
            viewed: viewedUserId,
            isHidden
        });

        // إرسال Socket event في الوقت الحقيقي (فقط لو الزيارة مش مخفية)
        if (!isHidden && global.io) {
            global.io.to(`user:${viewedUserId}`).emit('profile-viewed', {
                viewer: {
                    _id: req.user._id,
                    name: req.user.name,
                    profileImage: getFullUrl(req.user.profileImage),
                    isPremium: req.user.isPremium || false,
                    isVerified: req.user.verification?.isVerified || false
                },
                createdAt: profileView.createdAt
            });
        }

        res.json({ success: true, message: 'تم تسجيل الزيارة' });
    } catch (error) {
        console.error('خطأ في تسجيل زيارة البروفايل:', error);
        res.status(500).json({ success: false, message: 'فشل في تسجيل الزيارة' });
    }
});

// @route   GET /api/mobile/profile-views
// @desc    من شاف بروفايلي
// @access  Protected
router.get('/profile-views', protect, async (req, res) => {
    try {
        const { page = 1, limit = 20 } = req.query;
        const pageNum = parseInt(page);
        const limitNum = parseInt(limit);

        const totalViews = await ProfileView.countDocuments({
            viewed: req.user._id,
            isHidden: false
        });

        const isPremium = req.user.isPremium && req.user.premiumExpiresAt > new Date();

        if (isPremium) {
            // المشترك: يشوف التفاصيل
            const views = await ProfileView.find({
                viewed: req.user._id,
                isHidden: false
            })
                .populate('viewer', 'name profileImage country isOnline isPremium verification.isVerified')
                .sort({ createdAt: -1 })
                .limit(limitNum)
                .skip((pageNum - 1) * limitNum);

            res.json({
                success: true,
                data: {
                    totalViews,
                    views: views.map(v => ({
                        viewer: {
                            _id: v.viewer._id,
                            name: v.viewer.name,
                            profileImage: getFullUrl(v.viewer.profileImage),
                            country: v.viewer.country,
                            isVerified: v.viewer.verification?.isVerified || false
                        },
                        createdAt: v.createdAt
                    })),
                    page: pageNum,
                    totalPages: Math.ceil(totalViews / limitNum),
                    isPremiumRequired: false
                }
            });
        } else {
            // المجاني: عدد فقط + بيانات مخفية
            const views = await ProfileView.find({
                viewed: req.user._id,
                isHidden: false
            })
                .sort({ createdAt: -1 })
                .limit(3);

            res.json({
                success: true,
                data: {
                    totalViews,
                    views: views.map(v => ({
                        viewer: { _id: null, name: null, profileImage: null, country: null },
                        createdAt: v.createdAt
                    })),
                    page: 1,
                    totalPages: 1,
                    isPremiumRequired: true
                }
            });
        }
    } catch (error) {
        console.error('خطأ في جلب زيارات البروفايل:', error);
        res.status(500).json({ success: false, message: 'فشل في جلب الزيارات' });
    }
});

// ==========================================
// نظام التوثيق (Verification)
// ==========================================

// @route   POST /api/mobile/verification/submit
// @desc    طلب توثيق الحساب (رفع سيلفي)
// @access  Protected + Premium
router.post('/verification/submit', protect, requirePremium, uploadVerificationSelfie.single('selfie'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'صورة السيلفي مطلوبة' });
        }

        // التحقق من الحالة الحالية
        if (req.user.verification && req.user.verification.status === 'pending') {
            return res.status(400).json({ success: false, message: 'لديك طلب توثيق قيد المراجعة' });
        }

        const selfieUrl = `/uploads/verifications/${req.file.filename}`;

        await User.findByIdAndUpdate(req.user._id, {
            'verification.selfieUrl': selfieUrl,
            'verification.status': 'pending',
            'verification.submittedAt': new Date()
        });

        res.json({
            success: true,
            message: 'تم إرسال طلب التوثيق بنجاح',
            data: { status: 'pending' }
        });
    } catch (error) {
        console.error('خطأ في طلب التوثيق:', error);
        res.status(500).json({ success: false, message: 'فشل في إرسال طلب التوثيق' });
    }
});

// @route   GET /api/mobile/verification/status
// @desc    حالة التوثيق
// @access  Protected
router.get('/verification/status', protect, async (req, res) => {
    try {
        const user = await User.findById(req.user._id).select('verification');
        res.json({
            success: true,
            data: {
                isVerified: user.verification?.isVerified || false,
                status: user.verification?.status || 'none',
                submittedAt: user.verification?.submittedAt || null,
                reviewedAt: user.verification?.reviewedAt || null
            }
        });
    } catch (error) {
        console.error('خطأ في جلب حالة التوثيق:', error);
        res.status(500).json({ success: false, message: 'فشل في جلب حالة التوثيق' });
    }
});

// ==========================================
// وضع التخفي (Stealth Mode)
// ==========================================

// @route   PUT /api/mobile/users/stealth-mode
// @desc    تفعيل/تعطيل وضع التخفي
// @access  Protected + Premium
router.put('/users/stealth-mode', protect, requirePremium, async (req, res) => {
    try {
        const { enabled } = req.body;

        if (typeof enabled !== 'boolean') {
            return res.status(400).json({ success: false, message: 'القيمة مطلوبة (true/false)' });
        }

        await User.findByIdAndUpdate(req.user._id, { stealthMode: enabled });

        res.json({
            success: true,
            message: enabled ? 'تم تفعيل وضع التخفي' : 'تم تعطيل وضع التخفي',
            data: { stealthMode: enabled }
        });
    } catch (error) {
        console.error('خطأ في تغيير وضع التخفي:', error);
        res.status(500).json({ success: false, message: 'فشل في تغيير وضع التخفي' });
    }
});

// ==========================================
// إعدادات الخصوصية (Mobile)
// ==========================================

// @route   GET /api/mobile/privacy/settings
// @desc    جلب إعدادات الخصوصية الحالية
// @access  Private
router.get('/privacy/settings', protect, async (req, res) => {
    try {
        const user = await User.findById(req.user._id)
            .select('privacySettings showDistance stealthMode');

        if (!user) {
            return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
        }

        res.json({
            success: true,
            data: {
                profileVisibility: user.privacySettings?.profileVisibility || 'public',
                showLastSeen: user.privacySettings?.showLastSeen ?? true,
                notificationSound: user.privacySettings?.notificationSound ?? true,
                showDistance: user.showDistance ?? true,
                stealthMode: user.stealthMode || false
            }
        });
    } catch (error) {
        console.error('خطأ في جلب إعدادات الخصوصية:', error);
        res.status(500).json({ success: false, message: 'حدث خطأ في الخادم' });
    }
});

// @route   PATCH /api/mobile/privacy/distance
// @desc    تفعيل/تعطيل إظهار المسافة
// @access  Private
router.patch('/privacy/distance', protect, async (req, res) => {
    try {
        const { showDistance } = req.body;

        if (typeof showDistance !== 'boolean') {
            return res.status(400).json({ success: false, message: 'القيمة مطلوبة (true/false)' });
        }

        await User.findByIdAndUpdate(req.user._id, { showDistance });

        res.json({
            success: true,
            message: showDistance ? 'تم إظهار المسافة' : 'تم إخفاء المسافة'
        });
    } catch (error) {
        console.error('خطأ في تغيير إعداد المسافة:', error);
        res.status(500).json({ success: false, message: 'فشل في تغيير الإعداد' });
    }
});

// @route   PATCH /api/mobile/privacy/stealth
// @desc    تفعيل/تعطيل وضع التخفي
// @access  Private + Premium
router.patch('/privacy/stealth', protect, requirePremium, async (req, res) => {
    try {
        const { stealthMode } = req.body;

        if (typeof stealthMode !== 'boolean') {
            return res.status(400).json({ success: false, message: 'القيمة مطلوبة (true/false)' });
        }

        await User.findByIdAndUpdate(req.user._id, { stealthMode });

        res.json({
            success: true,
            message: stealthMode ? 'تم تفعيل وضع التخفي' : 'تم تعطيل وضع التخفي'
        });
    } catch (error) {
        console.error('خطأ في تغيير وضع التخفي:', error);
        res.status(500).json({ success: false, message: 'فشل في تغيير وضع التخفي' });
    }
});

// ==========================================
// نظام Super Like
// ==========================================

// @route   POST /api/mobile/super-like
// @desc    إرسال Super Like
// @access  Protected
router.post('/super-like', protect, async (req, res) => {
    try {
        const { userId: targetUserId } = req.body;
        const senderId = req.user._id;

        if (!targetUserId) {
            return res.status(400).json({ success: false, message: 'معرف المستخدم مطلوب' });
        }

        if (targetUserId === senderId.toString()) {
            return res.status(400).json({ success: false, message: 'لا يمكن إرسال Super Like لنفسك' });
        }

        // التحقق من وجود المستخدم المستهدف
        const targetUser = await User.findById(targetUserId);
        if (!targetUser) {
            return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
        }

        // التحقق من الحد اليومي
        const user = await User.findById(senderId);
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const lastReset = user.superLikes?.lastReset ? new Date(user.superLikes.lastReset) : new Date(0);
        lastReset.setHours(0, 0, 0, 0);

        let dailyCount = user.superLikes?.daily || 0;

        // ريسيت إذا يوم جديد
        if (lastReset < today) {
            dailyCount = 0;
        }

        const isPremium = user.isPremium && user.premiumExpiresAt > new Date();
        const maxDaily = isPremium ? 5 : 1;

        if (dailyCount >= maxDaily) {
            return res.status(429).json({
                success: false,
                error: 'super_like_limit_reached',
                message: `وصلت الحد الأقصى (${maxDaily} يومياً)`,
                data: { remaining: 0, max: maxDaily }
            });
        }

        // إنشاء Super Like
        await SuperLike.create({ sender: senderId, receiver: targetUserId });

        // تحديث العداد
        await User.findByIdAndUpdate(senderId, {
            'superLikes.daily': dailyCount + 1,
            'superLikes.lastReset': new Date()
        });

        // إنشاء محادثة pending تلقائياً (إذا ما فيه محادثة سابقة)
        let conversation = null;
        const existingConversation = await Conversation.findOne({
            type: 'private',
            participants: { $all: [senderId, targetUserId] }
        });

        if (!existingConversation) {
            conversation = await Conversation.create({
                type: 'private',
                participants: [senderId, targetUserId],
                creator: senderId,
                status: 'pending',
                isActive: true,
                title: `محادثة بين ${req.user.name} و ${targetUser.name}`
            });
        }

        // Socket.IO (لو متصل)
        if (global.io) {
            global.io.to(`user:${targetUserId}`).emit('conversation:request', {
                conversationId: conversation ? conversation._id : existingConversation._id,
                isSuperLike: true,
                from: {
                    _id: senderId,
                    name: req.user.name,
                    profileImage: req.user.profileImage
                }
            });
        }

        // إرسال إشعار push
        try {
            await pushNotificationService.sendNotificationToUser(targetUserId, {
                title: '💎 إعجاب مميز!',
                body: `${req.user.name} أرسل لك Super Like`,
                type: 'super_like'
            }, {
                userId: senderId.toString(),
                type: 'super_like',
                conversationId: conversation ? conversation._id.toString() : existingConversation._id.toString()
            });
        } catch (notifError) {
            console.error('خطأ في إرسال إشعار Super Like:', notifError);
        }

        res.json({
            success: true,
            message: 'تم إرسال Super Like بنجاح',
            data: {
                remaining: maxDaily - (dailyCount + 1),
                max: maxDaily,
                conversationId: conversation ? conversation._id : existingConversation._id
            }
        });
    } catch (error) {
        console.error('خطأ في Super Like:', error);
        res.status(500).json({ success: false, message: 'فشل في إرسال Super Like' });
    }
});

// @route   GET /api/mobile/super-like/remaining
// @desc    المتبقي من Super Likes
// @access  Protected
router.get('/super-like/remaining', protect, async (req, res) => {
    try {
        const user = await User.findById(req.user._id).select('superLikes isPremium premiumExpiresAt');

        const isPremium = user.isPremium && user.premiumExpiresAt > new Date();
        const maxDaily = isPremium ? 5 : 1;

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const lastReset = user.superLikes?.lastReset ? new Date(user.superLikes.lastReset) : new Date(0);
        lastReset.setHours(0, 0, 0, 0);

        let used = user.superLikes?.daily || 0;
        if (lastReset < today) used = 0;

        // وقت الريسيت القادم (بداية اليوم التالي)
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        res.json({
            success: true,
            data: {
                remaining: Math.max(0, maxDaily - used),
                max: maxDaily,
                used,
                resetsAt: tomorrow.toISOString()
            }
        });
    } catch (error) {
        console.error('خطأ في جلب بيانات Super Like:', error);
        res.status(500).json({ success: false, message: 'فشل في جلب البيانات' });
    }
});

// ==========================================
// نظام الاشتراكات (Subscription)
// ==========================================

// @route   POST /api/mobile/subscription/verify
// @desc    التحقق من إيصال Apple وتفعيل الاشتراك
// @access  Protected
router.post('/subscription/verify', protect, async (req, res) => {
    try {
        const { receipt, transactionId, originalTransactionId, plan } = req.body;

        // يجب إرسال إما receipt (StoreKit 1) أو transactionId (StoreKit 2)
        if (!receipt && !transactionId) {
            return res.status(400).json({
                success: false,
                message: 'بيانات الإيصال مطلوبة (receipt أو transactionId)'
            });
        }

        if (!plan) {
            return res.status(400).json({ success: false, message: 'الخطة مطلوبة' });
        }

        if (!['weekly', 'monthly', 'quarterly'].includes(plan)) {
            return res.status(400).json({ success: false, message: 'خطة غير صالحة' });
        }

        // TODO: التحقق الفعلي من Apple في بيئة الإنتاج
        // StoreKit 1: التحقق من receipt عبر Apple verifyReceipt API
        // StoreKit 2: التحقق من transactionId عبر App Store Server API v2

        // حساب تاريخ الانتهاء
        const now = new Date();
        let expiresAt;
        switch (plan) {
            case 'weekly':
                expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
                break;
            case 'monthly':
                expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
                break;
            case 'quarterly':
                expiresAt = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
                break;
        }

        const updateData = {
            isPremium: true,
            premiumPlan: plan,
            premiumExpiresAt: expiresAt
        };

        // حفظ بيانات المعاملة لو StoreKit 2
        if (transactionId) {
            updateData.subscriptionTransactionId = transactionId;
            if (originalTransactionId) {
                updateData.subscriptionOriginalTransactionId = originalTransactionId;
            }
        }

        await User.findByIdAndUpdate(req.user._id, updateData);

        res.json({
            success: true,
            message: 'تم تفعيل الاشتراك بنجاح',
            data: {
                isPremium: true,
                plan,
                expiresAt: expiresAt.toISOString()
            }
        });
    } catch (error) {
        console.error('خطأ في التحقق من الاشتراك:', error);
        res.status(500).json({ success: false, message: 'فشل في التحقق من الاشتراك' });
    }
});

// @route   GET /api/mobile/subscription/status
// @desc    حالة الاشتراك الحالية
// @access  Protected
router.get('/subscription/status', protect, async (req, res) => {
    try {
        const user = await User.findById(req.user._id)
            .select('isPremium premiumPlan premiumExpiresAt');

        const isPremium = user.isPremium && user.premiumExpiresAt && user.premiumExpiresAt > new Date();

        res.json({
            success: true,
            data: {
                isPremium: isPremium || false,
                plan: isPremium ? user.premiumPlan : null,
                expiresAt: isPremium ? user.premiumExpiresAt.toISOString() : null
            }
        });
    } catch (error) {
        console.error('خطأ في جلب حالة الاشتراك:', error);
        res.status(500).json({ success: false, message: 'فشل في جلب حالة الاشتراك' });
    }
});

// ==========================================
// نظام حظر المستخدمين
// ==========================================

// @route   POST /api/mobile/users/block/:userId
// @desc    حظر مستخدم
// @access  Private
router.post('/users/block/:userId', protect, async (req, res) => {
    try {
        const { userId } = req.params;

        // تحقق إن المستخدم موجود
        const target = await User.findById(userId);
        if (!target) {
            return res.status(404).json({
                success: false,
                message: 'المستخدم غير موجود'
            });
        }

        // لا تحظر نفسك
        if (userId === req.user._id.toString()) {
            return res.status(400).json({
                success: false,
                message: 'لا يمكن حظر نفسك'
            });
        }

        // أضف للقائمة السوداء (بدون تكرار)
        await User.findByIdAndUpdate(req.user._id, {
            $addToSet: { blockedUsers: userId }
        });

        // حذف أي محادثة بينهم
        await Conversation.deleteMany({
            type: 'private',
            participants: { $all: [req.user._id, userId] }
        });

        res.json({
            success: true,
            message: 'تم حظر المستخدم'
        });

    } catch (error) {
        console.error('خطأ في حظر المستخدم:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في السيرفر',
            error: error.message
        });
    }
});

// @route   POST /api/mobile/users/unblock/:userId
// @desc    إلغاء حظر مستخدم
// @access  Private
router.post('/users/unblock/:userId', protect, async (req, res) => {
    try {
        const { userId } = req.params;

        // تحقق إن المستخدم موجود
        const target = await User.findById(userId);
        if (!target) {
            return res.status(404).json({
                success: false,
                message: 'المستخدم غير موجود'
            });
        }

        // إزالة من القائمة السوداء
        await User.findByIdAndUpdate(req.user._id, {
            $pull: { blockedUsers: userId }
        });

        res.json({
            success: true,
            message: 'تم إلغاء حظر المستخدم'
        });

    } catch (error) {
        console.error('خطأ في إلغاء حظر المستخدم:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في السيرفر',
            error: error.message
        });
    }
});

// @route   GET /api/mobile/users/blocked
// @desc    الحصول على قائمة المحظورين
// @access  Private
router.get('/users/blocked', protect, async (req, res) => {
    try {
        const user = await User.findById(req.user._id)
            .populate('blockedUsers', 'name email profileImage isPremium verification.isVerified');

        res.json({
            success: true,
            data: {
                blockedUsers: user.blockedUsers || []
            }
        });

    } catch (error) {
        console.error('خطأ في جلب المحظورين:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في السيرفر',
            error: error.message
        });
    }
});

// ==========================================
// نظام المحادثات (طلب/قبول/رفض)
// ==========================================

// @route   POST /api/mobile/conversations/request
// @desc    طلب بدء محادثة مع مستخدم
// @access  Private
router.post('/conversations/request', protect, async (req, res) => {
    try {
        const { targetUserId, initialMessage, isSuperLike } = req.body;

        if (!targetUserId) {
            return res.status(400).json({
                success: false,
                message: 'معرف المستخدم المستهدف مطلوب'
            });
        }

        // التحقق من وجود المستخدم المستهدف
        const targetUser = await User.findById(targetUserId);
        if (!targetUser) {
            return res.status(404).json({
                success: false,
                message: 'المستخدم غير موجود'
            });
        }

        if (!targetUser.isActive) {
            return res.status(400).json({
                success: false,
                message: 'المستخدم غير نشط'
            });
        }

        // التحقق من عدم وجود محادثة سابقة
        const existingConversation = await Conversation.findOne({
            type: 'private',
            participants: { $all: [req.user._id, targetUserId] }
        });

        if (existingConversation) {
            return res.status(200).json({
                success: true,
                message: 'محادثة موجودة بالفعل',
                data: {
                    conversation: existingConversation,
                    isExisting: true
                }
            });
        }

        // ========== معالجة Super Like ==========
        let superLikeCreated = false;
        if (isSuperLike) {
            const senderId = req.user._id;

            // التحقق من الحد اليومي
            const senderUser = await User.findById(senderId);
            const today = new Date();
            today.setHours(0, 0, 0, 0);

            const lastReset = senderUser.superLikes?.lastReset ? new Date(senderUser.superLikes.lastReset) : new Date(0);
            lastReset.setHours(0, 0, 0, 0);

            let dailyCount = senderUser.superLikes?.daily || 0;
            if (lastReset < today) dailyCount = 0;

            const userIsPremium = senderUser.isPremium && senderUser.premiumExpiresAt > new Date();
            const maxDaily = userIsPremium ? 5 : 1;

            if (dailyCount >= maxDaily) {
                return res.status(429).json({
                    success: false,
                    error: 'super_like_limit_reached',
                    message: `وصلت الحد الأقصى من Super Likes (${maxDaily} يومياً)`,
                    data: { remaining: 0, max: maxDaily }
                });
            }

            // إنشاء Super Like
            await SuperLike.create({ sender: senderId, receiver: targetUserId });
            await User.findByIdAndUpdate(senderId, {
                'superLikes.daily': dailyCount + 1,
                'superLikes.lastReset': new Date()
            });
            superLikeCreated = true;
        }

        // إنشاء محادثة جديدة بحالة "pending"
        const conversation = await Conversation.create({
            type: 'private',
            participants: [req.user._id, targetUserId],
            creator: req.user._id,
            status: 'pending',
            isActive: true,
            title: `محادثة بين ${req.user.name} و ${targetUser.name}`
        });

        // إرسال الرسالة الأولى إذا وجدت
        if (initialMessage) {
            await Message.create({
                conversation: conversation._id,
                sender: req.user._id,
                content: initialMessage,
                type: 'text',
                status: 'sent'
            });
        }

        // ١. Socket.IO (لو متصل)
        if (global.io) {
            global.io.to(`user:${targetUserId}`).emit('conversation:request', {
                conversationId: conversation._id,
                isSuperLike: superLikeCreated,
                from: {
                    _id: req.user._id,
                    name: req.user.name,
                    profileImage: req.user.profileImage
                }
            });
        }

        // ٢. Push Notification عبر FCM
        const notifTitle = superLikeCreated ? '💎 إعجاب مميز!' : 'طلب محادثة جديد';
        const notifBody = superLikeCreated
            ? `${req.user.name} أرسل لك Super Like ويريد التحدث معك`
            : `${req.user.name} يريد التحدث معك`;

        try {
            await pushNotificationService.sendNotificationToUser(
                targetUserId,
                {
                    title: notifTitle,
                    body: notifBody,
                    type: superLikeCreated ? 'super_like' : 'conversation_request'
                },
                {
                    type: superLikeCreated ? 'super_like' : 'conversation_request',
                    conversationId: conversation._id.toString(),
                    senderId: req.user._id.toString(),
                    senderName: req.user.name,
                    isSuperLike: superLikeCreated ? 'true' : 'false'
                }
            );
        } catch (notifError) {
            console.error('خطأ في إرسال إشعار طلب المحادثة:', notifError);
        }

        res.status(201).json({
            success: true,
            message: superLikeCreated ? 'تم إرسال Super Like وطلب المحادثة' : 'تم إرسال طلب المحادثة',
            data: {
                conversation,
                isExisting: false,
                isSuperLike: superLikeCreated
            }
        });

    } catch (error) {
        console.error('خطأ في طلب المحادثة:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في السيرفر',
            error: error.message
        });
    }
});

// @route   PUT /api/mobile/conversations/:id/accept
// @desc    قبول طلب محادثة
// @access  Private
router.put('/conversations/:id/accept', protect, async (req, res) => {
    try {
        const conversation = await Conversation.findById(req.params.id)
            .populate('participants', 'name email deviceToken fcmToken');

        if (!conversation) {
            return res.status(404).json({
                success: false,
                message: 'المحادثة غير موجودة'
            });
        }

        // التحقق من أن المستخدم هو المستهدف وليس المنشئ
        if (conversation.creator.toString() === req.user._id.toString()) {
            return res.status(400).json({
                success: false,
                message: 'لا يمكنك قبول طلب أنت أرسلته'
            });
        }

        // التحقق من أن المستخدم جزء من المحادثة
        const isParticipant = conversation.participants.some(
            p => p._id.toString() === req.user._id.toString()
        );

        if (!isParticipant) {
            return res.status(403).json({
                success: false,
                message: 'ليس لديك صلاحية لهذه المحادثة'
            });
        }

        // تفعيل المحادثة
        conversation.status = 'accepted';
        conversation.isActive = true;
        await conversation.save();

        // إرسال إشعار لمنشئ المحادثة عبر FCM
        const creator = conversation.participants.find(
            p => p._id.toString() === conversation.creator.toString()
        );

        if (creator && creator.fcmToken) {
            await pushNotificationService.sendNotificationToUser(
                creator._id,
                {
                    title: 'تم قبول طلب المحادثة',
                    body: `${req.user.name} قبل طلب المحادثة`
                },
                {
                    type: 'conversation_request',
                    conversationId: conversation._id.toString(),
                    action: 'accepted'
                }
            );
        }

        // إرسال عبر Socket.IO
        if (global.io) {
            global.io.to(`user:${conversation.creator.toString()}`).emit('conversation-accepted', {
                conversationId: conversation._id,
                acceptedBy: req.user.name
            });
        }

        res.status(200).json({
            success: true,
            message: 'تم قبول المحادثة',
            data: { conversation }
        });

    } catch (error) {
        console.error('خطأ في قبول المحادثة:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في السيرفر',
            error: error.message
        });
    }
});

// @route   PUT /api/mobile/conversations/:id/reject
// @desc    رفض طلب محادثة
// @access  Private
router.put('/conversations/:id/reject', protect, async (req, res) => {
    try {
        const conversation = await Conversation.findById(req.params.id)
            .populate('participants', 'name email deviceToken fcmToken');

        if (!conversation) {
            return res.status(404).json({
                success: false,
                message: 'المحادثة غير موجودة'
            });
        }

        // التحقق من أن المستخدم هو المستهدف
        if (conversation.creator.toString() === req.user._id.toString()) {
            return res.status(400).json({
                success: false,
                message: 'لا يمكنك رفض طلب أنت أرسلته'
            });
        }

        const isParticipant = conversation.participants.some(
            p => p._id.toString() === req.user._id.toString()
        );

        if (!isParticipant) {
            return res.status(403).json({
                success: false,
                message: 'ليس لديك صلاحية لهذه المحادثة'
            });
        }

        // تحديث حالة المحادثة
        conversation.status = 'rejected';
        conversation.isActive = false;
        await conversation.save();

        // إرسال إشعار لمنشئ المحادثة عبر FCM
        const creator = conversation.participants.find(
            p => p._id.toString() === conversation.creator.toString()
        );

        if (creator && creator.fcmToken) {
            await pushNotificationService.sendNotificationToUser(
                creator._id,
                {
                    title: 'طلب المحادثة',
                    body: 'لم يتم قبول طلب المحادثة'
                },
                {
                    type: 'conversation_request',
                    conversationId: conversation._id.toString(),
                    action: 'rejected'
                }
            );
        }

        // إرسال عبر Socket.IO
        if (global.io) {
            global.io.to(`user:${conversation.creator.toString()}`).emit('conversation-rejected', {
                conversationId: conversation._id,
                rejectedBy: req.user.name
            });
        }

        res.status(200).json({
            success: true,
            message: 'تم رفض طلب المحادثة',
            data: { conversation }
        });

    } catch (error) {
        console.error('خطأ في رفض المحادثة:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في السيرفر',
            error: error.message
        });
    }
});

// @route   PUT /api/mobile/conversations/:id/read
// @desc    تحديث الرسائل كمقروءة في المحادثة
// @access  Private
router.put('/conversations/:id/read', protect, async (req, res) => {
    try {
        const conversationId = req.params.id;
        const userId = req.user._id;

        // التحقق من المحادثة
        const conversation = await Conversation.findById(conversationId);

        if (!conversation) {
            return res.status(404).json({
                success: false,
                message: 'المحادثة غير موجودة'
            });
        }

        // التحقق من أن المستخدم جزء من المحادثة
        const isParticipant = conversation.participants.some(
            p => p.toString() === userId.toString()
        );

        if (!isParticipant) {
            return res.status(403).json({
                success: false,
                message: 'ليس لديك صلاحية لهذه المحادثة'
            });
        }

        // تحديث جميع الرسائل غير المقروءة (التي لم يقرأها هذا المستخدم)
        const result = await Message.updateMany(
            {
                conversation: conversationId,
                sender: { $ne: userId }, // رسائل الآخرين فقط
                'readBy.user': { $ne: userId } // لم يقرأها هذا المستخدم بعد
            },
            {
                $addToSet: {
                    readBy: { user: userId, readAt: new Date() }
                },
                $set: { status: 'read' }
            }
        );

        // إرسال Socket event للطرف الآخر (اختياري)
        if (global.io && result.modifiedCount > 0) {
            global.io.to(`conversation-${conversationId}`).emit('messages-read', {
                conversationId,
                readBy: userId,
                count: result.modifiedCount
            });
        }

        res.status(200).json({
            success: true,
            message: 'تم تحديث حالة القراءة',
            data: {
                markedAsRead: result.modifiedCount
            }
        });

    } catch (error) {
        console.error('خطأ في تحديث حالة القراءة:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في السيرفر',
            error: error.message
        });
    }
});

// @route   GET /api/mobile/conversations/pending
// @desc    الحصول على طلبات المحادثة المعلقة
// @access  Private
router.get('/conversations/pending', protect, async (req, res) => {
    try {
        const conversations = await Conversation.find({
            participants: req.user._id,
            creator: { $ne: req.user._id },
            status: 'pending'
        })
            .populate('creator', 'name email profileImage verification.isVerified isPremium')
            .populate('participants', 'name email profileImage lastLogin isOnline isPremium verification.isVerified')
            .sort({ createdAt: -1 });

        // إضافة حقل isSuperLike لكل طلب
        const creatorIds = conversations.map(c => c.creator._id);
        const superLikes = await SuperLike.find({
            receiver: req.user._id,
            sender: { $in: creatorIds }
        });
        const superLikeSet = new Set(superLikes.map(sl => sl.sender.toString()));

        const enrichedConversations = conversations.map(conv => {
            const convObj = conv.toObject();
            convObj.isSuperLike = superLikeSet.has(conv.creator._id.toString());
            convObj.creator.isVerified = conv.creator.verification?.isVerified || false;
            return convObj;
        });

        // ترتيب: Super Like أولاً ثم بالتاريخ
        enrichedConversations.sort((a, b) => {
            if (a.isSuperLike && !b.isSuperLike) return -1;
            if (!a.isSuperLike && b.isSuperLike) return 1;
            return new Date(b.createdAt) - new Date(a.createdAt);
        });

        res.status(200).json({
            success: true,
            data: { conversations: enrichedConversations }
        });

    } catch (error) {
        console.error('خطأ في جلب الطلبات المعلقة:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في السيرفر',
            error: error.message
        });
    }
});

// @route   GET /api/mobile/conversations
// @desc    الحصول على محادثات المستخدم النشطة مع عدد الرسائل غير المقروءة
// @access  Private
router.get('/conversations', protect, async (req, res) => {
    try {
        const { page = 1, limit = 20 } = req.query;
        const userId = req.user._id;

        const conversations = await Conversation.find({
            participants: userId,
            status: { $in: ['accepted', 'pending'] },
            isActive: true
        })
            .populate('participants', 'name email profileImage lastLogin isOnline isPremium verification.isVerified')
            .populate('lastMessage')
            .sort({ updatedAt: -1 })
            .limit(limit * 1)
            .skip((page - 1) * limit)
            .lean(); // استخدام lean للتعديل على النتائج

        // حساب عدد الرسائل غير المقروءة لكل محادثة
        const conversationsWithUnread = await Promise.all(
            conversations.map(async (conv) => {
                const unreadCount = await Message.countDocuments({
                    conversation: conv._id,
                    sender: { $ne: userId }, // رسائل الآخرين فقط
                    'readBy.user': { $ne: userId } // لم يقرأها هذا المستخدم
                });
                return { ...conv, unreadCount };
            })
        );

        const total = await Conversation.countDocuments({
            participants: userId,
            status: { $in: ['accepted', 'pending'] },
            isActive: true
        });

        // حساب إجمالي الرسائل غير المقروءة
        const totalUnread = conversationsWithUnread.reduce((sum, conv) => sum + conv.unreadCount, 0);

        res.status(200).json({
            success: true,
            data: {
                conversations: conversationsWithUnread,
                total,
                totalUnread,
                currentPage: parseInt(page),
                totalPages: Math.ceil(total / limit)
            }
        });

    } catch (error) {
        console.error('خطأ في جلب المحادثات:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في السيرفر',
            error: error.message
        });
    }
});

// @route   PUT /api/mobile/conversations/:id/mute
// @desc    كتم/إلغاء كتم إشعارات محادثة
// @access  Private
router.put('/conversations/:id/mute', protect, async (req, res) => {
    try {
        const { id } = req.params;
        const { muted, mutedUntil } = req.body;
        const userId = req.user._id;

        // التحقق من وجود المحادثة وأن المستخدم مشارك فيها
        const conversation = await Conversation.findById(id);
        if (!conversation) {
            return res.status(404).json({
                success: false,
                message: 'المحادثة غير موجودة'
            });
        }

        if (!conversation.participants.includes(userId)) {
            return res.status(403).json({
                success: false,
                message: 'غير مصرح لك بالوصول لهذه المحادثة'
            });
        }

        if (muted) {
            // إزالة أي كتم سابق لنفس المحادثة أولاً
            await User.findByIdAndUpdate(userId, {
                $pull: { mutedConversations: { conversationId: id } }
            });
            // إضافة للقائمة المكتومة
            await User.findByIdAndUpdate(userId, {
                $push: {
                    mutedConversations: {
                        conversationId: id,
                        mutedUntil: mutedUntil || null
                    }
                }
            });
        } else {
            // إزالة من القائمة المكتومة
            await User.findByIdAndUpdate(userId, {
                $pull: { mutedConversations: { conversationId: id } }
            });
        }

        res.json({
            success: true,
            muted,
            mutedUntil: muted ? (mutedUntil || null) : null,
            message: muted ? 'تم كتم المحادثة' : 'تم إلغاء كتم المحادثة'
        });
    } catch (error) {
        console.error('خطأ في كتم المحادثة:', error);
        res.status(500).json({
            success: false,
            message: 'فشل في تحديث حالة الكتم',
            error: error.message
        });
    }
});

// ==========================================
// نظام الرسائل
// ==========================================

// @route   POST /api/mobile/messages/send
// @desc    إرسال رسالة
// @access  Private
router.post('/messages/send', protect, async (req, res) => {
    try {
        const { conversationId, content, type = 'text', mediaUrl, mediaMetadata } = req.body;

        if (!conversationId || !content) {
            return res.status(400).json({
                success: false,
                message: 'معرف المحادثة والمحتوى مطلوبان'
            });
        }

        // التحقق من المحادثة
        const conversation = await Conversation.findById(conversationId)
            .populate('participants', 'name email deviceToken');

        if (!conversation) {
            return res.status(404).json({
                success: false,
                message: 'المحادثة غير موجودة'
            });
        }

        // التحقق من أن المستخدم جزء من المحادثة
        const isParticipant = conversation.participants.some(
            p => p._id.toString() === req.user._id.toString()
        );

        if (!isParticipant) {
            return res.status(403).json({
                success: false,
                message: 'ليس لديك صلاحية لهذه المحادثة'
            });
        }

        // التحقق من أن المحادثة نشطة
        if (!conversation.isActive) {
            return res.status(400).json({
                success: false,
                message: 'المحادثة غير نشطة'
            });
        }

        // لو معلقة، بس المنشئ يقدر يرسل
        if (conversation.status === 'pending') {
            if (conversation.creator.toString() !== req.user._id.toString()) {
                return res.status(400).json({
                    success: false,
                    message: 'لا يمكنك الإرسال حتى تقبل المحادثة'
                });
            }
        }

        // إنشاء الرسالة
        const message = await Message.create({
            conversation: conversationId,
            sender: req.user._id,
            content,
            type,
            mediaUrl: mediaUrl || null,
            mediaMetadata: mediaMetadata || null,
            status: 'sent'
        });

        // تحديث آخر رسالة + عداد الرسائل
        conversation.lastMessage = message._id;
        if (!conversation.metadata) conversation.metadata = {};
        conversation.metadata.totalMessages = (conversation.metadata.totalMessages || 0) + 1;
        await conversation.save();

        // جلب الرسالة مع بيانات المرسل
        const populatedMessage = await Message.findById(message._id)
            .populate('sender', 'name email profileImage isPremium verification.isVerified');

        // إرسال عبر Socket.IO
        console.log('🔥 About to emit new-message to room:', `conversation-${conversationId}`);
        console.log('🔥 global.io exists:', !!global.io);
        if (global.io) {
            global.io.to(`conversation-${conversationId}`).emit('new-message', {
                message: populatedMessage
            });
            console.log('🔥 Emitted!');
        } else {
            console.log('❌ global.io is undefined!');
        }

        // إرسال إشعارات للمستقبلين الـ offline فقط عبر FCM
        const recipients = conversation.participants.filter(
            p => p._id.toString() !== req.user._id.toString()
        );

        console.log('📲 عدد المستقبلين:', recipients.length);

        for (const recipient of recipients) {
            const recipientId = recipient._id.toString();

            // تحقق هل المستقبل متصل بالسوكت
            const isOnline = global.connectedUsers && global.connectedUsers.has(recipientId);

            if (isOnline) {
                console.log(`📲 ${recipient.name} متصل بالسوكت - لا حاجة لـ Push`);
            } else {
                console.log(`📲 ${recipient.name} غير متصل - إرسال Push Notification`);
                // إرسال Push Notification عبر Firebase للـ offline users فقط
                const pushResult = await pushNotificationService.sendNewMessageNotification(
                    recipient._id,
                    req.user.name,
                    type === 'text' ? (content.length > 100 ? content.substring(0, 100) + '...' : content) : `أرسل ${type === 'image' ? 'صورة' : type === 'audio' ? 'رسالة صوتية' : type === 'video' ? 'فيديو' : 'ملف'}`,
                    conversationId
                );
                console.log('📲 نتيجة الإشعار:', JSON.stringify(pushResult));
            }
        }

        res.status(201).json({
            success: true,
            message: 'تم إرسال الرسالة',
            data: { message: populatedMessage }
        });

    } catch (error) {
        console.error('خطأ في إرسال الرسالة:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في السيرفر',
            error: error.message
        });
    }
});

// @route   POST /api/mobile/conversations/:conversationId/messages/image
// @desc    إرسال صورة في رسالة (multipart/form-data)
// @access  Private
router.post('/conversations/:conversationId/messages/image', protect, uploadMessageImage.single('image'), async (req, res) => {
    try {
        const { conversationId } = req.params;
        const senderId = req.user._id;

        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: 'لم يتم رفع صورة'
            });
        }

        // التحقق من المحادثة
        const conversation = await Conversation.findById(conversationId)
            .populate('participants', 'name email fcmToken');

        if (!conversation) {
            // حذف الصورة المرفوعة
            fs.unlinkSync(req.file.path);
            return res.status(404).json({
                success: false,
                message: 'المحادثة غير موجودة'
            });
        }

        // التحقق من أن المستخدم جزء من المحادثة
        const isParticipant = conversation.participants.some(
            p => p._id.toString() === senderId.toString()
        );

        if (!isParticipant) {
            fs.unlinkSync(req.file.path);
            return res.status(403).json({
                success: false,
                message: 'ليس لديك صلاحية لهذه المحادثة'
            });
        }

        // رابط الصورة
        const baseUrl = process.env.BASE_URL || 'https://halachat.khalafiati.io';
        const mediaUrl = `${baseUrl}/uploads/messages/${req.file.filename}`;

        // إنشاء الرسالة
        const message = await Message.create({
            conversation: conversationId,
            sender: senderId,
            type: 'image',
            mediaUrl: mediaUrl,
            content: req.body.caption || '',
            status: 'sent'
        });

        // تحديث آخر رسالة في المحادثة
        conversation.lastMessage = message._id;
        await conversation.save();

        // جلب الرسالة مع بيانات المرسل
        const populatedMessage = await Message.findById(message._id)
            .populate('sender', 'name profileImage isPremium verification.isVerified');

        // إرسال عبر Socket.IO
        if (global.io) {
            global.io.to(`conversation-${conversationId}`).emit('new-message', {
                message: populatedMessage
            });
        }

        // إرسال Push للمستقبلين غير المتصلين
        const recipients = conversation.participants.filter(
            p => p._id.toString() !== senderId.toString()
        );

        for (const recipient of recipients) {
            const recipientId = recipient._id.toString();
            const isOnline = global.connectedUsers && global.connectedUsers.has(recipientId);

            if (!isOnline) {
                await pushNotificationService.sendNewMessageNotification(
                    recipient._id,
                    req.user.name,
                    '📷 أرسل صورة',
                    conversationId
                );
            }
        }

        res.status(201).json({
            success: true,
            message: 'تم إرسال الصورة',
            data: { message: populatedMessage }
        });

    } catch (error) {
        console.error('خطأ في إرسال الصورة:', error);
        // حذف الصورة إذا حدث خطأ
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }
        res.status(500).json({
            success: false,
            message: 'خطأ في السيرفر',
            error: error.message
        });
    }
});

// @route   POST /api/mobile/conversations/:conversationId/messages
// @desc    إرسال رسالة (route بديل للتوافق مع iOS)
// @access  Private
router.post('/conversations/:conversationId/messages', protect, async (req, res) => {
    try {
        const { conversationId } = req.params;
        const { content, type = 'text', mediaUrl, mediaMetadata } = req.body;

        if (!content) {
            return res.status(400).json({
                success: false,
                message: 'المحتوى مطلوب'
            });
        }

        // التحقق من المحادثة
        const conversation = await Conversation.findById(conversationId)
            .populate('participants', 'name email deviceToken fcmToken');

        if (!conversation) {
            return res.status(404).json({
                success: false,
                message: 'المحادثة غير موجودة'
            });
        }

        // التحقق من أن المستخدم جزء من المحادثة
        const isParticipant = conversation.participants.some(
            p => p._id.toString() === req.user._id.toString()
        );

        if (!isParticipant) {
            return res.status(403).json({
                success: false,
                message: 'ليس لديك صلاحية لهذه المحادثة'
            });
        }

        // إنشاء الرسالة
        const message = await Message.create({
            conversation: conversationId,
            sender: req.user._id,
            content,
            type,
            mediaUrl: mediaUrl || null,
            mediaMetadata: mediaMetadata || null,
            status: 'sent'
        });

        // تحديث آخر رسالة + عداد الرسائل
        conversation.lastMessage = message._id;
        if (!conversation.metadata) conversation.metadata = {};
        conversation.metadata.totalMessages = (conversation.metadata.totalMessages || 0) + 1;
        await conversation.save();

        // جلب الرسالة مع بيانات المرسل
        const populatedMessage = await Message.findById(message._id)
            .populate('sender', 'name email profileImage isPremium verification.isVerified');

        // إرسال عبر Socket.IO
        console.log('🔥 About to emit new-message to room:', `conversation-${conversationId}`);
        console.log('🔥 global.io exists:', !!global.io);
        if (global.io) {
            global.io.to(`conversation-${conversationId}`).emit('new-message', {
                message: populatedMessage
            });
            console.log('🔥 Emitted!');
        }

        // إرسال إشعارات للمستقبلين الـ offline فقط عبر FCM
        const recipients = conversation.participants.filter(
            p => p._id.toString() !== req.user._id.toString()
        );

        console.log('📲 عدد المستقبلين:', recipients.length);

        for (const recipient of recipients) {
            const recipientId = recipient._id.toString();
            const isOnline = global.connectedUsers && global.connectedUsers.has(recipientId);

            if (isOnline) {
                console.log(`📲 ${recipient.name} متصل بالسوكت - لا حاجة لـ Push`);
            } else {
                console.log(`📲 ${recipient.name} غير متصل - إرسال Push Notification`);
                const pushResult = await pushNotificationService.sendNewMessageNotification(
                    recipient._id,
                    req.user.name,
                    type === 'text' ? (content.length > 100 ? content.substring(0, 100) + '...' : content) : `أرسل ${type === 'image' ? 'صورة' : type === 'audio' ? 'رسالة صوتية' : type === 'video' ? 'فيديو' : 'ملف'}`,
                    conversationId
                );
                console.log('📲 نتيجة الإشعار:', JSON.stringify(pushResult));
            }
        }

        res.status(201).json({
            success: true,
            message: 'تم إرسال الرسالة',
            data: { message: populatedMessage }
        });

    } catch (error) {
        console.error('خطأ في إرسال الرسالة:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في السيرفر',
            error: error.message
        });
    }
});

// @route   GET /api/mobile/messages/:conversationId
// @desc    الحصول على رسائل محادثة
// @access  Private
router.get('/messages/:conversationId', protect, async (req, res) => {
    try {
        const { page = 1, limit = 50 } = req.query;
        const { conversationId } = req.params;

        // التحقق من المحادثة
        const conversation = await Conversation.findById(conversationId);

        if (!conversation) {
            return res.status(404).json({
                success: false,
                message: 'المحادثة غير موجودة'
            });
        }

        // التحقق من صلاحية المستخدم
        const isParticipant = conversation.participants.some(
            p => p.toString() === req.user._id.toString()
        );

        if (!isParticipant) {
            return res.status(403).json({
                success: false,
                message: 'ليس لديك صلاحية لهذه المحادثة'
            });
        }

        const messages = await Message.find({
            conversation: conversationId,
            isDeleted: false
        })
            .populate('sender', 'name email profileImage isPremium verification.isVerified')
            .sort({ createdAt: -1 })
            .limit(limit * 1)
            .skip((page - 1) * limit);

        const total = await Message.countDocuments({
            conversation: conversationId,
            isDeleted: false
        });

        res.status(200).json({
            success: true,
            data: {
                messages: messages.reverse(), // عكس الترتيب للعرض
                total,
                currentPage: parseInt(page),
                totalPages: Math.ceil(total / limit)
            }
        });

    } catch (error) {
        console.error('خطأ في جلب الرسائل:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في السيرفر',
            error: error.message
        });
    }
});

// ==========================================
// نظام الإبلاغات
// ==========================================

// @route   POST /api/mobile/reports
// @desc    إنشاء بلاغ جديد (شكل مبسط للتطبيق)
// @access  Private
router.post('/reports', protect, async (req, res) => {
    try {
        const {
            reportedUser,   // userId للمستخدم المبلغ عنه
            reason,         // spam | inappropriate | harassment | fake_profile | other
            description     // وصف إضافي (اختياري)
        } = req.body;

        // التحقق من البيانات المطلوبة
        if (!reportedUser || !reason) {
            return res.status(400).json({
                success: false,
                message: 'معرف المستخدم وسبب البلاغ مطلوبان'
            });
        }

        // التحقق من صحة السبب
        const validReasons = ['spam', 'inappropriate', 'harassment', 'fake_profile', 'other'];
        if (!validReasons.includes(reason)) {
            return res.status(400).json({
                success: false,
                message: 'سبب البلاغ غير صالح'
            });
        }

        // التحقق من وجود المستخدم المبلغ عنه
        const targetUser = await User.findById(reportedUser);
        if (!targetUser) {
            return res.status(404).json({
                success: false,
                message: 'المستخدم المبلغ عنه غير موجود'
            });
        }

        // لا يمكن الإبلاغ عن نفسك
        if (reportedUser === req.user._id.toString()) {
            return res.status(400).json({
                success: false,
                message: 'لا يمكن الإبلاغ عن نفسك'
            });
        }

        // تحديد الأولوية بناء على السبب
        const highPriorityReasons = ['harassment', 'inappropriate'];
        const priority = highPriorityReasons.includes(reason) ? 'high' : 'medium';

        const report = await Report.create({
            type: 'user',
            reportedBy: req.user._id,
            reportedUser: reportedUser,
            category: reason,
            description: description || '',
            status: 'pending',
            priority
        });

        // إرسال إشعار للأدمن عند إنشاء بلاغ جديد
        try {
            // جلب جميع الأدمن
            const admins = await User.find({ role: 'admin', isActive: true });

            // ترجمة السبب للعربية
            const reasonTranslations = {
                'spam': 'سبام',
                'inappropriate': 'محتوى غير لائق',
                'harassment': 'تحرش',
                'fake_profile': 'حساب مزيف',
                'other': 'أخرى'
            };

            const reasonArabic = reasonTranslations[reason] || reason;

            // إنشاء إشعار في قاعدة البيانات
            await Notification.create({
                title: 'بلاغ جديد',
                body: `${req.user.name} أبلغ عن ${targetUser.name} - السبب: ${reasonArabic}`,
                type: 'report',
                recipients: 'specific',
                targetUsers: admins.map(admin => admin._id),
                sender: req.user._id,
                status: 'sent',
                priority: priority === 'high' ? 'high' : 'normal',
                sentAt: new Date(),
                sentCount: admins.length,
                data: {
                    reportId: report._id.toString(),
                    reportedUserId: reportedUser,
                    reportedUserName: targetUser.name,
                    reason: reason,
                    type: 'new_report'
                }
            });

            // إرسال Push Notifications للأدمن الأوفلاين
            for (const admin of admins) {
                // Socket.IO للأدمن المتصلين
                if (global.io) {
                    global.io.to(`user:${admin._id}`).emit('notification', {
                        type: 'report',
                        title: 'بلاغ جديد',
                        body: `${req.user.name} أبلغ عن ${targetUser.name}`,
                        data: { reportId: report._id.toString() }
                    });
                }

                // Push للأدمن الأوفلاين
                if (!admin.isOnline && admin.deviceToken) {
                    await notificationService.sendPush(
                        admin.deviceToken,
                        'بلاغ جديد ⚠️',
                        `${req.user.name} أبلغ عن ${targetUser.name} - السبب: ${reasonArabic}`,
                        {
                            type: 'new_report',
                            reportId: report._id.toString()
                        }
                    );
                }
            }
        } catch (notifError) {
            console.error('خطأ في إرسال إشعار البلاغ:', notifError);
            // نكمل حتى لو فشل الإشعار
        }

        res.status(201).json({
            success: true,
            message: 'تم إرسال البلاغ'
        });

    } catch (error) {
        console.error('خطأ في إنشاء البلاغ:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في السيرفر',
            error: error.message
        });
    }
});

// @route   GET /api/mobile/reports/my
// @desc    الحصول على بلاغاتي
// @access  Private
router.get('/reports/my', protect, async (req, res) => {
    try {
        const reports = await Report.find({ reportedBy: req.user._id })
            .populate('reportedUser', 'name email')
            .sort({ createdAt: -1 });

        res.status(200).json({
            success: true,
            data: { reports }
        });

    } catch (error) {
        console.error('خطأ في جلب البلاغات:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في السيرفر',
            error: error.message
        });
    }
});

// ==========================================
// نظام الإشعارات
// ==========================================

// @route   GET /api/mobile/notifications
// @desc    الحصول على إشعارات المستخدم
// @access  Private
router.get('/notifications', protect, async (req, res) => {
    try {
        const { page = 1, limit = 20 } = req.query;

        // جلب الإشعارات الموجهة للمستخدم أو للجميع
        const query = {
            $or: [
                { targetUsers: req.user._id },
                { recipients: 'all' }
            ],
            isActive: true
        };

        const notifications = await Notification.find(query)
            .populate('sender', 'name profileImage isPremium verification.isVerified')
            .sort({ createdAt: -1 })
            .limit(limit * 1)
            .skip((page - 1) * limit);

        const total = await Notification.countDocuments(query);

        // حساب الإشعارات غير المقروءة
        const unreadCount = await Notification.countDocuments({
            ...query,
            'readBy._id': { $ne: req.user._id }
        });

        // تحويل صور المرسلين إلى روابط كاملة
        const formattedNotifications = notifications.map(n => {
            const notif = n.toObject();
            if (notif.sender && notif.sender.profileImage) {
                notif.sender.profileImage = getFullUrl(notif.sender.profileImage);
            }
            if (notif.image) {
                notif.image = getFullUrl(notif.image);
            }
            return notif;
        });

        res.status(200).json({
            success: true,
            data: {
                notifications: formattedNotifications,
                total,
                unreadCount,
                currentPage: parseInt(page),
                totalPages: Math.ceil(total / limit)
            }
        });

    } catch (error) {
        console.error('خطأ في جلب الإشعارات:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في السيرفر',
            error: error.message
        });
    }
});

// @route   PUT /api/mobile/notifications/:id/read
// @desc    تحديد إشعار كمقروء
// @access  Private
router.put('/notifications/:id/read', protect, async (req, res) => {
    try {
        const notification = await Notification.findById(req.params.id);

        if (!notification) {
            return res.status(404).json({
                success: false,
                message: 'الإشعار غير موجود'
            });
        }

        // إضافة المستخدم لقائمة القراء (بنفس format الموجود في DB)
        const alreadyRead = notification.readBy.some(r =>
            (r._id && r._id.toString() === req.user._id.toString()) ||
            (r.toString() === req.user._id.toString())
        );
        if (!alreadyRead) {
            notification.readBy.push({ _id: req.user._id, readAt: new Date() });
            await notification.save();
        }

        res.status(200).json({
            success: true,
            message: 'تم تحديد الإشعار كمقروء'
        });

    } catch (error) {
        console.error('خطأ في تحديث الإشعار:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في السيرفر',
            error: error.message
        });
    }
});

// @route   PUT /api/mobile/notifications/read-all
// @desc    تحديد جميع الإشعارات كمقروءة
// @access  Private
router.put('/notifications/read-all', protect, async (req, res) => {
    try {
        await Notification.updateMany(
            {
                $or: [
                    { targetUsers: req.user._id },
                    { recipients: 'all' }
                ],
                'readBy._id': { $ne: req.user._id }
            },
            {
                $addToSet: { readBy: { _id: req.user._id, readAt: new Date() } }
            }
        );

        res.status(200).json({
            success: true,
            message: 'تم تحديد جميع الإشعارات كمقروءة'
        });

    } catch (error) {
        console.error('خطأ في تحديث الإشعارات:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في السيرفر',
            error: error.message
        });
    }
});

// ==========================================
// نظام FCM Token (Firebase Cloud Messaging)
// ==========================================

// @route   POST /api/mobile/device/register-token
// @desc    تسجيل FCM Token للإشعارات
// @access  Private
router.post('/device/register-token', protect, async (req, res) => {
    try {
        const { fcmToken, deviceToken, platform, osVersion, appVersion } = req.body;

        if (!fcmToken && !deviceToken) {
            return res.status(400).json({
                success: false,
                message: 'FCM Token أو Device Token مطلوب'
            });
        }

        // تحديث بيانات المستخدم
        const updateData = {
            deviceInfo: {
                platform: platform || null,
                osVersion: osVersion || null,
                appVersion: appVersion || null
            }
        };

        // إضافة FCM Token (Firebase)
        if (fcmToken) {
            updateData.fcmToken = fcmToken;
        }

        // إضافة Device Token (APNs)
        if (deviceToken) {
            updateData.deviceToken = deviceToken;
        }

        await User.findByIdAndUpdate(req.user._id, updateData);

        console.log(`📱 تم تسجيل Token للمستخدم ${req.user.name}`);

        res.status(200).json({
            success: true,
            message: 'تم تسجيل Token بنجاح'
        });

    } catch (error) {
        console.error('خطأ في تسجيل Token:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في السيرفر',
            error: error.message
        });
    }
});

// @route   DELETE /api/mobile/device/unregister-token
// @desc    إلغاء تسجيل FCM Token (عند تسجيل الخروج)
// @access  Private
router.delete('/device/unregister-token', protect, async (req, res) => {
    try {
        await User.findByIdAndUpdate(req.user._id, {
            $unset: { fcmToken: 1, deviceToken: 1 }
        });

        console.log(`📴 تم إلغاء تسجيل Token للمستخدم ${req.user.name}`);

        res.status(200).json({
            success: true,
            message: 'تم إلغاء تسجيل Token بنجاح'
        });

    } catch (error) {
        console.error('خطأ في إلغاء تسجيل Token:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في السيرفر',
            error: error.message
        });
    }
});

// @route   PUT /api/mobile/device/update-token
// @desc    تحديث FCM Token
// @access  Private
router.put('/device/update-token', protect, async (req, res) => {
    try {
        const { fcmToken, deviceToken } = req.body;

        if (!fcmToken && !deviceToken) {
            return res.status(400).json({
                success: false,
                message: 'FCM Token أو Device Token مطلوب'
            });
        }

        const updateData = {};
        if (fcmToken) updateData.fcmToken = fcmToken;
        if (deviceToken) updateData.deviceToken = deviceToken;

        await User.findByIdAndUpdate(req.user._id, updateData);

        res.status(200).json({
            success: true,
            message: 'تم تحديث Token بنجاح'
        });

    } catch (error) {
        console.error('خطأ في تحديث Token:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في السيرفر',
            error: error.message
        });
    }
});

module.exports = router;
