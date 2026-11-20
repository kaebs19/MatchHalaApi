// 👥 جمهور القصة: everyone (الافتراضي) أو friends — قصة «الأصدقاء فقط» لا يراها غير الأصدقاء المقبولين.
// ⚠️ كل مسار يعرض قصة لغير صاحبها يمرّ بهذا: القائمة/الحالة/الخلاصة بـ audienceClause،
//    والقصة المفردة (مشاهدة/تفاعل/لقطة/تصويت/ردّ) بـ canSeeAudience.

const mongoose = require('mongoose');
const Friendship = require('../models/Friendship');

const AUDIENCES = ['everyone', 'friends'];

/** معرّفات أصدقاء المستخدم المقبولين (ObjectId) */
async function friendIdsOf(userId) {
    const rows = await Friendship.find({
        status: 'accepted',
        $or: [{ requester: userId }, { recipient: userId }]
    }).select('requester recipient').lean();
    const me = String(userId);
    return rows.map(r => (String(r.requester) === me ? r.recipient : r.requester));
}

async function areFriends(a, b) {
    if (!a || !b) return false;
    return !!(await Friendship.exists({
        status: 'accepted',
        $or: [{ requester: a, recipient: b }, { requester: b, recipient: a }]
    }));
}

/** شرط Mongo: قصص الجميع + قصص «الأصدقاء» لأصدقائي فقط */
async function audienceClause(viewerId) {
    const friends = await friendIdsOf(viewerId);
    return { $or: [{ audience: { $ne: 'friends' } }, { user: { $in: friends } }] };
}

/** قصة مفردة: هل يراها هذا المشاهد؟ (صاحبها دائماً) */
async function canSeeAudience(story, viewerId) {
    if (!story || story.audience !== 'friends') return true;
    if (String(story.user) === String(viewerId)) return true;
    return areFriends(story.user, viewerId);
}

const parseAudience = (raw) => (AUDIENCES.includes(raw) ? raw : 'everyone');

module.exports = { AUDIENCES, friendIdsOf, areFriends, audienceClause, canSeeAudience, parseAudience, isValidId: mongoose.isValidObjectId };
