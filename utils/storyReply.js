// ↩️ الرد على القصة — لقطة مرجعية تُحفظ في الرسالة (Message.storyRef)
//
// ⚠️ بلا نسخة من الصورة: الرابط يشير لملف القصة المؤقت (uploads/ephemeral) ويختفي
//    بانتهائها، والعميل يعرض «القصة لم تعد متاحة» بعد expiresAt — وعد الخصوصية أن
//    القصة 24 ساعة لا يُكسر بحفظها داخل محادثة.

const mongoose = require('mongoose');
const Story = require('../models/Story');
const { getFullUrl } = require('../routes/mobile/helpers');
const { canSeeAudience } = require('./storyAudience');

/**
 * قصة صالحة للرد: نشطة، غير منتهية، غير محجوبة بالبلاغات، وصاحبها ownerId.
 * يُرجع null إن لم تكن — المتصل يردّ بـ 410 STORY_UNAVAILABLE.
 */
async function buildStoryRef(storyId, ownerId, viewerId = null) {
    if (!storyId || !mongoose.isValidObjectId(storyId) || !ownerId) return null;
    const story = await Story.findOne({
        _id: storyId,
        user: ownerId,
        status: 'active',
        expiresAt: { $gt: new Date() },
        heldAt: null
    }).select('user kind text background imageUrl expiresAt audience').lean();
    if (!story) return null;
    // 👥 قصة «الأصدقاء فقط»: لا يردّ عليها غيرهم
    if (viewerId && !(await canSeeAudience(story, viewerId))) return null;

    const isText = story.kind === 'text';
    return {
        story: story._id,
        owner: story.user,
        kind: isText ? 'text' : 'image',
        text: isText ? story.text : null,
        background: isText ? (story.background || 0) : null,
        imageUrl: isText ? null : getFullUrl(story.imageUrl),
        expiresAt: story.expiresAt
    };
}

const STORY_UNAVAILABLE = {
    success: false,
    code: 'STORY_UNAVAILABLE',
    message: 'انتهت القصة أو لم تعد متاحة'
};

module.exports = { buildStoryRef, STORY_UNAVAILABLE };
