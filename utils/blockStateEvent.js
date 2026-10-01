// MatchHala — إبلاغ الطرفين بتغيّر حالة الحظر في محادثاتهما المشتركة
//
// ⚠️ الحظر/إلغاؤه لا يغيّران updatedAt للمحادثة (تغييره يقفز بمحادثات قديمة لأعلى القائمة)،
// والمزامنة التفاضلية في التطبيق تعتمد عليه — فبدون هذا الحدث لا تصل blockState الجديدة
// إلا مع مزامنة كاملة. التطبيق يجلب كل محادثة مذكورة (GET /mobile/conversations/:id).
const Conversation = require('../models/Conversation');

/**
 * @param {string} blockerId من قام بالحظر/الإلغاء
 * @param {string} otherId الطرف الآخر
 * @param {boolean} blocked true = حظر، false = إلغاء
 */
async function emitBlockStateChange(blockerId, otherId, blocked) {
    try {
        if (!global.io) return;
        const convs = await Conversation.find({
            type: 'private',
            participants: { $all: [blockerId, otherId] }
        }).select('_id').lean();
        if (convs.length === 0) return;
        const conversationIds = convs.map(c => String(c._id));
        global.io.to(`user:${blockerId}`).emit('conversation:block-state', {
            conversationIds, blockState: blocked ? 'iBlocked' : null
        });
        global.io.to(`user:${otherId}`).emit('conversation:block-state', {
            conversationIds, blockState: blocked ? 'blockedMe' : null
        });
    } catch (e) {
        console.error('emitBlockStateChange:', e.message);
    }
}

module.exports = { emitBlockStateChange };
