// MatchHala - دخول مباريات هلا لودو: الأهلية، اللعب السريع (طابور)، الغرف الخاصة بالرمز، ضدّ الكمبيوتر
//
// قواعد لا تُرخى:
// - الألعاب خلف مفتاح السيرفر (Settings.gamesTab — utils/featureFlags.js).
// - لا يلعب المعلَّق ولا المحظور كلياً ولا غير النشط.
// - لا يُجمع طرفا حظر في مباراة واحدة (أيّ الطرفين حظر الآخر) — في الطابور وفي الغرف.
// - مباراة جارية واحدة لكل مستخدم؛ والانتظار في طابور واحد أو غرفة واحدة.
// الطابور ينتظر BOT_FILL_MS ثم يكمل المقاعد ببوتات (startLudoLobbySweeper على instance 0).

const User = require('../../models/User');
const { getFeaturesForUser } = require('../featureFlags');
const { LudoError, constants: { MODES } } = require('../ludoEngine');
const store = require('./store');
const service = require('./service');
const economy = require('./economy');

const BOT_FILL_MS = Number(process.env.LUDO_BOT_FILL_MS) || 20000;
const SWEEP_MS = 2000;

// الدوري جزء من مفتاح الطابور: لا يُجمع لاعبان برسوم مختلفة. بلا دوري = طابور ودّي (النسخ القديمة)
const queueKeyOf = (mode, size, league) => league ? `${mode}:${size}:${league}` : `${mode}:${size}`;

function validateSetup(mode, size) {
    if (!MODES[mode]) throw new LudoError('BAD_MODE', 'نمط غير معروف');
    size = Number(size);
    if (![2, 4].includes(size)) throw new LudoError('BAD_PLAYERS', 'عدد اللاعبين 2 أو 4');
    if (MODES[mode].teams && size !== 4) throw new LudoError('BAD_PLAYERS', 'نمط الفرق يحتاج 4 لاعبين');
    return { mode, size };
}

// يُعاد التحميل من القاعدة: socket.user يُقرأ عند الاتصال وقد يكون قديماً
async function loadEligible(userId) {
    const user = await User.findById(userId)
        .select('name profileImage role isActive suspension bannedWords blockedUsers')
        .lean();
    if (!user || !user.isActive) throw new LudoError('NOT_ALLOWED', 'الحساب غير متاح', 403);
    const suspended = user.suspension?.isSuspended &&
        (!user.suspension.suspendedUntil || new Date(user.suspension.suspendedUntil) > new Date());
    if (suspended || user.bannedWords?.isBanned) {
        throw new LudoError('ACCOUNT_RESTRICTED', 'لا يمكنك اللعب حالياً بسبب تقييد على حسابك', 403);
    }
    const features = await getFeaturesForUser(user);
    if (!features.games) throw new LudoError('GAMES_DISABLED', 'الألعاب غير متاحة حالياً', 403);
    return user;
}

const playerInfo = (user) => ({
    id: String(user._id),
    name: user.name,
    photo: user.profileImage || null
});

const blockedList = (user) => (user.blockedUsers || []).map(String);

// طرفا حظر؟ (entries تحمل blocked من وقت الانضمام)
const conflict = (a, b) => a.blocked.includes(b.userId) || b.blocked.includes(a.userId);

async function assertFree(userId) {
    if (await store.getUserGame(userId)) {
        throw new LudoError('IN_GAME', 'عندك مباراة جارية — ارجع لها أولاً', 409);
    }
    if (await store.getUserRoom(userId)) {
        throw new LudoError('IN_ROOM', 'أنت في غرفة انتظار — اخرج منها أولاً', 409);
    }
}

// ───────────── اللعب السريع ─────────────

async function joinQueue(userId, { mode, size, league }) {
    ({ mode, size } = validateSetup(mode, size));
    league = league ? String(league) : null;
    if (league) economy.assertLeague(league);
    const user = await loadEligible(userId);
    const id = String(user._id);
    await store.dequeue([id]);          // تبديل الطابور مسموح
    await assertFree(id);
    // الرسوم تُخصم عند بدء المباراة — هنا نتحقق فقط أن الرصيد يكفي
    if (league) await economy.assertCanAfford(id, league);
    const key = queueKeyOf(mode, size, league);
    await store.enqueue(key, {
        userId: id,
        joinedAt: Date.now(),
        mode,
        size,
        league,
        blocked: blockedList(user),
        player: playerInfo(user)
    });
    await tryMatch(key);
    return { queued: !(await store.getUserGame(id)), mode, size, league, botFillMs: BOT_FILL_MS };
}

// يخصم رسوم الدخول من كل لاعب — من لا يكفي رصيده (تغيّر منذ دخوله الطابور) يُستبعد
async function chargeEntry(group, fee) {
    const paid = [];
    for (const g of group) {
        if (await economy.charge(g.userId, fee)) paid.push(g);
        else emitQueueDropped(g.userId);
    }
    return paid;
}

