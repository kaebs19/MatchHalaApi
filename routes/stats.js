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
const Report = require('../models/Report');
const BannedDevice = require('../models/BannedDevice');
const Appeal = require('../models/Appeal');
const { protect, adminOnly } = require('../middleware/auth');
const { get, set, CACHE_KEYS, CACHE_TTL } = require('../utils/cache');
const redisClient = require('../utils/redisClient');
const mongoose = require('mongoose');

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
        const fiveMinAgo = new Date(now.getTime() - 5 * 60 * 1000);

        // ✅ كل الاستعلامات بالتوازي (Promise.all) بدل تسلسل 40+ await
        const [
            totalUsers, activeUsers, newUsers, recentLogins,
            latestUsers,
            premiumTotal, premiumActive, premiumExpired,
            premiumWeekly, premiumMonthly, premiumQuarterly,
            totalSuperLikes, superLikesLast7Days,
            stealthModeUsers,
            totalConversations, activeConversations, allMessages, deletedMessages,
            totalSwipes, swipesLast7Days, totalLikes, totalSwipeSuperLikes,
            totalMatches, activeMatches, matchesLast7Days,
            suspendedNow, bannedNow, reportsToday, reportsPending,
            onlineNow,
            bannedDevicesCount, bannedDevicesToday,
            appealsPending, appealsApproved, appealsRejected, appealsLast7Days,
            growthAgg,
            topReported,
            platformAgg,
            appVersionAgg
        ] = await Promise.all([
            User.countDocuments(),
            User.countDocuments({ isActive: true }),
            User.countDocuments({ createdAt: { $gte: sevenDaysAgo } }),
            User.countDocuments({ lastLogin: { $gte: oneDayAgo } }),

            User.find({}).select('name email createdAt profileImage').sort({ createdAt: -1 }).limit(5).lean(),

            User.countDocuments({ isPremium: true }),
            User.countDocuments({ isPremium: true, premiumExpiresAt: { $gte: now } }),
            User.countDocuments({ isPremium: true, premiumExpiresAt: { $lt: now } }),
            User.countDocuments({ isPremium: true, premiumPlan: 'weekly', premiumExpiresAt: { $gte: now } }),
            User.countDocuments({ isPremium: true, premiumPlan: 'monthly', premiumExpiresAt: { $gte: now } }),
            User.countDocuments({ isPremium: true, premiumPlan: 'quarterly', premiumExpiresAt: { $gte: now } }),

            SuperLike.countDocuments(),
            SuperLike.countDocuments({ createdAt: { $gte: sevenDaysAgo } }),

            User.countDocuments({ stealthMode: true, isPremium: true }),

            // ⚠️ countDocuments بفلتر فارغ يمسح المجموعة كاملة للعدّ الدقيق،
            //    بينما estimatedDocumentCount يقرأ عدّاد المجموعة من البيانات
            //    الوصفية. على swipes (٢٣ مليون) الفرق: 6,739ms → 2ms.
            Conversation.estimatedDocumentCount(),
            Conversation.countDocuments({ isActive: true }),
            // ⚠️ isDeleted:false يطابق ١١ مليوناً من ١١٫١ — مسحها أبطأ من
            //    عدّ المحذوف (٦٦٧٨ بفهرس) وطرحه: 5,298ms → ~30ms.
            Message.estimatedDocumentCount(),
            Message.countDocuments({ isDeleted: true }),

            Swipe.estimatedDocumentCount(),
            Swipe.countDocuments({ createdAt: { $gte: sevenDaysAgo } }),
            // ⚠️ dislike يُشتق طرحاً: عدّه مباشرةً يمشي على ٢٢٫٣ مليون مفتاح
            //    بلا فائدة، والاثنان الصغيران يكفيان (فهرس { type: 1 }).
            Swipe.countDocuments({ type: 'like' }),
            Swipe.countDocuments({ type: 'superlike' }),

            Match.countDocuments(),
            Match.countDocuments({ isActive: true }),
            Match.countDocuments({ createdAt: { $gte: sevenDaysAgo } }),

            User.countDocuments({ 'suspension.isSuspended': true }),
            User.countDocuments({ 'bannedWords.isBanned': true }),
            Report.countDocuments({ createdAt: { $gte: oneDayAgo } }),
            Report.countDocuments({ status: { $in: ['pending', 'reviewing'] } }),

            User.countDocuments({
                $or: [
                    { isOnline: true },
                    { lastLogin: { $gte: fiveMinAgo } }
                ]
            }),

            BannedDevice.countDocuments({ isActive: true }),
            BannedDevice.countDocuments({ isActive: true, createdAt: { $gte: oneDayAgo } }),

            Appeal.countDocuments({ status: 'pending' }),
            Appeal.countDocuments({ status: 'approved' }),
            Appeal.countDocuments({ status: 'rejected' }),
            Appeal.countDocuments({ createdAt: { $gte: sevenDaysAgo } }),

            User.aggregate([
                { $match: { createdAt: { $gte: sevenDaysAgo } } },
                { $group: {
                    _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
                    count: { $sum: 1 }
                }},
                { $sort: { _id: 1 } }
            ]),

            Report.aggregate([
                { $match: { status: { $in: ['pending', 'reviewing'] } } },
                { $group: { _id: '$reportedUser', count: { $sum: 1 } } },
                { $sort: { count: -1 } },
                { $limit: 5 },
                { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'user' } },
                { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
                { $project: { _id: 1, count: 1, name: '$user.name', email: '$user.email' } }
            ]),

            // 📱 توزيع المنصّات — deviceInfo.platform يُملأ عند تسجيل الجهاز.
            //    الحسابات التي سبقت إضافة الحقل تبقى null وتُعرض «غير معروف»
            //    صراحةً: إخفاؤها يجعل مجموع الشرائح أقلّ من إجمالي المستخدمين.
            User.aggregate([
                { $group: { _id: '$deviceInfo.platform', count: { $sum: 1 } } },
                { $sort: { count: -1 } }
            ]),

            // 📦 توزيع نسخ التطبيق — للمعروفة فقط
            User.aggregate([
                { $match: { 'deviceInfo.appVersion': { $nin: [null, ''] } } },
                { $group: { _id: '$deviceInfo.appVersion', count: { $sum: 1 } } },
                { $sort: { count: -1 } },
                { $limit: 8 }
            ])
        ]);

        // تطبيع المنصّات إلى مفاتيح ثابتة يعتمد عليها العرض
        const platforms = { ios: 0, android: 0, web: 0, unknown: 0 };
        for (const row of platformAgg) {
            const key = (row._id || '').toString().toLowerCase();
            if (key === 'ios' || key === 'iphone' || key === 'ipad') platforms.ios += row.count;
            else if (key === 'android') platforms.android += row.count;
            else if (key === 'web') platforms.web += row.count;
            else platforms.unknown += row.count;
        }
        platforms.known = platforms.ios + platforms.android + platforms.web;

        const appVersions = appVersionAgg.map(r => ({ version: r._id, count: r.count }));

        // القيم المشتقّة — أدقّ من عدّها مباشرةً وأرخص بمراتب
        const totalMessages = Math.max(allMessages - deletedMessages, 0);
        const totalDislikes = Math.max(totalSwipes - totalLikes - totalSwipeSuperLikes, 0);

        // إيراد تقديري شهري
        const prices = { weekly: 9.99, monthly: 29.99, quarterly: 69.99 };
        const estimatedMonthlyRevenue =
            (premiumWeekly * prices.weekly * 4) +
            (premiumMonthly * prices.monthly) +
            (premiumQuarterly * (prices.quarterly / 3));

        const appeals = {
            pending: appealsPending,
            approved: appealsApproved,
            rejected: appealsRejected,
            last7Days: appealsLast7Days
        };

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
                latestUsers,
                moderation: {
                    suspendedNow,
                    bannedNow,
                    reportsToday,
                    reportsPending,
                    topReported
                },
                onlineNow,
                bannedDevices: {
                    total: bannedDevicesCount,
                    today: bannedDevicesToday
                },
                appeals,
                growth: growthAgg,
                platforms,
                appVersions
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
            .skip((pageNum - 1) * limitNum)
            .lean();

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
//
// ⚠️ ثقيلة: ~5.4 مليون رسالة و~5.3 مليون سوايب في 30 يوماً، ولا فهرس createdAt على
// الرسائل. كانت تُحسب عند كل فتح للصفحة بثلاث تجميعات تمسح مجموعة الرسائل كاملة،
// وبكاش منفصل لكل نسخة من النسخ الأربع ← انتهاء مهلة MongoDB و502 (١٠ أكتوبر ٢٠٢٦).
// الآن: تُحسب مرة في Redis مشتركة بين النسخ، بقفل، وتُعرض القديمة فوراً أثناء التحديث.
const ANALYTICS_KEY = 'stats:analytics:v2';
const ANALYTICS_LOCK = 'stats:analytics:lock';
const ANALYTICS_FRESH_MS = 60 * 60 * 1000;      // ساعة — إحصاءات 30 يوماً لا تحتاج أحدث
const ANALYTICS_KEEP_S = 24 * 60 * 60;          // تُعرض القديمة حتى يوم كامل
let analyticsInFlight = null;

