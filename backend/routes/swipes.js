// MatchHala - Swipes Routes
// مسارات السوايب

const express = require('express');
const router = express.Router();
const Swipe = require('../models/Swipe');
const Match = require('../models/Match');
const User = require('../models/User');
const Conversation = require('../models/Conversation');
const Notification = require('../models/Notification');
const { protect, adminOnly } = require('../middleware/auth');
const { requirePremium } = require('../middleware/premium');
const { sendNotificationToUser } = require('../services/pushNotificationService');

// Helper: تحويل المسار النسبي إلى URL كامل
const getFullUrl = (imgPath) => {
    if (!imgPath) return null;
    if (imgPath.startsWith('http')) return imgPath;
    const baseUrl = process.env.BASE_URL || 'https://halachat.khalafiati.io';
    return `${baseUrl}${imgPath}`;
};

// @route   POST /api/swipes
// @desc    إنشاء سوايب (like/dislike/superlike)
// @access  Protected
router.post('/', protect, async (req, res) => {
    try {
        const { userId, type } = req.body;
        const swiperId = req.user._id;

        // التحقق من البيانات
        if (!userId || !type) {
            return res.status(400).json({
                success: false,
                message: 'معرف المستخدم ونوع السوايب مطلوبان'
            });
        }

        if (!['like', 'dislike', 'superlike'].includes(type)) {
            return res.status(400).json({
                success: false,
                message: 'نوع السوايب غير صالح'
            });
        }

        // لا يمكن السوايب على نفسك
        if (userId === swiperId.toString()) {
            return res.status(400).json({
                success: false,
                message: 'لا يمكنك السوايب على نفسك'
            });
        }

        // التحقق من وجود المستخدم المستهدف
        const targetUser = await User.findById(userId);
        if (!targetUser || !targetUser.isActive) {
            return res.status(404).json({
                success: false,
                message: 'المستخدم غير موجود'
            });
        }

        // التحقق من عدم وجود سوايب سابق
        const existingSwipe = await Swipe.findOne({ swiper: swiperId, swiped: userId });
        if (existingSwipe) {
            return res.status(400).json({
                success: false,
                message: 'لقد قمت بالسوايب على هذا المستخدم مسبقاً'
            });
        }

        // التحقق من حد السوبر لايك
        if (type === 'superlike') {
            const user = await User.findById(swiperId);
            const now = new Date();
            const lastReset = user.superLikes?.lastReset || new Date(0);

            // إعادة تعيين العداد إذا مر يوم
            if (now - lastReset > 24 * 60 * 60 * 1000) {
                user.superLikes = { daily: 0, lastReset: now };
                await user.save();
            }

            const maxSuperLikes = user.isPremium ? 5 : 1;
            if ((user.superLikes?.daily || 0) >= maxSuperLikes) {
                return res.status(400).json({
                    success: false,
                    message: `وصلت للحد الأقصى من السوبر لايك (${maxSuperLikes}/يوم)`
                });
            }

            // زيادة عداد السوبر لايك
            await User.findByIdAndUpdate(swiperId, {
                $inc: { 'superLikes.daily': 1 }
            });
        }

        // إنشاء السوايب
        const swipe = await Swipe.create({
            swiper: swiperId,
            swiped: userId,
            type
        });

        let matchData = null;

        // التحقق من التطابق (like أو superlike)
        if (type === 'like' || type === 'superlike') {
            const reverseSwipe = await Swipe.findOne({
                swiper: userId,
                swiped: swiperId,
                type: { $in: ['like', 'superlike'] }
            });

            if (reverseSwipe) {
                // تطابق! إنشاء Match + Conversation
                const conversation = await Conversation.create({
                    type: 'private',
                    participants: [swiperId, userId],
                    status: 'accepted'
                });

                const match = await Match.create({
                    users: [swiperId, userId],
                    conversation: conversation._id
                });

                matchData = {
                    matchId: match._id,
                    conversationId: conversation._id,
                    user: {
                        _id: targetUser._id,
                        name: targetUser.name,
                        profileImage: getFullUrl(targetUser.profileImage)
                    }
                };

                // إشعار Socket.IO لكلا المستخدمين
                if (global.io) {
                    // إشعار للمستخدم الحالي
                    global.io.to(`user:${swiperId}`).emit('new-match', {
                        match: matchData
                    });

                    // إشعار للمستخدم الآخر
                    const currentUser = await User.findById(swiperId).select('name profileImage');
                    global.io.to(`user:${userId}`).emit('new-match', {
                        match: {
                            matchId: match._id,
                            conversationId: conversation._id,
                            user: {
                                _id: currentUser._id,
                                name: currentUser.name,
                                profileImage: getFullUrl(currentUser.profileImage)
                            }
                        }
                    });
                }

                // إشعار Push للمستخدم الآخر
                try {
                    await sendNotificationToUser(
                        userId,
                        { title: 'تطابق جديد! 🎉', body: `لديك تطابق مع ${req.user.name}` },
                        { type: 'new_match', matchId: match._id.toString() }
                    );
                } catch (pushErr) {
                    console.error('خطأ في إرسال إشعار التطابق:', pushErr);
                }
            }
        }

        // إشعار سوبر لايك
        if (type === 'superlike') {
            // إشعار Socket.IO
            if (global.io) {
                global.io.to(`user:${userId}`).emit('new-superlike', {
                    from: {
                        _id: swiperId,
                        name: req.user.name,
                        profileImage: getFullUrl(req.user.profileImage)
                    }
                });
            }

            // إنشاء إشعار في قاعدة البيانات
            try {
                await Notification.create({
                    title: 'سوبر لايك جديد ⭐',
                    body: `${req.user.name} أعجب بك بشدة!`,
                    type: 'super_like',
                    recipients: 'specific',
                    targetUsers: [userId],
                    sender: swiperId,
                    data: { fromUserId: swiperId.toString() }
                });
            } catch (notifErr) {
                console.error('خطأ في إنشاء إشعار السوبر لايك:', notifErr);
            }

            // إشعار Push
            try {
                await sendNotificationToUser(
                    userId,
                    { title: 'سوبر لايك جديد ⭐', body: `${req.user.name} أعجب بك بشدة!` },
                    { type: 'superlike', fromUserId: swiperId.toString() }
                );
            } catch (pushErr) {
                console.error('خطأ في إرسال إشعار السوبر لايك:', pushErr);
            }
        }

        res.status(201).json({
            success: true,
            message: matchData ? 'تطابق جديد! 🎉' : 'تم السوايب بنجاح',
            data: {
                swipe: {
                    _id: swipe._id,
                    type: swipe.type,
                    swiped: userId
                },
                match: matchData
            }
        });

    } catch (error) {
        console.error('خطأ في إنشاء السوايب:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في السيرفر',
            error: error.message
        });
    }
});

