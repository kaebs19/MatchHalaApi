// اختبار تكامل هلا لودو: Redis حقيقي (قاعدة 9 محلياً) + مستخدمون وهميون بلا Mongo
// node --test tests/ludoLobby.integration.test.js   (يُتخطّى إن لم يتوفر Redis)
process.env.REDIS_URL = process.env.LUDO_TEST_REDIS || 'redis://127.0.0.1:6379/9';
process.env.LUDO_TURN_MS = '300';
process.env.LUDO_BOT_FILL_MS = '200';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

// ── مستخدمون وهميون ──
const users = new Map();
const oid = () => new mongoose.Types.ObjectId().toString();
function addUser(patch = {}) {
    const id = oid();
    users.set(id, {
        _id: id, name: `u${users.size + 1}`, profileImage: null, role: 'admin', isActive: true,
        suspension: {}, bannedWords: {}, blockedUsers: [], ...patch
    });
    return id;
}
const User = require('../models/User');
User.findById = (id) => ({ select: () => ({ lean: async () => users.get(String(id)) || null }) });

const Settings = require('../models/Settings');
let gamesTab = 'admins';
Settings.findOne = () => ({ select: () => ({ lean: async () => ({ gamesTab }) }) });

const LudoMatch = require('../models/LudoMatch');
const saved = [];
LudoMatch.create = async (doc) => { saved.push(doc); return doc; };

// ── محافظ وهمية (models/LudoWallet) — تنفّذ الاستعلامات الذرّية التي يستعملها economy.js ──
const LudoWallet = require('../models/LudoWallet');
const wallets = new Map();
const walletMatches = (w, filter) => {
    if (!w) return false;
    if (filter.coins?.$gte !== undefined && !(w.coins >= filter.coins.$gte)) return false;
    if (filter.gems?.$gte !== undefined && !((w.gems || 0) >= filter.gems.$gte)) return false;
    if (filter.gems?.$exists === false && w.gems !== undefined) return false;
    if (typeof filter.adToken === 'string' && w.adToken !== filter.adToken) return false;
    if (typeof filter.weekKey === 'string' && w.weekKey !== filter.weekKey) return false;
    if (filter.weekPoints?.$gt !== undefined && !((w.weekPoints || 0) > filter.weekPoints.$gt)) return false;
    if (filter.$or) {
        const ok = filter.$or.some(c => c.dailyClaimedAt === null
            ? w.dailyClaimedAt === null
            : w.dailyClaimedAt !== null && w.dailyClaimedAt <= c.dailyClaimedAt.$lte);
        if (!ok) return false;
    }
    return true;
};
const walletApply = (w, update) => {
    for (const [k, v] of Object.entries(update.$inc || {})) w[k] = (w[k] || 0) + v;
    for (const [k, v] of Object.entries(update.$set || {})) {
        if (k.includes('.')) { const [a, b] = k.split('.'); w[a] = { ...(w[a] || {}), [b]: v }; } else w[k] = v;
    }
};
LudoWallet.findOneAndUpdate = (filter, update, opts = {}) => ({
    lean: async () => {
        const id = String(filter.user);
        let w = wallets.get(id);
        if (!w && opts.upsert) {
            w = { user: id, coins: 0, played: 0, wins: 0, losses: 0, dailyClaimedAt: null, weekKey: null, ...(update.$setOnInsert || {}) };
            wallets.set(id, w);
            return { ...w };
        }
        if (!walletMatches(w, filter)) return null;
        walletApply(w, update);
        return { ...w };
    }
});
LudoWallet.updateOne = async (filter, update) => {
    const w = wallets.get(String(filter.user));
    if (w) walletApply(w, update);
};
// find(...).sort().limit().select().populate().lean() — ترتيب تنازلي بـ weekPoints
LudoWallet.find = (filter) => {
    let rows = [...wallets.values()].filter(w => walletMatches(w, filter))
        .sort((a, b) => (b.weekPoints || 0) - (a.weekPoints || 0));
    let populate = false;
    const chain = {
        sort: () => chain,
        limit: (n) => { rows = rows.slice(0, n); return chain; },
        select: () => chain,
        populate: () => { populate = true; return chain; },
        lean: async () => rows.map(w => ({ ...w, user: populate ? (users.get(w.user) || null) : w.user }))
    };
    return chain;
};
LudoWallet.countDocuments = async (filter) => [...wallets.values()].filter(w => walletMatches(w, filter)).length;

const LudoSeason = require('../models/LudoSeason');
const seasons = new Map();
LudoSeason.create = async (doc) => {
    if (seasons.has(doc.weekKey)) { const e = new Error('dup'); e.code = 11000; throw e; }
    seasons.set(doc.weekKey, doc);
    return doc;
};

const LudoPurchase = require('../models/LudoPurchase');
const purchases = new Map();
LudoPurchase.create = async (doc) => {
    if (purchases.has(doc.transactionId)) { const e = new Error('dup'); e.code = 11000; throw e; }
    purchases.set(doc.transactionId, doc);
    return doc;
};
LudoPurchase.findOne = (f) => ({ select: () => ({ lean: async () => purchases.get(f.transactionId) || null }) });

// تحقق أبل وهمي: الـ JWS هنا JSON مباشر
const apple = require('../utils/appleTransactions');
apple.verifySignedTransaction = async (jws) => {
    const t = JSON.parse(jws);
    if (t.bad) throw new Error('INVALID_JWS');
    return { transactionId: t.id, originalTransactionId: t.id, productId: t.productId, revoked: !!t.revoked, environment: 'Sandbox' };
};

