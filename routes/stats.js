// HalaChat Dashboard - Stats Routes
// المسارات الخاصة بالإحصائيات

const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Message = require('../models/Message');
const Conversation = require('../models/Conversation');
const SuperLike = require('../models/SuperLike');
const Swipe = require('../models/Swipe');
const Match = require('../models/Match');
const { protect, adminOnly } = require('../middleware/auth');
const { get, set, CACHE_KEYS, CACHE_TTL } = require('../utils/cache');

// @route   GET /api/stats/dashboard
// @desc    الحصول على إحصائيات Dashboard الشاملة
// @access  Private/Admin
router.get('/dashboard', protect, adminOnly, async (req, res) => {
    try {
        // التحقق من الـ Cache أولاً
        const cachedData = get(CACHE_KEYS.DASHBOARD_STATS);
        if (cachedData) {
            console.log('📦 Dashboard Stats من الـ Cache');
            return res.status(200).json(cachedData);
        }

        const now = new Date();
        const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000);
        const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);
        const thirtyDaysAgo = new Date(now - 30 * 24 * 60 * 60 * 1000);

        // ============ إحصائيات المستخدمين ============
        const totalUsers = await User.countDocuments();
        const activeUsers = await User.countDocuments({ isActive: true });
        const newUsers = await User.countDocuments({ createdAt: { $gte: sevenDaysAgo } });
        const recentLogins = await User.countDocuments({ lastLogin: { $gte: oneDayAgo } });

        // أحدث المستخدمين (آخر 5)
        const latestUsers = await User.find({})
            .select('name email createdAt profileImage')
            .sort({ createdAt: -1 })
            .limit(5);

        // ============ إحصائيات Premium ============
        const premiumTotal = await User.countDocuments({ isPremium: true });
        const premiumActive = await User.countDocuments({ isPremium: true, premiumExpiresAt: { $gte: now } });
        const premiumExpired = await User.countDocuments({ isPremium: true, premiumExpiresAt: { $lt: now } });
        const premiumWeekly = await User.countDocuments({ isPremium: true, premiumPlan: 'weekly', premiumExpiresAt: { $gte: now } });
        const premiumMonthly = await User.countDocuments({ isPremium: true, premiumPlan: 'monthly', premiumExpiresAt: { $gte: now } });
        const premiumQuarterly = await User.countDocuments({ isPremium: true, premiumPlan: 'quarterly', premiumExpiresAt: { $gte: now } });

        // إيراد تقديري شهري (بالريال السعودي)
        const prices = { weekly: 9.99, monthly: 29.99, quarterly: 69.99 };
        const estimatedMonthlyRevenue =
            (premiumWeekly * prices.weekly * 4) +
            (premiumMonthly * prices.monthly) +
            (premiumQuarterly * (prices.quarterly / 3));

        // ============ إحصائيات Super Like ============
        const totalSuperLikes = await SuperLike.countDocuments();
        const superLikesLast7Days = await SuperLike.countDocuments({ createdAt: { $gte: sevenDaysAgo } });

        // ============ إحصائيات Stealth Mode ============
        const stealthModeUsers = await User.countDocuments({ stealthMode: true, isPremium: true });

        // ============ إحصائيات المحادثات ============
        const totalConversations = await Conversation.countDocuments();
        const activeConversations = await Conversation.countDocuments({ isActive: true });
        const totalMessages = await Message.countDocuments({ isDeleted: false });

        // ============ إحصائيات Swipes ============
        const totalSwipes = await Swipe.countDocuments();
        const swipesLast7Days = await Swipe.countDocuments({ createdAt: { $gte: sevenDaysAgo } });
        const totalLikes = await Swipe.countDocuments({ type: 'like' });
        const totalDislikes = await Swipe.countDocuments({ type: 'dislike' });
        const totalSwipeSuperLikes = await Swipe.countDocuments({ type: 'superlike' });

        // ============ إحصائيات Matches ============
        const totalMatches = await Match.countDocuments();
        const activeMatches = await Match.countDocuments({ isActive: true });
        const matchesLast7Days = await Match.countDocuments({ createdAt: { $gte: sevenDaysAgo } });

        const responseData = {
            success: true,
            data: {
                stats: {
                    totalUsers,
                    activeUsers,
                    newUsers,
                    recentLogins
                },
                premium: {
                    total: premiumTotal,
                    active: premiumActive,
                    expired: premiumExpired,
                    byPlan: {
                        weekly: premiumWeekly,
                        monthly: premiumMonthly,
                        quarterly: premiumQuarterly
                    },
                    estimatedMonthlyRevenue: Math.round(estimatedMonthlyRevenue * 100) / 100
                },
                superLikes: {
                    total: totalSuperLikes,
                    last7Days: superLikesLast7Days
                },
                swipes: {
                    total: totalSwipes,
                    last7Days: swipesLast7Days,
                    likes: totalLikes,
                    dislikes: totalDislikes,
                    superLikes: totalSwipeSuperLikes
                },
                matches: {
                    total: totalMatches,
                    active: activeMatches,
                    last7Days: matchesLast7Days
                },
                stealthMode: {
                    activeUsers: stealthModeUsers
                },
                conversations: {
                    total: totalConversations,
                    active: activeConversations,
                    totalMessages: totalMessages
                },
                latestUsers
            }
        };

        // تخزين في الـ Cache
        set(CACHE_KEYS.DASHBOARD_STATS, responseData, CACHE_TTL.DASHBOARD_STATS);
        console.log('💾 Dashboard Stats تم تخزينها في الـ Cache');

        res.status(200).json(responseData);

    } catch (error) {
        console.error('خطأ في جلب الإحصائيات:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في السيرفر'
        });
    }
});

