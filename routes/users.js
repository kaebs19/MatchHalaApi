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

module.exports = router;
