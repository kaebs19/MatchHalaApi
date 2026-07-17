// Mobile Routes - Friends (نظام الأصدقاء)
// طلب صداقة صريح + قبول/رفض + قائمة الأصدقاء
const express = require('express');
const router = express.Router();
const User = require('../../models/User');
const Friendship = require('../../models/Friendship');
const Conversation = require('../../models/Conversation');
const Notification = require('../../models/Notification');
const { protect } = require('../../middleware/auth');
const pushNotificationService = require('../../services/pushNotificationService');
const { getFullUrl, getBestUserImage, isUserFullyBanned } = require('./helpers');

// بعد الرفض: يُسمح بإعادة الإرسال بعد 7 أيام
const REDECLINE_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

// Helper: صورة المستخدم كـ URL كامل
const userImageUrl = (user) => getFullUrl(getBestUserImage(user)) || null;

// Helper: هل يوجد حظر بين الطرفين؟
const isBlockedEitherWay = async (myId, otherId) => {
    const [me, other] = await Promise.all([
        User.findById(myId).select('blockedUsers').lean(),
        User.findById(otherId).select('blockedUsers').lean()
    ]);
    const myBlocked = (me?.blockedUsers || []).map(String);
    const otherBlocked = (other?.blockedUsers || []).map(String);
    return myBlocked.includes(String(otherId)) || otherBlocked.includes(String(myId));
};

// Helper: جلب الصداقة بين طرفين (أي اتجاه)
const findFriendshipBetween = (a, b) => Friendship.findOne({
    $or: [
        { requester: a, recipient: b },
        { requester: b, recipient: a }
    ]
});

// ==========================================
// POST /friends/request — إرسال طلب صداقة
// ==========================================
router.post('/friends/request', protect, async (req, res) => {
    try {
        const myId = req.user._id;
        const { userId: targetUserId } = req.body;

        if (!targetUserId) {
            return res.status(400).json({ success: false, message: 'userId مطلوب' });
        }
        if (String(targetUserId) === String(myId)) {
            return res.status(400).json({ success: false, message: 'لا يمكنك إضافة نفسك' });
        }

        const target = await User.findById(targetUserId)
            .select('name isActive bannedWords suspension deviceToken notificationPreferences')
            .lean();
        if (!target || isUserFullyBanned(target)) {
            return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
        }

        if (await isBlockedEitherWay(myId, targetUserId)) {
            return res.status(403).json({ success: false, message: 'لا يمكن إرسال طلب صداقة لهذا المستخدم' });
        }

        const existing = await findFriendshipBetween(myId, targetUserId);

        if (existing) {
            if (existing.status === 'accepted') {
                return res.status(409).json({ success: false, message: 'أنتما صديقان بالفعل', data: { status: 'friends' } });
            }
            if (existing.status === 'pending') {
                // الطرف الآخر أرسل لي طلباً سابقاً → قبول تلقائي (الرغبة متبادلة)
                if (String(existing.requester) === String(targetUserId)) {
                    existing.status = 'accepted';
                    existing.respondedAt = new Date();
                    await existing.save();
                    await notifyAccepted(req.user, targetUserId, existing._id);
                    return res.json({ success: true, message: 'أصبحتما صديقين', data: { status: 'friends', friendshipId: existing._id } });
                }
                return res.status(409).json({ success: false, message: 'الطلب مرسل مسبقاً', data: { status: 'pending_sent' } });
            }
            // declined — cooldown ثم إعادة استخدام نفس الوثيقة
            const declinedAt = existing.respondedAt || existing.updatedAt;
            if (declinedAt && (Date.now() - new Date(declinedAt).getTime()) < REDECLINE_COOLDOWN_MS) {
                return res.status(429).json({ success: false, message: 'لا يمكن إعادة إرسال الطلب الآن، حاول لاحقاً' });
            }
            existing.requester = myId;
            existing.recipient = targetUserId;
            existing.status = 'pending';
            existing.respondedAt = null;
            await existing.save();
            await notifyRequest(req.user, targetUserId, existing._id);
            return res.status(201).json({ success: true, message: 'تم إرسال طلب الصداقة', data: { status: 'pending_sent', friendshipId: existing._id } });
        }

        const friendship = await Friendship.create({
            requester: myId,
            recipient: targetUserId,
            status: 'pending'
        });

        await notifyRequest(req.user, targetUserId, friendship._id);

        res.status(201).json({
            success: true,
            message: 'تم إرسال طلب الصداقة',
            data: { status: 'pending_sent', friendshipId: friendship._id }
        });
    } catch (error) {
        console.error('friends/request error:', error);
        res.status(500).json({ success: false, message: 'خطأ في الخادم' });
    }
});

