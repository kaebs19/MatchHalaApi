// MatchHala - تخزين مباريات هلا لودو في Redis
//
// ⚠️ لا شيء في ذاكرة العملية: 4 نسخ PM2، ولاعبو المباراة الواحدة قد يتصلون بنسخ مختلفة.
// كل تعديل على مباراة يمرّ بقفل withLock (SET NX PX + حذف مشروط بالرمز) فلا تُطبَّق
// حركتان معاً ولا يسبق المؤقّت حركةَ لاعب.
//
// المفاتيح:
//   ludo:game:<id>        سجلّ المباراة { id, state, meta, deadlineAt }        TTL 3س (يتجدّد)
//   ludo:user:<userId>    معرّف مباراته الجارية                                  TTL 3س
//   ludo:deadlines        ZSET: id → موعد انتهاء الدور (ms)
//   ludo:queue:<key>      ZSET: userId → وقت الانضمام  +  ludo:qentry:<userId> بياناته
//   ludo:room:<code>      غرفة خاصة بانتظار اللاعبين                            TTL 15د
//   ludo:lock:<name>      أقفال

const crypto = require('crypto');
const { getClient } = require('../redisClient');

const GAME_TTL_S = 3 * 60 * 60;
const ROOM_TTL_S = 15 * 60;
const LOCK_TTL_MS = 4000;
const DEADLINES = 'ludo:deadlines';
// مهلة عودة المنقطع في مباراة دوري: العضو `<gameId>|<userId>` والدرجة موعد الحسم
const FORFEITS = 'ludo:forfeits';

class StoreUnavailable extends Error {
    constructor() {
        super('خدمة الألعاب غير متاحة مؤقتاً');
        this.code = 'GAMES_UNAVAILABLE';
        this.status = 503;
    }
}

async function redis() {
    const c = await getClient();
    if (!c) throw new StoreUnavailable();
    return c;
}

const k = {
    game: (id) => `ludo:game:${id}`,
    user: (userId) => `ludo:user:${userId}`,
    queue: (key) => `ludo:queue:${key}`,
    qentry: (userId) => `ludo:qentry:${userId}`,
    room: (code) => `ludo:room:${code}`,
    userRoom: (userId) => `ludo:userroom:${userId}`,
    lock: (name) => `ludo:lock:${name}`,
    quits: (userId) => `ludo:quits:${userId}`,
    quitLevel: (userId) => `ludo:quitlevel:${userId}`,
    quitBan: (userId) => `ludo:quitban:${userId}`,
    lastResult: (userId) => `ludo:lastresult:${userId}`,
    rival: (a, b) => `ludo:rival:${[String(a), String(b)].sort().join(':')}`,
    challenge: (to, from) => `ludo:challenge:${to}:${from}`,
    challengeCd: (from, to) => `ludo:challengecd:${from}:${to}`
};

// ───────────── القفل ─────────────

const RELEASE = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";

// ينتظر القفل حتى waitMs ثم يرمي LOCK_BUSY
async function withLock(name, fn, { waitMs = 2500 } = {}) {
    const c = await redis();
    const key = k.lock(name);
    const token = crypto.randomBytes(8).toString('hex');
    const until = Date.now() + waitMs;
    while (!(await c.set(key, token, { NX: true, PX: LOCK_TTL_MS }))) {
        if (Date.now() > until) {
            const err = new Error('الطلب مزدحم — حاول مجدداً');
            err.code = 'LOCK_BUSY';
            err.status = 409;
            throw err;
        }
        await new Promise(r => setTimeout(r, 25 + Math.random() * 25));
    }
    try {
        return await fn();
    } finally {
        await c.eval(RELEASE, { keys: [key], arguments: [token] }).catch(() => {});
    }
}

// ───────────── المباريات ─────────────

async function getGame(id) {
    const raw = await (await redis()).get(k.game(id));
    return raw ? JSON.parse(raw) : null;
}

async function saveGame(record) {
    const c = await redis();
    const multi = c.multi().set(k.game(record.id), JSON.stringify(record), { EX: GAME_TTL_S });
    if (record.state.phase === 'ended' || !record.deadlineAt) {
        multi.zRem(DEADLINES, record.id);
    } else {
        multi.zAdd(DEADLINES, { score: record.deadlineAt, value: record.id });
    }
    await multi.exec();
}

