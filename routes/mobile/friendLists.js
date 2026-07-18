// Mobile Routes - Friend Lists (قوائم الأصدقاء المخصصة)
// إنشاء/تعديل/حذف قوائم + إدارة الأعضاء + إعادة الترتيب + تثبيت الأصدقاء
const express = require('express');
const router = express.Router();
const User = require('../../models/User');
const Friendship = require('../../models/Friendship');
const FriendList = require('../../models/FriendList');
const { protect } = require('../../middleware/auth');

// 🛡️ الحدود
const MAX_LISTS_FREE = 3;
const MAX_LISTS_PREMIUM = 10;

const isPremiumActive = (user) =>
    !!(user && user.isPremium && (!user.premiumExpiresAt || new Date(user.premiumExpiresAt) > new Date()));

// Helper: هل هذا المستخدم صديقي المقبول؟
const isAcceptedFriend = async (myId, otherId) => {
    const f = await Friendship.findOne({
        status: 'accepted',
        $or: [
            { requester: myId, recipient: otherId },
            { requester: otherId, recipient: myId }
        ]
    }).select('_id').lean();
    return !!f;
};

// Helper: تنسيق القائمة للاستجابة
const formatList = (list) => ({
    _id: list._id,
    name: list.name,
    emoji: list.emoji || '',
    order: list.order || 0,
    members: (list.members || []).map(String),
    membersCount: (list.members || []).length,
    createdAt: list.createdAt
});

// ==========================================
// GET /friends/lists — قوائمي (مرتبة) + المثبتون
// ==========================================
router.get('/friends/lists', protect, async (req, res) => {
    try {
        const [lists, me] = await Promise.all([
            FriendList.find({ owner: req.user._id }).sort({ order: 1, createdAt: 1 }).lean(),
            User.findById(req.user._id).select('pinnedFriends isPremium premiumExpiresAt').lean()
        ]);

        const premium = isPremiumActive(me);

        res.json({
            success: true,
            data: {
                lists: lists.map(formatList),
                pinnedFriends: (me?.pinnedFriends || []).map(String),
                maxLists: premium ? MAX_LISTS_PREMIUM : MAX_LISTS_FREE,
                isPremium: premium
            }
        });
    } catch (error) {
        console.error('friends/lists error:', error);
        res.status(500).json({ success: false, message: 'خطأ في الخادم' });
    }
});

// ==========================================
// POST /friends/lists — إنشاء قائمة
// ==========================================
router.post('/friends/lists', protect, async (req, res) => {
    try {
        const { name, emoji } = req.body;
        const trimmed = (name || '').trim();

        if (!trimmed) {
            return res.status(400).json({ success: false, message: 'اسم القائمة مطلوب' });
        }
        if (trimmed.length > 30) {
            return res.status(400).json({ success: false, message: 'اسم القائمة طويل (30 حرفاً كحد أقصى)' });
        }

        const me = await User.findById(req.user._id).select('isPremium premiumExpiresAt').lean();
        const premium = isPremiumActive(me);
        const maxLists = premium ? MAX_LISTS_PREMIUM : MAX_LISTS_FREE;

        const count = await FriendList.countDocuments({ owner: req.user._id });
        if (count >= maxLists) {
            return res.status(403).json({
                success: false,
                message: premium
                    ? `وصلت الحد الأقصى (${maxLists} قوائم)`
                    : `وصلت الحد الأقصى (${maxLists} قوائم) — اشترك في Premium لعشر قوائم`,
                code: 'LISTS_LIMIT_REACHED',
                data: { limit: maxLists, requiresPremium: !premium }
            });
        }

        // منع تكرار الاسم
        const duplicate = await FriendList.findOne({ owner: req.user._id, name: trimmed }).lean();
        if (duplicate) {
            return res.status(409).json({ success: false, message: 'لديك قائمة بهذا الاسم' });
        }

        const list = await FriendList.create({
            owner: req.user._id,
            name: trimmed,
            emoji: (emoji || '').slice(0, 8),
            order: count
        });

        res.status(201).json({ success: true, message: 'تم إنشاء القائمة', data: { list: formatList(list) } });
    } catch (error) {
        console.error('friends/lists create error:', error);
        res.status(500).json({ success: false, message: 'خطأ في الخادم' });
    }
});

// ==========================================
// PUT /friends/lists/reorder — إعادة ترتيب القوائم
// (قبل /:id حتى لا يلتقطها الـ param route)
// ==========================================
router.put('/friends/lists/reorder', protect, async (req, res) => {
    try {
        const { orderedIds } = req.body;
        if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
            return res.status(400).json({ success: false, message: 'orderedIds مطلوبة' });
        }

        await Promise.all(orderedIds.map((id, index) =>
            FriendList.updateOne({ _id: id, owner: req.user._id }, { $set: { order: index } })
        ));

        res.json({ success: true, message: 'تم حفظ الترتيب' });
    } catch (error) {
        console.error('friends/lists reorder error:', error);
        res.status(500).json({ success: false, message: 'خطأ في الخادم' });
    }
});