// إشعار (يُحفظ في DB تلقائياً عبر pushNotificationService) + push + socket لطلب الصداقة
async function notifyRequest(sender, recipientId, friendshipId) {
    const title = '👥 طلب صداقة جديد';
    const body = `${sender.name} يريد إضافتك كصديق`;

    if (global.io) {
        global.io.to(`user:${recipientId}`).emit('friend:request', {
            friendshipId: String(friendshipId),
            from: { _id: sender._id, name: sender.name, profileImage: userImageUrl(sender) }
        });
    }

    pushNotificationService.sendNotificationToUser(String(recipientId), {
        title, body, type: 'friend_request'
    }, {
        type: 'friend_request',
        friendshipId: String(friendshipId),
        senderId: String(sender._id),
        senderName: sender.name,
        senderImage: userImageUrl(sender) || '',
        status: 'pending'
    }).catch(() => {});
}

// إشعار (يُحفظ في DB تلقائياً عبر pushNotificationService) + push + socket لقبول الصداقة
async function notifyAccepted(accepter, requesterId, friendshipId) {
    const title = '🎉 تم قبول طلب الصداقة';
    const body = `${accepter.name} قبل طلب صداقتك — أصبحتما صديقين`;

    // تحديث إشعار الطلب الأصلي حتى يعرف التطبيق أنه تمت معالجته
    Notification.updateMany(
        { type: 'friend_request', 'data.friendshipId': String(friendshipId) },
        { $set: { 'data.status': 'accepted' } }
    ).exec().catch(() => {});

    if (global.io) {
        global.io.to(`user:${requesterId}`).emit('friend:accepted', {
            friendshipId: String(friendshipId),
            by: { _id: accepter._id, name: accepter.name, profileImage: userImageUrl(accepter) }
        });
    }

    pushNotificationService.sendNotificationToUser(String(requesterId), {
        title, body, type: 'friend_accepted'
    }, {
        type: 'friend_accepted',
        friendshipId: String(friendshipId),
        senderId: String(accepter._id),
        senderName: accepter.name,
        senderImage: userImageUrl(accepter) || ''
    }).catch(() => {});
}

// ==========================================
// POST /friends/requests/:id/accept — قبول طلب
// ==========================================
router.post('/friends/requests/:id/accept', protect, async (req, res) => {
    try {
        const friendship = await Friendship.findById(req.params.id);
        if (!friendship || friendship.status !== 'pending') {
            return res.status(404).json({ success: false, message: 'الطلب غير موجود أو تمت معالجته' });
        }
        if (String(friendship.recipient) !== String(req.user._id)) {
            return res.status(403).json({ success: false, message: 'غير مصرح' });
        }

        friendship.status = 'accepted';
        friendship.respondedAt = new Date();
        await friendship.save();

        await notifyAccepted(req.user, friendship.requester, friendship._id);

        res.json({ success: true, message: 'أصبحتما صديقين', data: { status: 'friends', friendshipId: friendship._id } });
    } catch (error) {
        console.error('friends/accept error:', error);
        res.status(500).json({ success: false, message: 'خطأ في الخادم' });
    }
});

// ==========================================
// POST /friends/requests/:id/decline — رفض طلب
// ==========================================
router.post('/friends/requests/:id/decline', protect, async (req, res) => {
    try {
        const friendship = await Friendship.findById(req.params.id);
        if (!friendship || friendship.status !== 'pending') {
            return res.status(404).json({ success: false, message: 'الطلب غير موجود أو تمت معالجته' });
        }
        if (String(friendship.recipient) !== String(req.user._id)) {
            return res.status(403).json({ success: false, message: 'غير مصرح' });
        }

        friendship.status = 'declined';
        friendship.respondedAt = new Date();
        await friendship.save();

        // تحديث إشعار الطلب — بدون إشعار للمرسل (رفض صامت)
        Notification.updateMany(
            { type: 'friend_request', 'data.friendshipId': String(friendship._id) },
            { $set: { 'data.status': 'declined' } }
        ).exec().catch(() => {});

        res.json({ success: true, message: 'تم رفض الطلب' });
    } catch (error) {
        console.error('friends/decline error:', error);
        res.status(500).json({ success: false, message: 'خطأ في الخادم' });
    }
});

// ==========================================
// DELETE /friends/:userId — إزالة صديق أو إلغاء طلبي المُرسل
// ==========================================
router.delete('/friends/:userId', protect, async (req, res) => {
    try {
        const myId = req.user._id;
        const otherId = req.params.userId;

        const friendship = await findFriendshipBetween(myId, otherId);
        if (!friendship) {
            return res.status(404).json({ success: false, message: 'لا توجد صداقة' });
        }

        // pending: فقط مرسل الطلب يستطيع الإلغاء (المستقبل يستخدم decline)
        if (friendship.status === 'pending' && String(friendship.requester) !== String(myId)) {
            return res.status(403).json({ success: false, message: 'استخدم رفض الطلب بدلاً من الحذف' });
        }

        await Friendship.deleteOne({ _id: friendship._id });

        res.json({ success: true, message: friendship.status === 'accepted' ? 'تمت إزالة الصديق' : 'تم إلغاء الطلب' });
    } catch (error) {
        console.error('friends/delete error:', error);
        res.status(500).json({ success: false, message: 'خطأ في الخادم' });
    }
});

