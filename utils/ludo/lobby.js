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
const penalties = require('./penalties');
const missions = require('./missions');
const { planGroups } = require('./matchmaking');

const BOT_FILL_MS = Number(process.env.LUDO_BOT_FILL_MS) || 20000;
const SWEEP_MS = 2000;

// الدوري جزء من مفتاح الطابور: لا يُجمع لاعبان برسوم مختلفة. بلا دوري = طابور ودّي (النسخ القديمة)
const queueKeyOf = (mode, size, league) => league ? `${mode}:${size}:${league}` : `${mode}:${size}`;
// طوابير الدوري الثلاثة لنمط وحجم واحد تُطابَق معاً (رسوم ← مستوى ← الأقرب — utils/ludo/matchmaking.js)
const LEAGUE_IDS = ['bronze', 'silver', 'gold'];
const poolOf = (queueKey) => {
    const [mode, size, league] = queueKey.split(':');
    return league ? { mode, size: Number(size), keys: LEAGUE_IDS.map(l => `${mode}:${size}:${l}`), lock: `${mode}:${size}:leagues` }
                  : { mode, size: Number(size), keys: [queueKey], lock: queueKey };
};
// نوافذ التوسّع (نسب من مهلة البوت كي تتبعها في الاختبارات)
const windows = () => ({
    sameFee: Number(process.env.LUDO_MATCH_SAME_FEE_MS) || Math.round(BOT_FILL_MS * 0.3),
    level: Number(process.env.LUDO_MATCH_LEVEL_MS) || Math.round(BOT_FILL_MS * 0.6),
    botFill: BOT_FILL_MS
});

function validateSetup(mode, size) {
    // ⚠️ الكلاسيكي أُلغي (قرار المالك ١٣ نوفمبر ٢٠٢٦): اللعبة المعتمدة هي السريعة (قطعتان).
    //    أي طلب بلا نمط أو بـ classic يُلعب سريعاً — المحرّك ما زال يعرّف classic للاختبارات وللفرق.
    if (!mode || mode === 'classic') mode = 'quick';
    if (!MODES[mode]) throw new LudoError('BAD_MODE', 'نمط غير معروف');
    size = Number(size);
    if (![2, 4].includes(size)) throw new LudoError('BAD_PLAYERS', 'عدد اللاعبين 2 أو 4');
    if (MODES[mode].teams && size !== 4) throw new LudoError('BAD_PLAYERS', 'نمط الفرق يحتاج 4 لاعبين');
    return { mode, size };
}

