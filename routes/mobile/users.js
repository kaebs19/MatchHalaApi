const mongoose = require('mongoose');
const express = require('express');
const router = express.Router();
const User = require('../../models/User');
const Message = require('../../models/Message');
const Conversation = require('../../models/Conversation');
const Notification = require('../../models/Notification');
const ProfileView = require('../../models/ProfileView');
const SuperLike = require('../../models/SuperLike');
const { protect } = require('../../middleware/auth');
const { getFullUrl, getBestUserImage, getUserImage, isUserFullyBanned } = require('./helpers');
const { getZodiacSign, computeUserRank, isBirthdayToday, hasVipBadge, getVipBadgeSource } = require('../../utils/profileEnrichment');

// ==========================================
// Batch Home Endpoint - طلب واحد لكل بيانات الصفحة الرئيسية
// ==========================================

// @route   GET /api/mobile/home
// @desc    جلب كل البيانات المطلوبة عند فتح التطبيق في طلب واحد
// @access  Protected
router.get('/home', protect, async (req, res) => {
    try {
        const userId = req.user._id;

        const [profile, matches, notifications, conversations] = await Promise.all([
            // 1. بروفايل المستخدم
            User.findById(userId)
                .select('-password')
                .lean(),

            // 2. آخر التطابقات (limit 10)
            (async () => {
                const Match = require('../../models/Match');
                const matchDocs = await Match.find({ users: userId, isActive: true })
                    .populate('users', 'name profileImage birthDate gender country bio isOnline isPremium verification.isVerified lastLogin')
                    .populate('conversation', '_id lastMessage')
                    .sort({ createdAt: -1 })
                    .limit(10)
                    .lean();

                return matchDocs.map(match => {
                    const otherUser = match.users.find(u => u._id.toString() !== userId.toString());
                    return {
                        _id: match._id,
                        conversationId: match.conversation?._id,
                        createdAt: match.createdAt,
                        user: otherUser ? {
                            _id: otherUser._id,
                            name: otherUser.name,
                            profileImage: getFullUrl(otherUser.profileImage),
                            birthDate: otherUser.birthDate,
                            gender: otherUser.gender,
                            country: otherUser.country,
                            bio: otherUser.bio,
                            isOnline: otherUser.isOnline,
                            isPremium: otherUser.isPremium,
                            isVerified: otherUser.verification?.isVerified || false
                        } : null
                    };
                });
            })(),

            // 3. الإشعارات غير المقروءة (limit 20)
            (async () => {
                const notifQuery = {
                    $or: [
                        { targetUsers: userId },
                        { recipients: 'all' }
                    ],
                    isActive: true,
                    'readBy._id': { $ne: userId }
                };

                const notifs = await Notification.find(notifQuery)
                    .populate('sender', 'name profileImage photos isPremium verification.isVerified')
                    .sort({ createdAt: -1 })
                    .limit(20)
                    .lean();

                return notifs.map(n => {
                    if (n.sender) {
                        n.sender.profileImage = getFullUrl(getBestUserImage(n.sender));
                    }
                    if (n.image) {
                        n.image = getFullUrl(n.image);
                    }
                    return n;
                });
            })(),

            // 4. آخر المحادثات (limit 10)
            (async () => {
                const convs = await Conversation.find({
                    participants: userId,
                    status: { $in: ['accepted', 'pending'] },
                    isActive: true,
                    // ✅ استبعاد المحادثات المخفية عن هذا المستخدم
                    'hiddenFor.user': { $ne: userId }
                })
                    .populate('participants', 'name email profileImage lastLogin isOnline isPremium isActive verification.isVerified')
                    .populate('lastMessage')
                    .sort({ updatedAt: -1 })
                    .limit(10)
                    .lean();

                // ✅ حساب الرسائل غير المقروءة بـ aggregation واحد بدل N+1 queries
                const convIds = convs.map(c => c._id);
                const unreadCounts = await Message.aggregate([
                    {
                        $match: {
                            conversation: { $in: convIds },
                            sender: { $ne: new mongoose.Types.ObjectId(userId) },
                            'readBy.user': { $ne: new mongoose.Types.ObjectId(userId) }
                        }
                    },
                    {
                        $group: {
                            _id: '$conversation',
                            count: { $sum: 1 }
                        }
                    }
                ]);

                const unreadMap = {};
                for (const item of unreadCounts) {
                    unreadMap[item._id.toString()] = item.count;
                }

                return convs.map(conv => ({
                    ...conv,
                    unreadCount: unreadMap[conv._id.toString()] || 0
                }));
            })()
        ]);

        // تحويل صورة البروفايل
        if (profile && profile.profileImage) {
            profile.profileImage = getFullUrl(profile.profileImage);
        }

        // إجمالي الرسائل غير المقروءة
        const totalUnread = conversations.reduce((sum, conv) => sum + conv.unreadCount, 0);

        res.json({
            success: true,
            data: {
                profile,
                matches,
                notifications: {
                    items: notifications,
                    unreadCount: notifications.length
                },
                conversations: {
                    items: conversations,
                    totalUnread
                }
            }
        });

    } catch (error) {
        console.error('خطأ في جلب بيانات الصفحة الرئيسية:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في السيرفر',
            error: error.message
        });
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
        const { latitude, longitude, city, country } = req.body;

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

        const updateData = {
            location: {
                type: 'Point',
                coordinates: [longitude, latitude] // GeoJSON: [lng, lat]
            }
        };
        if (city) updateData.city = city;
        if (country) updateData.country = country;

        await User.findByIdAndUpdate(req.user._id, updateData);

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
            isActive: true,
            // ✅ إخفاء المستخدمين المحظورين بشكل كامل من الاستكشاف
            'bannedWords.isBanned': { $ne: true },
            // ✅ إخفاء المقيّدين من المراسلة (جزئي أو كامل) — ما يظهروا في الاستكشاف
            'restrictions.messagingRestricted': { $ne: true },
            $and: [
                {
                    $or: [
                        { 'suspension.isSuspended': { $ne: true } },
                        { 'suspension.level': { $lt: 5 } }
                    ]
                },
                // ✅ استبعاد المخفيين (مع احتساب انتهاء المدة)
                {
                    $or: [
                        { 'hidden.isHidden': { $ne: true } },
                        { 'hidden.hiddenUntil': { $ne: null, $lte: new Date() } }
                    ]
                }
            ]
        };

        // استثناء المستخدمين المحظورين
        if (req.user.blockedUsers && req.user.blockedUsers.length > 0) {
            filter._id = {
                $ne: req.user._id,
                $nin: req.user.blockedUsers
            };
        }

        // فلتر البحث: اسم أو إيميل أو معرف
        if (q && q.length >= 2) {
            // إذا كان يبدو كـ MongoDB ObjectId (24 حرف hex)
            if (/^[0-9a-fA-F]{24}$/.test(q)) {
                filter._id = q;
            }
            // إذا كان يحتوي @ فهو إيميل
            else if (q.includes('@')) {
                filter.email = { $regex: q, $options: 'i' };
            }
            // بحث بالاسم
            else {
                filter.name = { $regex: q, $options: 'i' };
            }
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
        if (latitude && longitude && parseFloat(latitude) !== 0 && parseFloat(longitude) !== 0) {
            const lat = parseFloat(latitude);
            const lng = parseFloat(longitude);
            // استبعاد المستخدمين بموقع [0,0]
            filter['location.coordinates'] = { $ne: [0, 0] };
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
                        isVerified: '$verification.isVerified', isPremium: 1, stealthMode: 1, distance: 1,
                        showDistance: 1
                    }
                },
                { $sort: { isOnline: -1, distance: 1 } },
                { $skip: skipNum },
                { $limit: limitNum }
            ];

            users = await User.aggregate(pipeline);

            // حساب distanceLabel + إخفاء lastLogin للمتخفين + احترام showDistance
            users = users.map(u => {
                const hideDistance = u.showDistance === false;
                const result = {
                    ...u,
                    distance: hideDistance ? null : Math.round(u.distance / 100) / 10,
                    distanceLabel: hideDistance ? null : getDistanceLabel(u.distance),
                    lastActive: u.stealthMode ? null : u.lastLogin
                };
                result.profileImage = getFullUrl(u.profileImage);
                delete result.lastLogin;
                delete result.stealthMode;
                delete result.showDistance;
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
                .select('name email profileImage birthDate gender country bio isOnline isActive lastLogin verification.isVerified isPremium stealthMode')
                .sort({ isOnline: -1, lastLogin: -1 })
                .limit(limitNum)
                .skip(skipNum)
                .lean();

            totalUsers = await User.countDocuments(filter);

            // إخفاء lastLogin للمتخفين + إضافة distance: null + حذف stealthMode
            users = users.map(u => {
                const userObj = { ...u };
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
            'name profileImage photos birthDate gender country bio isOnline lastLogin isPremium premiumExpiresAt verification vipBadge location blockedUsers isActive bannedWords suspension hidden createdAt stats showDistance acceptingRequests premiumOnlyRequests privacySettings stealthMode'
        ).lean();

        if (!user) {
            return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
        }

        // تحقق إذا الطالب محظور
        if (user.blockedUsers && user.blockedUsers.some(blockedId => blockedId.toString() === req.user._id.toString())) {
            return res.status(403).json({ success: false, message: 'لا يمكنك عرض هذا البروفايل' });
        }

        // ✅ مستخدم موقوف بشكل كامل → رجّع بيانات مقنّعة
        if (isUserFullyBanned(user)) {
            return res.json({
                success: true,
                data: {
                    user: {
                        _id: user._id,
                        name: 'مستخدم موقوف',
                        profileImage: null,
                        photos: [],
                        bio: '',
                        isOnline: false,
                        isPremium: false,
                        isActive: false,
                        isSuspendedAccount: true,
                        verification: { isVerified: false, status: 'none' },
                        distance: null
                    }
                }
            });
        }

        // حساب المسافة إذا كلا المستخدمين لديهم موقع حقيقي (مو [0,0])
        let distance = null;
        if (
            req.user.location && req.user.location.coordinates &&
            user.location && user.location.coordinates &&
            (req.user.location.coordinates[0] !== 0 || req.user.location.coordinates[1] !== 0) &&
            (user.location.coordinates[0] !== 0 || user.location.coordinates[1] !== 0)
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

        // ✅ احترام إعداد showDistance — المستخدم اختار إخفاء المسافة في بروفايله
        if (user.showDistance === false) {
            distance = null;
        }

        // ✅ احترام إعداد showLastSeen + stealthMode — لو مخفي، نخفي lastLogin + isOnline
        const hidePresence = user.privacySettings?.showLastSeen === false || user.stealthMode === true;

        // ✅ isPremium محسوب لحظياً — لا نرجع المخزن stale
        const nowDate = new Date();
        const userExpiresAt = user.premiumExpiresAt ? new Date(user.premiumExpiresAt) : null;
        const userIsPremiumValid = !!(user.isPremium && userExpiresAt && userExpiresAt > nowDate);

        const profileData = {
            _id: user._id,
            name: user.name,
            profileImage: getUserImage(user, 'original'),
            photos: user.photos && user.photos.length > 0
                ? user.photos.map(p => ({
                    original: getFullUrl(p.original),
                    medium: getFullUrl(p.medium),
                    thumbnail: getFullUrl(p.thumbnail),
                    order: p.order
                }))
                : [],
            birthDate: user.birthDate,
            gender: user.gender,
            country: user.country,
            bio: user.bio,
            isOnline: hidePresence ? false : user.isOnline,
            lastLogin: hidePresence ? null : user.lastLogin,
            isPremium: userIsPremiumValid,
            isActive: user.isActive,
            verification: {
                isVerified: user.verification?.isVerified || false,
                status: user.verification?.status || 'none'
            },
            distance,
            // ✅ حقول محسوبة للملف الشخصي
            joinDate: user.createdAt,
            zodiacSign: getZodiacSign(user.birthDate),
            userRank: computeUserRank(user),
            isBirthdayToday: isBirthdayToday(user.birthDate),
            hasVipBadge: hasVipBadge(user),
            vipBadgeSource: getVipBadgeSource(user),
            // ✅ إعدادات الخصوصية للعرض الشرطي في iOS (تعطيل زر الإرسال مسبقاً)
            acceptingRequests: user.acceptingRequests !== false, // افتراضي true
            premiumOnlyRequests: user.premiumOnlyRequests === true
        };

        // ✅ إخفاء الحساب — العميل يبلر الصورة ويخفي الاسم لمن ليس المستخدم نفسه
        const isOwnProfile = String(user._id) === String(req.user._id);
        const hiddenActive = !!(user.hidden?.isHidden) &&
            (!user.hidden.hiddenUntil || new Date(user.hidden.hiddenUntil) > new Date());
        if (hiddenActive && !isOwnProfile) {
            profileData.isHidden = true;
            profileData.hiddenLabel = 'مستخدم مخفي';
        }

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
        const viewedUser = await User.findById(viewedUserId).lean();
        if (!viewedUser) {
            return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
        }

        // لا تسجل زيارة مكررة خلال 24 ساعة
        const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const existingView = await ProfileView.findOne({
            viewer: viewerId,
            viewed: viewedUserId,
            createdAt: { $gte: twentyFourHoursAgo }
        }).lean();

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

        // ✅ إشعار الزيارة — تصميمان حسب اشتراك viewedUser
        // Premium: إشعار كامل مع اسم وصورة الزائر
        // مجاني: إشعار تعريفي مبهم يقود لـ Paywall (نموذج Tinder/Bumble)
        const nowDate = new Date();
        const viewedIsPremiumActive = !!(viewedUser.isPremium &&
            viewedUser.premiumExpiresAt &&
            new Date(viewedUser.premiumExpiresAt) > nowDate);

        if (!isHidden) {
            try {
                const Notification = require('../../models/Notification');
                const pushService = require('../../services/pushNotificationService');

                // ✅ بناء صيغة "غامضة + إثارة" للمجاني: جنس + بلد/مدينة (بدون اسم)
                const buildTeaserTitle = () => {
                    const gender = req.user.gender;
                    const country = req.user.country || req.user.city;
                    const verb = gender === 'female' ? 'زارت' : 'زار';
                    let subject;
                    if (gender === 'female') {
                        subject = 'أنثى';
                    } else if (gender === 'male') {
                        subject = 'شاب';
                    } else {
                        subject = 'شخص ما';
                    }
                    if (country) {
                        return `👀 ${subject} من ${country} ${verb} ملفك!`;
                    }
                    return `👀 ${subject} ${verb} ملفك!`;
                };

                const title = viewedIsPremiumActive
                    ? '👀 زيارة جديدة'
                    : buildTeaserTitle();
                const body = viewedIsPremiumActive
                    ? `${req.user.name || 'مستخدم'} زار ملفك الشخصي`
                    : 'اشترك في Premium لاكتشاف من هو/هي ←';

                // in-app: للـ Premium نُعطي data كاملة، للمجاني data مقفلة (locked)
                await Notification.create({
                    title, body,
                    type: 'profile_view',
                    sender: viewedIsPremiumActive ? req.user._id : null,
                    recipients: 'specific',
                    targetUsers: [viewedUserId],
                    data: viewedIsPremiumActive ? {
                        viewerId: String(req.user._id),
                        viewerName: req.user.name,
                        viewerAvatar: getFullUrl(req.user.profileImage),
                        isPremium: !!req.user.isPremium,
                        isVerified: !!req.user.verification?.isVerified,
                        locked: false
                    } : {
                        locked: true,
                        requiresPremium: true
                    },
                    status: 'sent',
                    sentAt: new Date()
                });

                // push (fail-silent)
                pushService.sendNotificationToUser(String(viewedUserId), {
                    title, body
                }, {
                    type: 'profile_view',
                    locked: viewedIsPremiumActive ? '0' : '1',
                    viewerId: viewedIsPremiumActive ? String(req.user._id) : ''
                }).catch(() => {});
            } catch (notifErr) {
                console.error('profile-view notify error:', notifErr.message);
            }
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
                .skip((pageNum - 1) * limitNum)
                .lean();

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
                .limit(3)
                .lean();

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
// Activity Stats + Streak — البطاقة في شاشة "ملفي"
// ==========================================

// @route   GET /api/mobile/stats
// @desc    إحصائيات نشاط المستخدم (زوار/إعجابات/محادثات + streak)
// @access  Protected
router.get('/stats', protect, async (req, res) => {
    try {
        const userId = req.user._id;
        const { updateUserStreak } = require('../../utils/streakHelper');

        // ✅ تحديث streak تلقائياً عند طلب الإحصائيات
        // (هذا الـ endpoint يُستدعى عند فتح شاشة الملف الشخصي)
        const user = await User.findById(userId).select('streak blockedUsers');
        const streakStatus = await updateUserStreak(user);

        // قائمة المحظورين — لاستبعادهم من العدّ
        const blockedIds = (user.blockedUsers || []).map(id => id.toString());

        // عدّ ثلاثة بالتوازي
        const [visitorsCount, likesCount, conversationsCount] = await Promise.all([
            // 👁️ زوار البروفايل (غير المخفيين، غير المحظورين)
            ProfileView.countDocuments({
                viewed: userId,
                isHidden: { $ne: true },
                viewer: { $nin: blockedIds }
            }),

            // 💕 الإعجابات (Super Likes المستلمة، غير المحظورين)
            SuperLike.countDocuments({
                receiver: userId,
                sender: { $nin: blockedIds }
            }),

            // 💬 المحادثات النشطة (status=accepted، غير مخفية)
            Conversation.countDocuments({
                participants: userId,
                status: 'accepted',
                isActive: true,
                'hiddenFor.user': { $ne: userId }
            })
        ]);

        res.json({
            success: true,
            data: {
                visitors: visitorsCount,
                likes: likesCount,
                conversations: conversationsCount,
                streak: {
                    current: streakStatus.current,
                    longest: streakStatus.longest,
                    increased: streakStatus.increased,  // اليوم زادت؟ (لـ celebration animation في iOS)
                    reset: streakStatus.reset            // اليوم انكسرت سلسلة سابقة؟
                }
            }
        });
    } catch (error) {
        console.error('خطأ في جلب الإحصائيات:', error);
        res.status(500).json({ success: false, message: 'فشل في جلب الإحصائيات' });
    }
});

module.exports = router;