// @route   GET /api/stats/super-likes
// @desc    قائمة Super Likes مع الإحصائيات
// @access  Private/Admin
router.get('/super-likes', protect, adminOnly, async (req, res) => {
    try {
        const { page = 1, limit = 20, startDate, endDate } = req.query;
        const pageNum = parseInt(page);
        const limitNum = parseInt(limit);

        // بناء الفلتر
        const filter = {};
        if (startDate || endDate) {
            filter.createdAt = {};
            if (startDate) filter.createdAt.$gte = new Date(startDate);
            if (endDate) filter.createdAt.$lte = new Date(endDate);
        }

        // جلب Super Likes
        const superLikes = await SuperLike.find(filter)
            .populate('sender', 'name email profileImage isPremium verification.isVerified')
            .populate('receiver', 'name email profileImage isPremium verification.isVerified')
            .sort({ createdAt: -1 })
            .limit(limitNum)
            .skip((pageNum - 1) * limitNum);

        const total = await SuperLike.countDocuments(filter);

        // إضافة حالة المحادثة لكل super like
        const superLikesWithConversation = await Promise.all(
            superLikes.map(async (sl) => {
                const conversation = await Conversation.findOne({
                    participants: { $all: [sl.sender?._id, sl.receiver?._id] },
                    type: 'private'
                }).select('status isActive createdAt');

                return {
                    _id: sl._id,
                    sender: sl.sender,
                    receiver: sl.receiver,
                    createdAt: sl.createdAt,
                    conversation: conversation ? {
                        _id: conversation._id,
                        status: conversation.status,
                        isActive: conversation.isActive
                    } : null
                };
            })
        );

        // إحصائيات
        const now = new Date();
        const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);

        const totalAll = await SuperLike.countDocuments();
        const last7Days = await SuperLike.countDocuments({ createdAt: { $gte: sevenDaysAgo } });

        // نسبة التحويل: super likes التي أنشئت محادثة مقبولة
        const allSuperLikes = await SuperLike.find().select('sender receiver');
        let conversionsCount = 0;
        for (const sl of allSuperLikes) {
            const conv = await Conversation.findOne({
                participants: { $all: [sl.sender, sl.receiver] },
                type: 'private',
                status: 'accepted'
            }).select('_id');
            if (conv) conversionsCount++;
        }
        const conversionRate = totalAll > 0 ? Math.round((conversionsCount / totalAll) * 100) : 0;

        res.json({
            success: true,
            data: {
                superLikes: superLikesWithConversation,
                stats: {
                    total: totalAll,
                    last7Days,
                    conversionRate,
                    conversions: conversionsCount
                },
                page: pageNum,
                totalPages: Math.ceil(total / limitNum),
                total
            }
        });
    } catch (error) {
        console.error('خطأ في جلب Super Likes:', error);
        res.status(500).json({ success: false, message: 'فشل في جلب Super Likes' });
    }
});