// يُعاد التحميل من القاعدة: socket.user يُقرأ عند الاتصال وقد يكون قديماً
async function loadEligible(userId) {
    const user = await User.findById(userId)
        .select('name profileImage role isActive suspension bannedWords blockedUsers keychainToken vendorId')
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
const deviceIds = (user) => [user.keychainToken && `k:${user.keychainToken}`, user.vendorId && `v:${user.vendorId}`].filter(Boolean);

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
    // خرج من مباريات الدوري مراراً ← منع مؤقت من الدوري وحده (الودّي متاح)
    const ban = league ? await penalties.leagueBan(id) : null;
    if (ban) {
        throw new LudoError('LEAGUE_COOLDOWN',
            `خرجت من مباريات الدوري أكثر من مرة — الدوري متاح لك بعد ${ban.minutes} دقيقة. اللعب الودّي متاح الآن.`, 429);
    }
    const key = queueKeyOf(mode, size, league);
    // المستوى للمطابقة (مرتبة النجوم) — للدوري وحده
    const level = league ? economy.levelOf((await economy.getWallet(id)).points) : 0;
    await store.enqueue(key, {
        userId: id,
        joinedAt: Date.now(),
        mode,
        size,
        league,
        fee: league ? economy.assertLeague(league).fee : 0,
        level,
        blocked: blockedList(user),
        // معرّفات الجهاز: حسابان على الجهاز نفسه لا يتقابلان (matchmaking.sameDevice). لا بصمة الجهاز — تتصادم بين أجهزة بالطراز نفسه
        devices: deviceIds(user),
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
    // منع الدوري الساري (خروج متكرر) — ليُعرض قفلاً قبل الضغط؛ now لتصحيح فرق الساعة
    const ban = await penalties.leagueBan(String(user._id)).catch(() => null);
    return {
        wallet: economy.walletView(wallet), leagues: economy.leaguesView(),
        leagueBanUntil: ban ? ban.until : null, now: Date.now(),
        daily: await missions.view(String(user._id))
    };
}

// 🎯 استلام مكافأة مهمة مكتملة — يعيد الرصيد والمهام بعد الاستلام
async function claimMission(userId, missionId) {
    const user = await loadEligible(userId);
    const id = String(user._id);
    const wallet = await missions.claim(id, missionId);
    return { wallet: economy.walletView(wallet), daily: await missions.view(id) };
}

// المتجر: باقات العملات (بالجواهر) ومنتجات الجواهر (App Store)
async function storeInfo(userId) {
    const user = await loadEligible(userId);
    const wallet = await economy.getWallet(String(user._id));
    return { wallet: economy.walletView(wallet), store: economy.storeView() };
}

async function buyCoins(userId, packId) {
    const user = await loadEligible(userId);
    return { wallet: economy.walletView(await economy.buyCoins(String(user._id), String(packId))) };
}

async function redeemPurchase(userId, signedTransaction) {
    const user = await loadEligible(userId);
    const r = await economy.redeemPurchase(String(user._id), signedTransaction);
    return { wallet: economy.walletView(r.wallet), granted: r.granted, grantedCoins: r.grantedCoins, transactionId: r.transactionId };
}

// مكافأة مشاهدة إعلان: رمز عند البدء ثم المطالبة به بعد انتهاء الإعلان
async function adStart(userId) {
    const user = await loadEligible(userId);
    return economy.startAd(String(user._id));
}

async function adClaim(userId, token) {
    const user = await loadEligible(userId);
    return { wallet: economy.walletView(await economy.claimAd(String(user._id), token)) };
}

async function leaderboard(userId) {
    const user = await loadEligible(userId);
    return economy.leaderboard(user);
}

async function prizeSeen(userId) {
    await economy.markPrizeSeen(String(userId));
    return {};
}

async function claimDaily(userId) {
    const user = await loadEligible(userId);
    return { wallet: economy.walletView(await economy.claimDaily(String(user._id))) };
}

// ───────────── التحدّي المباشر ─────────────
// مباراة ودّية من لاعبَين، بلا رسوم. يحقّ بين صديقَين، أو بين خصمَي مباراة انتهت للتوّ («مباراة ثانية»)
// — لا تحدٍّ لغريب: الاسم ظاهر في الترتيب لكل الناس، والتحدّي تنبيه يقاطع صاحبه.

const CHALLENGE_TTL_MS = Number(process.env.LUDO_CHALLENGE_TTL_MS) || 30000;

async function mayChallenge(a, b) {
    if (await store.areRivals(a, b)) return true;
    const Friendship = require('../../models/Friendship');
    return !!(await Friendship.findOne({
        status: 'accepted',
        $or: [{ requester: a, recipient: b }, { requester: b, recipient: a }]
    }).select('_id').lean());
}

async function challenge(userId, targetId) {
    const from = await loadEligible(userId);
    const fromId = String(from._id);
    const toId = String(targetId || '');
    const unavailable = () => new LudoError('PLAYER_UNAVAILABLE', 'هذا اللاعب غير متاح الآن', 404);
    if (!/^[a-f0-9]{24}$/i.test(toId) || toId === fromId) throw unavailable();
    let to;
    try { to = await loadEligible(toId); } catch (e) { throw unavailable(); }
    if (blockedList(from).includes(toId) || blockedList(to).includes(fromId)) throw unavailable();
    if (!(await mayChallenge(fromId, toId))) {
        throw new LudoError('CHALLENGE_NOT_ALLOWED', 'التحدّي متاح لأصدقائك ولمن لعبت معه للتوّ', 403);
    }
    await assertFree(fromId);
    if (await store.getUserGame(toId)) throw new LudoError('PLAYER_BUSY', 'اللاعب في مباراة أخرى الآن', 409);
    if (!(await store.challengeCooldown(fromId, toId, CHALLENGE_TTL_MS))) {
        throw new LudoError('CHALLENGE_PENDING', 'أرسلت له تحدّياً للتوّ — انتظر ردّه', 429);
    }
    const expiresAt = Date.now() + CHALLENGE_TTL_MS;
    await store.setChallenge(toId, fromId, { from: playerInfo(from), expiresAt }, CHALLENGE_TTL_MS);
    global.io?.to(`user:${toId}`).emit('ludo:challenge', { from: playerInfo(from), expiresAt, now: Date.now() });
    return { expiresAt, now: Date.now() };
}

async function challengeReply(userId, fromId, accept) {
    const toId = String(userId);
    const from = String(fromId || '');
    const pending = /^[a-f0-9]{24}$/i.test(from) ? await store.takeChallenge(toId, from) : null;
    if (!pending) throw new LudoError('CHALLENGE_EXPIRED', 'انتهت مهلة التحدّي', 410);
    if (!accept) {
        global.io?.to(`user:${from}`).emit('ludo:challenge:declined', { by: toId });
        return { started: false };
    }
    let a; let b;
    try {
        [a, b] = await Promise.all([loadEligible(from), loadEligible(toId)]);
        if (blockedList(a).includes(toId) || blockedList(b).includes(from)) throw new Error('blocked');
        await assertFree(from);
    } catch (e) {
        global.io?.to(`user:${from}`).emit('ludo:challenge:declined', { by: toId });
        throw new LudoError('CHALLENGE_EXPIRED', 'صاحب التحدّي لم يعد متاحاً', 410);
    }
    await assertFree(toId);
    await store.dequeue([from, toId]);
    const record = await service.createMatch({
        players: [playerInfo(a), playerInfo(b)], mode: 'quick', source: 'challenge'
    });
    return { started: true, gameId: record.id };
}

// 👤 بطاقة لاعب (الضغط على اسمه): بيانات عامة + إحصاءات الدوري. لا تُعرض لطرفَي حظر ولا لحساب غير متاح.
async function playerCard(viewerId, targetId) {
    const viewer = await loadEligible(viewerId);
    const gone = () => new LudoError('PLAYER_UNAVAILABLE', 'هذا اللاعب غير متاح', 404);
    const id = String(targetId || '');
    if (!/^[a-f0-9]{24}$/i.test(id)) throw gone();
    const isMe = id === String(viewer._id);
    const user = await User.findById(id)
        .select('name profileImage country createdAt isActive suspension blockedUsers isPremium premiumExpiresAt')
        .lean();
    if (!user || !user.isActive || user.suspension?.isSuspended) throw gone();
    if (!isMe && (blockedList(viewer).includes(id) || blockedList(user).includes(String(viewer._id)))) throw gone();
    const premium = !!user.isPremium && (!user.premiumExpiresAt || new Date(user.premiumExpiresAt) > new Date());
    return {
        player: {
            ...playerInfo(user),
            country: user.country || null,
            joinedAt: user.createdAt ? new Date(user.createdAt).getTime() : null,
            premium,
            isMe,
            canChallenge: !isMe && await mayChallenge(String(viewer._id), id),
            stats: await economy.publicStats(id)
        }
    };
}

async function leaveQueue(userId) {
    await store.dequeue([String(userId)]);
    return { queued: false };
}

// يكوّن مجموعات متوافقة (بلا طرفَي حظر) — الدوري برسوم ← مستوى ← الأقرب (matchmaking.js)، والودّي بترتيب الانضمام.
// fillBots: من انتظر BOT_FILL_MS تكتمل مجموعته ببوتات.
async function tryMatch(queueKey, { fillBots = false, now = Date.now() } = {}) {
    const pool = poolOf(queueKey);
    const { mode, size } = pool;
    return store.withLock(`queue:${pool.lock}`, async () => {
        const entries = (await Promise.all(pool.keys.map(k => store.queueEntries(k)))).flat()
            // طابور قديم بلا fee (قبل النشر) — يُشتقّ من دوريه
            .map(e => (e.league && !e.fee ? { ...e, fee: economy.assertLeague(e.league).fee } : e));
        const started = [];
        for (const { members: group, fee } of planGroups(entries, { size, now, windows: windows(), fillBots })) {
            // دوري الأدنى رسوماً في المجموعة — بمعرّفه لا برسومه (قد تتغيّر الرسوم من اللوحة أثناء الانتظار)
            const lowest = fee ? group.reduce((m, g) => (g.fee < m.fee ? g : m)) : null;
            const league = lowest?.league || null;
            const stake = league ? economy.stakeFor(league, mode, size) : null;
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
        }
        return started;
    }, { waitMs: 1500 });
}

let sweepTimer = null;
function startLudoLobbySweeper() {
    if (sweepTimer) return;
    sweepTimer = setInterval(async () => {
        try {
            // طوابير الدوري الثلاثة مجمّع واحد — يُطابَق مرة لكل دورة
            const seen = new Set();
            const keys = (await store.activeQueueKeys()).filter(k => {
                const lock = poolOf(k).lock;
                if (seen.has(lock)) return false;
                seen.add(lock);
                return true;
            });
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
    deviceIds,
    claimMission,
    playerCard,
    challenge,
    challengeReply,
    claimDaily,
    storeInfo,
    buyCoins,
    redeemPurchase,
    adStart,
    adClaim,
    leaderboard,
    prizeSeen,
    startLudoLobbySweeper,
    stopLudoLobbySweeper,
    constants: { BOT_FILL_MS }
};
