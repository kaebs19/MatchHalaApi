// HalaChat Dashboard - Users Routes
// المسارات الخاصة بإدارة المستخدمين (للأدمن فقط)

const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Report = require('../models/Report');
const { protect, adminOnly } = require('../middleware/auth');
const { get, set, CACHE_KEYS, CACHE_TTL, invalidateUsers } = require('../utils/cache');

// @route   GET /api/users
// @desc    الحصول على جميع المستخدمين
// @access  Private/Admin
router.get('/', protect, adminOnly, async (req, res) => {
    try {
        const { page = 1, limit = 20, search, sort = 'createdAt', order = 'desc', filter } = req.query;
        const pageNum = parseInt(page);
        const limitNum = Math.min(parseInt(limit) || 20, 100);

        const queryFilter = {};
        if (search && search.trim().length >= 1) {
            const q = search.trim();
            const orConditions = [
                { name: { $regex: q, $options: 'i' } },
                { email: { $regex: q, $options: 'i' } },
                { halaId: { $regex: q, $options: 'i' } }
            ];
            // البحث بالمعرف الكامل (MongoDB ObjectId)
            if (q.match(/^[0-9a-fA-F]{24}$/)) {
                orConditions.push({ _id: q });
            }
            queryFilter.$or = orConditions;
        }
        if (filter === 'active') queryFilter.isActive = true;
        else if (filter === 'suspended') queryFilter['suspension.isSuspended'] = true;
        else if (filter === 'premium') queryFilter.isPremium = true;
        else if (filter === 'online') queryFilter.isOnline = true;

        const cacheKey = `users_list_${pageNum}_${limitNum}_${search || ''}_${sort}_${order}_${filter || ''}`;
        const cachedData = get(cacheKey);
        if (cachedData) {
            return res.status(200).json(cachedData);
        }

        const sortObj = {};
        sortObj[sort] = order === 'asc' ? 1 : -1;

        const [users, total] = await Promise.all([
            User.find(queryFilter)
                .select('name email profileImage role isActive createdAt lastLogin isOnline suspension.isSuspended isPremium verification.isVerified halaId')
                .sort(sortObj)
                .limit(limitNum)
                .skip((pageNum - 1) * limitNum)
                .lean(),
            User.countDocuments(queryFilter)
        ]);

        const responseData = {
            success: true,
            data: {
                users,
                page: pageNum,
                totalPages: Math.ceil(total / limitNum),
                total
            }
        };

        set(cacheKey, responseData, 60);
        res.status(200).json(responseData);

    } catch (error) {
        console.error('خطأ في جلب المستخدمين:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في السيرفر'
        });
    }
});

// @route   GET /api/users/premium
// @desc    قائمة المستخدمين المميزين
// @access  Private/Admin
router.get('/premium', protect, adminOnly, async (req, res) => {
    try {
        const { page = 1, limit = 20, plan, expired } = req.query;
        const pageNum = parseInt(page);
        const limitNum = parseInt(limit);

        const filter = { isPremium: true };
        if (plan && ['weekly', 'monthly', 'quarterly'].includes(plan)) {
            filter.premiumPlan = plan;
        }
        if (expired === 'true') {
            filter.premiumExpiresAt = { $lt: new Date() };
        } else if (expired === 'false') {
            filter.premiumExpiresAt = { $gte: new Date() };
        }

        const users = await User.find(filter)
            .select('name email profileImage isPremium premiumPlan premiumExpiresAt verification.isVerified createdAt lastLogin')
            .sort({ premiumExpiresAt: -1 })
            .limit(limitNum)
            .skip((pageNum - 1) * limitNum);

        const total = await User.countDocuments(filter);

        // إحصائيات
        const stats = {
            total: await User.countDocuments({ isPremium: true }),
            active: await User.countDocuments({ isPremium: true, premiumExpiresAt: { $gte: new Date() } }),
            expired: await User.countDocuments({ isPremium: true, premiumExpiresAt: { $lt: new Date() } }),
            weekly: await User.countDocuments({ isPremium: true, premiumPlan: 'weekly' }),
            monthly: await User.countDocuments({ isPremium: true, premiumPlan: 'monthly' }),
            quarterly: await User.countDocuments({ isPremium: true, premiumPlan: 'quarterly' })
        };

        res.json({
            success: true,
            data: {
                users,
                stats,
                page: pageNum,
                totalPages: Math.ceil(total / limitNum),
                total
            }
        });
    } catch (error) {
        console.error('خطأ في جلب المستخدمين المميزين:', error);
        res.status(500).json({ success: false, message: 'فشل في جلب المستخدمين المميزين' });
    }
});

// @route   PUT /api/users/:id/premium
// @desc    تعديل اشتراك مستخدم يدوياً
// @access  Private/Admin
router.put('/:id/premium', protect, adminOnly, async (req, res) => {
    try {
        const { isPremium, premiumPlan, premiumExpiresAt } = req.body;

        const user = await User.findById(req.params.id);
        if (!user) {
            return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
        }

        if (typeof isPremium === 'boolean') user.isPremium = isPremium;
        if (premiumPlan !== undefined) user.premiumPlan = premiumPlan;
        if (premiumExpiresAt) user.premiumExpiresAt = new Date(premiumExpiresAt);

        // إذا تم إلغاء Premium
        if (isPremium === false) {
            user.premiumPlan = null;
            user.premiumExpiresAt = null;
            user.stealthMode = false;
        }

        await user.save();

        res.json({
            success: true,
            message: 'تم تحديث الاشتراك بنجاح',
            data: {
                _id: user._id,
                name: user.name,
                isPremium: user.isPremium,
                premiumPlan: user.premiumPlan,
                premiumExpiresAt: user.premiumExpiresAt
            }
        });
    } catch (error) {
        console.error('خطأ في تعديل الاشتراك:', error);
        res.status(500).json({ success: false, message: 'فشل في تعديل الاشتراك' });
    }
});

// @route   GET /api/users/stats/devices
// @desc    إحصائيات الأجهزة والمواقع
// @access  Private/Admin
router.get('/stats/devices', protect, adminOnly, async (req, res) => {
    try {
        const [
            platformStats,
            deviceModelStats,
            countryStats,
            cityStats,
            languageStats,
            totalUsers,
            onlineUsers,
            activeToday
        ] = await Promise.all([
            User.aggregate([
                { $match: { 'deviceInfo.platform': { $ne: null } } },
                { $group: { _id: '$deviceInfo.platform', count: { $sum: 1 } } },
                { $sort: { count: -1 } }
            ]),
            User.aggregate([
                { $match: { 'deviceInfo.deviceModel': { $ne: null } } },
                { $group: { _id: '$deviceInfo.deviceModel', count: { $sum: 1 } } },
                { $sort: { count: -1 } },
                { $limit: 15 }
            ]),
            User.aggregate([
                { $match: { country: { $ne: null } } },
                { $group: { _id: '$country', count: { $sum: 1 } } },
                { $sort: { count: -1 } },
                { $limit: 20 }
            ]),
            User.aggregate([
                { $match: { city: { $ne: null } } },
                { $group: { _id: '$city', count: { $sum: 1 } } },
                { $sort: { count: -1 } },
                { $limit: 20 }
            ]),
            User.aggregate([
                { $match: { 'deviceInfo.language': { $ne: null } } },
                { $group: { _id: '$deviceInfo.language', count: { $sum: 1 } } },
                { $sort: { count: -1 } }
            ]),
            User.countDocuments({}),
            User.countDocuments({ isOnline: true }),
            User.countDocuments({ lastLogin: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } })
        ]);

        res.json({
            success: true,
            data: {
                overview: { totalUsers, onlineUsers, activeToday },
                platforms: platformStats.map(p => ({ name: p._id, count: p.count })),
                deviceModels: deviceModelStats.map(d => ({ name: d._id, count: d.count })),
                countries: countryStats.map(c => ({ name: c._id, count: c.count })),
                cities: cityStats.map(c => ({ name: c._id, count: c.count })),
                languages: languageStats.map(l => ({ name: l._id, count: l.count }))
            }
        });
    } catch (error) {
        console.error('خطأ في إحصائيات الأجهزة:', error);
        res.status(500).json({ success: false, message: 'خطأ في السيرفر' });
    }
});

// @route   GET /api/users/featured
// @desc    مستخدمين مميزين للصفحة الرئيسية (بدون auth)
// @access  Public
router.get('/featured', async (req, res) => {
    try {
        const cacheKey = 'featured_users';
        const cached = get(cacheKey);
        if (cached) return res.json(cached);

        const users = await User.find({
            isActive: true,
            profileImage: { $exists: true, $ne: null, $ne: '' },
            name: { $exists: true, $ne: '' }
        })
        .select('name profileImage country isOnline isPremium verification.isVerified')
        .sort({ lastLogin: -1 })
        .limit(12)
        .lean();

        const getFullUrl = (path) => {
            if (!path || typeof path !== 'string') return null;
            if (path.startsWith('http')) return path;
            const baseUrl = process.env.BASE_URL || 'https://matchhala.chathala.com';
            return `${baseUrl}${path.startsWith('/') ? '' : '/'}${path}`;
        };
        const result = users.map(u => ({
            name: u.name,
            profileImage: getFullUrl(u.profileImage),
            country: u.country || null,
            isOnline: u.isOnline || false,
            isPremium: u.isPremium || false,
            isVerified: u.verification?.isVerified || false
        }));

        const response = { success: true, data: { users: result } };
        set(cacheKey, response, 300); // cache 5 minutes
        res.json(response);
    } catch (error) {
        console.error('خطأ في المستخدمين المميزين:', error);
        res.status(500).json({ success: false, message: 'خطأ في السيرفر' });
    }
});

// @route   GET /api/users/:id/profile
// @desc    عرض بروفايل مستخدم (عام لأي مستخدم مسجّل)
// @access  Private
router.get('/:id/profile', protect, async (req, res) => {
    try {
        const user = await User.findById(req.params.id)
            .select('name profileImage photos birthDate gender country city bio interests isOnline isPremium verification halaId lastLogin createdAt');

        if (!user) {
            return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
        }

        // Helper: تحويل المسار النسبي إلى URL كامل
        const getFullUrl = (path) => {
            if (!path) return null;
            if (typeof path !== 'string') return null;
            if (path.startsWith('http')) return path;
            const baseUrl = process.env.BASE_URL || 'https://matchhala.chathala.com';
            return `${baseUrl}${path.startsWith('/') ? '' : '/'}${path}`;
        };

        // استخراج أفضل صورة من photos array
        let mainImage = user.profileImage;
        if (user.photos && user.photos.length > 0) {
            const mainPhoto = user.photos.find(p => p.order === 0) || user.photos[0];
            if (mainPhoto?.original) mainImage = mainPhoto.original;
            else if (mainPhoto?.thumbnail) mainImage = mainPhoto.thumbnail;
        }

        // تحويل photos array إلى URLs
        const photoUrls = user.photos
            ? user.photos.map(p => getFullUrl(typeof p === 'string' ? p : (p.original || p.thumbnail))).filter(Boolean)
            : [];

        const profileData = {
            _id: user._id,
            name: user.name,
            profileImage: getFullUrl(mainImage),
            photos: photoUrls,
            birthDate: user.birthDate,
            gender: user.gender,
            country: user.country,
            city: user.city,
            bio: user.bio,
            interests: user.interests || [],
            isOnline: user.isOnline || false,
            isPremium: user.isPremium || false,
            isVerified: user.verification?.isVerified || false,
            halaId: user.halaId,
            lastLogin: user.lastLogin,
            createdAt: user.createdAt
        };

        res.status(200).json({ success: true, data: { user: profileData } });
    } catch (error) {
        console.error('خطأ في عرض البروفايل:', error);
        res.status(500).json({ success: false, message: 'خطأ في السيرفر' });
    }
});

