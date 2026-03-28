// HalaChat Dashboard - Users Routes
// المسارات الخاصة بإدارة المستخدمين (للأدمن فقط)

const express = require('express');
const router = express.Router();
const User = require('../models/User');
const { protect, adminOnly } = require('../middleware/auth');
const { get, set, CACHE_KEYS, CACHE_TTL, invalidateUsers } = require('../utils/cache');

// @route   GET /api/users
// @desc    الحصول على جميع المستخدمين
// @access  Private/Admin
router.get('/', protect, adminOnly, async (req, res) => {
    try {
        // التحقق من الـ Cache
        const cachedUsers = get(CACHE_KEYS.ALL_USERS);
        if (cachedUsers) {
            console.log('📦 Users من الـ Cache');
            return res.status(200).json(cachedUsers);
        }

        const users = await User.find({}).select('-password').sort({ createdAt: -1 });

        const responseData = {
            success: true,
            count: users.length,
            data: {
                users
            }
        };

        // تخزين في الـ Cache
        set(CACHE_KEYS.ALL_USERS, responseData, CACHE_TTL.ALL_USERS);

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

        const user = await User.findById(req.params.id).select('-password');

        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'المستخدم غير موجود'
            });
        }

        // إحصائيات المستخدم
        const userConversations = await Conversation.find({
            participants: req.params.id
        }).populate('lastMessage');

        const userMessages = await Message.find({
            sender: req.params.id,
            isDeleted: false
        });

        // حساب الإحصائيات
        const stats = {
            totalConversations: userConversations.length,
            activeConversations: userConversations.filter(c => c.isActive).length,
            totalMessagesSent: userMessages.length,
            lastActivity: user.lastLogin || user.updatedAt
        };

        res.status(200).json({
            success: true,
            data: {
                user,
                stats,
                conversations: userConversations,
                recentMessages: userMessages.slice(0, 10)
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

        // إلغاء الحظر التلقائي إذا تم تقليل المخالفات
        if (violations < 3 && user.bannedWords?.isBanned) {
            user.set('bannedWords.isBanned', false);
            user.set('bannedWords.bannedAt', null);
            user.set('bannedWords.banReason', null);
            user.isActive = true;
        }

        // حظر تلقائي إذا تم زيادة المخالفات لـ 3+
        if (violations >= 3 && !user.bannedWords?.isBanned) {
            user.set('bannedWords.isBanned', true);
            user.set('bannedWords.bannedAt', new Date());
            user.set('bannedWords.banReason', 'حظر تلقائي - تحديد مخالفات من الأدمن');
            user.isActive = false;
        }

        await user.save();
        invalidateUsers();

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

// @route   PUT /api/users/:id/suspend
// @desc    تعليق/إلغاء تعليق عضوية مستخدم لمدة معينة
// @access  Private/Admin
router.put('/:id/suspend', protect, adminOnly, async (req, res) => {
    try {
        const { duration, reason, notify = true } = req.body;
        // duration: '24h', '48h', '7d', أو عدد أيام (مثل 14)، أو 'permanent'، أو 'unsuspend'

        const user = await User.findById(req.params.id);
        if (!user) {
            return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
        }

        // إلغاء التعليق
        if (duration === 'unsuspend') {
            user.set('suspension.isSuspended', false);
            user.set('suspension.suspendedUntil', null);
            user.set('suspension.reason', null);
            user.isActive = true;
            await user.save();
            invalidateUsers();

            // إشعار المستخدم
            if (notify) {
                await pushNotificationService.sendNotificationToUser(user._id, {
                    title: '✅ تم إلغاء تعليق حسابك',
                    body: 'يمكنك الآن استخدام التطبيق بشكل طبيعي'
                }, { type: 'account_unsuspended' });
            }

            return res.json({
                success: true,
                message: 'تم إلغاء تعليق المستخدم',
                data: { user }
            });
        }

        // حساب تاريخ انتهاء التعليق
        let suspendedUntil = null;
        let durationText = '';

        switch (duration) {
            case '24h':
                suspendedUntil = new Date(Date.now() + 24 * 60 * 60 * 1000);
                durationText = '24 ساعة';
                break;
            case '48h':
                suspendedUntil = new Date(Date.now() + 48 * 60 * 60 * 1000);
                durationText = '48 ساعة';
                break;
            case '7d':
                suspendedUntil = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
                durationText = 'أسبوع';
                break;
            case 'permanent':
                suspendedUntil = null; // دائم
                durationText = 'دائم';
                break;
            default:
                // عدد أيام مخصص
                const days = parseInt(duration);
                if (isNaN(days) || days <= 0) {
                    return res.status(400).json({
                        success: false,
                        message: 'المدة غير صحيحة. استخدم: 24h, 48h, 7d, permanent, أو عدد أيام'
                    });
                }
                suspendedUntil = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
                durationText = `${days} يوم`;
                break;
        }

        user.set('suspension', {
            isSuspended: true,
            suspendedAt: new Date(),
            suspendedUntil: suspendedUntil,
            reason: reason || 'تعليق من الإدارة',
            suspendedBy: req.user._id
        });
        user.isActive = false;
        await user.save();
        invalidateUsers();

        // إشعار المستخدم
        if (notify) {
            await pushNotificationService.sendNotificationToUser(user._id, {
                title: '⚠️ تم تعليق حسابك',
                body: `تم تعليق حسابك لمدة ${durationText}. السبب: ${reason || 'مخالفة شروط الاستخدام'}`
            }, { type: 'account_suspended', suspendedUntil, reason });
        }

        // Socket.IO
        if (global.io) {
            global.io.to(`user-${user._id}`).emit('account-suspended', {
                suspendedUntil, reason, duration: durationText
            });
        }

        res.json({
            success: true,
            message: `تم تعليق ${user.name} لمدة ${durationText}`,
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

// @route   PUT /api/users/:id/name-action
// @desc    إجراءات على اسم المستخدم (تعليق/حظر/إعادة)
// @access  Private/Admin
router.put('/:id/name-action', protect, adminOnly, async (req, res) => {
    try {
        const { action, reason, newName, notify = true } = req.body;
        // action: 'suspend' (يظهر نجوم), 'ban' (يظهر "اسم محظور"), 'restore' (إعادة الأصلي), 'change' (تغيير)

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
                // حظر الاسم — يظهر "اسم محظور"
                displayName = 'اسم محظور';
                user.set('nameStatus', {
                    status: 'banned',
                    originalName: originalName,
                    reason: reason || 'اسم محظور',
                    changedBy: req.user._id,
                    changedAt: new Date()
                });
                user.name = displayName;
                statusMessage = `تم حظر اسم ${originalName} → يظهر "اسم محظور"`;
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

        await user.save();
        invalidateUsers();

        // إشعار المستخدم
        if (notify) {
            let notifTitle, notifBody;
            switch (action) {
                case 'suspend':
                    notifTitle = '⚠️ تم تعليق اسمك';
                    notifBody = `تم تعليق اسمك بسبب: ${reason || 'اسم غير لائق'}. يرجى تغيير اسمك.`;
                    break;
                case 'ban':
                    notifTitle = '🚫 تم حظر اسمك';
                    notifBody = `تم حظر اسمك بسبب: ${reason || 'مخالفة'}. يرجى التواصل مع الإدارة.`;
                    break;
                case 'restore':
                    notifTitle = '✅ تم إعادة اسمك';
                    notifBody = 'تم إعادة اسمك الأصلي بنجاح.';
                    break;
                case 'change':
                    notifTitle = '📝 تم تغيير اسمك';
                    notifBody = `تم تغيير اسمك بواسطة الإدارة إلى "${newName}".`;
                    break;
            }
            await pushNotificationService.sendNotificationToUser(user._id, {
                title: notifTitle,
                body: notifBody
            }, { type: 'name_action', action, reason });
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
        const fs = require('fs');
        const path = require('path');

        if (photoIndex === 'profile' || photoIndex === undefined) {
            // حذف الصورة الرئيسية
            removedUrl = user.profileImage || '';

            // حذف الملف من السيرفر
            if (removedUrl) {
                const filePath = path.join(__dirname, '..', 'public', removedUrl);
                if (fs.existsSync(filePath)) {
                    fs.unlinkSync(filePath);
                }
            }

            user.profileImage = null;
        } else {
            // حذف صورة من المصفوفة
            const idx = parseInt(photoIndex);
            if (isNaN(idx) || idx < 0 || idx >= (user.photos?.length || 0)) {
                return res.status(400).json({ success: false, message: 'رقم الصورة غير صحيح' });
            }

            const photo = user.photos[idx];
            removedUrl = photo.original || '';

            // حذف الملفات من السيرفر
            ['original', 'medium', 'thumbnail'].forEach(size => {
                if (photo[size]) {
                    const filePath = path.join(__dirname, '..', 'public', photo[size]);
                    if (fs.existsSync(filePath)) {
                        fs.unlinkSync(filePath);
                    }
                }
            });

            user.photos.splice(idx, 1);
        }

        // تسجيل عملية الحذف
        if (!user.photoRemovals) user.photoRemovals = [];
        user.photoRemovals.push({
            photoUrl: removedUrl,
            reason: reason || 'صورة مخالفة',
            removedBy: req.user._id,
            removedAt: new Date()
        });

        await user.save();
        invalidateUsers();

        // إشعار المستخدم
        if (notify) {
            await pushNotificationService.sendNotificationToUser(user._id, {
                title: '🚫 تم حذف صورتك',
                body: `تم حذف صورتك بسبب: ${reason || 'مخالفة سياسة الاستخدام'}. يرجى رفع صورة مناسبة.`
            }, { type: 'photo_removed', reason });
        }

        res.json({
            success: true,
            message: `تم حذف صورة ${user.name}`,
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

module.exports = router;