async function computeAnalytics() {
        const now = new Date();
        const thirtyDaysAgo = new Date(now - 30 * 24 * 60 * 60 * 1000);
        // _id يحمل وقت الإنشاء ومفهرس — createdAt على الرسائل غير مفهرس (مسح كامل)
        const thirtyDaysAgoId = mongoose.Types.ObjectId.createFromTime(Math.floor(thirtyDaysAgo / 1000));

        // ═══════════ 1+3+7. الرسائل: مرور واحد بدل ثلاثة ═══════════
        const [msgFacet] = await Message.aggregate([
            { $match: { _id: { $gte: thirtyDaysAgoId }, isDeleted: false } },
            { $project: { sender: 1, createdAt: 1 } },
            { $facet: {
                bySender: [
                    { $group: { _id: '$sender', messageCount: { $sum: 1 }, lastMessage: { $max: '$createdAt' } } },
                    { $sort: { messageCount: -1 } },
                    { $limit: 30 }
                ],
                byDay: [
                    { $group: {
                        _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
                        count: { $sum: 1 }
                    }},
                    { $sort: { _id: 1 } }
                ]
            }}
        ]).allowDiskUse(true);

        // ═══════════ 1. الأكثر إرسالاً للرسائل (آخر 30 يوم) ═══════════
        const topSenders = msgFacet.bySender.slice(0, 15);
        const senderUsers = await User.find({ _id: { $in: topSenders.map(s => s._id) } })
            .select('name email profileImage isOnline isPremium lastLogin verification.isVerified')
            .lean();
        const senderUsersMap = {};
        senderUsers.forEach(u => { senderUsersMap[u._id.toString()] = u; });
        const topMessagers = topSenders
            .map(s => ({ ...s, user: senderUsersMap[s._id.toString()] }))
            .filter(s => s.user);

        // ═══════════ 2. الأكثر تواجداً (أحدث lastLogin) ═══════════
        const mostOnline = await User.find({ isActive: true, lastLogin: { $exists: true } })
            .select('name email profileImage isOnline isPremium lastLogin verification.isVerified location createdAt')
            .sort({ lastLogin: -1 })
            .limit(15)
            .lean();

        // ═══════════ 3. الأكثر نشاطاً (swipes + messages مجتمعة) ═══════════
        const topSwipersRaw = await Swipe.aggregate([
            { $match: { createdAt: { $gte: thirtyDaysAgo } } },
            { $group: { _id: '$swiper', swipeCount: { $sum: 1 } } },
            { $sort: { swipeCount: -1 } },
            { $limit: 30 }
        ]).allowDiskUse(true);

        const topMsgRaw = msgFacet.bySender.map(s => ({ _id: s._id, msgCount: s.messageCount }));

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

        // ═══════════ 7. نمو الرسائل (آخر 30 يوم يومياً) — من المرور أعلاه ═══════════
        const messageGrowth = msgFacet.byDay;

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

        return responseData;
}