const coinsOf = (id) => wallets.get(String(id))?.coins;

// ── سوكت وهمي يلتقط البثّ ──
const emitted = [];
global.io = {
    to: (rooms) => ({ emit: (event, payload) => emitted.push({ rooms: [].concat(rooms), event, payload }) })
};
const eventsFor = (userId, event) =>
    emitted.filter(e => e.event === event && e.rooms.includes(`user:${userId}`)).map(e => e.payload);

const store = require('../utils/ludo/store');
const service = require('../utils/ludo/service');
const lobby = require('../utils/ludo/lobby');
const economy = require('../utils/ludo/economy');
const { getClient } = require('../utils/redisClient');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

let redisOk = false;
test.before(async () => {
    const c = await getClient();
    if (!c) return;
    redisOk = true;
    await c.flushDb();
});
test.after(async () => {
    const c = await getClient();
    if (c) { await c.flushDb(); await c.quit(); }
});

const maybe = (name, fn) => test(name, async (t) => {
    if (!redisOk) return t.skip('Redis غير متاح');
    await fn(t);
});

// يلعب حتى النهاية: البشر بأول حركة مسموحة، والبوتات بالمؤقّت
async function playToEnd(gameId, limit = 4000) {
    for (let i = 0; i < limit; i++) {
        const rec = await store.getGame(gameId);
        if (rec.state.phase === 'ended') return rec;
        const seat = rec.state.seats[rec.state.turn];
        const isBot = rec.meta.players.find(p => p.id === seat.id).isBot || seat.isBot;
        if (isBot) {
            await service.processDue(gameId, Date.now() + 60_000);
        } else if (rec.state.phase === 'roll') {
            await service.playerRoll(seat.id, gameId, rec.state.version);
        } else if (rec.state.legalMoves.length === 0) {
            await service.playerPass(seat.id, gameId, rec.state.version);
        } else {
            await service.playerMove(seat.id, gameId, rec.state.legalMoves[0].token, rec.state.version);
        }
    }
    throw new Error('لم تنتهِ المباراة');
}

maybe('الطابور: لاعبان ← مباراة، والأفعال تُبثّ، والنهاية تُحفظ مرة', async () => {
    const a = addUser(); const b = addUser();
    assert.equal((await lobby.joinQueue(a, { mode: 'quick', size: 2 })).queued, true);
    await lobby.joinQueue(b, { mode: 'quick', size: 2 });

    const gameId = await store.getUserGame(a);
    assert.ok(gameId);
    assert.equal(await store.getUserGame(b), gameId);
    assert.equal(eventsFor(a, 'ludo:match-found').length, 1);
    assert.equal(eventsFor(b, 'ludo:match-found').length, 1);

    const rec = await store.getGame(gameId);
    const notTurn = rec.state.seats[1 - rec.state.turn].id;
    await assert.rejects(service.playerRoll(notTurn, gameId), { code: 'NOT_YOUR_TURN' });
    await assert.rejects(service.playerRoll(addUser(), gameId), { code: 'NOT_IN_GAME' });

    await assert.rejects(lobby.joinQueue(a, { mode: 'quick', size: 2 }), { code: 'IN_GAME' });

    const end = await playToEnd(gameId);
    assert.equal(end.state.phase, 'ended');
    assert.equal(saved.filter(s => s.gameId === gameId).length, 1);
    assert.equal(await store.getUserGame(a), null);
    assert.equal(eventsFor(a, 'ludo:ended').length, 1);
    assert.ok(eventsFor(b, 'ludo:state').length > 3);
});