function emitQueueDropped(userId) {
    global.io?.to(`user:${userId}`).emit('ludo:queue-dropped', {
        code: 'NOT_ENOUGH_COINS', message: 'رصيدك لا يكفي لرسوم دخول هذا الدوري'
    });
}

// الرصيد والدوريات (شاشة الألعاب) والمكافأة اليومية
async function walletInfo(userId) {
    const user = await loadEligible(userId);
    const wallet = await economy.getWallet(String(user._id));
    return { wallet: economy.walletView(wallet), leagues: economy.leaguesView() };
}

async function claimDaily(userId) {
    const user = await loadEligible(userId);
    return { wallet: economy.walletView(await economy.claimDaily(String(user._id))) };
}

async function leaveQueue(userId) {
    await store.dequeue([String(userId)]);
    return { queued: false };
}

// يكوّن مجموعات متوافقة (بلا طرفَي حظر) بترتيب الانضمام.
// fillBots: من انتظر BOT_FILL_MS تكتمل مجموعته ببوتات.
async function tryMatch(queueKey, { fillBots = false, now = Date.now() } = {}) {
    const [mode, sizeStr, league] = queueKey.split(':');
    const size = Number(sizeStr);
    const stake = league ? economy.stakeFor(league, mode, size) : null;
    return store.withLock(`queue:${queueKey}`, async () => {
        let entries = await store.queueEntries(queueKey);
        const started = [];
        while (entries.length > 0) {
            const seed = entries[0];
            const group = [seed];
            for (const e of entries.slice(1)) {
                if (group.length === size) break;
                if (group.every(g => !conflict(g, e))) group.push(e);
            }
            const waitedEnough = fillBots && now - seed.joinedAt >= BOT_FILL_MS;
            if (group.length < size && !waitedEnough) {
                // هذا المنتظر لم يكتمل بعد — جرّب التالي كبذرة (قد تتكوّن مجموعة بدونه)
                entries = entries.slice(1);
                continue;
            }
            const ids = group.map(g => g.userId);
            await store.dequeue(ids);
            // من دخل مباراة أخرى أثناء الانتظار يُستبعد
            let free = [];
            for (const g of group) if (!(await store.getUserGame(g.userId))) free.push(g);
            if (stake) free = await chargeEntry(free, stake.fee);
            if (free.length > 0) {
                try {
                    const record = await service.createMatch({
                        players: free.map(g => g.player),
                        bots: size - free.length,
                        mode,
                        source: 'queue',
                        stake
                    });
                    started.push(record.id);
                } catch (e) {
                    // لم تبدأ المباراة ← تُردّ الرسوم
                    if (stake) await Promise.all(free.map(g => economy.refund(g.userId, stake.fee).catch(() => {})));
                    throw e;
                }
            }
            entries = entries.filter(e => !ids.includes(e.userId));
        }
        return started;
    }, { waitMs: 1500 });
}

let sweepTimer = null;
function startLudoLobbySweeper() {
    if (sweepTimer) return;
    sweepTimer = setInterval(async () => {
        try {
            const keys = await store.activeQueueKeys();
            for (const key of keys) {
                await tryMatch(key, { fillBots: true }).catch(e => {
                    if (e.code !== 'LOCK_BUSY') console.error('ludo sweep:', e.message);
                });
            }
        } catch (e) {
            if (e.code !== 'GAMES_UNAVAILABLE') console.error('ludo sweep error:', e.message);
        }
    }, SWEEP_MS);
    sweepTimer.unref?.();
}

function stopLudoLobbySweeper() {
    if (sweepTimer) clearInterval(sweepTimer);
    sweepTimer = null;
}

// ───────────── ضدّ الكمبيوتر ─────────────

async function startSolo(userId, { mode = 'classic', size = 2 }) {
    ({ mode, size } = validateSetup(mode, size));
    const user = await loadEligible(userId);
    await store.dequeue([String(user._id)]);
    await assertFree(String(user._id));
    const record = await service.createMatch({
        players: [playerInfo(user)], bots: size - 1, mode, source: 'solo'
    });
    return service.view(record);
}

// ───────────── دعوة من المحادثة (routes/mobile/games.js) ─────────────

// مباراة ثنائية بين صاحب الدعوة والمدعو — الحارس (المحادثة، الحظر) عند المسار.
// الأهلية والفراغ للطرفين هنا: المدعو يقبل الآن، وصاحب الدعوة قد يكون دخل مباراة أخرى منذ دعوته.
async function startInviteMatch(inviterId, inviteeId, { mode = 'classic', messageId }) {
    ({ mode } = validateSetup(mode, 2));
    const [inviter, invitee] = await Promise.all([loadEligible(inviterId), loadEligible(inviteeId)]);
    await assertFree(String(invitee._id));
    try {
        await assertFree(String(inviter._id));
    } catch (e) {
        throw new LudoError('INVITER_BUSY', 'صاحب الدعوة في مباراة أخرى الآن — جرّب بعد قليل', 409);
    }
    await store.dequeue([String(inviter._id), String(invitee._id)]);
    const record = await service.createMatch({
        players: [playerInfo(inviter), playerInfo(invitee)],
        mode,
        source: 'invite',
        link: { messageId: String(messageId) }
    });
    return record;
}