// ==========================================
// GET /friends — قائمة أصدقائي (المقبولون)
// ==========================================
router.get('/friends', protect, async (req, res) => {
    try {
        const myId = req.user._id;

        const [friendships, pendingCount] = await Promise.all([
            Friendship.find({
                status: 'accepted',
                $or: [{ requester: myId }, { recipient: myId }]
            }).sort({ respondedAt: -1 }).lean(),
            Friendship.countDocuments({ recipient: myId, status: 'pending' })
        ]);

        if (friendships.length === 0) {
            return res.json({ success: true, data: { friends: [], totalCount: 0, pendingCount } });
        }

        const otherIds = friendships.map(f =>
            String(f.requester) === String(myId) ? f.recipient : f.requester
        );

        const [users, conversations] = await Promise.all([
            User.find({ _id: { $in: otherIds } })
                .select('name profileImage photos isOnline lastLogin isPremium isActive bannedWords suspension verification.isVerified privacySettings stealthMode profileCompletion')
                .lean(),
            // محادثة مقبولة بيني وبين كل صديق (لفتح الدردشة مباشرة)
            Conversation.find({
                participants: myId,
                status: 'accepted',
                isActive: true
            }).select('_id participants').lean()
        ]);

        const convByOther = {};
        for (const c of conversations) {
            const other = c.participants.find(p => String(p) !== String(myId));
            if (other) convByOther[String(other)] = String(c._id);
        }

        const userMap = {};
        users.forEach(u => { userMap[String(u._id)] = u; });

        const friends = friendships.map(f => {
            const otherId = String(f.requester) === String(myId) ? String(f.recipient) : String(f.requester);
            const u = userMap[otherId];
            if (!u || isUserFullyBanned(u)) return null;

            const hidePresence = u.privacySettings?.showLastSeen === false || u.stealthMode === true;

            return {
                friendshipId: f._id,
                since: f.respondedAt || f.updatedAt,
                conversationId: convByOther[otherId] || null,
                user: {
                    _id: u._id,
                    name: u.name,
                    profileImage: userImageUrl(u),
                    isOnline: hidePresence ? false : !!u.isOnline,
                    lastLogin: hidePresence ? null : u.lastLogin,
                    isPremium: !!u.isPremium,
                    isVerified: u.verification?.isVerified || false,
                    profileCompletion: u.profileCompletion ?? 1
                }
            };
        }).filter(Boolean);

        res.json({ success: true, data: { friends, totalCount: friends.length, pendingCount } });
    } catch (error) {
        console.error('friends list error:', error);
        res.status(500).json({ success: false, message: 'خطأ في الخادم' });
    }
});

// ==========================================
// GET /friends/requests — طلبات الصداقة الواردة
// ==========================================
router.get('/friends/requests', protect, async (req, res) => {
    try {
        const requests = await Friendship.find({
            recipient: req.user._id,
            status: 'pending'
        })
            .sort({ createdAt: -1 })
            .populate('requester', 'name profileImage photos isPremium isActive bannedWords suspension verification.isVerified')
            .lean();

        const data = requests
            .filter(r => r.requester && !isUserFullyBanned(r.requester))
            .map(r => ({
                friendshipId: r._id,
                createdAt: r.createdAt,
                user: {
                    _id: r.requester._id,
                    name: r.requester.name,
                    profileImage: userImageUrl(r.requester),
                    isPremium: !!r.requester.isPremium,
                    isVerified: r.requester.verification?.isVerified || false
                }
            }));

        res.json({ success: true, data: { requests: data, totalCount: data.length } });
    } catch (error) {
        console.error('friends/requests error:', error);
        res.status(500).json({ success: false, message: 'خطأ في الخادم' });
    }
});

// ==========================================
// GET /friends/status/:userId — حالة الصداقة مع مستخدم (لزر البروفايل)
// ==========================================
router.get('/friends/status/:userId', protect, async (req, res) => {
    try {
        const myId = req.user._id;
        const otherId = req.params.userId;

        const friendship = await findFriendshipBetween(myId, otherId);

        let status = 'none';
        if (friendship) {
            if (friendship.status === 'accepted') {
                status = 'friends';
            } else if (friendship.status === 'pending') {
                status = String(friendship.requester) === String(myId) ? 'pending_sent' : 'pending_received';
            }
            // declined → يظهر كـ none (المرسل يستطيع المحاولة بعد الـ cooldown)
        }

        res.json({
            success: true,
            data: {
                status,
                friendshipId: friendship && friendship.status !== 'declined' ? friendship._id : null
            }
        });
    } catch (error) {
        console.error('friends/status error:', error);
        res.status(500).json({ success: false, message: 'خطأ في الخادم' });
    }
});

module.exports = router;
