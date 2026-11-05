// MatchHala — بثّ حالة الحساب (محظور/موقوف ↔ نشط) لأطراف محادثاته فوراً
//
// قبلها كانت أطراف المحادثات تعرف الحظر عند إعادة تحميل القائمة الكاملة فقط: الحظر لا يغيّر
// updatedAt المحادثة فلا يصل بالمزامنة التفاضلية. الآن User يبثّ عند تغيّر isActive/التعليق/
// حظر الكلمات (models/User.js)، والتطبيق يحدّث الصفّ والمحادثة المفتوحة.
//
// المعيار نفسه الذي يخفي البيانات في الردود: isUserFullyBanned (routes/mobile/helpers.js).

const STATE_PATHS = ['isActive', 'suspension.isSuspended', 'suspension.level', 'bannedWords.isBanned'];

/** هل يمسّ هذا التحديث حالة الحساب؟ (يقبل كائن update لـ updateOne/findOneAndUpdate) */
function touchesAccountState(update) {
    if (!update || typeof update !== 'object') return false;
    const keys = new Set();
    const collect = (obj, prefix = '') => {
        for (const [k, v] of Object.entries(obj || {})) {
            if (k.startsWith('$')) { collect(v, ''); continue; }
            const path = prefix ? `${prefix}.${k}` : k;
            keys.add(path);
            if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date) && !v._bsontype) collect(v, path);
        }
    };
    collect(update);
    return STATE_PATHS.some(p => keys.has(p));
}

/** يبثّ الحالة الحالية للمستخدم لكل من يحادثه. fire-and-forget. */
async function broadcastAccountState(userId) {
    try {
        if (!userId || !global.io) return;
        const User = require('../models/User');
        const Conversation = require('../models/Conversation');
        const { isUserFullyBanned } = require('../routes/mobile/helpers');

        const user = await User.findById(userId).select('isActive bannedWords.isBanned suspension.isSuspended suspension.level').lean();
        if (!user) return;
        const suspended = isUserFullyBanned(user);

        const partners = await Conversation.distinct('participants', { participants: user._id });
        const rooms = partners
            .map(String)
            .filter(id => id !== String(user._id))
            .map(id => `user:${id}`);
        if (rooms.length === 0) return;

        // بثّ واحد متعدّد الغرف (انظر «البثّ المزدوج» في CLAUDE.md)
        global.io.to(rooms).emit('partner:account-state', {
            userId: String(user._id),
            suspended
        });
    } catch (err) {
        console.error('⚠️ broadcastAccountState:', err.message);
    }
}

module.exports = { broadcastAccountState, touchesAccountState };