async function deleteGame(id) {
    const c = await redis();
    await c.multi().del(k.game(id)).zRem(DEADLINES, id).exec();
}

async function dueGames(now, limit = 50) {
    return (await redis()).zRangeByScore(DEADLINES, '-inf', now, { LIMIT: { offset: 0, count: limit } });
}

async function setUserGame(userIds, gameId) {
    const c = await redis();
    const multi = c.multi();
    userIds.forEach(u => multi.set(k.user(u), gameId, { EX: GAME_TTL_S }));
    await multi.exec();
}

async function getUserGame(userId) {
    return (await redis()).get(k.user(userId));
}

// يمسح الربط فقط إن كان ما زال يشير لهذه المباراة (قد يكون بدأ غيرها)
const CLEAR_IF = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";
async function clearUserGame(userIds, gameId) {
    const c = await redis();
    await Promise.all(userIds.map(u => c.eval(CLEAR_IF, { keys: [k.user(u)], arguments: [gameId] })));
}

// ───────────── مهلة العودة (الدوري) ─────────────

async function addForfeit(gameId, userId, at) {
    await (await redis()).zAdd(FORFEITS, { score: at, value: `${gameId}|${userId}` });
}

async function removeForfeit(gameId, userId) {
    await (await redis()).zRem(FORFEITS, `${gameId}|${userId}`);
}

async function dueForfeits(now, limit = 50) {
    const due = await (await redis()).zRangeByScore(FORFEITS, '-inf', now, { LIMIT: { offset: 0, count: limit } });
    return due.map(v => { const i = v.indexOf('|'); return { gameId: v.slice(0, i), userId: v.slice(i + 1) }; });
}

// ───────────── عقوبة الخروج المتكرر (penalties.js) ─────────────

// يضيف خروجاً ويعيد عددها داخل النافذة
async function addQuit(userId, now, windowMs) {
    const c = await redis();
    const key = k.quits(userId);
    const res = await c.multi()
        .zAdd(key, { score: now, value: `${now}:${crypto.randomBytes(3).toString('hex')}` })
        .zRemRangeByScore(key, '-inf', now - windowMs)
        .zCard(key)
        .expire(key, Math.ceil(windowMs / 1000))
        .exec();
    return Number(res[2]) || 0;
}

// مستوى التصعيد (1، 2، …) — يتصفّر بعد ttl بلا عقوبة جديدة
async function bumpQuitLevel(userId, ttlS) {
    const c = await redis();
    const res = await c.multi().incr(k.quitLevel(userId)).expire(k.quitLevel(userId), ttlS).exec();
    return Number(res[0]) || 1;
}

// المنع يبدأ بصفحة جديدة: الخروجات التي أوجبته لا تُحسب مرة ثانية
async function setQuitBan(userId, until, ms) {
    const c = await redis();
    await c.multi().set(k.quitBan(userId), String(until), { PX: ms }).del(k.quits(userId)).exec();
}

async function getQuitBan(userId) {
    const v = await (await redis()).get(k.quitBan(userId));
    return v ? Number(v) : null;
}

// ───────────── آخر نتيجة (لمن انتهت مباراته وهو غائب) ─────────────

async function setLastResult(userId, result, ttlS = 24 * 60 * 60) {
    await (await redis()).set(k.lastResult(userId), JSON.stringify(result), { EX: ttlS });
}

async function getLastResult(userId) {
    const raw = await (await redis()).get(k.lastResult(userId));
    return raw ? JSON.parse(raw) : null;
}

// ───────────── التحدّي المباشر ─────────────

// لعبا معاً للتوّ ← يحقّ لأيّهما تحدّي الآخر (مباراة ثانية) خلال ttl
async function markRivals(userIds, ttlS) {
    const c = await redis();
    const multi = c.multi();
    for (let i = 0; i < userIds.length; i++) {
        for (let j = i + 1; j < userIds.length; j++) multi.set(k.rival(userIds[i], userIds[j]), '1', { EX: ttlS });
    }
    await multi.exec();
}

async function areRivals(a, b) {
    return !!(await (await redis()).get(k.rival(a, b)));
}

// false إن كان أرسل له للتوّ (مهلة بين تحدٍّ وآخر للشخص نفسه)
async function challengeCooldown(from, to, ms) {
    return !!(await (await redis()).set(k.challengeCd(from, to), '1', { NX: true, PX: ms }));
}