// @route   GET /api/users/:id
// @desc    الحصول على مستخدم واحد
// @access  Private/Admin
router.get('/:id', protect, adminOnly, async (req, res) => {
    try {
        const user = await User.findById(req.params.id)
            .select('-password -resetPasswordToken -resetPasswordExpire +lastIP');

        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'المستخدم غير موجود'
            });
        }

        // إحصائيات إضافية للأدمن
        const Conversation = require('../models/Conversation');
        const Message = require('../models/Message');
        const FlaggedMessage = require('../models/FlaggedMessage');

        const [conversationCount, messageCount, flaggedCount] = await Promise.all([
            Conversation.countDocuments({ participants: user._id }),
            Message.countDocuments({ sender: user._id }),
            FlaggedMessage.countDocuments({ sender: user._id })
        ]);

        res.status(200).json({
            success: true,
            data: {
                user,
                stats: {
                    conversations: conversationCount,
                    messages: messageCount,
                    flaggedMessages: flaggedCount
                }
            }
        });

    } catch (error) {
        console.error('خطأ في جلب المستخدم:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في السيرفر'
        });
    }
});

// @route   DELETE /api/users/:id
// @desc    حذف مستخدم
// @access  Private/Admin
router.delete('/:id', protect, adminOnly, async (req, res) => {
    try {
        const user = await User.findById(req.params.id);

        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'المستخدم غير موجود'
            });
        }

        await user.deleteOne();

        // إبطال الـ Cache
        invalidateUsers();

        res.status(200).json({
            success: true,
            message: 'تم حذف المستخدم بنجاح'
        });

    } catch (error) {
        console.error('خطأ في حذف المستخدم:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في السيرفر'
        });
    }
});

// @route   PUT /api/users/:id
// @desc    تعديل بيانات مستخدم
// @access  Private/Admin
router.put('/:id', protect, adminOnly, async (req, res) => {
    try {
        const { name, email, role } = req.body;

        // التحقق من وجود المستخدم
        const user = await User.findById(req.params.id);

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

        // تحديث البيانات
        if (name) user.name = name;
        if (email) user.email = email;
        if (role) user.role = role;

        // ✅ تحديث النبذة (حذف أو تعديل من الأدمن)
        if (req.body.hasOwnProperty('bio')) {
            const oldBio = user.bio;
            user.bio = req.body.bio || '';

            // لو تم حذف النبذة (كان فيها محتوى وصارت فاضية) → مخالفة + إشعار
            if (oldBio && oldBio.trim() && !user.bio.trim()) {
                const currentViolations = user.bannedWords?.violations || 0;
                user.set('bannedWords.violations', currentViolations + 1);
                user.set('bannedWords.lastViolationDate', new Date());

                // إشعار المستخدم
                try {
                    const pushNotificationService = require('../services/pushNotificationService');
                    await pushNotificationService.sendNotificationToUser(user._id, {
                        title: '⚠️ تم حذف النبذة تلقائياً',
                        body: 'اكتشف نظام الحماية مخالفة في النبذة الشخصية، وتمّت إزالتها تلقائياً. مخالفة ' + (currentViolations + 1) + ' — يُرجى الالتزام بالشروط.'
                    }, { type: 'warning' });
                } catch(e) { console.error('Push error:', e.message); }
            }
        }

        await user.save();

        // إبطال الـ Cache
        invalidateUsers();

        res.status(200).json({
            success: true,
            message: 'تم تحديث بيانات المستخدم بنجاح',
            data: {
                user: {
                    _id: user._id,
                    name: user.name,
                    email: user.email,
                    role: user.role,
                    isActive: user.isActive
                }
            }
        });

    } catch (error) {
        console.error('خطأ في تحديث المستخدم:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في السيرفر'
        });
    }
});

// @route   PUT /api/users/:id/bio-action
// @desc    Ban or restore user bio (admin)
// @access  Private/Admin
router.put('/:id/bio-action', protect, adminOnly, async (req, res) => {
    try {
        const { action, reason } = req.body;
        const user = await User.findById(req.params.id);
        if (!user) {
            return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
        }

        if (action === 'ban') {
            // Save original bio before banning
            const originalBio = user.bio || '';
            user.bioStatus = {
                status: 'banned',
                originalBio,
                reason: reason || 'نبذة مخالفة',
                bannedAt: new Date()
            };
            user.bio = '';

            // Increment violations
            const currentViolations = user.bannedWords?.violations || 0;
            user.set('bannedWords.violations', currentViolations + 1);
            user.set('bannedWords.lastViolationDate', new Date());

            // Send notification
            try {
                const pushNotificationService = require('../services/pushNotificationService');
                await pushNotificationService.sendNotificationToUser(user._id, {
                    title: '⚠️ تم حذف النبذة تلقائياً',
                    body: 'اكتشف نظام الحماية مخالفة في النبذة الشخصية، وتمّت إزالتها تلقائياً. مخالفة ' + (currentViolations + 1) + ' — يُرجى الالتزام بالشروط.'
                }, { type: 'warning' });
            } catch(e) { console.error('Push error:', e.message); }

            // ✅ تسجيل Violation مع النبذة الأصلية كـ دليل
            try {
                const Violation = require('../models/Violation');
                await Violation.create({
                    user: user._id,
                    type: 'bio',
                    reason: reason || 'نبذة مخالفة',
                    action: 'bio_reset',
                    source: 'admin',
                    admin: req.user._id,
                    evidence: {
                        kind: 'bio',
                        text: originalBio
                    }
                });
            } catch (e) { console.error('violation (bio) error:', e.message); }

        } else if (action === 'restore') {
            // Restore original bio
            if (user.bioStatus?.originalBio) {
                user.bio = user.bioStatus.originalBio;
            }
            user.bioStatus = {
                status: 'active',
                originalBio: null,
                reason: null,
                bannedAt: null
            };
        } else {
            return res.status(400).json({ success: false, message: 'إجراء غير صالح' });
        }

        await user.save();
        invalidateUsers();

        res.status(200).json({
            success: true,
            message: action === 'ban' ? 'تم حظر النبذة بنجاح' : 'تم إعادة النبذة بنجاح',
            data: { bio: user.bio, bioStatus: user.bioStatus }
        });
    } catch (error) {
        console.error('خطأ في إجراء النبذة:', error);
        res.status(500).json({ success: false, message: 'خطأ في السيرفر' });
    }
});

// @route   PUT /api/users/:id/toggle-active
// @desc    تفعيل/إلغاء تفعيل مستخدم
// @access  Private/Admin
router.put('/:id/toggle-active', protect, adminOnly, async (req, res) => {
    try {
        const user = await User.findById(req.params.id);

        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'المستخدم غير موجود'
            });
        }

        user.isActive = !user.isActive;
        await user.save();

        // إبطال الـ Cache
        invalidateUsers();

        res.status(200).json({
            success: true,
            message: user.isActive ? 'تم تفعيل المستخدم' : 'تم إلغاء تفعيل المستخدم',
            data: {
                user
            }
        });

    } catch (error) {
        console.error('خطأ في تحديث المستخدم:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في السيرفر'
        });
    }
});

// @route   GET /api/users/:id/activity
// @desc    الحصول على نشاط مستخدم محدد
// @access  Private/Admin
router.get('/:id/activity', protect, adminOnly, async (req, res) => {
    try {
        const Conversation = require('../models/Conversation');
        const Message = require('../models/Message');
        const Swipe = require('../models/Swipe');
        const ProfileView = require('../models/ProfileView');
        const Appeal = require('../models/Appeal');
        const SpamReport = require('../models/SpamReport');

        const userId = req.params.id;
        const user = await User.findById(userId).select('-password');

        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'المستخدم غير موجود'
            });
        }

        // إحصائيات المحادثات والرسائل
        const [userConversations, userMessages] = await Promise.all([
            Conversation.find({ participants: userId })
                .populate('lastMessage')
                .populate('participants', 'name email profileImage halaId isOnline lastLogin')
                .sort({ updatedAt: -1 }),  // ✅ الأحدث أولاً
            Message.find({ sender: userId, isDeleted: false })
                .sort({ createdAt: -1 })   // ✅ الأحدث أولاً (بدل insertion order)
                .limit(50)                 // قيد سريع للأداء
        ]);

        // إحصائيات السوايب
        const [likesGiven, dislikesGiven, superlikesGiven, likesReceived, superlikesReceived] = await Promise.all([
            Swipe.countDocuments({ swiper: userId, type: 'like' }),
            Swipe.countDocuments({ swiper: userId, type: 'dislike' }),
            Swipe.countDocuments({ swiper: userId, type: 'superlike' }),
            Swipe.countDocuments({ swiped: userId, type: 'like' }),
            Swipe.countDocuments({ swiped: userId, type: 'superlike' })
        ]);

        // إحصائيات زيارات البروفايل
        const [profileViewsReceived, profileViewsGiven] = await Promise.all([
            ProfileView.countDocuments({ viewed: userId }),
            ProfileView.countDocuments({ viewer: userId })
        ]);

        // إحصائيات البلاغات
        const [reportsReceived, reportsSent, recentReportsReceived] = await Promise.all([
            Report.countDocuments({ reportedUser: userId }),
            Report.countDocuments({ reportedBy: userId }),
            Report.find({ reportedUser: userId })
                .sort({ createdAt: -1 })
                .limit(5)
                .populate('reportedBy', 'name halaId profileImage')
                .select('reportedBy category status createdAt')
                .lean()
        ]);

        // الاستئنافات
        const appeals = await Appeal.find({ user: userId }).sort({ createdAt: -1 }).lean();

        // بلاغات السبام
        const spamReportsCount = await SpamReport.countDocuments({ userId: userId });

        // حساب الإحصائيات
        const stats = {
            totalConversations: userConversations.length,
            activeConversations: userConversations.filter(c => c.isActive).length,
            totalMessagesSent: userMessages.length,
            lastActivity: user.lastLogin || user.updatedAt,
            // إحصائيات السوايب
            likesGiven,
            dislikesGiven,
            superlikesGiven,
            likesReceived,
            superlikesReceived,
            // إحصائيات زيارات البروفايل
            profileViewsReceived,
            profileViewsGiven,
            // إحصائيات البلاغات
            reportsReceived,
            reportsSent,
            spamReportsCount
        };

        // ✅ عدد مخالفات لكل محادثة (banned_word violations)
        const Violation = require('../models/Violation');
        const convIds = userConversations.map(c => c._id);
        const violationCountsByConv = await Violation.aggregate([
            { $match: { user: user._id, 'evidence.conversationId': { $in: convIds } } },
            { $group: { _id: '$evidence.conversationId', count: { $sum: 1 } } }
        ]);
        const violationMap = {};
        violationCountsByConv.forEach(v => { violationMap[String(v._id)] = v.count; });

        const conversationsWithViolations = userConversations.map(c => {
            const obj = c.toObject ? c.toObject() : c;
            obj.violationsCount = violationMap[String(c._id)] || 0;
            return obj;
        });

        res.status(200).json({
            success: true,
            data: {
                user,
                stats,
                conversations: conversationsWithViolations,
                recentMessages: userMessages.slice(0, 30),  // ✅ زيادة من 10 إلى 30
                recentReportsReceived,
                appeals
            }
        });

    } catch (error) {
        console.error('خطأ في جلب نشاط المستخدم:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في السيرفر'
        });
    }
});