// ==========================================
// PUT /friends/lists/:id — تعديل قائمة (اسم/إيموجي)
// ==========================================
router.put('/friends/lists/:id', protect, async (req, res) => {
    try {
        const list = await FriendList.findOne({ _id: req.params.id, owner: req.user._id });
        if (!list) {
            return res.status(404).json({ success: false, message: 'القائمة غير موجودة' });
        }

        const { name, emoji } = req.body;
        if (name !== undefined) {
            const trimmed = (name || '').trim();
            if (!trimmed) return res.status(400).json({ success: false, message: 'اسم القائمة مطلوب' });
            if (trimmed.length > 30) return res.status(400).json({ success: false, message: 'اسم القائمة طويل' });
            list.name = trimmed;
        }
        if (emoji !== undefined) {
            list.emoji = (emoji || '').slice(0, 8);
        }

        await list.save();
        res.json({ success: true, message: 'تم تحديث القائمة', data: { list: formatList(list) } });
    } catch (error) {
        console.error('friends/lists update error:', error);
        res.status(500).json({ success: false, message: 'خطأ في الخادم' });
    }
});

// ==========================================
// DELETE /friends/lists/:id — حذف قائمة
// ==========================================
router.delete('/friends/lists/:id', protect, async (req, res) => {
    try {
        const result = await FriendList.deleteOne({ _id: req.params.id, owner: req.user._id });
        if (result.deletedCount === 0) {
            return res.status(404).json({ success: false, message: 'القائمة غير موجودة' });
        }
        res.json({ success: true, message: 'تم حذف القائمة' });
    } catch (error) {
        console.error('friends/lists delete error:', error);
        res.status(500).json({ success: false, message: 'خطأ في الخادم' });
    }
});

// ==========================================
// POST /friends/lists/:id/members — إضافة صديق للقائمة
// ==========================================
router.post('/friends/lists/:id/members', protect, async (req, res) => {
    try {
        const { userId } = req.body;
        if (!userId) {
            return res.status(400).json({ success: false, message: 'userId مطلوب' });
        }

        const list = await FriendList.findOne({ _id: req.params.id, owner: req.user._id });
        if (!list) {
            return res.status(404).json({ success: false, message: 'القائمة غير موجودة' });
        }

        // فقط الأصدقاء المقبولون يمكن إضافتهم
        if (!(await isAcceptedFriend(req.user._id, userId))) {
            return res.status(403).json({ success: false, message: 'هذا المستخدم ليس من أصدقائك' });
        }

        await FriendList.updateOne(
            { _id: list._id },
            { $addToSet: { members: userId } }
        );

        res.json({ success: true, message: `تمت الإضافة إلى "${list.name}"` });
    } catch (error) {
        console.error('friends/lists add member error:', error);
        res.status(500).json({ success: false, message: 'خطأ في الخادم' });
    }
});

// ==========================================
// DELETE /friends/lists/:id/members/:userId — إزالة صديق من القائمة
// ==========================================
router.delete('/friends/lists/:id/members/:userId', protect, async (req, res) => {
    try {
        const list = await FriendList.findOne({ _id: req.params.id, owner: req.user._id });
        if (!list) {
            return res.status(404).json({ success: false, message: 'القائمة غير موجودة' });
        }

        await FriendList.updateOne(
            { _id: list._id },
            { $pull: { members: req.params.userId } }
        );

        res.json({ success: true, message: 'تمت الإزالة من القائمة' });
    } catch (error) {
        console.error('friends/lists remove member error:', error);
        res.status(500).json({ success: false, message: 'خطأ في الخادم' });
    }
});

// ==========================================
// PUT /friends/pin/:userId — تثبيت/إلغاء تثبيت صديق (toggle، عام)
// ==========================================
router.put('/friends/pin/:userId', protect, async (req, res) => {
    try {
        const otherId = req.params.userId;

        if (!(await isAcceptedFriend(req.user._id, otherId))) {
            return res.status(403).json({ success: false, message: 'هذا المستخدم ليس من أصدقائك' });
        }

        const me = await User.findById(req.user._id).select('pinnedFriends').lean();
        const isPinned = (me?.pinnedFriends || []).map(String).includes(String(otherId));

        await User.findByIdAndUpdate(req.user._id, isPinned
            ? { $pull: { pinnedFriends: otherId } }
            : { $addToSet: { pinnedFriends: otherId } }
        );

        res.json({
            success: true,
            message: isPinned ? 'تم إلغاء التثبيت' : 'تم تثبيت الصديق',
            data: { pinned: !isPinned }
        });
    } catch (error) {
        console.error('friends/pin error:', error);
        res.status(500).json({ success: false, message: 'خطأ في الخادم' });
    }
});

module.exports = router;