maybe('رميتان متزامنتان: واحدة تنجح والأخرى تُرفض', async () => {
    const a = addUser(); const b = addUser();
    await lobby.joinQueue(a, { mode: 'classic', size: 2 });
    await lobby.joinQueue(b, { mode: 'classic', size: 2 });
    const gameId = await store.getUserGame(a);
    const rec = await store.getGame(gameId);
    const cur = rec.state.seats[rec.state.turn].id;
    const v = rec.state.version;
    const results = await Promise.allSettled([service.playerRoll(cur, gameId, v), service.playerRoll(cur, gameId, v)]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    assert.match(results.find(r => r.status === 'rejected').reason.code, /STALE_VERSION|NOT_ROLL_PHASE/);
    await service.playerLeave(a, gameId);
});

maybe('المهلة: المؤقّت يلعب عن الغائب ويحسب الدور فائتاً', async () => {
    const a = addUser(); const b = addUser();
    await lobby.joinQueue(a, { mode: 'classic', size: 2 });
    await lobby.joinQueue(b, { mode: 'classic', size: 2 });
    const gameId = await store.getUserGame(a);
    const before = await store.getGame(gameId);
    const absent = before.state.seats[before.state.turn].id;
    await sleep(350);
    await service.tick();
    const after = await store.getGame(gameId);
    assert.ok(after.state.version > before.state.version);
    const seat = after.state.seats.find(s => s.id === absent);
    assert.equal(seat.missed, 1);
    await service.playerLeave(b, gameId);
    assert.equal((await store.getGame(gameId)).state.phase, 'ended');
});

maybe('طرفا حظر لا يُجمعان، وبعد المهلة يلعب كلٌّ مع بوت', async () => {
    const a = addUser();
    const b = addUser({ blockedUsers: [a] });
    await lobby.joinQueue(a, { mode: 'quick', size: 2 });
    await lobby.joinQueue(b, { mode: 'quick', size: 2 });
    assert.equal(await store.getUserGame(a), null);
    assert.equal(await store.getUserGame(b), null);

    await sleep(250);
    await lobby.tryMatch('quick:2', { fillBots: true });
    const ga = await store.getUserGame(a);
    const gb = await store.getUserGame(b);
    assert.ok(ga && gb && ga !== gb);
    const rec = await store.getGame(ga);
    assert.equal(rec.meta.players.filter(p => p.isBot).length, 1);
    await service.playerLeave(a, ga);
    await service.playerLeave(b, gb);
});

maybe('ضدّ الكمبيوتر: البوتات تلعب بالمؤقّت حتى النهاية', async () => {
    const a = addUser();
    const game = (await lobby.startSolo(a, { mode: 'quick', size: 4 }));
    assert.equal(game.players.filter(p => p.isBot).length, 3);
    const end = await playToEnd(game.gameId);
    assert.equal(end.state.phase, 'ended');
    assert.ok(saved.some(s => s.gameId === game.gameId && s.source === 'solo'));
});

maybe('الغرفة بالرمز: انضمام، حظر، وبدء المضيف ببوتات', async () => {
    const host = addUser(); const friend = addUser(); const blocker = addUser({ blockedUsers: [host] });
    const room = await lobby.createRoom(host, { mode: 'classic', size: 4 });
    assert.match(room.code, /^\d{4}$/);
    await assert.rejects(lobby.joinQueue(host, { mode: 'classic', size: 2 }), { code: 'IN_ROOM' });

    const joined = await lobby.joinRoom(friend, room.code);
    assert.equal(joined.room.players.length, 2);
    assert.ok(eventsFor(host, 'ludo:room').length >= 1);

    await assert.rejects(lobby.joinRoom(blocker, room.code), { code: 'ROOM_UNAVAILABLE' });
    await assert.rejects(lobby.startRoom(friend, room.code), { code: 'NOT_HOST' });
    await assert.rejects(lobby.joinRoom(addUser(), '0000'), { code: 'ROOM_NOT_FOUND' });

    const started = await lobby.startRoom(host, room.code);
    assert.equal(started.game.players.filter(p => p.isBot).length, 2);
    assert.equal(await store.getRoom(room.code), null);
    assert.equal(await store.getUserRoom(friend), null);
    await service.playerLeave(host, started.game.gameId);
    await service.playerLeave(friend, started.game.gameId);
});

maybe('الغرفة تبدأ وحدها حين تكتمل، وخروج المضيف يغلقها', async () => {
    const h = addUser(); const f = addUser();
    const room = await lobby.createRoom(h, { mode: 'quick', size: 2 });
    const r = await lobby.joinRoom(f, room.code);
    assert.equal(r.started, true);
    await service.playerLeave(h, r.game.gameId);

    const h2 = addUser(); const f2 = addUser();
    const room2 = await lobby.createRoom(h2, { mode: 'classic', size: 4 });
    await lobby.joinRoom(f2, room2.code);
    await lobby.leaveRoom(h2);
    assert.equal(await store.getRoom(room2.code), null);
    assert.ok(eventsFor(f2, 'ludo:room').some(p => p.closed));
});

maybe('الأهلية: المعلَّق والمفتاح المطفأ والنمط الخاطئ', async () => {
    const s = addUser({ suspension: { isSuspended: true, suspendedUntil: null } });
    await assert.rejects(lobby.joinQueue(s, { mode: 'classic', size: 2 }), { code: 'ACCOUNT_RESTRICTED' });
    const normal = addUser({ role: 'user' });
    await assert.rejects(lobby.startSolo(normal, { mode: 'classic', size: 2 }), { code: 'GAMES_DISABLED' });
    await assert.rejects(lobby.joinQueue(addUser(), { mode: 'teams', size: 2 }), { code: 'BAD_PLAYERS' });
    await assert.rejects(lobby.joinQueue(addUser(), { mode: 'nope', size: 2 }), { code: 'BAD_MODE' });
});

maybe('السوكت: ack موحّد، والعبارات من القائمة فقط، والملصق المدفوع لهلا+', async () => {
    const { registerLudoHandlers } = require('../utils/ludo/socketHandlers');
    const makeSocket = (userId, user) => {
        const handlers = {};
        return {
            userId, user,
            on: (ev, fn) => { handlers[ev] = fn; },
            call: (ev, payload) => new Promise(res => handlers[ev](payload, res))
        };
    };
    const a = addUser(); const b = addUser();
    const fakeIo = { ...global.io, in: () => ({ fetchSockets: async () => [] }) };
    const sa = makeSocket(a, users.get(a)); registerLudoHandlers(fakeIo, sa);
    const sb = makeSocket(b, { ...users.get(b), isPremium: true }); registerLudoHandlers(fakeIo, sb);

    assert.deepEqual(await sa.call('ludo:resume', {}), { ok: true, game: null });
    const bad = await sa.call('ludo:queue:join', { mode: 'x', size: 2 });
    assert.equal(bad.ok, false); assert.equal(bad.code, 'BAD_MODE');

    assert.equal((await sa.call('ludo:queue:join', { mode: 'classic', size: 2 })).ok, true);
    await sb.call('ludo:queue:join', { mode: 'classic', size: 2 });
    const { game } = await sa.call('ludo:resume', {});
    assert.ok(game.gameId);

    assert.equal((await sa.call('ludo:emote', { gameId: game.gameId, emote: 'hack <script>' })).code, 'BAD_EMOTE');
    assert.equal((await sa.call('ludo:emote', { gameId: game.gameId, emote: 'love' })).code, 'PREMIUM_REQUIRED');
    assert.equal((await sb.call('ludo:emote', { gameId: game.gameId, emote: 'love' })).ok, true);
    assert.equal((await sa.call('ludo:emote', { gameId: game.gameId, emote: 'laugh' })).ok, true);
    assert.equal((await sa.call('ludo:emote', { gameId: game.gameId, emote: 'laugh' })).code, 'EMOTE_COOLDOWN');
    assert.ok(eventsFor(b, 'ludo:emote').some(e => e.emote === 'laugh' && e.playerId === a));

    const left = await sa.call('ludo:leave', { gameId: game.gameId });
    assert.equal(left.ok, true);
    assert.equal(left.game.phase, 'ended');
});

maybe('إعادة الرمي والتخطّي عبر الخدمة، والمهلة تتخطّى بلا احتساب خطأ', async () => {
    const a = addUser();
    await lobby.walletInfo(a);
    wallets.get(a).gems = 0;                       // بلا جواهر: المجانية وحدها (المدفوعة في اختبارها)
    const game = await lobby.startSolo(a, { mode: 'classic', size: 2 });
    let rec = await store.getGame(game.gameId);
    // نوصل الدور لـ a برمية بلا حركة (كل القطع في القاعدة)
    for (let i = 0; i < 50; i++) {
        rec = await store.getGame(game.gameId);
        const seat = rec.state.seats[rec.state.turn];
        if (seat.id !== a) { await service.processDue(game.gameId, Date.now() + 60_000); continue; }
        if (rec.state.phase === 'roll') { await service.playerRoll(a, game.gameId, rec.state.version); continue; }
        break;
    }
    rec = await store.getGame(game.gameId);
    assert.equal(rec.state.phase, 'move');
    assert.equal(rec.state.canReroll, true);
    const v = await service.playerReroll(a, game.gameId, rec.state.version);
    assert.equal(v.lastAction.reroll, true);
    assert.equal(v.seats.find(s => s.id === a).rerolls, 0);
    // الإعادة نفسها عشوائية: 6 ← يبقى الدور له (CANNOT_REROLL)، وإلا ينتقل الدور (NOT_YOUR_TURN)
    await assert.rejects(service.playerReroll(a, game.gameId, v.version),
        (e) => ['CANNOT_REROLL', 'NOT_YOUR_TURN'].includes(e.code));
    await service.playerLeave(a, game.gameId);
});

maybe('دعوة المحادثة: مباراة ثنائية مربوطة بالرسالة، والنهاية تصل مستمع onFinalize', async () => {
    const a = addUser(); const b = addUser();
    const finished = [];
    service.onFinalize(async (record, ranking) => {
        if (record.meta.link) finished.push({ link: record.meta.link, ranking });
    });
    const messageId = oid();
    const record = await lobby.startInviteMatch(a, b, { mode: 'quick', messageId });
    assert.equal(record.meta.source, 'invite');
    assert.deepEqual(record.meta.players.map(p => p.id), [a, b]);
    assert.equal(record.meta.players.some(p => p.isBot), false);
    assert.equal(eventsFor(a, 'ludo:match-found').some(p => p.gameId === record.id), true);
    assert.equal(eventsFor(b, 'ludo:match-found').some(p => p.gameId === record.id), true);

    // المدعو مشغول بمباراة ← IN_GAME، وصاحب الدعوة مشغول ← INVITER_BUSY
    const c = addUser();
    await assert.rejects(lobby.startInviteMatch(c, b, { messageId: oid() }), { code: 'IN_GAME' });
    await assert.rejects(lobby.startInviteMatch(a, c, { messageId: oid() }), { code: 'INVITER_BUSY' });

    await playToEnd(record.id);
    const hit = finished.find(f => f.link.messageId === messageId);
    assert.ok(hit);
    assert.equal(hit.ranking.length, 2);
});

maybe('دعوة المحادثة: الألعاب مطفأة لغير المشرف ← GAMES_DISABLED', async () => {
    const a = addUser(); const b = addUser({ role: 'user' });
    await assert.rejects(lobby.startInviteMatch(a, b, { messageId: oid() }), { code: 'GAMES_DISABLED' });
});

maybe('«دورك»: onTurn للبشر وحدهم، عند انتقال الدور لا الرمية الإضافية', async () => {
    const a = addUser(); const b = addUser();
    const turns = [];
    service.onTurn((t) => { turns.push(t); });
    const solo = await lobby.startSolo(a, { mode: 'quick', size: 2 });   // a ضدّ بوت
    await playToEnd(solo.gameId, 800).catch(() => {});
    await sleep(20);
    const soloTurns = turns.filter(t => t.gameId === solo.gameId);
    assert.ok(soloTurns.length > 0);
    assert.ok(soloTurns.every(t => t.userId === a));   // لا إشعار للبوت

    const rec = await lobby.startInviteMatch(a, b, { mode: 'quick', messageId: oid() });
    await playToEnd(rec.id);
    await sleep(20);
    const duo = turns.filter(t => t.gameId === rec.id);
    assert.ok(duo.some(t => t.userId === a) && duo.some(t => t.userId === b));
    // لا تكرار متتالٍ للاعب نفسه (الرمية الإضافية لا تُطلق إشعاراً)
    for (let i = 1; i < duo.length; i++) assert.notEqual(duo[i].userId, duo[i - 1].userId);
});

// ───────────── الاقتصاد: الدوريات، رسوم الدخول، الجوائز ─────────────

maybe('الدوري: الرسوم تُخصم عند البدء، الفائز يأخذ الجائزة والخاسر يخسر رسومه — مرة واحدة', async () => {
    const { START_COINS, LEAGUES } = economy.constants;
    const fee = LEAGUES.silver.fee;
    const a = addUser(); const b = addUser();

    const info = await lobby.walletInfo(a);
    assert.equal(info.wallet.coins, START_COINS);
    assert.deepEqual(info.leagues.map(l => l.id), ['bronze', 'silver', 'gold']);
    assert.equal(info.leagues[1].prize.two, fee * 2);

    await lobby.joinQueue(a, { mode: 'quick', size: 2, league: 'silver' });
    assert.equal(coinsOf(a), START_COINS, 'لا خصم أثناء الانتظار');
    await lobby.joinQueue(b, { mode: 'quick', size: 2, league: 'silver' });

    const gameId = await store.getUserGame(a);
    assert.ok(gameId);
    assert.equal(coinsOf(a), START_COINS - fee);
    assert.equal(coinsOf(b), START_COINS - fee);
    assert.deepEqual(service.view(await store.getGame(gameId)).stake, { league: 'silver', fee, prize: fee * 2 });

    const end = await playToEnd(gameId);
    const winner = end.state.winners[0];
    const loser = winner === a ? b : a;
    assert.equal(coinsOf(winner), START_COINS + fee);
    assert.equal(coinsOf(loser), START_COINS - fee);
    assert.equal(wallets.get(winner).wins, 1);
    assert.equal(wallets.get(loser).losses, 1);

    const ended = eventsFor(a, 'ludo:ended').find(e => e.gameId === gameId);
    assert.equal(ended.stake.league, 'silver');
    assert.deepEqual(ended.rewards.find(r => r.id === winner), { id: winner, won: true, prize: fee * 2, delta: fee, points: 30 });
    assert.deepEqual(ended.rewards.find(r => r.id === loser), { id: loser, won: false, prize: 0, delta: -fee, points: 0 });
    const doc = saved.find(s => s.gameId === gameId);
    assert.equal(doc.league, 'silver');
    assert.equal(doc.prize, fee * 2);
});

maybe('الدوري: رصيد لا يكفي، دوري خاطئ، ودوريان مختلفان لا يُجمعان', async () => {
    const poor = addUser();
    await lobby.walletInfo(poor);
    wallets.get(poor).coins = 100;
    await assert.rejects(lobby.joinQueue(poor, { mode: 'quick', size: 2, league: 'bronze' }), { code: 'NOT_ENOUGH_COINS' });
    await assert.rejects(lobby.joinQueue(poor, { mode: 'quick', size: 2, league: 'diamond' }), { code: 'BAD_LEAGUE' });
    assert.equal(coinsOf(poor), 100);

    const a = addUser(); const b = addUser();
    await lobby.joinQueue(a, { mode: 'quick', size: 2, league: 'bronze' });
    await lobby.joinQueue(b, { mode: 'quick', size: 2, league: 'silver' });
    assert.equal(await store.getUserGame(a), null);
    assert.equal(await store.getUserGame(b), null);
    // الخروج من الطابور بلا خصم
    await lobby.leaveQueue(a); await lobby.leaveQueue(b);
    assert.equal(coinsOf(a), economy.constants.START_COINS);
});

maybe('الدوري مع بوت: مقعد البوت يدخل الجائزة، والودّية (غرفة/كمبيوتر/طابور بلا دوري) بلا رسوم', async () => {
    const { START_COINS, LEAGUES } = economy.constants;
    const fee = LEAGUES.bronze.fee;
    const a = addUser();
    await lobby.joinQueue(a, { mode: 'quick', size: 2, league: 'bronze' });
    await sleep(250);
    const [gameId] = await lobby.tryMatch('quick:2:bronze', { fillBots: true });
    assert.ok(gameId);
    assert.equal(coinsOf(a), START_COINS - fee);
    const end = await playToEnd(gameId);
    assert.equal(coinsOf(a), end.state.winners.includes(a) ? START_COINS + fee : START_COINS - fee);

    const before = coinsOf(a);
    const solo = await lobby.startSolo(a, { mode: 'quick', size: 2 });
    assert.equal(solo.stake, null);
    await playToEnd(solo.gameId);
    assert.equal(coinsOf(a), before);
    assert.equal(wallets.get(a).played, 1, 'الودّية لا تُحسب في العدّادات');
});

maybe('الدوري: خصم يفشل عند البدء (الرصيد تغيّر) ← يُستبعد اللاعب ويُبلَّغ', async () => {
    const a = addUser(); const b = addUser();
    await lobby.joinQueue(a, { mode: 'quick', size: 2, league: 'gold' }).catch(() => {});
    // رصيد البداية أقل من رسوم الذهب؟ نضبطه صراحةً
    await lobby.walletInfo(a); await lobby.walletInfo(b);
    const fee = economy.constants.LEAGUES.gold.fee;
    wallets.get(a).coins = fee; wallets.get(b).coins = fee;
    await lobby.joinQueue(a, { mode: 'quick', size: 2, league: 'gold' });
    wallets.get(a).coins = 0;                      // صُرف في مكان آخر أثناء الانتظار
    await lobby.joinQueue(b, { mode: 'quick', size: 2, league: 'gold' });
    assert.equal(await store.getUserGame(a), null);
    assert.equal(eventsFor(a, 'ludo:queue-dropped').length, 1);
    const gameId = await store.getUserGame(b);
    assert.ok(gameId, 'الثاني يلعب مع بوت');
    assert.equal(coinsOf(b), 0);
    await service.playerLeave(b, gameId);
});

maybe('المكافأة اليومية: مرة كل 24 ساعة', async () => {
    const a = addUser();
    const { START_COINS, DAILY_BONUS } = economy.constants;
    const first = await lobby.claimDaily(a);
    assert.equal(first.wallet.coins, START_COINS + DAILY_BONUS);
    assert.ok(first.wallet.dailyAvailableAt > Date.now());
    await assert.rejects(lobby.claimDaily(a), { code: 'DAILY_NOT_READY' });
    wallets.get(a).dailyClaimedAt = new Date(Date.now() - 25 * 3600 * 1000);
    assert.equal((await lobby.claimDaily(a)).wallet.coins, START_COINS + 2 * DAILY_BONUS);
});

// ───────────── الجواهر: إعادة الرمي المدفوعة، نرد الحظ، المتجر ─────────────

// يوصل دور اللاعب إلى رمية مفتوحة (phase move) ثم يعيد fn — البوت خصمه
async function untilMyMove(gameId, me, limit = 400) {
    for (let i = 0; i < limit; i++) {
        const rec = await store.getGame(gameId);
        if (rec.state.phase === 'ended') return null;
        const seat = rec.state.seats[rec.state.turn];
        if (seat.id !== me) { await service.processDue(gameId, Date.now() + 60_000); continue; }
        if (rec.state.phase === 'roll') { await service.playerRoll(me, gameId, rec.state.version); continue; }
        return rec;
    }
    return null;
}

maybe('إعادة الرمي بالجواهر: بعد المجانية، السعر يتصاعد 2 ← 4 ← 8 ثم تنتهي', async () => {
    const a = addUser();
    await lobby.walletInfo(a);
    assert.equal(wallets.get(a).gems, economy.constants.START_GEMS);
    const game = await lobby.startSolo(a, { mode: 'classic', size: 2 });
    const paid = [];
    let freeUsed = false;
    for (let guard = 0; guard < 60 && paid.length < 3; guard++) {
        const rec = await untilMyMove(game.gameId, a);
        if (!rec) break;
        const v = service.view(rec);
        if (v.canReroll) {
            if (v.rerollCost === 0) { freeUsed = true; }
            else paid.push(v.rerollCost);
            const before = wallets.get(a).gems;
            const after = await service.playerReroll(a, game.gameId, v.version);
            assert.equal(before - wallets.get(a).gems, v.rerollCost);
            assert.equal(!!after.lastAction.paid, v.rerollCost > 0);
            continue;
        }
        if (rec.state.legalMoves.length === 0) await service.playerPass(a, game.gameId, rec.state.version);
        else await service.playerMove(a, game.gameId, rec.state.legalMoves[0].token, rec.state.version);
    }
    assert.ok(freeUsed, 'المجانية أولاً');
    assert.deepEqual(paid, [2, 4, 8]);
    assert.equal(wallets.get(a).gems, economy.constants.START_GEMS - 14);
    const rec = await untilMyMove(game.gameId, a);
    if (rec) assert.equal(service.view(rec).canReroll, false, 'لا إعادة رابعة');
    await service.playerLeave(a, game.gameId).catch(() => {});
});

maybe('بلا جواهر: لا إعادة مدفوعة ولا انتظار قرار، ونرد الحظ يُرفض', async () => {
    const a = addUser();
    await lobby.walletInfo(a);
    wallets.get(a).gems = 0;
    const game = await lobby.startSolo(a, { mode: 'classic', size: 2 });
    await assert.rejects(service.playerBoost(a, game.gameId), { code: 'NOT_ENOUGH_GEMS' });
    let rec = await untilMyMove(game.gameId, a);
    if (rec && service.view(rec).rerollCost === 0) {
        await service.playerReroll(a, game.gameId, rec.state.version);
        rec = await untilMyMove(game.gameId, a);
    }
    if (rec) assert.equal(service.view(rec).canReroll && service.view(rec).rerollCost > 0, false);
    await service.playerLeave(a, game.gameId).catch(() => {});
});

maybe('نرد الحظ: يُخصم مرة، يظهر للجميع، ويرفع نسبة الـ 6 فعلاً', async () => {
    const a = addUser(); const b = addUser();
    await lobby.joinQueue(a, { mode: 'quick', size: 2 });
    await lobby.joinQueue(b, { mode: 'quick', size: 2 });
    const gameId = await store.getUserGame(a);
    const before = (await store.getGame(gameId)).state.version;
    const v = await service.playerBoost(a, gameId);
    assert.deepEqual(v.boosts, [a]);
    assert.equal(v.version, before + 1);
    assert.equal(wallets.get(a).gems, economy.constants.START_GEMS - economy.constants.BOOST_COST);
    assert.ok(eventsFor(b, 'ludo:state').some(e => e.gameId === gameId && e.boosts.includes(a)), 'الخصم يراه');
    await assert.rejects(service.playerBoost(a, gameId), { code: 'BOOST_ACTIVE' });
    await assert.rejects(service.playerBoost(addUser(), gameId), { code: 'NOT_IN_GAME' });

    const state = { turn: 0, seats: [{ id: 'x', tokens: [5, 9] }] };
    const sixes = (boosted) => { let n = 0; for (let i = 0; i < 30000; i++) if (service.rollDie(state, boosted) === 6) n++; return n / 30000; };
    const plain = sixes(false), lucky = sixes(true);
    assert.ok(plain > 0.21 && plain < 0.275, `عادي ${plain}`);
    assert.ok(lucky > 0.31 && lucky < 0.375, `محظوظ ${lucky}`);
    await service.playerLeave(a, gameId);
});

maybe('المتجر: عملات بالجواهر (ذرّي)، وشراء الجواهر يُمنح مرة لكل معاملة', async () => {
    const a = addUser(); const b = addUser();
    const { START_COINS, START_GEMS } = economy.constants;
    const info = await lobby.storeInfo(a);
    assert.equal(info.store.coinPacks.length, 3);
    assert.equal(info.store.gemProducts.length, 3);

    assert.equal((await lobby.buyCoins(a, 'coins_s')).wallet.coins, START_COINS + 5000);
    assert.equal(wallets.get(a).gems, START_GEMS - 10);
    await assert.rejects(lobby.buyCoins(a, 'coins_m'), { code: 'NOT_ENOUGH_GEMS' });
    await assert.rejects(lobby.buyCoins(a, 'nope'), { code: 'BAD_PACK' });
    assert.equal(wallets.get(a).coins, START_COINS + 5000);

    const jws = JSON.stringify({ id: 't1', productId: 'com.app.hala.ludo.gems60' });
    const first = await lobby.redeemPurchase(a, jws);
    assert.equal(first.granted, 60);
    assert.equal(first.wallet.gems, START_GEMS - 10 + 60);
    const again = await lobby.redeemPurchase(a, jws);
    assert.equal(again.granted, 0);
    assert.equal(again.wallet.gems, START_GEMS - 10 + 60);
    await assert.rejects(lobby.redeemPurchase(b, jws), { code: 'IAP_IN_USE' });
    await assert.rejects(lobby.redeemPurchase(a, JSON.stringify({ id: 't2', productId: 'com.app.hala.monthly' })), { code: 'IAP_UNKNOWN_PRODUCT' });
    await assert.rejects(lobby.redeemPurchase(a, JSON.stringify({ id: 't3', productId: 'com.app.hala.ludo.gems60', revoked: true })), { code: 'IAP_REVOKED' });
    await assert.rejects(lobby.redeemPurchase(a, JSON.stringify({ bad: true })), { code: 'IAP_VERIFICATION_FAILED' });
});

maybe('الإحصاءات والترتيب: النجوم والسلسلة، الترتيب الأسبوعي بلا المحظورين، والجوائز مرة واحدة', async () => {
    wallets.clear();
    const a = addUser(); const b = addUser(); const c = addUser();
    const now = Date.UTC(2026, 10, 11);           // أربعاء
    await economy.settle(a, { won: true, prize: 1000, league: 'bronze' }, now);
    await economy.settle(a, { won: true, prize: 10000, league: 'silver' }, now);
    await economy.settle(b, { won: true, prize: 40000, league: 'gold' }, now);
    await economy.settle(c, { won: false, prize: 0, league: 'gold' }, now);
    await economy.settle(a, { won: false, prize: 0, league: 'bronze' }, now);

    const wa = economy.walletView(wallets.get(a), now);
    assert.deepEqual([wa.wins, wa.losses, wa.winStreak, wa.bestStreak, wa.weekPoints, wa.coinsWon], [2, 1, 0, 2, 40, 11000]);
    assert.equal(economy.walletView(wallets.get(b), now).tier.id, 'silver');
    assert.equal(wa.tier.next, 100);

    let board = await economy.leaderboard(users.get(a), now);
    assert.deepEqual(board.top.map(r => r.id), [b, a]);
    assert.deepEqual(board.me, { rank: 2, points: 40 });
    assert.equal(board.endsAt, Date.UTC(2026, 10, 16));
    users.get(b).blockedUsers = [a];              // b حظر a ← لا يراه a
    board = await economy.leaderboard(users.get(a), now);
    assert.deepEqual(board.top.map(r => r.id), [a]);

    // أسبوع جديد: نقاط الأسبوع تبدأ من صفر، والمجموع يبقى
    const next = now + 7 * 24 * 3600 * 1000;
    assert.equal(economy.walletView(wallets.get(a), next).weekPoints, 0);
    const gemsB = wallets.get(b).gems;
    assert.equal(await economy.awardLastWeek(next), 2);
    assert.equal(wallets.get(b).gems, gemsB + 50);
    assert.deepEqual(economy.walletView(wallets.get(b), next).prize, { weekKey: '2026-11-09', rank: 1, gems: 50, coins: 50000 });
    assert.equal(await economy.awardLastWeek(next), 0, 'لا توزيع ثانٍ');
    assert.equal(wallets.get(b).gems, gemsB + 50);
    await lobby.prizeSeen(b);
    assert.equal(economy.walletView(wallets.get(b), next).prize, null);
    await economy.settle(a, { won: true, prize: 1000, league: 'bronze' }, next);
    assert.equal(economy.walletView(wallets.get(a), next).weekPoints, 10);
    assert.equal(wallets.get(a).points, 50);
});

maybe('مكافأة الإعلان: رمز يُستعمل مرة، بعد مدة الإعلان، وبسقف يومي', async () => {
    const a = addUser();
    const { START_COINS, START_GEMS, AD_REWARD, AD_DAILY_MAX, AD_MIN_MS } = economy.constants;
    const t0 = Date.UTC(2026, 10, 13, 10);
    assert.deepEqual((await lobby.walletInfo(a)).wallet.ad.max, AD_DAILY_MAX);

    const { token } = await economy.startAd(a, t0);
    await assert.rejects(economy.claimAd(a, token, t0 + 1000), { code: 'AD_NOT_VERIFIED' });      // قبل انتهاء الإعلان
    await assert.rejects(economy.claimAd(a, 'wrong', t0 + AD_MIN_MS), { code: 'AD_NOT_VERIFIED' });
    const w = await economy.claimAd(a, token, t0 + AD_MIN_MS);
    assert.equal(w.coins, START_COINS + AD_REWARD.coins);
    assert.equal(w.gems, START_GEMS + AD_REWARD.gems);
    await assert.rejects(economy.claimAd(a, token, t0 + AD_MIN_MS + 1), { code: 'AD_NOT_VERIFIED' }); // مرة واحدة

    for (let i = 1; i < AD_DAILY_MAX; i++) {
        const r = await economy.startAd(a, t0 + i * 60000);
        await economy.claimAd(a, r.token, t0 + i * 60000 + AD_MIN_MS);
    }
    assert.equal(economy.walletView(wallets.get(a), t0 + 3600000).ad.left, 0);
    await assert.rejects(economy.startAd(a, t0 + 3600000), { code: 'AD_LIMIT' });
    assert.equal(wallets.get(a).gems, START_GEMS + AD_REWARD.gems * AD_DAILY_MAX);
    // يوم جديد
    const next = t0 + 24 * 3600 * 1000;
    assert.equal(economy.walletView(wallets.get(a), next).ad.left, AD_DAILY_MAX);
    const r = await economy.startAd(a, next);
    await economy.claimAd(a, r.token, next + AD_MIN_MS);
    assert.equal(wallets.get(a).adCount, 1);
});

maybe('المتجر: منتجات العملات والباقات المجمّعة تُمنح كاملة ومرة واحدة', async () => {
    const a = addUser();
    const { START_COINS, START_GEMS } = economy.constants;
    const info = await lobby.storeInfo(a);
    assert.deepEqual(info.store.coinProducts.map(p => p.coins), [50000, 300000, 1000000]);
    assert.deepEqual(info.store.bundles.map(b => b.id), ['starter', 'pro']);
    assert.equal(info.store.gemProducts.length, 3, 'الباقات لا تظهر ضمن الجواهر');

    const coins = await lobby.redeemPurchase(a, JSON.stringify({ id: 'c1', productId: 'com.app.hala.ludo.coins300k' }));
    assert.equal(coins.grantedCoins, 300000);
    assert.equal(coins.wallet.coins, START_COINS + 300000);
    assert.equal(coins.wallet.gems, START_GEMS);

    const bundle = await lobby.redeemPurchase(a, JSON.stringify({ id: 'b1', productId: 'com.app.hala.ludo.bundle.starter' }));
    assert.equal(bundle.granted, 60);
    assert.equal(bundle.grantedCoins, 50000);
    assert.equal(bundle.wallet.coins, START_COINS + 350000);
    assert.equal(bundle.wallet.gems, START_GEMS + 60);

    const again = await lobby.redeemPurchase(a, JSON.stringify({ id: 'b1', productId: 'com.app.hala.ludo.bundle.starter' }));
    assert.equal(again.grantedCoins, 0);
    assert.equal(wallets.get(a).coins, START_COINS + 350000);
});

maybe('الكلاسيكي أُلغي: أي طلب به أو بلا نمط يُلعب سريعاً (قطعتان)', async () => {
    const a = addUser(); const b = addUser(); const c = addUser();
    const solo = await lobby.startSolo(a, { mode: 'classic', size: 2 });
    assert.equal(solo.mode, 'quick');
    assert.equal(solo.seats[0].tokens.length, 2);
    await service.playerLeave(a, solo.gameId);

    // classic و quick يلتقيان في الطابور نفسه
    await lobby.joinQueue(b, { mode: 'classic', size: 2 });
    await lobby.joinQueue(c, { mode: 'quick', size: 2 });
    const gameId = await store.getUserGame(b);
    assert.ok(gameId);
    assert.equal(await store.getUserGame(c), gameId);
    await service.playerLeave(b, gameId);
    const room = await lobby.createRoom(addUser(), { mode: 'classic', size: 2 });
    assert.equal(room.mode, 'quick');
});

maybe('ضمان الـ 6: بعد 3 رميات جافة وكل القطع عالقة، الرابعة 6 — والعدّاد يتصفّر', async () => {
    const engine = require('../utils/ludoEngine');
    const { PITY_SIX_AFTER } = service.constants;
    let s = engine.createGame({ players: [{ id: 'a' }, { id: 'b' }], mode: 'quick', options: { rerollsPerPlayer: 0 } });
    for (let i = 0; i < PITY_SIX_AFTER; i++) {
        s = engine.roll(s, { playerId: 'a', rollDie: () => 2 }).state;       // لا حركة ← ينتقل الدور
        assert.equal(s.seats[0].dry, i + 1);
        s = engine.roll(s, { playerId: 'b', rollDie: () => 6 }).state;       // b يخرج قطعة
        s = engine.move(s, { playerId: 'b', token: 0 }).state;
        s = engine.roll(s, { playerId: 'b', rollDie: () => 1 }).state;       // رميته الإضافية
        s = engine.move(s, { playerId: 'b', token: 0 }).state;
    }
    assert.equal(s.seats[s.turn].id, 'a');
    for (let i = 0; i < 50; i++) assert.equal(service.rollDie(s), 6, 'مضمونة');
    s = engine.roll(s, { playerId: 'a', rollDie: service.rollDie }).state;
    assert.equal(s.dice, 6);
    assert.equal(s.seats[0].dry, 0);
    // b له قطعة على المسار ← غير عالق ← لا عدّ
    assert.equal(s.seats[1].dry, 0);
});
