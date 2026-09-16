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
const NUDGE_COOLDOWN_SECONDS = 30;
const localNudgeCooldown = new Map();   // ارتداد إن تعذّر Redis: key → expiresAt
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

// ══════════════════════════════════════════
// 🔄 فهرس «من يشاهدني» في Redis — للاستعلام بعد إعادة الاتصال
// ══════════════════════════════════════════
// الأحداث لحظية: من أعاد الاتصال فاته «دخل» مَن كان داخل محادثته. الفهرس
// viewers:<مستقبِل> = { "<conv>:<مشاهد>": 1 } يُكتب عند الدخول ويُحذف عند
// الخروج. قد يبقى مدخل يتيم إن ماتت العملية — لذا كل مدخل يُتحقَّق منه حيّاً
// (سوكِت المشاهد ما زال يشاهد) قبل إرجاعه.
const VIEWERS_TTL_SECONDS = 6 * 60 * 60;

async function redisOrNull() {
    try { return await require('./redisClient').getClient(); } catch (_) { return null; }
}

async function indexViewing(me, conversationId, recipients, add) {
    const c = await redisOrNull();
    if (!c) return;
    try {
        for (const id of recipients) {
            const key = `viewers:${id}`;
            if (add) {
                await c.hSet(key, `${conversationId}:${me}`, '1');
                await c.expire(key, VIEWERS_TTL_SECONDS);
            } else {
                await c.hDel(key, `${conversationId}:${me}`);
            }
        }
    } catch (error) {
        console.error('⚠️ فهرس المشاهدة:', error.message);
    }
}

async function currentViewersOf(io, socket) {
    if (socket.user?.role === 'admin') return [];
    const me = String(socket.userId);
    const c = await redisOrNull();
    if (!c) return [];

    const fields = await c.hKeys(`viewers:${me}`).catch(() => []);
    if (fields.length === 0) return [];

    const self = await User.findById(me)
        .select('role stealthMode privacySettings.showLastSeen privacySettings.invisibleRead').lean();
    if (!self || self.role === 'admin' || hidesPresence(self)) return [];

    const result = [];
    for (const field of fields.slice(0, 50)) {
        const [conversationId, viewerId] = field.split(':');
        if (!mongoose.isValidObjectId(conversationId) || !mongoose.isValidObjectId(viewerId)) continue;

        const sockets = await fetchSocketsWithTimeout(io, `user:${viewerId}`);
        const live = sockets.some(s => {
            const list = s.data?.viewing?.[conversationId];
            return Array.isArray(list) && list.includes(me);
        });
        if (!live) {
            c.hDel(`viewers:${me}`, field).catch(() => {});
            continue;
        }
        const blocked = await User.exists({ _id: { $in: [me, viewerId] }, blockedUsers: { $in: [me, viewerId] } });
        if (blocked) continue;
        result.push({ conversationId, userId: viewerId });
    }
    return result;
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
        indexViewing(me, conversationId, recipients, true);
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
    indexViewing(me, conversationId, recipients, false);
    for (const id of recipients) {
        io.to(`user:${id}`).emit(EVENT, { conversationId, userId: me, viewing: false });
    }
}

function stopAllViewing(io, socket) {
    for (const conversationId of Object.keys(socket.data?.viewing || {})) {
        stopViewing(io, socket, conversationId);
    }
}

// ══════════════════════════════════════════
// 👋 النكزة — اهتزاز يصل فقط لمن هو داخل المحادثة الآن
// ══════════════════════════════════════════
// قواعد: نفس أهلية العين (أدمن/إخفاء/حظر/محادثة مقبولة)، والمُرسِل داخل
// المحادثة، والمستلم داخلها ومستقبِلٌ لعين المرسل. لا إشعار ولا تخزين.
// الحدّ: نكزة كل 30 ثانية لكل (مرسل، محادثة) عبر Redis — مشترك بين النسخ
// الأربع، ولا يُستهلك إلا عند نكزة وصلت فعلاً.
async function acquireNudgeSlot(userId, conversationId) {
    const key = `nudge:${userId}:${conversationId}`;
    try {
        const c = await require('./redisClient').getClient();
        if (c) {
            const ok = await c.set(key, '1', { NX: true, EX: NUDGE_COOLDOWN_SECONDS });
            if (ok) return { ok: true };
            const ttl = await c.ttl(key);
            return { ok: false, retryAfter: ttl > 0 ? ttl : NUDGE_COOLDOWN_SECONDS };
        }
    } catch (_) { /* ارتداد محلي */ }

    const now = Date.now();
    const until = localNudgeCooldown.get(key) || 0;
    if (until > now) return { ok: false, retryAfter: Math.ceil((until - now) / 1000) };
    localNudgeCooldown.set(key, now + NUDGE_COOLDOWN_SECONDS * 1000);
    return { ok: true };
}

async function sendNudge(io, socket, conversationId) {
    if (typeof conversationId !== 'string' || !mongoose.isValidObjectId(conversationId)) {
        return { ok: false, reason: 'invalid' };
    }
    // المرسل يجب أن يكون داخل المحادثة (والإدخال نفسه مرّ بفحص الأهلية)
    if (!socket.data?.viewing?.[conversationId]) return { ok: false, reason: 'not-here' };

    const recipients = await eligibleRecipients(socket, conversationId);
    if (recipients.length === 0) return { ok: false, reason: 'not-allowed' };

    const me = String(socket.userId);
    const targets = [];
    for (const id of recipients) {
        const sockets = await fetchSocketsWithTimeout(io, `user:${id}`);
        for (const s of sockets) {
            const theirs = s.data?.viewing?.[conversationId];
            if (Array.isArray(theirs) && theirs.includes(me)) targets.push(s.id);
        }
    }
    if (targets.length === 0) return { ok: false, reason: 'not-here' };

    const slot = await acquireNudgeSlot(me, conversationId);
    if (!slot.ok) return { ok: false, reason: 'cooldown', retryAfter: slot.retryAfter };

    for (const sid of targets) {
        io.to(sid).emit('conversation:nudged', { conversationId, userId: me });
    }
    return { ok: true, retryAfter: NUDGE_COOLDOWN_SECONDS };
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
    // 🔄 بعد إعادة الاتصال: من يشاهد محادثاتي الآن؟
    socket.on('conversation:viewers', async (_payload, ack) => {
        let viewers = [];
        try {
            viewers = await currentViewersOf(io, socket);
        } catch (error) {
            console.error('خطأ في conversation:viewers:', error.message);
        }
        if (typeof ack === 'function') ack({ viewers });
    });

    socket.on('conversation:nudge', async (payload, ack) => {
        let result;
        try {
            result = await sendNudge(io, socket, readId(payload));
        } catch (error) {
            console.error('خطأ في conversation:nudge:', error.message);
            result = { ok: false, reason: 'error' };
        }
        if (typeof ack === 'function') ack(result);
    });
    // socket.data ما زالت متاحة هنا — كل ما شوهد يُغلق عند انقطاع الاتصال
    socket.on('disconnect', () => stopAllViewing(io, socket));
}

module.exports = { registerViewingHandlers, hidesPresence, sendNudge };