// @route   PUT /api/users/:id/ban
// @desc    حظر/إلغاء حظر مستخدم
// @access  Private/Admin
router.put('/:id/ban', protect, adminOnly, async (req, res) => {
    try {
        const user = await User.findById(req.params.id);
        if (!user) {
            return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
        }

        const isBanned = user.bannedWords?.isBanned;

        if (isBanned) {
            // إلغاء الحظر
            user.set('bannedWords.isBanned', false);
            user.set('bannedWords.bannedAt', null);
            user.set('bannedWords.banReason', null);
            user.isActive = true;
        } else {
            // حظر
            user.set('bannedWords.isBanned', true);
            user.set('bannedWords.bannedAt', new Date());
            user.set('bannedWords.banReason', req.body.reason || 'حظر يدوي من الأدمن');
            user.isActive = false;
        }

        await user.save();
        invalidateUsers();

        res.json({
            success: true,
            message: isBanned ? 'تم إلغاء حظر المستخدم' : 'تم حظر المستخدم',
            data: { user }
        });
    } catch (error) {
        console.error('خطأ في حظر المستخدم:', error);
        res.status(500).json({ success: false, message: 'خطأ في السيرفر' });
    }
});

// ═══════════════════════════════════════════════════════════════════
// ✅ ميزات جديدة: تعليق + إشعارات + مخالفات + أسماء + صور
// ═══════════════════════════════════════════════════════════════════

const pushNotificationService = require('../services/pushNotificationService');
const Notification = require('../models/Notification');

// @route   PUT /api/users/:id/violations
// @desc    تحديد عدد مخالفات الكلمات المحظورة يدوياً
// @access  Private/Admin
router.put('/:id/violations', protect, adminOnly, async (req, res) => {
    try {
        const { violations } = req.body;

        if (violations === undefined || violations < 0) {
            return res.status(400).json({ success: false, message: 'عدد المخالفات مطلوب (0 أو أكثر)' });
        }

        const user = await User.findById(req.params.id);
        if (!user) {
            return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
        }

        user.set('bannedWords.violations', violations);

        // ✅ جلب الحد من الإعدادات (افتراضي 5)
        const Settings = require('../models/Settings');
        const appSettings = await Settings.getSettings();
        const maxViolations = appSettings?.maxBannedWordViolations || 5;

        // إلغاء الحظر التلقائي إذا تم تقليل المخالفات
        if (violations < maxViolations && user.bannedWords?.isBanned) {
            user.set('bannedWords.isBanned', false);
            user.set('bannedWords.bannedAt', null);
            user.set('bannedWords.banReason', null);
            user.isActive = true;
        }

        // حظر تلقائي إذا تم زيادة المخالفات للحد
        if (violations >= maxViolations && !user.bannedWords?.isBanned) {
            user.set('bannedWords.isBanned', true);
            user.set('bannedWords.bannedAt', new Date());
            user.set('bannedWords.banReason', 'حظر تلقائي - تحديد مخالفات من الأدمن');
            user.isActive = false;
        }

        await user.save();
        invalidateUsers();

        // ✅ إشعار المستخدم عند زيادة المخالفات
        if (violations > 0) {
            try {
                const pushNotificationService = require('../services/pushNotificationService');
                const Settings = require('../models/Settings');
                const appSettings = await Settings.getSettings();
                const maxV = appSettings?.maxBannedWordViolations || 5;

                await pushNotificationService.sendNotificationToUser(user._id, {
                    title: violations >= maxV ? '🚫 تم إيقاف حسابك' : '⚠️ مخالفة',
                    body: violations >= maxV
                        ? 'تم إيقاف حسابك بسبب تجاوز حد المخالفات المسموح. تواصل مع الإدارة.'
                        : `تم تسجيل مخالفة جديدة على حسابك (${violations} من ${maxV}). تجاوز الحد يؤدي لإيقاف الحساب.`
                }, { type: 'warning' });
            } catch(e) { console.error('Push error:', e.message); }
        }

        res.json({
            success: true,
            message: `تم تحديد المخالفات إلى ${violations}`,
            data: {
                _id: user._id,
                name: user.name,
                bannedWords: user.bannedWords
            }
        });
    } catch (error) {
        console.error('خطأ في تحديد المخالفات:', error);
        res.status(500).json({ success: false, message: 'خطأ في السيرفر' });
    }
});

// @route   POST /api/users/send-notification
// @desc    إرسال إشعار لمستخدم معين (بالبريد/الاسم/المعرف)
// @access  Private/Admin
router.post('/send-notification', protect, adminOnly, async (req, res) => {
    try {
        const { title, body, identifier, identifierType = 'id', type = 'system', data = {} } = req.body;

        if (!title || !body) {
            return res.status(400).json({ success: false, message: 'العنوان والمحتوى مطلوبان' });
        }
        if (!identifier) {
            return res.status(400).json({ success: false, message: 'معرف المستخدم مطلوب (id أو email أو name)' });
        }

        // البحث عن المستخدم حسب النوع
        let user;
        switch (identifierType) {
            case 'email':
                user = await User.findOne({ email: identifier.toLowerCase().trim() });
                break;
            case 'name':
                user = await User.findOne({ name: { $regex: new RegExp(`^${identifier.trim()}$`, 'i') } });
                break;
            case 'id':
            default:
                user = await User.findById(identifier);
                break;
        }

        if (!user) {
            return res.status(404).json({
                success: false,
                message: `المستخدم غير موجود (${identifierType}: ${identifier})`
            });
        }

        // إرسال الإشعار
        const result = await pushNotificationService.sendNotificationToUser(
            user._id,
            { title, body },
            { type, ...data, fromAdmin: true, adminId: req.user._id.toString() },
            true
        );

        // إرسال عبر Socket.IO أيضاً
        if (global.io) {
            global.io.to(`user-${user._id}`).emit('notification', {
                title, body, type, data, fromAdmin: true
            });
        }

        res.json({
            success: true,
            message: `تم إرسال الإشعار لـ ${user.name} (${user.email})`,
            data: {
                user: { _id: user._id, name: user.name, email: user.email },
                result
            }
        });
    } catch (error) {
        console.error('خطأ في إرسال الإشعار:', error);
        res.status(500).json({ success: false, message: 'خطأ في السيرفر' });
    }
});

