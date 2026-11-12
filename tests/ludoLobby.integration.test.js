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