// ───────────── الغرف الخاصة بالرمز ─────────────

function roomView(room) {
    return {
        code: room.code,
        hostId: room.hostId,
        mode: room.mode,
        size: room.size,
        players: room.players.map(id => room.info[id]),
        createdAt: room.createdAt
    };
}

function emitRoom(room, payload) {
    const server = global.io;
    if (!server || room.players.length === 0) return;
    server.to(room.players.map(u => `user:${u}`)).emit('ludo:room', payload);
}

async function startRoomMatch(room) {
    await store.deleteRoom(room);
    const record = await service.createMatch({
        players: room.players.map(id => room.info[id]),
        bots: room.size - room.players.length,
        mode: room.mode,
        source: 'room'
    });
    return record;
}

async function createRoom(userId, { mode, size }) {
    ({ mode, size } = validateSetup(mode, size));
    const user = await loadEligible(userId);
    const id = String(user._id);
    await store.dequeue([id]);
    await assertFree(id);
    const room = await store.createRoom({
        hostId: id,
        mode,
        size,
        players: [id],
        info: { [id]: playerInfo(user) },
        blocked: { [id]: blockedList(user) },
        createdAt: Date.now()
    });
    return roomView(room);
}

async function joinRoom(userId, code) {
    code = String(code || '').trim();
    if (!/^\d{4}$/.test(code)) throw new LudoError('BAD_CODE', 'الرمز 4 أرقام');
    const user = await loadEligible(userId);
    const id = String(user._id);
    await store.dequeue([id]);
    if (await store.getUserGame(id)) throw new LudoError('IN_GAME', 'عندك مباراة جارية — ارجع لها أولاً', 409);
    const current = await store.getUserRoom(id);
    if (current && current !== code) throw new LudoError('IN_ROOM', 'أنت في غرفة انتظار أخرى', 409);

    return store.withLock(`room:${code}`, async () => {
        const room = await store.getRoom(code);
        if (!room) throw new LudoError('ROOM_NOT_FOUND', 'الغرفة غير موجودة أو انتهت', 404);
        if (room.players.includes(id)) return { room: roomView(room) };
        if (room.players.length >= room.size) throw new LudoError('ROOM_FULL', 'الغرفة مكتملة', 409);

        const me = { userId: id, blocked: blockedList(user) };
        const clash = room.players.some(p => conflict(me, { userId: p, blocked: room.blocked[p] || [] }));
        // سبب محايد عمداً — لا نكشف من حظر من
        if (clash) throw new LudoError('ROOM_UNAVAILABLE', 'لا يمكنك الانضمام لهذه الغرفة', 403);

        room.players.push(id);
        room.info[id] = playerInfo(user);
        room.blocked[id] = me.blocked;

        if (room.players.length === room.size) {
            const record = await startRoomMatch(room);
            return { started: true, game: service.view(record) };
        }
        await store.saveRoom(room);
        emitRoom(room, { room: roomView(room) });
        return { room: roomView(room) };
    });
}

// المضيف يبدأ قبل الاكتمال — المقاعد الفارغة بوتات
async function startRoom(userId, code) {
    const id = String(userId);
    return store.withLock(`room:${code}`, async () => {
        const room = await store.getRoom(String(code));
        if (!room) throw new LudoError('ROOM_NOT_FOUND', 'الغرفة غير موجودة أو انتهت', 404);
        if (room.hostId !== id) throw new LudoError('NOT_HOST', 'صاحب الغرفة وحده يبدأ', 403);
        if (room.players.length < 2) throw new LudoError('ROOM_EMPTY', 'انتظر لاعباً واحداً على الأقل', 409);
        const record = await startRoomMatch(room);
        return { started: true, game: service.view(record) };
    });
}

async function leaveRoom(userId) {
    const id = String(userId);
    const code = await store.getUserRoom(id);
    if (!code) return { left: true };
    return store.withLock(`room:${code}`, async () => {
        const room = await store.getRoom(code);
        await store.clearUserRoom(id);
        if (!room) return { left: true };
        if (room.hostId === id) {
            // خروج المضيف يغلق الغرفة
            await store.deleteRoom(room);
            emitRoom({ ...room, players: room.players.filter(p => p !== id) }, { code, closed: true });
            return { left: true };
        }
        room.players = room.players.filter(p => p !== id);
        delete room.info[id];
        delete room.blocked[id];
        await store.saveRoom(room);
        emitRoom(room, { room: roomView(room) });
        return { left: true };
    });
}

module.exports = {
    joinQueue,
    leaveQueue,
    tryMatch,
    startSolo,
    startInviteMatch,
    createRoom,
    joinRoom,
    startRoom,
    leaveRoom,
    loadEligible,
    walletInfo,
    claimDaily,
    startLudoLobbySweeper,
    stopLudoLobbySweeper,
    constants: { BOT_FILL_MS }
};