// ══════════════════════════════════════════════════════════
// @route   PUT /api/users/:id/suspend
// @desc    تعليق/إلغاء تعليق عضوية مستخدم — نظام تدريجي
// @access  Private/Admin
//
// Body Parameters:
//   duration: '24h' | '48h' | '3d' | '7d' | 'permanent' | 'auto' | 'unsuspend' | عدد أيام
//   reason:   سبب التعليق (اختياري)
//   notify:   إرسال إشعار للمستخدم (default: true)
//   source:   'admin' | 'auto' — مصدر التعليق (default: 'admin')
//
// 'auto' → يختار المستوى التالي تلقائياً بناءً على level الحالي
//   المستوى 0→1: 24h | 1→2: 48h | 2→3: 3d | 3→4: 7d | 4→5: دائم
//
// Response: يرجع بيانات المستخدم مع suspension (level, totalSuspensions, history)
// ══════════════════════════════════════════════════════════
router.put('/:id/suspend', protect, adminOnly, async (req, res) => {
    try {
        const { duration, reason, notify = true, source = 'admin' } = req.body;
        // duration: 'escalate', 'warn-1', 'warn-2', 'restrict-new', 'restrict-all',
        //           '24h', '48h', '3d', '7d', 'permanent', 'auto', 'unsuspend', 'unrestrict', عدد أيام

        // ✅ تصعيد موحّد — يرفع المستوى تلقائياً
        if (duration === 'escalate') {
            const { escalateUser } = require('../middleware/escalation');
            const result = await escalateUser(req.params.id, reason || 'إجراء إداري', 'admin');
            return res.json({
                success: result.success,
                message: result.message,
                data: result
            });
        }

        const user = await User.findById(req.params.id);
        if (!user) {
            return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
        }

        // ═══ تحذيرات ═══
        if (duration === 'warn-1' || duration === 'warn-2') {
            const warnLevel = duration === 'warn-1' ? 1 : 2;
            user.set('warnings.level', warnLevel);
            user.set('warnings.lastWarningAt', new Date());
            const history = user.warnings?.history || [];
            history.push({
                level: warnLevel,
                reason: reason || 'مخالفة سياسة الاستخدام',
                issuedBy: req.user._id,
                source: source,
                at: new Date()
            });
            user.set('warnings.history', history);
            await user.save();

            // إشعار المستخدم
            if (notify) {
                const isFirst = warnLevel === 1;
                const pushNotificationService = require('../services/pushNotificationService');
                await pushNotificationService.sendNotificationToUser(user._id, {
                    title: isFirst ? '⚠️ تنبيه أول' : '🔴 تنبيه أخير!',
                    body: isFirst
                        ? 'تم رصد مخالفة لسياسة الاستخدام. هذا تنبيه أول — يرجى الالتزام بالشروط.'
                        : 'تنبيه أخير — تم رصد مخالفة متكررة. المخالفة القادمة ستؤدي لتقييد حسابك تلقائياً.'
                }, { type: 'warning', warningLevel: warnLevel });

                if (global.io) {
                    global.io.to(`user:${user._id}`).emit('account-warning', {
                        level: warnLevel, reason: reason || 'مخالفة سياسة الاستخدام'
                    });
                }
            }

            return res.json({
                success: true,
                message: `تم إرسال تحذير ${warnLevel === 1 ? 'أول' : 'أخير'} لـ ${user.name}`,
                data: { user: { _id: user._id, name: user.name, warnings: user.warnings } }
            });
        }

        // ═══ تقييد المراسلة ═══
        if (duration === 'restrict-new' || duration === 'restrict-all') {
            const restrictLevel = duration === 'restrict-new' ? 'new_only' : 'all';
            const hours = restrictLevel === 'new_only' ? 24 : 48;
            const until = new Date(Date.now() + hours * 60 * 60 * 1000);

            user.set('restrictions.messagingRestricted', true);
            user.set('restrictions.messagingRestrictedUntil', until);
            user.set('restrictions.messagingRestrictedLevel', restrictLevel);
            user.set('restrictions.restrictionReason', reason || 'مخالفة سياسة الاستخدام');
            await user.save();

            if (notify) {
                const pushNotificationService = require('../services/pushNotificationService');
                const msg = restrictLevel === 'new_only'
                    ? 'تم تقييد حسابك مؤقتاً بسبب مخالفات. لا يمكنك بدء محادثات جديدة لمدة 24 ساعة.'
                    : 'تم تقييد حسابك بسبب مخالفات متكررة. لا يمكنك إرسال أي رسائل لمدة 48 ساعة.';

                await pushNotificationService.sendNotificationToUser(user._id, {
                    title: restrictLevel === 'new_only' ? '🔒 تقييد مؤقت' : '🔒 تقييد كامل',
                    body: msg
                }, { type: 'account_restricted', restrictLevel, until: until.toISOString() });

                if (global.io) {
                    global.io.to(`user:${user._id}`).emit('account-restricted', {
                        level: restrictLevel,
                        until: until.toISOString(),
                        reason: reason || 'مخالفة سياسة الاستخدام'
                    });
                }
            }

            return res.json({
                success: true,
                message: `تم تقييد ${user.name} — ${restrictLevel === 'new_only' ? 'محادثات جديدة' : 'كل الرسائل'} لمدة ${hours} ساعة`,
                data: { user: { _id: user._id, name: user.name, restrictions: user.restrictions } }
            });
        }

        // ═══ فك التقييد ═══
        if (duration === 'unrestrict') {
            user.set('restrictions.messagingRestricted', false);
            user.set('restrictions.messagingRestrictedUntil', null);
            user.set('restrictions.messagingRestrictedLevel', null);
            user.set('restrictions.restrictionReason', null);
            user.set('warnings.level', 0);
            user.isActive = true;
            await user.save();
            invalidateUsers();

            // ✅ Socket event — التطبيق يمسح شاشة التقييد فوراً
            if (global.io) {
                global.io.to(`user:${user._id}`).emit('account-unsuspended');
            }

            // ✅ إشعار push
            if (notify) {
                try {
                    const pushNotificationService = require('../services/pushNotificationService');
                    await pushNotificationService.sendNotificationToUser(user._id, {
                        title: '✅ تم فك التقييد',
                        body: 'تم فك التقييد عن حسابك. يمكنك الآن استخدام التطبيق بشكل طبيعي. شكراً لالتزامك.'
                    }, { type: 'account_unsuspended' });
                } catch(e) { console.error('Push error:', e.message); }
            }

            return res.json({
                success: true,
                message: `تم فك تقييد ${user.name} ومسح التحذيرات`
            });
        }

        // إلغاء التعليق
        if (duration === 'unsuspend') {
            user.set('suspension.isSuspended', false);
            user.set('suspension.suspendedUntil', null);
            user.set('suspension.reason', null);
            user.isActive = true;
            await user.save();
            invalidateUsers();

            if (notify) {
                await pushNotificationService.sendNotificationToUser(user._id, {
                    title: '✅ تم إلغاء تعليق حسابك',
                    body: 'يمكنك الآن استخدام التطبيق بشكل طبيعي. مرحباً بعودتك!'
                }, { type: 'account_unsuspended' });

                await Notification.create({
                    title: '✅ تم إلغاء تعليق حسابك',
                    body: 'يمكنك الآن استخدام التطبيق بشكل طبيعي. مرحباً بعودتك!',
                    type: 'system',
                    recipients: 'specific',
                    targetUsers: [user._id],
                    sender: req.user._id,
                    data: { type: 'account_unsuspended', userId: user._id.toString() },
                    status: 'sent',
                    sentAt: new Date()
                });
            }

            if (global.io) {
                global.io.to(`user:${user._id}`).emit('account-unsuspended');
            }

            return res.json({
                success: true,
                message: 'تم إلغاء تعليق المستخدم',
                data: { user }
            });
        }

        // ======= حساب المدة والمستوى =======

        // خريطة المستويات: level → { hours, duration code, text }
        const SUSPENSION_LEVELS = {
            1: { hours: 24, code: '24h', text: '24 ساعة' },
            2: { hours: 48, code: '48h', text: '48 ساعة' },
            3: { hours: 72, code: '3d', text: '3 أيام' },
            4: { hours: 168, code: '7d', text: '7 أيام' },
            5: { hours: null, code: 'permanent', text: 'دائم' }
        };

        let suspendedUntil = null;
        let durationText = '';
        let newLevel = user.suspension?.level || 0;

        if (duration === 'auto') {
            // ✅ تعليق تلقائي تدريجي — المستوى التالي
            newLevel = Math.min((user.suspension?.level || 0) + 1, 5);
            const levelInfo = SUSPENSION_LEVELS[newLevel];
            suspendedUntil = levelInfo.hours
                ? new Date(Date.now() + levelInfo.hours * 60 * 60 * 1000)
                : null;
            durationText = levelInfo.text;
        } else {
            // تعليق يدوي من الأدمن
            switch (duration) {
                case '24h':
                    suspendedUntil = new Date(Date.now() + 24 * 60 * 60 * 1000);
                    durationText = '24 ساعة';
                    newLevel = 1;
                    break;
                case '48h':
                    suspendedUntil = new Date(Date.now() + 48 * 60 * 60 * 1000);
                    durationText = '48 ساعة';
                    newLevel = 2;
                    break;
                case '3d':
                    suspendedUntil = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
                    durationText = '3 أيام';
                    newLevel = 3;
                    break;
                case '7d':
                    suspendedUntil = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
                    durationText = 'أسبوع';
                    newLevel = 4;
                    break;
                case 'permanent':
                    suspendedUntil = null;
                    durationText = 'دائم';
                    newLevel = 5;
                    break;
                default:
                    const days = parseInt(duration);
                    if (isNaN(days) || days <= 0) {
                        return res.status(400).json({
                            success: false,
                            message: 'المدة غير صحيحة. استخدم: 24h, 48h, 3d, 7d, permanent, auto, أو عدد أيام'
                        });
                    }
                    suspendedUntil = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
                    durationText = `${days} يوم`;
                    // تحديد المستوى بناءً على عدد الأيام
                    if (days <= 1) newLevel = 1;
                    else if (days <= 2) newLevel = 2;
                    else if (days <= 3) newLevel = 3;
                    else if (days <= 7) newLevel = 4;
                    else newLevel = 5;
                    break;
            }
        }

        // ✅ حفظ في السجل قبل التحديث
        const historyEntry = {
            level: newLevel,
            reason: reason || 'مخالفة شروط الاستخدام',
            suspendedAt: new Date(),
            suspendedUntil: suspendedUntil,
            suspendedBy: req.user?._id || null,
            source: source
        };

        const currentHistory = user.suspension?.history || [];
        const totalSuspensions = (user.suspension?.totalSuspensions || 0) + 1;

        user.set('suspension', {
            isSuspended: true,
            suspendedAt: new Date(),
            suspendedUntil: suspendedUntil,
            reason: reason || 'مخالفة شروط الاستخدام',
            suspendedBy: req.user?._id || null,
            level: newLevel,
            totalSuspensions: totalSuspensions,
            history: [...currentHistory, historyEntry]
        });
        user.isActive = false;
        await user.save();
        invalidateUsers();

        // ✅ إشعار المستخدم
        if (notify) {
            const suspendTitle = '⚠️ تم تعليق حسابك';
            const suspendBody = `تم تعليق حسابك لمدة ${durationText}.\nالسبب: ${reason || 'مخالفة شروط الاستخدام'}`;

            await pushNotificationService.sendNotificationToUser(user._id, {
                title: suspendTitle,
                body: suspendBody
            }, { type: 'account_suspended', suspendedUntil, reason, level: newLevel });

            await Notification.create({
                title: suspendTitle,
                body: suspendBody,
                type: 'system',
                recipients: 'specific',
                targetUsers: [user._id],
                sender: req.user?._id || null,
                data: {
                    type: 'account_suspended',
                    suspendedUntil, reason,
                    level: newLevel,
                    userId: user._id.toString()
                },
                status: 'sent',
                sentAt: new Date()
            });
        }

        // Socket.IO
        if (global.io) {
            global.io.to(`user-${user._id}`).emit('account-suspended', {
                suspendedUntil, reason, duration: durationText, level: newLevel
            });
        }

        res.json({
            success: true,
            message: `تم تعليق ${user.name} لمدة ${durationText} (المستوى ${newLevel})`,
            data: {
                user: {
                    _id: user._id,
                    name: user.name,
                    suspension: user.suspension
                }
            }
        });
    } catch (error) {
        console.error('خطأ في تعليق المستخدم:', error);
        res.status(500).json({ success: false, message: 'خطأ في السيرفر' });
    }
});

// ══════════════════════════════════════════════════════════
// @route   POST /api/users/:id/escalate
// @desc    تصعيد تلقائي — يرفع مستوى العقوبة تلقائياً
// @access  Private/Admin
router.post("/:id/escalate", protect, adminOnly, async (req, res) => {
    try {
        const user = await User.findById(req.params.id);
        if (!user) return res.status(404).json({ success: false, message: "المستخدم غير موجود" });

        const { reason = "تصعيد من لوحة التحكم" } = req.body;
        const currentLevel = user.suspension?.level || 0;
        const nextLevel = Math.min(currentLevel + 1, 5);

        // حساب المدة بناءً على المستوى
        const durations = { 1: 24, 2: 48, 3: 72, 4: 168, 5: null };
        const hours = durations[nextLevel];
        const suspendedUntil = hours ? new Date(Date.now() + hours * 60 * 60 * 1000) : null;

        user.isActive = nextLevel >= 3;
        if (nextLevel >= 3) user.isActive = false;
        user.set("suspension", {
            isSuspended: nextLevel >= 3,
            suspendedAt: nextLevel >= 3 ? new Date() : user.suspension?.suspendedAt,
            suspendedUntil,
            reason,
            level: nextLevel,
            totalSuspensions: (user.suspension?.totalSuspensions || 0) + (nextLevel >= 3 ? 1 : 0),
            history: [...(user.suspension?.history || []), { level: nextLevel, reason, suspendedAt: new Date(), source: "admin_escalate" }]
        });
        await user.save();

        const labels = { 1: "تحذير أول", 2: "تحذير أخير", 3: "تقييد 3 أيام", 4: "تعليق 7 أيام", 5: "حظر نهائي" };

        // إشعار push
        try {
            const pushNotificationService = require("../services/pushNotificationService");
            await pushNotificationService.sendNotificationToUser(user._id, {
                title: nextLevel <= 2 ? "⚠️ تحذير" : "🚫 إجراء على حسابك",
                body: labels[nextLevel] + ": " + reason
            }, { type: "account_warning" });
        } catch(e) {}

        // طرد عبر Socket لو معلّق
        if (nextLevel >= 3 && global.io) {
            global.io.to("user:" + user._id).emit("account-suspended", { suspendedUntil, reason, level: nextLevel });
        }

        res.json({ success: true, message: "تم التصعيد إلى المستوى " + nextLevel + ": " + labels[nextLevel], data: { level: nextLevel, label: labels[nextLevel] } });
    } catch (error) {
        console.error("Escalate error:", error);
        res.status(500).json({ success: false, message: "خطأ في الخادم" });
    }
});