// يحسب ويخزّن — نسخة واحدة فقط في كل لحظة (قفل Redis)، وطلب واحد داخل النسخة.
// يعيد null إن كانت نسخة أخرى تحسب.
function refreshAnalytics() {
    if (analyticsInFlight) return analyticsInFlight;
    analyticsInFlight = (async () => {
        const c = await redisClient.getClient();
        if (c) {
            const got = await c.set(ANALYTICS_LOCK, String(process.pid), { NX: true, EX: 300 });
            if (!got) return null;
        }
        try {
            const started = Date.now();
            const data = await computeAnalytics();
            await redisClient.setJSON(ANALYTICS_KEY, { data, computedAt: Date.now() }, ANALYTICS_KEEP_S);
            console.log(`📊 التحليلات حُسبت في ${Date.now() - started}ms`);
            return data;
        } finally {
            if (c) await c.del(ANALYTICS_LOCK).catch(() => {});
        }
    })().finally(() => { analyticsInFlight = null; });
    return analyticsInFlight;
}

router.get('/analytics', protect, adminOnly, async (req, res) => {
    try {
        const cached = await redisClient.getJSON(ANALYTICS_KEY);
        if (cached?.data) {
            // قديمة؟ تُعرض فوراً ويُحدَّث في الخلفية
            if (Date.now() - cached.computedAt > ANALYTICS_FRESH_MS) {
                refreshAnalytics().catch(err => console.error('خطأ في تحديث التحليلات:', err.message));
            }
            return res.status(200).json(cached.data);
        }

        // لا شيء بعد: نحسب، أو ننتظر النسخة التي تحسب (أقل من مهلة Nginx 90ث)
        let data = await refreshAnalytics();
        for (let i = 0; !data && i < 35; i++) {
            await new Promise(r => setTimeout(r, 2000));
            data = (await redisClient.getJSON(ANALYTICS_KEY))?.data;
        }
        if (!data) {
            return res.status(503).json({ success: false, message: 'التحليلات قيد التجهيز، أعد المحاولة بعد دقيقة' });
        }
        res.status(200).json(data);

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
        .limit(500)
        .lean();

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