// @route   GET /api/stats/analytics
// @desc    تحليلات متقدمة: أكثر نشاطاً، أكثر إرسالاً، أكثر تواجداً، مواقع المستخدمين
// @access  Private/Admin
router.get('/analytics', protect, adminOnly, async (req, res) => {
    try {
        const cachedData = get('analytics_stats');
        if (cachedData) {
            return res.status(200).json(cachedData);
        }

        const now = new Date();
        const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);
        const thirtyDaysAgo = new Date(now - 30 * 24 * 60 * 60 * 1000);

        // ═══════════ 1. الأكثر إرسالاً للرسائل (آخر 30 يوم) ═══════════
        const topMessagers = await Message.aggregate([
            { $match: { createdAt: { $gte: thirtyDaysAgo }, isDeleted: false } },
            { $group: { _id: '$sender', messageCount: { $sum: 1 }, lastMessage: { $max: '$createdAt' } } },
            { $sort: { messageCount: -1 } },
            { $limit: 15 },
            { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'user' } },
            { $unwind: '$user' },
            { $project: {
                _id: 1,
                messageCount: 1,
                lastMessage: 1,
                'user.name': 1,
                'user.email': 1,
                'user.profileImage': 1,
                'user.isOnline': 1,
                'user.isPremium': 1,
                'user.lastLogin': 1,
                'user.verification.isVerified': 1
            }}
        ]);

        // ═══════════ 2. الأكثر تواجداً (أحدث lastLogin) ═══════════
        const mostOnline = await User.find({ isActive: true, lastLogin: { $exists: true } })
            .select('name email profileImage isOnline isPremium lastLogin verification.isVerified location createdAt')
            .sort({ lastLogin: -1 })
            .limit(15);

        // ═══════════ 3. الأكثر نشاطاً (swipes + messages مجتمعة) ═══════════
        const topSwipersRaw = await Swipe.aggregate([
            { $match: { createdAt: { $gte: thirtyDaysAgo } } },
            { $group: { _id: '$swiper', swipeCount: { $sum: 1 } } },
            { $sort: { swipeCount: -1 } },
            { $limit: 30 }
        ]);

        const topMsgRaw = await Message.aggregate([
            { $match: { createdAt: { $gte: thirtyDaysAgo }, isDeleted: false } },
            { $group: { _id: '$sender', msgCount: { $sum: 1 } } },
            { $sort: { msgCount: -1 } },
            { $limit: 30 }
        ]);

        // دمج النتائج لحساب نقاط النشاط الإجمالية
        const activityMap = {};
        topSwipersRaw.forEach(s => {
            const id = s._id.toString();
            if (!activityMap[id]) activityMap[id] = { swipes: 0, messages: 0 };
            activityMap[id].swipes = s.swipeCount;
        });
        topMsgRaw.forEach(m => {
            const id = m._id.toString();
            if (!activityMap[id]) activityMap[id] = { swipes: 0, messages: 0 };
            activityMap[id].messages = m.msgCount;
        });

        // حساب النقاط: رسائل × 2 + سوايبات × 1
        const activityScores = Object.entries(activityMap)
            .map(([userId, data]) => ({
                userId,
                score: data.messages * 2 + data.swipes,
                messages: data.messages,
                swipes: data.swipes
            }))
            .sort((a, b) => b.score - a.score)
            .slice(0, 15);

        // جلب بيانات المستخدمين
        const activityUserIds = activityScores.map(a => a.userId);
        const activityUsers = await User.find({ _id: { $in: activityUserIds } })
            .select('name email profileImage isOnline isPremium lastLogin verification.isVerified');

        const activityUsersMap = {};
        activityUsers.forEach(u => { activityUsersMap[u._id.toString()] = u; });

        const topActive = activityScores.map(a => ({
            ...a,
            user: activityUsersMap[a.userId] || null
        })).filter(a => a.user);

        // ═══════════ 4. مواقع المستخدمين (تجميع بالدول) ═══════════
        const locationStats = await User.aggregate([
            { $match: { isActive: true, country: { $exists: true, $ne: '' } } },
            { $group: { _id: '$country', count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $limit: 20 }
        ]);

        // مستخدمين عندهم موقع GPS فعلي (مو [0,0])
        const usersWithLocation = await User.countDocuments({
            isActive: true,
            'location.coordinates.0': { $ne: 0 },
            'location.coordinates.1': { $ne: 0 }
        });

        const usersWithoutLocation = await User.countDocuments({
            isActive: true,
            $or: [
                { location: { $exists: false } },
                { 'location.coordinates.0': 0, 'location.coordinates.1': 0 }
            ]
        });

        // ═══════════ 5. إحصائيات الأجهزة ═══════════
        const deviceStats = await User.aggregate([
            { $match: { isActive: true, 'deviceInfo.platform': { $exists: true, $ne: '' } } },
            { $group: { _id: '$deviceInfo.platform', count: { $sum: 1 } } },
            { $sort: { count: -1 } }
        ]);

        // ═══════════ 6. نمو المستخدمين (آخر 30 يوم يومياً) ═══════════
        const userGrowth = await User.aggregate([
            { $match: { createdAt: { $gte: thirtyDaysAgo } } },
            { $group: {
                _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
                count: { $sum: 1 }
            }},
            { $sort: { _id: 1 } }
        ]);

        // ═══════════ 7. نمو الرسائل (آخر 30 يوم يومياً) ═══════════
        const messageGrowth = await Message.aggregate([
            { $match: { createdAt: { $gte: thirtyDaysAgo }, isDeleted: false } },
            { $group: {
                _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
                count: { $sum: 1 }
            }},
            { $sort: { _id: 1 } }
        ]);

        // ═══════════ 8. توزيع الجنس ═══════════
        const genderStats = await User.aggregate([
            { $match: { isActive: true } },
            { $group: { _id: '$gender', count: { $sum: 1 } } }
        ]);

        // ═══════════ 9. توزيع الأعمار ═══════════
        const ageStats = await User.aggregate([
            { $match: { isActive: true, birthDate: { $exists: true } } },
            { $addFields: {
                age: { $floor: { $divide: [{ $subtract: [now, '$birthDate'] }, 365.25 * 24 * 60 * 60 * 1000] } }
            }},
            { $bucket: {
                groupBy: '$age',
                boundaries: [18, 25, 30, 35, 40, 50, 100],
                default: 'other',
                output: { count: { $sum: 1 } }
            }}
        ]);

        // ═══════════ 10. طرق التسجيل ═══════════
        const authProviderStats = await User.aggregate([
            { $match: { isActive: true } },
            { $group: { _id: '$authProvider', count: { $sum: 1 } } },
            { $sort: { count: -1 } }
        ]);

        // ═══════════ 11. مستخدمين بدون صورة / بدون bio ═══════════
        const noProfileImage = await User.countDocuments({
            isActive: true,
            $or: [
                { profileImage: { $exists: false } },
                { profileImage: '' },
                { profileImage: 'default.png' }
            ]
        });
        const noBio = await User.countDocuments({
            isActive: true,
            $or: [
                { bio: { $exists: false } },
                { bio: '' }
            ]
        });
        const activeTotal = await User.countDocuments({ isActive: true });

        const responseData = {
            success: true,
            data: {
                topMessagers: topMessagers.map(t => ({
                    user: t.user,
                    messageCount: t.messageCount,
                    lastMessage: t.lastMessage
                })),
                mostOnline: mostOnline.map(u => ({
                    _id: u._id,
                    name: u.name,
                    email: u.email,
                    profileImage: u.profileImage,
                    isOnline: u.isOnline,
                    isPremium: u.isPremium,
                    isVerified: u.verification?.isVerified || false,
                    lastLogin: u.lastLogin,
                    hasLocation: u.location && u.location.coordinates && u.location.coordinates[0] !== 0
                })),
                topActive,
                locationStats: {
                    byCountry: locationStats,
                    withGPS: usersWithLocation,
                    withoutGPS: usersWithoutLocation
                },
                deviceStats,
                userGrowth,
                messageGrowth,
                genderStats,
                ageStats,
                authProviderStats,
                profileCompleteness: {
                    total: activeTotal,
                    noPhoto: noProfileImage,
                    noBio: noBio,
                    complete: activeTotal - Math.max(noProfileImage, noBio)
                }
            }
        };

        set('analytics_stats', responseData, 300); // Cache 5 دقائق
        res.status(200).json(responseData);

    } catch (error) {
        console.error('خطأ في جلب التحليلات:', error);
        res.status(500).json({ success: false, message: 'خطأ في السيرفر' });
    }
});

// @route   GET /api/stats/user-locations
// @desc    مواقع المستخدمين على الخريطة
// @access  Private/Admin
router.get('/user-locations', protect, adminOnly, async (req, res) => {
    try {
        const users = await User.find({
            isActive: true,
            'location.coordinates.0': { $ne: 0 },
            'location.coordinates.1': { $ne: 0 }
        })
        .select('name profileImage location.coordinates isOnline lastLogin country')
        .limit(500);

        res.json({
            success: true,
            data: users.map(u => ({
                _id: u._id,
                name: u.name,
                profileImage: u.profileImage,
                lat: u.location.coordinates[1],
                lng: u.location.coordinates[0],
                isOnline: u.isOnline,
                lastLogin: u.lastLogin,
                country: u.country
            }))
        });
    } catch (error) {
        console.error('خطأ في جلب مواقع المستخدمين:', error);
        res.status(500).json({ success: false, message: 'خطأ في السيرفر' });
    }
});

module.exports = router;