// @route   POST /api/users/:id/ban-device
// @desc    حظر جهاز المستخدم — يمنع إنشاء حسابات جديدة من نفس الجهاز
// @access  Private/Admin
// ══════════════════════════════════════════════════════════
router.post('/:id/ban-device', protect, adminOnly, async (req, res) => {
    try {
        const BannedDevice = require('../models/BannedDevice');
        const user = await User.findById(req.params.id).select('+deviceFingerprint +keychainToken +deviceDetails');

        if (!user) {
            return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
        }

        const { reason = 'manual', details = '' } = req.body;

        if (!user.deviceFingerprint && !user.keychainToken) {
            return res.status(400).json({
                success: false,
                message: 'لا توجد بصمة جهاز لهذا المستخدم — لم يسجل دخول من التطبيق المحدّث'
            });
        }

        const bannedDevice = await BannedDevice.findOneAndUpdate(
            {
                $or: [
                    ...(user.deviceFingerprint ? [{ deviceFingerprint: user.deviceFingerprint }] : []),
                    ...(user.keychainToken ? [{ keychainToken: user.keychainToken }] : [])
                ]
            },
            {
                deviceFingerprint: user.deviceFingerprint,
                keychainToken: user.keychainToken,
                originalUserId: user._id,
                deviceInfo: user.deviceDetails || {},
                reason,
                reasonDetails: details,
                bannedBy: 'admin',
                adminId: req.user._id,
                isActive: true
            },
            { upsert: true, returnDocument: "after" }
        );

        // ✅ تعليق الحساب + طرد فوري عبر Socket
        user.isActive = false;
        user.set('suspension', {
            isSuspended: true,
            suspendedAt: new Date(),
            suspendedUntil: null, // دائم
            reason: details || 'حظر الجهاز',
            level: 5,
            totalSuspensions: (user.suspension?.totalSuspensions || 0) + 1,
            history: [
                ...(user.suspension?.history || []),
                { level: 5, reason: `حظر جهاز: ${details || reason}`, suspendedAt: new Date(), suspendedUntil: null, source: 'admin' }
            ]
        });
        await user.save();

        // ✅ طرد فوري — Socket event يطرده من التطبيق مباشرة
        if (global.io) {
            global.io.to(`user:${user._id}`).emit('account-suspended', {
                suspendedUntil: null,
                reason: 'تم حظر حسابك وجهازك بشكل نهائي',
                level: 5
            });
            // قطع الاتصال
            const sockets = await global.io.in(`user:${user._id}`).fetchSockets();
            sockets.forEach(s => s.disconnect(true));
        }

        // ✅ إشعار push
        try {
            const pushNotificationService = require('../services/pushNotificationService');
            await pushNotificationService.sendNotificationToUser(user._id, {
                title: '🚫 تم إيقاف حسابك نهائياً',
                body: 'تم إيقاف حسابك وحظر جهازك بشكل نهائي بسبب مخالفات لسياسة الاستخدام.'
            }, { type: 'account_suspended' });
        } catch(e) { console.error('Push error:', e.message); }

        invalidateUsers();

        res.json({
            success: true,
            message: `تم حظر جهاز ${user.name} + إيقاف الحساب + طرد فوري`,
            data: {
                bannedDevice: {
                    id: bannedDevice._id,
                    fingerprint: bannedDevice.deviceFingerprint?.substring(0, 12) + '...',
                    reason: bannedDevice.reason
                }
            }
        });
    } catch (error) {
        console.error('Ban device error:', error);
        res.status(500).json({ success: false, message: 'خطأ في الخادم' });
    }
});

// ══════════════════════════════════════════════════════════
// @route   GET /api/users/banned-devices
// @desc    قائمة الأجهزة المحظورة
// @access  Private/Admin
// ══════════════════════════════════════════════════════════
router.get('/banned-devices/list', protect, adminOnly, async (req, res) => {
    try {
        const BannedDevice = require('../models/BannedDevice');
        const { search = '', page = 1, limit = 50 } = req.query;
        const skip = (Number(page) - 1) * Number(limit);

        // ✅ بناء الفلتر مع البحث
        let filter = { isActive: true };
        let userIds = null;

        if (search && search.trim()) {
            const cleanSearch = search.trim().replace(/[^a-zA-Z0-9@.\-\s\u0600-\u06FF]/g, "");
            const searchRegex = new RegExp(cleanSearch, "i");
            // ابحث عن المستخدمين أولاً
            const matchedUsers = await User.find({
                $or: [
                    { name: searchRegex },
                    { email: searchRegex }
                ]
            }).select('_id').lean();
            userIds = matchedUsers.map(u => u._id);

            // فلتر: إما fingerprint يطابق أو user يطابق
            filter.$or = [
                { deviceFingerprint: searchRegex },
                { originalUserId: { $in: userIds } }
            ];
        }

        // ✅ إحصائيات (قبل pagination)
        const now = new Date();
        const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

        const [totalActive, today, thisWeek, thisMonth, totalCount] = await Promise.all([
            BannedDevice.countDocuments({ isActive: true }),
            BannedDevice.countDocuments({ isActive: true, createdAt: { $gte: dayAgo } }),
            BannedDevice.countDocuments({ isActive: true, createdAt: { $gte: weekAgo } }),
            BannedDevice.countDocuments({ isActive: true, createdAt: { $gte: monthAgo } }),
            BannedDevice.countDocuments(filter)
        ]);

        const devices = await BannedDevice.find(filter)
            .populate('originalUserId', 'name email profileImage halaId')
            .populate('adminId', 'name')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(Number(limit))
            .lean();

        res.json({
            success: true,
            data: {
                total: totalCount,
                page: Number(page),
                totalPages: Math.ceil(totalCount / Number(limit)),
                stats: {
                    totalActive,
                    today,
                    thisWeek,
                    thisMonth
                },
                devices: devices.map(d => ({
                    id: d._id,
                    fingerprint: d.deviceFingerprint?.substring(0, 16) + '...',
                    fullFingerprint: d.deviceFingerprint,
                    user: d.originalUserId,
                    reason: d.reason,
                    reasonDetails: d.reasonDetails,
                    bannedBy: d.bannedBy,
                    admin: d.adminId,
                    rejectedAttempts: d.rejectedAttempts?.length || 0,
                    lastAttempt: d.rejectedAttempts?.slice(-1)[0],
                    createdAt: d.createdAt
                }))
            }
        });
    } catch (error) {
        console.error('banned-devices/list error:', error);
        res.status(500).json({ success: false, message: 'خطأ في الخادم' });
    }
});

// ══════════════════════════════════════════════════════════
// @route   DELETE /api/users/:id/unban-device
// @desc    فك حظر جهاز المستخدم
// @access  Private/Admin
// ══════════════════════════════════════════════════════════
router.delete('/:id/unban-device', protect, adminOnly, async (req, res) => {
    try {
        const BannedDevice = require('../models/BannedDevice');
        const user = await User.findById(req.params.id).select('+deviceFingerprint +keychainToken');

        if (!user) {
            return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
        }

        const result = await BannedDevice.updateMany(
            {
                $or: [
                    { originalUserId: user._id },
                    ...(user.deviceFingerprint ? [{ deviceFingerprint: user.deviceFingerprint }] : []),
                    ...(user.keychainToken ? [{ keychainToken: user.keychainToken }] : [])
                ]
            },
            { $set: { isActive: false } }
        );

        // ✅ فك تعليق الحساب أيضاً
        user.isActive = true;
        user.set('suspension.isSuspended', false);
        user.set('suspension.suspendedUntil', null);
        user.set('suspension.reason', null);
        await user.save();
        invalidateUsers();

        // ✅ Socket event — التطبيق يمسح شاشة الحظر فوراً
        if (global.io) {
            global.io.to(`user:${user._id}`).emit('account-unsuspended');
        }

        // ✅ إشعار push
        try {
            const pushNotificationService = require('../services/pushNotificationService');
            await pushNotificationService.sendNotificationToUser(user._id, {
                title: '✅ تم فك الحظر',
                body: 'تم فك حظر حسابك وجهازك. يمكنك الآن استخدام التطبيق بشكل طبيعي. مرحباً بعودتك!'
            }, { type: 'account_unsuspended' });
        } catch(e) { console.error('Push error:', e.message); }

        res.json({
            success: true,
            message: `تم فك حظر جهاز ${user.name} + فك تعليق الحساب`,
            data: { unbannedCount: result.modifiedCount }
        });
    } catch (error) {
        console.error('Unban device error:', error);
        res.status(500).json({ success: false, message: 'خطأ في الخادم' });
    }
});

// ──────────────────────────────────────────────────────────
// @route   GET /api/users/:id/reports-count
// @desc    عدد البلاغات ضد مستخدم (من مستخدمين مختلفين)
// @access  Private/Admin
//
// Response:
//   uniqueReporters:      عدد المبلّغين الفريدين (pending/reviewing)
//   totalReports:         إجمالي البلاغات ضد هذا المستخدم
//   pendingReports:       البلاغات المعلّقة
//   autoSuspendThreshold: الحد المطلوب للتعليق التلقائي (5)
// ──────────────────────────────────────────────────────────
router.get('/:id/reports-count', protect, adminOnly, async (req, res) => {
    try {
        const userId = req.params.id;

        // عدد البلاغات من مستخدمين مختلفين (pending + reviewing)
        const uniqueReporters = await Report.distinct('reportedBy', {
            reportedUser: userId,
            status: { $in: ['pending', 'reviewing'] }
        });

        // إجمالي البلاغات
        const totalReports = await Report.countDocuments({ reportedUser: userId });

        // البلاغات المعلّقة
        const pendingReports = await Report.countDocuments({
            reportedUser: userId,
            status: { $in: ['pending', 'reviewing'] }
        });

        res.json({
            success: true,
            data: {
                uniqueReporters: uniqueReporters.length,
                totalReports,
                pendingReports,
                autoSuspendThreshold: 5
            }
        });
    } catch (error) {
        console.error('خطأ في جلب عدد البلاغات:', error);
        res.status(500).json({ success: false, message: 'خطأ في السيرفر' });
    }
});