// @route   GET /api/swipes/cards
// @desc    جلب بطاقات للسوايب (مستخدمين لم يتم السوايب عليهم)
// @access  Protected
router.get('/cards', protect, async (req, res) => {
    try {
        const { page = 1, limit = 10, gender, minAge, maxAge } = req.query;
        const userId = req.user._id;
        const pageNum = parseInt(page);
        const limitNum = parseInt(limit);

        // جلب IDs المستخدمين الذين تم السوايب عليهم
        const swipedIds = await Swipe.find({ swiper: userId }).distinct('swiped');

        // جلب IDs المستخدمين المحظورين
        const currentUser = await User.findById(userId);
        const blockedIds = currentUser.blockedUsers || [];

        // بناء الفلتر
        const filter = {
            _id: {
                $ne: userId,
                $nin: [...swipedIds, ...blockedIds]
            },
            isActive: true,
            'privacySettings.profileVisibility': { $ne: 'private' }
        };

        // فلتر الجنس
        if (gender && ['male', 'female'].includes(gender)) {
            filter.gender = gender;
        }

        // فلتر العمر
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

        let users;
        let totalUsers;

        // إذا المستخدم الحالي لديه موقع، رتب حسب القرب
        if (currentUser.location && currentUser.location.coordinates[0] !== 0 && currentUser.location.coordinates[1] !== 0) {
            const pipeline = [
                {
                    $geoNear: {
                        near: currentUser.location,
                        distanceField: 'distance',
                        maxDistance: 100000, // 100 كم
                        query: filter,
                        spherical: true
                    }
                },
                {
                    $project: {
                        name: 1, profileImage: 1, birthDate: 1,
                        gender: 1, country: 1, bio: 1, isOnline: 1,
                        isPremium: 1, distance: 1,
                        isVerified: '$verification.isVerified'
                    }
                },
                { $skip: (pageNum - 1) * limitNum },
                { $limit: limitNum }
            ];

            users = await User.aggregate(pipeline);
            users = users.map(u => ({
                ...u,
                profileImage: getFullUrl(u.profileImage),
                distance: Math.round(u.distance / 1000) // بالكيلومتر
            }));

            const countPipeline = [
                {
                    $geoNear: {
                        near: currentUser.location,
                        distanceField: 'distance',
                        maxDistance: 100000,
                        query: filter,
                        spherical: true
                    }
                },
                { $count: 'total' }
            ];
            const countResult = await User.aggregate(countPipeline);
            totalUsers = countResult.length > 0 ? countResult[0].total : 0;
        } else {
            // بدون موقع - ترتيب عشوائي
            users = await User.find(filter)
                .select('name profileImage birthDate gender country bio isOnline isPremium verification.isVerified')
                .limit(limitNum)
                .skip((pageNum - 1) * limitNum);

            totalUsers = await User.countDocuments(filter);

            users = users.map(u => {
                const userObj = u.toObject();
                userObj.profileImage = getFullUrl(userObj.profileImage);
                userObj.isVerified = userObj.verification?.isVerified || false;
                delete userObj.verification;
                userObj.distance = null;
                return userObj;
            });
        }

        res.json({
            success: true,
            data: {
                cards: users,
                total: totalUsers,
                currentPage: pageNum,
                totalPages: Math.ceil(totalUsers / limitNum)
            }
        });

    } catch (error) {
        console.error('خطأ في جلب البطاقات:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في السيرفر',
            error: error.message
        });
    }
});

