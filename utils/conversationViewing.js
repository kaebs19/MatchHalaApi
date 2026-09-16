// MatchHala — «داخل المحادثة الآن» (العين 👁)
//
// ⚠️ لماذا حدث مستقل ولا نكتفي بـ join-conversation:
// قائمة المحادثات في التطبيق تنضمّ لغرف كل المحادثات لتستقبل أحداثها،
// فالانضمام للغرفة لا يعني أن المستخدم يفتح الشاشة. التطبيق يرسل
// conversation:view / conversation:unview من شاشة المحادثة وحدها.
//
// قواعد صارمة (لا تُرخِ أياً منها):
// ① الأدمن لا يبثّ عيناً أبداً — مراقبته لمحادثة لا تُكشف لطرفيها.
// ② من يخفي حضوره (stealthMode / showLastSeen=false / invisibleRead) لا يبثّ
//    عيناً، **ولا يستقبل** عين غيره — المعاملة بالمثل.
// ③ لا عين بين طرفين أحدهما حظر الآخر، ولا في محادثة غير مقبولة/غير نشطة.
// ④ «خرج» تُرسل فقط لمن أُرسلت له «دخل» — وإلا كشفت أنه كان داخلها.
//
// الحالة محفوظة في socket.data.viewing = { convId: [recipientIds] } لأن
// socket.data يُقرأ عبر عمليات الـ cluster بـ fetchSockets (Redis adapter).

const mongoose = require('mongoose');
const User = require('../models/User');
const Conversation = require('../models/Conversation');

const EVENT = 'conversation:viewing';
const CROSS_NODE_TIMEOUT_MS = 1200;
const VIEW_THROTTLE_MS = 1000;

function hidesPresence(u) {
    return !u
        || u.stealthMode === true
        || u.privacySettings?.showLastSeen === false
        || u.privacySettings?.invisibleRead === true;
}

async function fetchSocketsWithTimeout(io, room) {
    const pending = io.in(room).fetchSockets();
    pending.catch(() => {});
    let timer;
    try {
        return await Promise.race([
            pending,
            new Promise((_, reject) => {
                timer = setTimeout(() => reject(new Error('timeout')), CROSS_NODE_TIMEOUT_MS);
            })
        ]);
    } catch (_) {
        return [];
    } finally {
        clearTimeout(timer);
    }
}

/**
 * من يحقّ له أن يرى عين هذا المستخدم في هذه المحادثة؟ ([] = لا أحد)
 */
async function eligibleRecipients(socket, conversationId) {
    if (socket.user?.role === 'admin') return [];

    const conv = await Conversation.findById(conversationId)
        .select('participants status isActive').lean();
    if (!conv || conv.status !== 'accepted' || conv.isActive === false) return [];

    const me = String(socket.userId);
    const ids = (conv.participants || []).map(String);
    if (!ids.includes(me)) return [];

    const others = ids.filter(id => id !== me);
    if (others.length === 0) return [];

    const [users, blocked] = await Promise.all([
        User.find({ _id: { $in: ids } })
            .select('role isActive stealthMode privacySettings.showLastSeen privacySettings.invisibleRead')
            .lean(),
        User.exists({ _id: { $in: ids }, blockedUsers: { $in: ids } })
    ]);
    if (blocked) return [];

    const byId = new Map(users.map(u => [String(u._id), u]));
    const self = byId.get(me);
    if (!self || self.role === 'admin' || hidesPresence(self)) return [];

    return others.filter(id => {
        const u = byId.get(id);
        return u && u.isActive !== false && !hidesPresence(u);
    });
}

function viewingMap(socket) {
    if (!socket.data.viewing) socket.data.viewing = {};
    return socket.data.viewing;
}

async function startViewing(io, socket, conversationId) {
    try {
        if (typeof conversationId !== 'string' || !mongoose.isValidObjectId(conversationId)) return;

        const now = Date.now();
        const last = socket.data.lastViewAt?.[conversationId] || 0;
        if (now - last < VIEW_THROTTLE_MS) return;
        socket.data.lastViewAt = { ...(socket.data.lastViewAt || {}), [conversationId]: now };

        // ⚠️ سباق: خروج سريع يصل أثناء استعلامات الأهلية — بدون هذا الرقم
        //    تُسجَّل «دخل» بعد «خرج» فتبقى العين ظاهرة عند الطرف الآخر
        const gen = bumpGen(socket, conversationId);
        const recipients = await eligibleRecipients(socket, conversationId);
        if (socket.disconnected || gen !== socket.data.viewGen[conversationId]) return;
        const map = viewingMap(socket);
        if (recipients.length === 0) {
            // تغيّرت الأهلية (إخفاء/حظر) أثناء المشاهدة → أغلق ما سبق إرساله
            stopViewing(io, socket, conversationId);
            return;
        }

        map[conversationId] = recipients;
        const me = String(socket.userId);
        for (const id of recipients) {
            io.to(`user:${id}`).emit(EVENT, { conversationId, userId: me, viewing: true });
        }

        // الحالة الأولية: هل الطرف الآخر داخلها أصلاً؟ (يُرسل فقط إن كنتُ ضمن مستقبليه)
        for (const id of recipients) {
            const sockets = await fetchSocketsWithTimeout(io, `user:${id}`);
            const isViewingMe = sockets.some(s =>
                Array.isArray(s.data?.viewing?.[conversationId]) &&
                s.data.viewing[conversationId].includes(me)
            );
            if (isViewingMe) {
                socket.emit(EVENT, { conversationId, userId: id, viewing: true });
            }
        }
    } catch (error) {
        console.error('خطأ في conversation:view:', error.message);
    }
}

function bumpGen(socket, conversationId) {
    if (!socket.data.viewGen) socket.data.viewGen = {};
    socket.data.viewGen[conversationId] = (socket.data.viewGen[conversationId] || 0) + 1;
    return socket.data.viewGen[conversationId];
}

function stopViewing(io, socket, conversationId) {
    const map = socket.data?.viewing;
    const recipients = map?.[conversationId];
    if (!recipients) return;
    delete map[conversationId];

    const me = String(socket.userId);
    for (const id of recipients) {
        io.to(`user:${id}`).emit(EVENT, { conversationId, userId: me, viewing: false });
    }
}

function stopAllViewing(io, socket) {
    for (const conversationId of Object.keys(socket.data?.viewing || {})) {
        stopViewing(io, socket, conversationId);
    }
}

function registerViewingHandlers(io, socket) {
    const readId = (p) => (typeof p === 'string' ? p : p?.conversationId || null);

    socket.on('conversation:view', (payload) => startViewing(io, socket, readId(payload)));
    socket.on('conversation:unview', (payload) => {
        const id = readId(payload);
        if (!id) return;
        bumpGen(socket, id);
        if (socket.data.lastViewAt) delete socket.data.lastViewAt[id];
        stopViewing(io, socket, id);
    });
    // socket.data ما زالت متاحة هنا — كل ما شوهد يُغلق عند انقطاع الاتصال
    socket.on('disconnect', () => stopAllViewing(io, socket));
}

module.exports = { registerViewingHandlers, hidesPresence };