// @route   PUT /api/users/:id/name-action
// @desc    إجراءات على اسم المستخدم (تعليق/حظر/إعادة)
// @access  Private/Admin
router.put('/:id/name-action', protect, adminOnly, async (req, res) => {
    try {
        const { action, reason, newName, notify = true } = req.body;
        // action: 'suspend' (يظهر نجوم), 'ban' (يظهر "اسم مخالف"), 'restore' (إعادة الأصلي), 'change' (تغيير)

        const user = await User.findById(req.params.id);
        if (!user) {
            return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
        }

        const originalName = user.nameStatus?.originalName || user.name;
        let displayName = user.name;
        let statusMessage = '';

        switch (action) {
            case 'suspend':
                // تعليق الاسم — يظهر نجوم
                displayName = '***';
                user.set('nameStatus', {
                    status: 'suspended',
                    originalName: originalName,
                    reason: reason || 'اسم غير لائق',
                    changedBy: req.user._id,
                    changedAt: new Date()
                });
                user.name = displayName;
                statusMessage = `تم تعليق اسم ${originalName} → يظهر ***`;
                break;

            case 'ban':
                // حظر الاسم — يظهر "اسم مخالف"
                displayName = 'اسم مخالف';
                user.set('nameStatus', {
                    status: 'banned',
                    originalName: originalName,
                    reason: reason || 'اسم مخالف',
                    changedBy: req.user._id,
                    changedAt: new Date()
                });
                user.name = displayName;
                statusMessage = `تم حظر اسم ${originalName} → يظهر "اسم مخالف"`;
                break;

            case 'restore':
                // إعادة الاسم الأصلي
                if (!user.nameStatus?.originalName) {
                    return res.status(400).json({ success: false, message: 'لا يوجد اسم أصلي محفوظ' });
                }
                user.name = user.nameStatus.originalName;
                user.set('nameStatus', {
                    status: 'normal',
                    originalName: null,
                    reason: null,
                    changedBy: req.user._id,
                    changedAt: new Date()
                });
                statusMessage = `تم إعادة الاسم الأصلي: ${user.name}`;
                break;

            case 'change':
                // تغيير الاسم يدوياً
                if (!newName || newName.trim().length < 2) {
                    return res.status(400).json({ success: false, message: 'الاسم الجديد مطلوب (حرفين على الأقل)' });
                }
                user.set('nameStatus', {
                    status: 'normal',
                    originalName: originalName,
                    reason: reason || 'تغيير من الإدارة',
                    changedBy: req.user._id,
                    changedAt: new Date()
                });
                user.name = newName.trim();
                statusMessage = `تم تغيير الاسم من ${originalName} إلى ${newName}`;
                break;

            default:
                return res.status(400).json({
                    success: false,
                    message: 'الإجراء غير صحيح. استخدم: suspend, ban, restore, أو change'
                });
        }

        // ✅ إضافة مخالفة تلقائية عند تعليق/حظر الاسم
        if (action === 'suspend' || action === 'ban') {
            const currentV = user.bannedWords?.violations || 0;
            user.set('bannedWords.violations', currentV + 1);
            user.set('bannedWords.lastViolationDate', new Date());
        }

        await user.save();
        invalidateUsers();

        // ✅ تسجيل Violation (سجل موحّد) عند تعليق/حظر الاسم
        if (action === 'suspend' || action === 'ban') {
            try {
                const Violation = require('../models/Violation');
                await Violation.create({
                    user: user._id,
                    type: 'name',
                    reason: reason || (action === 'ban' ? 'اسم مخالف' : 'اسم غير لائق'),
                    action: 'name_reset',
                    source: 'admin',
                    admin: req.user._id,
                    evidence: {
                        kind: 'name',
                        text: originalName // الاسم الأصلي كـ دليل
                    }
                });
            } catch (e) { console.error('violation (name) error:', e.message); }
        }

        // ✅ إشعار المستخدم (push + داخل التطبيق)
        if (notify) {
            const vCount = user.bannedWords?.violations || 0;
            let notifTitle, notifBody;
            switch (action) {
                case 'suspend':
                    notifTitle = '⚠️ تم تعليق الاسم تلقائياً';
                    notifBody = `اكتشف نظام الحماية اسماً مخالفاً لسياسة الاستخدام. تمّ تعليق الاسم تلقائياً (مخالفة ${vCount}). يُرجى تغيير الاسم من الإعدادات.`;
                    break;
                case 'ban':
                    notifTitle = '🚫 تم حظر الاسم تلقائياً';
                    notifBody = `رصد نظام الحماية اسماً مخالفاً لسياسة الاستخدام. مخالفة ${vCount} — يجب تغيير الاسم فوراً من الإعدادات لتجنّب إيقاف الحساب تلقائياً.`;
                    break;
                case 'restore':
                    notifTitle = '✅ تم إعادة الاسم الأصلي';
                    notifBody = 'تمّ إعادة الاسم الأصلي بنجاح. شكراً لالتزامك بسياسة الاستخدام.';
                    break;
                case 'change':
                    notifTitle = '📝 تم تحديث الاسم';
                    notifBody = `تمّ تحديث الاسم تلقائياً إلى "${newName}". يمكنك تعديله من الإعدادات.`;
                    break;
            }

            // Push notification
            await pushNotificationService.sendNotificationToUser(user._id, {
                title: notifTitle,
                body: notifBody
            }, { type: 'name_action', action, reason });

            // ✅ إشعار داخلي في التطبيق
            await Notification.create({
                title: notifTitle,
                body: notifBody,
                type: 'system',
                recipients: 'specific',
                targetUsers: [user._id],
                sender: req.user._id,
                data: { type: 'name_action', action, reason, userId: user._id.toString() },
                status: 'sent',
                sentAt: new Date()
            });
        }

        res.json({
            success: true,
            message: statusMessage,
            data: {
                _id: user._id,
                name: user.name,
                nameStatus: user.nameStatus
            }
        });
    } catch (error) {
        console.error('خطأ في إجراء الاسم:', error);
        res.status(500).json({ success: false, message: 'خطأ في السيرفر' });
    }
});

// @route   DELETE /api/users/:id/photo
// @desc    حذف صورة مستخدم + إشعاره
// @access  Private/Admin
router.delete('/:id/photo', protect, adminOnly, async (req, res) => {
    try {
        const { photoIndex, reason, notify = true } = req.body;
        // photoIndex: رقم الصورة في مصفوفة photos (0 = الأولى) أو 'profile' للصورة الرئيسية

        const user = await User.findById(req.params.id);
        if (!user) {
            return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
        }

        let removedUrl = '';
        // ✅ بدل الحذف النهائي: ننقل لمجلد /uploads/violations/<userId>/ كـ دليل
        const { movePhotoToViolations } = require('../utils/violationEvidence');
        let evidenceResult = { moved: false, publicUrl: null, originalPath: null };

        if (photoIndex === 'profile' || photoIndex === undefined) {
            // حذف الصورة الرئيسية
            removedUrl = user.profileImage || '';
            if (removedUrl) {
                evidenceResult = await movePhotoToViolations(user._id, removedUrl);
            }

            user.profileImage = null;
            user.markModified('profileImage');
        } else {
            // حذف صورة من المصفوفة
            const idx = parseInt(photoIndex);
            if (isNaN(idx) || idx < 0 || idx >= (user.photos?.length || 0)) {
                return res.status(400).json({ success: false, message: 'رقم الصورة غير صحيح' });
            }

            const photo = user.photos[idx];
            removedUrl = photo.original || '';

            // ننقل original كـ دليل + نحذف medium/thumbnail فقط
            if (photo.original) {
                evidenceResult = await movePhotoToViolations(user._id, photo.original);
            }
            // الأحجام الأصغر (medium/thumbnail) يمكن حذفها لأن original محفوظ كـ دليل
            const fs = require('fs');
            const path = require('path');
            ['medium', 'thumbnail'].forEach(size => {
                if (photo[size]) {
                    const filePath = path.join(__dirname, '..', photo[size]);
                    if (fs.existsSync(filePath)) {
                        try { fs.unlinkSync(filePath); } catch(e) { /* ignore */ }
                    }
                }
            });

            user.photos.splice(idx, 1);
        }

        // تسجيل عملية الحذف (التوافق مع الـ API القديم)
        if (!user.photoRemovals) user.photoRemovals = [];
        user.photoRemovals.push({
            photoUrl: removedUrl,
            reason: reason || 'صورة مخالفة',
            removedBy: req.user._id,
            removedAt: new Date()
        });

        // ✅ إضافة مخالفة تلقائية عند حذف صورة
        const currentV = user.bannedWords?.violations || 0;
        user.set('bannedWords.violations', currentV + 1);
        user.set('bannedWords.lastViolationDate', new Date());

        await user.save();
        invalidateUsers();

        // ✅ تسجيل في Violation (سجل المخالفات الموحّد) مع دليل
        // الصورة نُقلت أصلاً لمجلد /uploads/violations/ أعلاه، لذا نمرر النتائج مباشرة
        try {
            const Violation = require('../models/Violation');
            await Violation.create({
                user: user._id,
                type: 'photo',
                reason: reason || 'صورة مخالفة',
                action: 'photo_removed',
                source: 'admin',
                admin: req.user._id,
                evidence: {
                    kind: 'photo',
                    photoPath: evidenceResult.publicUrl || null,
                    originalPhotoPath: evidenceResult.originalPath || removedUrl || null,
                    metadata: { moved: evidenceResult.moved }
                }
            });
        } catch (e) { console.error('record violation (photo) error:', e.message); }

        // ✅ إشعار المستخدم (push + داخل التطبيق)
        if (notify) {
            const vCount = user.bannedWords?.violations || 0;
            const notifTitle = '⚠️ تم حذف الصورة تلقائياً';
            const notifBody = `اكتشف نظام الحماية صورة مخالفة لسياسة الاستخدام، وتمّت إزالتها تلقائياً. مخالفة ${vCount} — يُرجى رفع صورة مناسبة لتجنّب إيقاف الحساب.`;

            // Push notification
            await pushNotificationService.sendNotificationToUser(user._id, {
                title: notifTitle,
                body: notifBody
            }, { type: 'photo_removed', reason });

            // ✅ إشعار داخلي في التطبيق (يظهر في صفحة الإشعارات)
            await Notification.create({
                title: notifTitle,
                body: notifBody,
                type: 'system',
                recipients: 'specific',
                targetUsers: [user._id],
                sender: req.user._id,
                data: { type: 'photo_removed', reason, userId: user._id.toString() },
                status: 'sent',
                sentAt: new Date()
            });
        }

        res.json({
            success: true,
            message: `تم حذف صورة ${user.name} وإشعاره`,
            data: {
                _id: user._id,
                name: user.name,
                removedUrl,
                photoRemovals: user.photoRemovals
            }
        });
    } catch (error) {
        console.error('خطأ في حذف صورة المستخدم:', error);
        res.status(500).json({ success: false, message: 'خطأ في السيرفر' });
    }
});

// @route   POST /api/users/search
// @desc    بحث عن مستخدم بالبريد أو الاسم أو المعرف
// @access  Private/Admin
// @route   GET /api/users/search
// @desc    بحث سريع عن المستخدمين (للبحث العام)
// @access  Private/Admin
router.get('/search', protect, adminOnly, async (req, res) => {
    try {
        const { q } = req.query;

        if (!q || q.trim().length < 2) {
            return res.status(400).json({ success: false, message: 'أدخل كلمة بحث (حرفين على الأقل)' });
        }

        const query = q.trim();
        const cacheKey = `user_search_${query.toLowerCase()}`;
        const cached = get(cacheKey);
        if (cached) return res.json(cached);

        const users = await User.find({
            $or: [
                { name: { $regex: query, $options: 'i' } },
                { email: { $regex: query, $options: 'i' } },
                { halaId: { $regex: query, $options: 'i' } }
            ]
        })
        .select('name email profileImage halaId isOnline isActive isPremium verification.isVerified')
        .limit(20)
        .lean();

        const responseData = {
            success: true,
            count: users.length,
            data: { users }
        };

        set(cacheKey, responseData, 30);
        res.json(responseData);
    } catch (error) {
        console.error('خطأ في البحث:', error);
        res.status(500).json({ success: false, message: 'خطأ في السيرفر' });
    }
});

router.post('/search', protect, adminOnly, async (req, res) => {
    try {
        const { query, type = 'auto' } = req.body;

        if (!query || query.trim().length < 2) {
            return res.status(400).json({ success: false, message: 'أدخل كلمة بحث (حرفين على الأقل)' });
        }

        let users = [];
        const q = query.trim();

        if (type === 'id' || (type === 'auto' && q.match(/^[0-9a-fA-F]{24}$/))) {
            // بحث بالمعرف
            const user = await User.findById(q).select('-password');
            if (user) users = [user];
        } else if (type === 'email' || (type === 'auto' && q.includes('@'))) {
            // بحث بالبريد
            users = await User.find({
                email: { $regex: new RegExp(q, 'i') }
            }).select('-password').limit(10);
        } else {
            // بحث بالاسم
            users = await User.find({
                name: { $regex: new RegExp(q, 'i') }
            }).select('-password').limit(20);
        }

        res.json({
            success: true,
            count: users.length,
            data: { users }
        });
    } catch (error) {
        console.error('خطأ في البحث:', error);
        res.status(500).json({ success: false, message: 'خطأ في السيرفر' });
    }
});