// @route   GET /api/swipes/likes-me
// @desc    من أعجب بي (ميزة بريميوم)
// @access  Protected + Premium
router.get('/likes-me', protect, requirePremium, async (req, res) => {
    try {
        const { page = 1, limit = 20 } = req.query;
        const userId = req.user._id;
        const pageNum = parseInt(page);
        const limitNum = parseInt(limit);

        // جلب من أعجب بي ولم أعمل لهم سوايب بعد
        const mySwipedIds = await Swipe.find({ swiper: userId }).distinct('swiped');

        const likesFilter = {
            swiped: userId,
            type: { $in: ['like', 'superlike'] },
            swiper: { $nin: mySwipedIds }
        };

        const likes = await Swipe.find(likesFilter)
            .populate('swiper', 'name profileImage birthDate gender country bio isOnline isPremium verification.isVerified')
            .sort({ createdAt: -1 })
            .limit(limitNum)
            .skip((pageNum - 1) * limitNum);

        const total = await Swipe.countDocuments(likesFilter);

        const formattedLikes = likes.map(like => ({
            _id: like._id,
            type: like.type,
            createdAt: like.createdAt,
            user: {
                _id: like.swiper._id,
                name: like.swiper.name,
                profileImage: getFullUrl(like.swiper.profileImage),
                birthDate: like.swiper.birthDate,
                gender: like.swiper.gender,
                country: like.swiper.country,
                bio: like.swiper.bio,
                isOnline: like.swiper.isOnline,
                isPremium: like.swiper.isPremium,
                isVerified: like.swiper.verification?.isVerified || false
            }
        }));

        res.json({
            success: true,
            data: {
                likes: formattedLikes,
                total,
                currentPage: pageNum,
                totalPages: Math.ceil(total / limitNum)
            }
        });

    } catch (error) {
        console.error('خطأ في جلب الإعجابات:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في السيرفر',
            error: error.message
        });
    }
});

// @route   GET /api/swipes/my-likes
// @desc    من أعجبت به
// @access  Protected
router.get('/my-likes', protect, async (req, res) => {
    try {
        const { page = 1, limit = 20 } = req.query;
        const userId = req.user._id;
        const pageNum = parseInt(page);
        const limitNum = parseInt(limit);

        const likesFilter = {
            swiper: userId,
            type: { $in: ['like', 'superlike'] }
        };

        const likes = await Swipe.find(likesFilter)
            .populate('swiped', 'name profileImage birthDate gender country bio isOnline isPremium verification.isVerified')
            .sort({ createdAt: -1 })
            .limit(limitNum)
            .skip((pageNum - 1) * limitNum);

        const total = await Swipe.countDocuments(likesFilter);

        const formattedLikes = likes.map(like => ({
            _id: like._id,
            type: like.type,
            createdAt: like.createdAt,
            user: {
                _id: like.swiped._id,
                name: like.swiped.name,
                profileImage: getFullUrl(like.swiped.profileImage),
                birthDate: like.swiped.birthDate,
                gender: like.swiped.gender,
                country: like.swiped.country,
                bio: like.swiped.bio,
                isOnline: like.swiped.isOnline,
                isPremium: like.swiped.isPremium,
                isVerified: like.swiped.verification?.isVerified || false
            }
        }));

        res.json({
            success: true,
            data: {
                likes: formattedLikes,
                total,
                currentPage: pageNum,
                totalPages: Math.ceil(total / limitNum)
            }
        });

    } catch (error) {
        console.error('خطأ في جلب إعجاباتي:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في السيرفر',
            error: error.message
        });
    }
});

// @route   GET /api/swipes/stats
// @desc    إحصائيات السوايب (أدمن)
// @access  Admin
router.get('/stats', protect, adminOnly, async (req, res) => {
    try {
        const now = new Date();
        const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);

        const totalSwipes = await Swipe.countDocuments();
        const totalLikes = await Swipe.countDocuments({ type: 'like' });
        const totalDislikes = await Swipe.countDocuments({ type: 'dislike' });
        const totalSuperlikes = await Swipe.countDocuments({ type: 'superlike' });
        const swipesLast7Days = await Swipe.countDocuments({ createdAt: { $gte: sevenDaysAgo } });

        // نسبة اللايكات
        const likeRate = totalSwipes > 0
            ? Math.round(((totalLikes + totalSuperlikes) / totalSwipes) * 100)
            : 0;

        res.json({
            success: true,
            data: {
                totalSwipes,
                totalLikes,
                totalDislikes,
                totalSuperlikes,
                swipesLast7Days,
                likeRate
            }
        });

    } catch (error) {
        console.error('خطأ في جلب إحصائيات السوايب:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في السيرفر',
            error: error.message
        });
    }
});

module.exports = router;