async function setChallenge(to, from, data, ms) {
    await (await redis()).set(k.challenge(to, from), JSON.stringify(data), { PX: ms });
}

// يأخذ التحدّي ويمحوه (يُردّ عليه مرة واحدة)
async function takeChallenge(to, from) {
    // get+del في معاملة واحدة (لا GETDEL: يحتاج Redis 6.2)
    const key = k.challenge(to, from);
    const res = await (await redis()).multi().get(key).del(key).exec();
    return res[0] ? JSON.parse(String(res[0])) : null;
}

// ───────────── طابور المطابقة ─────────────

async function enqueue(queueKey, entry) {
    const c = await redis();
    await c.multi()
        .zAdd(k.queue(queueKey), { score: entry.joinedAt, value: entry.userId })
        .set(k.qentry(entry.userId), JSON.stringify({ ...entry, queueKey }), { EX: 10 * 60 })
        .exec();
}

async function dequeue(userIds) {
    const c = await redis();
    for (const u of userIds) {
        const raw = await c.get(k.qentry(u));
        if (!raw) continue;
        const { queueKey } = JSON.parse(raw);
        await c.multi().zRem(k.queue(queueKey), u).del(k.qentry(u)).exec();
    }
}

async function getQueueEntry(userId) {
    const raw = await (await redis()).get(k.qentry(userId));
    return raw ? JSON.parse(raw) : null;
}

// المنتظرون بترتيب الانضمام مع بياناتهم — يُنظَّف من انتهت بياناته
async function queueEntries(queueKey, limit = 200) {
    const c = await redis();
    const ids = await c.zRange(k.queue(queueKey), 0, limit - 1);
    if (ids.length === 0) return [];
    const raws = await c.mGet(ids.map(k.qentry));
    const entries = [];
    const stale = [];
    ids.forEach((id, i) => (raws[i] ? entries.push(JSON.parse(raws[i])) : stale.push(id)));
    if (stale.length) await c.zRem(k.queue(queueKey), stale);
    return entries;
}

async function activeQueueKeys() {
    const c = await redis();
    const keys = [];
    for await (const batch of c.scanIterator({ MATCH: 'ludo:queue:*', COUNT: 100 })) {
        (Array.isArray(batch) ? batch : [batch]).forEach(key => keys.push(key.slice('ludo:queue:'.length)));
    }
    return keys;
}

// ───────────── الغرف الخاصة ─────────────

async function createRoom(room) {
    const c = await redis();
    // رمز من 4 أرقام غير مستعمل
    for (let i = 0; i < 20; i++) {
        const code = String(crypto.randomInt(1000, 10000));
        const ok = await c.set(k.room(code), JSON.stringify({ ...room, code }), { NX: true, EX: ROOM_TTL_S });
        if (ok) {
            await c.set(k.userRoom(room.hostId), code, { EX: ROOM_TTL_S });
            return { ...room, code };
        }
    }
    throw new StoreUnavailable();
}

async function getRoom(code) {
    const raw = await (await redis()).get(k.room(code));
    return raw ? JSON.parse(raw) : null;
}

async function saveRoom(room) {
    const c = await redis();
    const multi = c.multi().set(k.room(room.code), JSON.stringify(room), { EX: ROOM_TTL_S });
    room.players.forEach(u => multi.set(k.userRoom(u), room.code, { EX: ROOM_TTL_S }));
    await multi.exec();
}

async function deleteRoom(room) {
    const c = await redis();
    const multi = c.multi().del(k.room(room.code));
    room.players.forEach(u => multi.del(k.userRoom(u)));
    await multi.exec();
}

async function getUserRoom(userId) {
    return (await redis()).get(k.userRoom(userId));
}

async function clearUserRoom(userId) {
    await (await redis()).del(k.userRoom(userId));
}

module.exports = {
    withLock,
    getGame, saveGame, deleteGame, dueGames,
    setUserGame, getUserGame, clearUserGame,
    addForfeit, removeForfeit, dueForfeits,
    addQuit, bumpQuitLevel, setQuitBan, getQuitBan,
    setLastResult, getLastResult,
    markRivals, areRivals, challengeCooldown, setChallenge, takeChallenge,
    enqueue, dequeue, getQueueEntry, queueEntries, activeQueueKeys,
    createRoom, getRoom, saveRoom, deleteRoom, getUserRoom, clearUserRoom,
    StoreUnavailable
};