// @route   PUT /api/users/:id/restrict
// @desc    منع مستخدم من تغيير الصورة/الاسم لفترة
// @access  Private/Admin
router.put('/:id/restrict', protect, adminOnly, async (req, res) => {
    try {
        const { type, duration, reason } = req.body;
        // type: 'photo' | 'name'
        // duration: '7d' | '30d' | '90d' | 'permanent'

        const user = await User.findById(req.params.id);
        if (!user) {
            return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
        }

        const durationMap = { '7d': 7, '30d': 30, '90d': 90 };
        const days = durationMap[duration];
        const until = days ? new Date(Date.now() + days * 24 * 60 * 60 * 1000) : null;

        const durationTextAr = duration === '7d' ? '7 أيام' : duration === '30d' ? '30 يوم' : duration === '90d' ? '90 يوم' : 'دائم';

        if (type === 'photo') {
            user.restrictions = user.restrictions || {};
            user.restrictions.photoBlocked = true;
            user.restrictions.photoBlockedUntil = until;
            user.restrictions.photoBlockedReason = reason || 'صورة مخالفة';
        } else if (type === 'name') {
            user.restrictions = user.restrictions || {};
            user.restrictions.nameBlocked = true;
            user.restrictions.nameBlockedUntil = until;
            user.restrictions.nameBlockedReason = reason || 'اسم مخالف';
        } else {
            return res.status(400).json({ success: false, message: 'نوع القيد غير صحيح (photo أو name)' });
        }

        // تسجيل كمخالفة
        if (!user.photoRemovals) user.photoRemovals = [];
        user.photoRemovals.push({
            reason: `قيد ${type === 'photo' ? 'صورة' : 'اسم'}: ${reason || 'مخالفة'} (${durationTextAr})`,
            removedBy: req.user._id,
            removedAt: new Date()
        });

        await user.save();

        // إشعار المستخدم
        const typeAr = type === 'photo' ? 'تغيير الصورة' : 'تغيير الاسم';
        const notifTitle = `⛔ تم منعك من ${typeAr}`;
        const notifBody = `تم منعك من ${typeAr} لمدة ${durationTextAr}.\nالسبب: ${reason || 'مخالفة سياسة الاستخدام'}`;

        const pushNotificationService = require('../services/pushNotificationService');
        await pushNotificationService.sendNotificationToUser(user._id, {
            title: notifTitle, body: notifBody
        }, { type: 'restriction', restrictionType: type, duration });

        const Notification = require('../models/Notification');
        await Notification.create({
            title: notifTitle, body: notifBody,
            type: 'system', recipients: 'specific',
            targetUsers: [user._id], sender: req.user._id,
            data: { type: 'restriction', restrictionType: type },
            status: 'sent', sentAt: new Date()
        });

        res.json({
            success: true,
            message: `تم منع ${user.name} من ${typeAr} لمدة ${durationTextAr}`,
            data: { restrictions: user.restrictions }
        });
    } catch (error) {
        console.error('Restrict error:', error);
        res.status(500).json({ success: false, message: 'خطأ في السيرفر' });
    }
});

// ============================================================
// ============ Violations & Official Warnings ================
// ============================================================

const Violation = require('../models/Violation');
const OfficialWarning = require('../models/OfficialWarning');
const { getAllTemplates, getTemplate } = require('../config/warningTemplates');
const { recordViolation, sendOfficialWarning } = require('../utils/violationManager');

// @route   GET /api/users/tools/warning-templates
// @desc    الحصول على قائمة قوالب التنبيهات
// @access  Private/Admin
// ملاحظة: المسار مسارين لتجنب التضارب مع /:id (one segment)
router.get('/tools/warning-templates', protect, adminOnly, async (req, res) => {
    try {
        return res.json({ success: true, data: { templates: getAllTemplates() } });
    } catch (error) {
        console.error('warning-templates error:', error);
        res.status(500).json({ success: false, message: 'خطأ في السيرفر' });
    }
});

// @route   GET /api/users/:id/violations
// @desc    سجل مخالفات المستخدم (مع أدلة)
// @access  Private/Admin
router.get('/:id/violations', protect, adminOnly, async (req, res) => {
    try {
        const { limit = 50, skip = 0, type } = req.query;
        const filter = { user: req.params.id };
        if (type) filter.type = type;

        const [items, total] = await Promise.all([
            Violation.find(filter)
                .sort({ createdAt: -1 })
                .skip(parseInt(skip))
                .limit(Math.min(parseInt(limit), 200))
                .populate('admin', 'name email')
                .populate('officialWarning', 'title body severity status acknowledgedAt')
                .lean(),
            Violation.countDocuments(filter)
        ]);

        res.json({
            success: true,
            data: {
                violations: items,
                total,
                counts: {
                    total,
                    byType: await Violation.aggregate([
                        { $match: { user: require('mongoose').Types.ObjectId.createFromHexString(req.params.id) } },
                        { $group: { _id: '$type', count: { $sum: 1 } } }
                    ])
                }
            }
        });
    } catch (error) {
        console.error('get violations error:', error);
        res.status(500).json({ success: false, message: 'خطأ في السيرفر' });
    }
});

// @route   GET /api/users/:id/warnings
// @desc    سجل التنبيهات الرسمية المُرسلة للمستخدم
// @access  Private/Admin
router.get('/:id/warnings', protect, adminOnly, async (req, res) => {
    try {
        const { limit = 50, skip = 0 } = req.query;
        const filter = { user: req.params.id };

        const [items, total] = await Promise.all([
            OfficialWarning.find(filter)
                .sort({ sentAt: -1 })
                .skip(parseInt(skip))
                .limit(Math.min(parseInt(limit), 200))
                .populate('sentBy', 'name email')
                .lean(),
            OfficialWarning.countDocuments(filter)
        ]);

        res.json({ success: true, data: { warnings: items, total } });
    } catch (error) {
        console.error('get warnings error:', error);
        res.status(500).json({ success: false, message: 'خطأ في السيرفر' });
    }
});

// @route   POST /api/users/:id/official-warning
// @desc    إرسال تنبيه رسمي للمستخدم (قالب أو مخصص)
// @access  Private/Admin
// Body: { templateKey, customTitle?, customBody?, isBlocking?, recordViolation? }
router.post('/:id/official-warning', protect, adminOnly, async (req, res) => {
    try {
        const { templateKey, customTitle, customBody, isBlocking, recordViolation: shouldRecordViolation = true } = req.body;

        if (!templateKey) {
            return res.status(400).json({ success: false, message: 'templateKey مطلوب' });
        }
        const template = getTemplate(templateKey);
        if (!template) {
            return res.status(400).json({ success: false, message: 'قالب غير موجود' });
        }

        const user = await User.findById(req.params.id).select('_id name');
        if (!user) {
            return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
        }

        // تسجيل مخالفة موازية (اختياري)
        let violationId = null;
        if (shouldRecordViolation && templateKey !== 'custom') {
            const typeMap = {
                photo_violation: 'photo',
                name_violation: 'name',
                bio_violation: 'bio',
                inappropriate_content: 'inappropriate',
                disruptive_behavior: 'behavior',
                final_warning: 'other'
            };
            try {
                const v = await recordViolation({
                    userId: user._id,
                    type: typeMap[templateKey] || 'other',
                    reason: templateKey === 'custom' ? customTitle : template.label,
                    action: 'warning',
                    source: 'admin',
                    adminId: req.user._id,
                    evidence: { kind: 'text', text: customBody || template.body }
                });
                violationId = v._id;
            } catch (e) {
                console.error('recordViolation inside official-warning failed:', e.message);
            }
        }

        const warning = await sendOfficialWarning({
            userId: user._id,
            templateKey,
            customTitle,
            customBody,
            sentBy: req.user._id,
            isBlocking,
            violationId
        });

        res.json({
            success: true,
            message: `تم إرسال تنبيه رسمي إلى ${user.name}`,
            data: { warning }
        });
    } catch (error) {
        console.error('send official-warning error:', error);
        res.status(500).json({ success: false, message: error.message || 'خطأ في السيرفر' });
    }
});

// @route   PUT /api/users/warnings/:warningId/dismiss
// @desc    الأدمن يُخفي تنبيه (يلغي حالته النشطة)
// @access  Private/Admin
router.put('/warnings/:warningId/dismiss', protect, adminOnly, async (req, res) => {
    try {
        const w = await OfficialWarning.findByIdAndUpdate(
            req.params.warningId,
            { status: 'dismissed', dismissedAt: new Date() },
            { new: true }
        );
        if (!w) return res.status(404).json({ success: false, message: 'تنبيه غير موجود' });

        // Socket.IO — إبلاغ التطبيق بإغلاق الـ modal فوراً
        try {
            if (global.io) global.io.to(`user:${w.user}`).emit('official-warning-dismissed', { _id: w._id });
        } catch (e) { /* ignore */ }

        res.json({ success: true, data: { warning: w } });
    } catch (error) {
        console.error('dismiss warning error:', error);
        res.status(500).json({ success: false, message: 'خطأ في السيرفر' });
    }
});

// @route   GET /api/users/:id/related-accounts
// @desc    حسابات مرتبطة بالمستخدم (بصمة/keychain/IP/email similar)
// @access  Private/Admin
router.get('/:id/related-accounts', protect, adminOnly, async (req, res) => {
    try {
        const mainUser = await User.findById(req.params.id)
            .select('+deviceFingerprint +keychainToken +lastIP name email halaId')
            .lean();

        if (!mainUser) {
            return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
        }

        const results = {
            byDeviceFingerprint: [],
            byKeychainToken: [],
            byIP: [],
            byBannedDevice: []
        };

        // 1) نفس deviceFingerprint
        if (mainUser.deviceFingerprint) {
            results.byDeviceFingerprint = await User.find({
                _id: { $ne: mainUser._id },
                deviceFingerprint: mainUser.deviceFingerprint
            })
            .select('+deviceFingerprint name email profileImage createdAt lastLogin isActive halaId suspension.isSuspended')
            .limit(50)
            .lean();
        }

        // 2) نفس keychainToken
        if (mainUser.keychainToken) {
            results.byKeychainToken = await User.find({
                _id: { $ne: mainUser._id },
                keychainToken: mainUser.keychainToken
            })
            .select('+keychainToken name email profileImage createdAt lastLogin isActive halaId suspension.isSuspended')
            .limit(50)
            .lean();
        }

        // 3) نفس lastIP
        if (mainUser.lastIP) {
            results.byIP = await User.find({
                _id: { $ne: mainUser._id },
                lastIP: mainUser.lastIP
            })
            .select('+lastIP name email profileImage createdAt lastLogin isActive halaId suspension.isSuspended')
            .limit(30)
            .lean();
        }

        // 4) الأجهزة المحظورة بنفس البصمة
        const BannedDevice = require('../models/BannedDevice');
        if (mainUser.deviceFingerprint || mainUser.keychainToken) {
            const bannedMatch = await BannedDevice.find({
                isActive: true,
                $or: [
                    ...(mainUser.deviceFingerprint ? [{ deviceFingerprint: mainUser.deviceFingerprint }] : []),
                    ...(mainUser.keychainToken ? [{ keychainToken: mainUser.keychainToken }] : [])
                ]
            })
            .populate('originalUserId', 'name email halaId profileImage')
            .lean();
            results.byBannedDevice = bannedMatch;
        }

        // dedupe: إذا نفس المستخدم ظهر في byDeviceFingerprint و byKeychainToken
        const seen = new Set();
        const dedupe = (arr) => arr.filter(u => {
            const id = String(u._id);
            if (seen.has(id)) return false;
            seen.add(id);
            return true;
        });

        const uniqueRelated = dedupe([
            ...results.byDeviceFingerprint,
            ...results.byKeychainToken
        ]);

        res.json({
            success: true,
            data: {
                mainUserId: mainUser._id,
                hasFingerprint: !!mainUser.deviceFingerprint,
                hasKeychain: !!mainUser.keychainToken,
                hasIP: !!mainUser.lastIP,
                counts: {
                    byFingerprint: results.byDeviceFingerprint.length,
                    byKeychain: results.byKeychainToken.length,
                    byIP: results.byIP.length,
                    byBannedDevice: results.byBannedDevice.length,
                    uniqueRelated: uniqueRelated.length
                },
                uniqueRelated,
                byDeviceFingerprint: results.byDeviceFingerprint,
                byKeychainToken: results.byKeychainToken,
                byIP: results.byIP,
                byBannedDevice: results.byBannedDevice
            }
        });
    } catch (error) {
        console.error('related-accounts error:', error);
        res.status(500).json({ success: false, message: 'خطأ في السيرفر' });
    }
});

// @route   GET /api/users/violations/recent
// @desc    آخر المخالفات في النظام (مراقبة إدارية)
// @access  Private/Admin
router.get('/violations/recent', protect, adminOnly, async (req, res) => {
    try {
        const { limit = 50, type } = req.query;
        const filter = {};
        if (type) filter.type = type;

        const items = await Violation.find(filter)
            .sort({ createdAt: -1 })
            .limit(Math.min(parseInt(limit), 200))
            .populate('user', 'name email profileImage halaId')
            .populate('admin', 'name')
            .lean();

        res.json({ success: true, data: { violations: items } });
    } catch (error) {
        console.error('recent violations error:', error);
        res.status(500).json({ success: false, message: 'خطأ في السيرفر' });
    }
});

// @route   DELETE /api/users/:id/conversations/bulk
// @desc    إخفاء جميع محادثات المستخدم من تطبيقه (hiddenFor — تبقى في DB للمراجعة)
// @access  Private/Admin
router.delete('/:id/conversations/bulk', protect, adminOnly, async (req, res) => {
    try {
        const Conversation = require('../models/Conversation');
        const userId = req.params.id;
        const mongoose = require('mongoose');
        const userObjectId = new mongoose.Types.ObjectId(userId);

        // جلب كل المحادثات التي يشارك فيها (حتى لو كانت مخفية مسبقاً — نعيد الإخفاء)
        const conversations = await Conversation.find({ participants: userId }).select('_id participants');
        const convIds = conversations.map(c => c._id);

        if (convIds.length === 0) {
            return res.json({ success: true, message: 'لا توجد محادثات للإخفاء', data: { hiddenConversations: 0 } });
        }

        // ✅ إضافة userId إلى hiddenFor (بدل الحذف الفعلي)
        // نحذف أولاً أي entry قديم لنفس المستخدم ثم نُضيف entry جديد
        await Conversation.updateMany(
            { _id: { $in: convIds } },
            { $pull: { hiddenFor: { user: userObjectId } } }
        );
        const result = await Conversation.updateMany(
            { _id: { $in: convIds } },
            {
                $push: {
                    hiddenFor: {
                        user: userObjectId,
                        hiddenAt: new Date(),
                        reason: 'admin_bulk_hide'
                    }
                }
            }
        );

        // Socket.IO — إبلاغ المستخدم فوراً بإخفاء محادثاته
        if (global.io) {
            convIds.forEach(cId => {
                global.io.to(`user:${userId}`).emit('conversation-deleted', {
                    conversationId: String(cId),
                    by: 'admin',
                    action: 'hidden'
                });
            });
        }

        // إشعار للمستخدم
        try {
            const pushService = require('../services/pushNotificationService');
            await pushService.sendNotificationToUser(userId, {
                title: '🗑️ تم إخفاء محادثاتك تلقائياً',
                body: `اكتشف نظام الحماية التلقائي مخالفات في محادثاتك (${convIds.length} محادثة)، وتمّ إخفاؤها من حسابك. يُرجى الالتزام بسياسة الاستخدام.`
            }, { type: 'conversations_wiped', hiddenCount: convIds.length });
        } catch (e) { console.error('notify user hide error:', e.message); }

        res.json({
            success: true,
            message: `تمّ إخفاء ${convIds.length} محادثة من تطبيق المستخدم (محفوظة للمراجعة)`,
            data: {
                hiddenConversations: convIds.length,
                deletedConversations: convIds.length  // للتوافق مع UI القديم
            }
        });
    } catch (error) {
        console.error('bulk hide conversations error:', error);
        res.status(500).json({ success: false, message: 'خطأ في السيرفر' });
    }
});

// @route   PUT /api/users/:id/conversations/unhide-all
// @desc    إلغاء إخفاء جميع محادثات المستخدم (إرجاعها للتطبيق)
// @access  Private/Admin
router.put('/:id/conversations/unhide-all', protect, adminOnly, async (req, res) => {
    try {
        const Conversation = require('../models/Conversation');
        const mongoose = require('mongoose');
        const userObjectId = new mongoose.Types.ObjectId(req.params.id);

        const result = await Conversation.updateMany(
            { 'hiddenFor.user': userObjectId },
            { $pull: { hiddenFor: { user: userObjectId } } }
        );

        // Socket.IO — إبلاغ بإعادة الظهور
        if (global.io) {
            global.io.to(`user:${req.params.id}`).emit('conversations-restored', {
                count: result.modifiedCount
            });
        }

        res.json({
            success: true,
            message: `تم إظهار ${result.modifiedCount} محادثة`,
            data: { restoredConversations: result.modifiedCount }
        });
    } catch (error) {
        console.error('unhide all error:', error);
        res.status(500).json({ success: false, message: 'خطأ في السيرفر' });
    }
});

// @route   PUT /api/users/:id/conversations/censor
// @desc    تشفير جميع رسائل المستخدم (استبدال النص بـ نجوم *)
//          الرسائل تبقى موجودة لكن المحتوى مخفي — يظهر التأثير فوراً في التطبيق
// @access  Private/Admin
router.put('/:id/conversations/censor', protect, adminOnly, async (req, res) => {
    try {
        const Conversation = require('../models/Conversation');
        const Message = require('../models/Message');
        const userId = req.params.id;

        const { scope = 'all' } = req.body; // 'all' = كل محادثاته، 'sent' = رسائله فقط
        const CENSOR_TEXT = '***';

        // جلب كل المحادثات
        const conversations = await Conversation.find({ participants: userId }).select('_id participants');
        const convIds = conversations.map(c => c._id);

        if (convIds.length === 0) {
            return res.json({ success: true, message: 'لا توجد محادثات', data: { censoredMessages: 0 } });
        }

        // بناء الـ filter حسب scope
        const messageFilter = { conversation: { $in: convIds }, type: 'text' };
        if (scope === 'sent') {
            messageFilter.sender = userId;  // فقط الرسائل التي أرسلها هذا المستخدم
        }

        // تشفير الرسائل (نُحتفظ بـ content الأصلي في metadata للمرجع الإداري)
        const result = await Message.updateMany(
            messageFilter,
            {
                $set: {
                    content: CENSOR_TEXT,
                    isCensored: true,
                    censoredAt: new Date(),
                    censoredBy: req.user._id
                }
            }
        );

        // Socket.IO — إبلاغ المشاركين فوراً
        if (global.io) {
            conversations.forEach(conv => {
                const cId = String(conv._id);
                (conv.participants || []).forEach(pid => {
                    global.io.to(`user:${pid}`).emit('messages-censored', {
                        conversationId: cId,
                        scope,
                        targetUserId: String(userId)
                    });
                });
                global.io.to(`conversation-${cId}`).emit('messages-censored', {
                    conversationId: cId,
                    scope,
                    targetUserId: String(userId)
                });
            });
        }

        // إشعار للمستخدم نفسه
        try {
            const pushService = require('../services/pushNotificationService');
            const notifBody = scope === 'sent'
                ? `اكتشف نظام الحماية التلقائي وجود محتوى غير لائق في رسائلك. تمّ إخفاء ${result.modifiedCount} رسالة تلقائياً.`
                : `اكتشف نظام الحماية التلقائي مخالفات في محادثاتك. تمّ إخفاء ${result.modifiedCount} رسالة تلقائياً.`;
            await pushService.sendNotificationToUser(userId, {
                title: '⭐ تم إخفاء محتوى الرسائل',
                body: notifBody
            }, { type: 'conversations_censored', scope, censoredCount: result.modifiedCount });
        } catch (e) { /* ignore */ }

        res.json({
            success: true,
            message: `تم تشفير ${result.modifiedCount} رسالة (${scope === 'sent' ? 'المرسلة فقط' : 'كل المحادثات'})`,
            data: {
                censoredMessages: result.modifiedCount,
                scope
            }
        });
    } catch (error) {
        console.error('censor messages error:', error);
        res.status(500).json({ success: false, message: 'خطأ في السيرفر' });
    }
});

// @route   DELETE /api/users/:id/messages/:messageId
// @desc    حذف رسالة واحدة من محادثات المستخدم (admin)
// @access  Private/Admin
router.delete('/:id/messages/:messageId', protect, adminOnly, async (req, res) => {
    try {
        const Message = require('../models/Message');
        const msg = await Message.findByIdAndUpdate(
            req.params.messageId,
            { isDeleted: true, deletedAt: new Date(), deletedBy: req.user._id },
            { new: true }
        );
        if (!msg) return res.status(404).json({ success: false, message: 'الرسالة غير موجودة' });

        // Socket.IO
        if (global.io && msg.conversation) {
            global.io.to(`conversation-${msg.conversation}`).emit('message-deleted', {
                messageId: String(msg._id),
                conversationId: String(msg.conversation),
                by: 'admin'
            });
        }

        res.json({ success: true, message: 'تم حذف الرسالة', data: { message: msg } });
    } catch (error) {
        console.error('delete message error:', error);
        res.status(500).json({ success: false, message: 'خطأ في السيرفر' });
    }
});

// @route   GET /api/users/:id/violation-evidence/:filename
// @desc    تقديم صورة دليل مخالفة (admin فقط)
// @access  Private/Admin
router.get('/:id/violation-evidence/:filename', protect, adminOnly, async (req, res) => {
    try {
        const path = require('path');
        const fs = require('fs');
        const { id, filename } = req.params;

        // حماية من path traversal
        if (filename.includes('..') || filename.includes('/')) {
            return res.status(400).json({ success: false, message: 'اسم ملف غير صالح' });
        }

        const filePath = path.join(__dirname, '..', 'uploads', 'violations', id, filename);
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ success: false, message: 'الدليل غير موجود' });
        }

        res.sendFile(filePath);
    } catch (error) {
        console.error('violation evidence error:', error);
        res.status(500).json({ success: false, message: 'خطأ في السيرفر' });
    }
});

module.exports = router;
