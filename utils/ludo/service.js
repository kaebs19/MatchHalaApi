// MatchHala - خدمة مباريات هلا لودو: الإنشاء، أفعال اللاعبين، المؤقّت، البوت، الإنهاء
//
// المحرّك (utils/ludoEngine.js) يحسم القواعد، وهذه الطبقة تربطه بـ Redis والسوكت:
// كل فعل = قفل المباراة ← تحميل ← المحرّك ← موعد الدور التالي ← حفظ ← بثّ لغرف اللاعبين.
// النرد من crypto.randomInt — لا من الجهاز.
//
// المؤقّت يعمل على instance 0 وحده (startLudoTicker): يقرأ ludo:deadlines كل 400ms.
// - انتهت مهلة لاعب ← البوت يكمل دوره (يُحسب فائتاً، 3 متتالية = يتولّاه البوت).
// - دور بوت ← يلعب بعد BOT_DELAY_MS (يبدو طبيعياً).
// - حركة واحدة ممكنة ← تُنفَّذ تلقائياً بعد AUTO_MOVE_MS ولا تُحسب فائتة.

const crypto = require('crypto');
const engine = require('../ludoEngine');
const store = require('./store');

const TURN_MS = Number(process.env.LUDO_TURN_MS) || 15000;
const BOT_DELAY_MS = 1200;
const AUTO_MOVE_MS = 700;
const TICK_MS = 400;

const BOT_NAMES = ['سهم', 'نجمة', 'برق', 'موج', 'غيمة', 'صقر'];

const rollDie = () => crypto.randomInt(1, 7);
const newGameId = () => crypto.randomBytes(9).toString('base64url');

let ioRef = null;
function setIo(io) { ioRef = io; }
const io = () => ioRef || global.io;

const humans = (record) => record.meta.players.filter(p => !p.isBot).map(p => p.id);

function emitToPlayers(record, event, payload) {
    const server = io();
    if (!server) return;
    const rooms = humans(record).map(u => `user:${u}`);
    if (rooms.length) server.to(rooms).emit(event, payload);
}

// الشكل الذي يصل التطبيق
function view(record) {
    return {
        gameId: record.id,
        source: record.meta.source,
        players: record.meta.players,           // { id, name, photo, isBot }
        turnMs: TURN_MS,
        deadlineAt: record.deadlineAt,
        ...engine.publicState(record.state)
    };
}

// موعد الخطوة التالية بحسب صاحب الدور
function scheduleNext(record, now = Date.now()) {
    const s = record.state;
    if (s.phase === 'ended') { record.deadlineAt = null; return; }
    const seat = s.seats[s.turn];
    if (seat.isBot) record.deadlineAt = now + BOT_DELAY_MS;
    else if (s.phase === 'move' && s.legalMoves.length === 1) record.deadlineAt = now + AUTO_MOVE_MS;
    else record.deadlineAt = now + TURN_MS;
}

// ───────────── الإنشاء ─────────────

// players: [{ id, name, photo }] بشر فقط؛ bots: عدد البوتات المكمِّلة
async function createMatch({ players, bots = 0, mode = 'classic', source }) {
    const used = new Set();
    const botPlayers = Array.from({ length: bots }, (_, i) => {
        let name;
        do { name = BOT_NAMES[crypto.randomInt(0, BOT_NAMES.length)]; } while (used.has(name) && used.size < BOT_NAMES.length);
        used.add(name);
        return { id: `bot:${i}:${crypto.randomBytes(3).toString('hex')}`, name, photo: null, isBot: true };
    });
    const all = [...players.map(p => ({ ...p, isBot: false })), ...botPlayers];

    const state = engine.createGame({
        players: all.map(p => ({ id: p.id, isBot: p.isBot })),
        mode
    });
    const record = {
        id: newGameId(),
        state,
        meta: { mode, source, players: all, startedAt: Date.now(), rolls: 0 },
        deadlineAt: null
    };
    scheduleNext(record);
    await store.saveGame(record);
    await store.setUserGame(humans(record), record.id);
    emitToPlayers(record, 'ludo:match-found', view(record));
    return record;
}

// ───────────── تطبيق فعل على مباراة ─────────────

async function finalize(record) {
    if (record.meta.persisted) return;
    record.meta.persisted = true;
    const ranking = engine.ranking(record.state);
    const placeOf = new Map(ranking.map(r => [r.id, r]));
    try {
        const LudoMatch = require('../../models/LudoMatch');
        await LudoMatch.create({
            gameId: record.id,
            mode: record.meta.mode,
            source: record.meta.source,
            players: record.state.seats.map(s => {
                const p = record.meta.players.find(x => x.id === s.id);
                return {
                    user: p.isBot ? null : s.id,
                    color: s.color,
                    team: s.team,
                    place: placeOf.get(s.id)?.place,
                    left: s.status === 'left',
                    isBot: p.isBot,
                    takenOver: !p.isBot && s.isBot
                };
            }),
            winners: (record.state.winners || []).filter(id => !id.startsWith('bot:')),
            rolls: record.meta.rolls,
            startedAt: new Date(record.meta.startedAt),
            endedAt: new Date()
        });
    } catch (e) {
        console.error('ludo finalize error:', e.message);
    }
    await store.clearUserGame(humans(record), record.id);
    emitToPlayers(record, 'ludo:ended', { gameId: record.id, winners: record.state.winners, ranking });
}

// fn(record) يُرجع { state, events } أو null (لا شيء يُفعل)
async function mutate(gameId, fn) {
    return store.withLock(`game:${gameId}`, async () => {
        const record = await store.getGame(gameId);
        if (!record) throw new engine.LudoError('GAME_NOT_FOUND', 'المباراة غير موجودة', 404);
        const result = await fn(record);
        if (!result) return record;
        record.state = result.state;
        record.meta.rolls += result.events.filter(e => e.type === 'roll').length;
        scheduleNext(record);
        await store.saveGame(record);
        emitToPlayers(record, 'ludo:state', { ...view(record), events: result.events });
        if (record.state.phase === 'ended') await finalize(record);
        // finalize يعدّل meta — احفظه ليُعرض الحفظ مرة واحدة
        if (record.meta.persisted) await store.saveGame(record);
        return record;
    });
}

function assertPlayer(record, userId) {
    if (!record.meta.players.some(p => p.id === String(userId) && !p.isBot)) {
        throw new engine.LudoError('NOT_IN_GAME', 'لست في هذه المباراة', 403);
    }
}

async function playerRoll(userId, gameId, version) {
    const r = await mutate(gameId, (record) => {
        assertPlayer(record, userId);
        return engine.roll(record.state, { playerId: userId, rollDie, expectVersion: version });
    });
    return view(r);
}

async function playerMove(userId, gameId, token, version) {
    const r = await mutate(gameId, (record) => {
        assertPlayer(record, userId);
        return engine.move(record.state, { playerId: userId, token, expectVersion: version });
    });
    return view(r);
}

async function playerLeave(userId, gameId) {
    const r = await mutate(gameId, (record) => {
        assertPlayer(record, userId);
        return engine.leave(record.state, { playerId: userId });
    });
    await store.clearUserGame([String(userId)], gameId);
    return view(r);
}

// المباراة الجارية للمستخدم (للعودة بعد انقطاع أو إعادة فتح التطبيق)
async function currentGame(userId) {
    const gameId = await store.getUserGame(String(userId));
    if (!gameId) return null;
    const record = await store.getGame(gameId);
    if (!record || record.state.phase === 'ended') {
        await store.clearUserGame([String(userId)], gameId);
        return null;
    }
    return view(record);
}

// ───────────── المؤقّت ─────────────

async function processDue(gameId, now = Date.now()) {
    return mutate(gameId, (record) => {
        if (!record.deadlineAt || record.deadlineAt > now || record.state.phase === 'ended') return null;
        const s = record.state;
        const seat = s.seats[s.turn];
        // حركة وحيدة للاعب: scheduleNext أعطاها مهلة AUTO_MOVE_MS — تُنفَّذ بلا احتساب دور فائت
        if (!seat.isBot && s.phase === 'move' && s.legalMoves.length === 1) {
            return engine.move(s, { playerId: seat.id, token: s.legalMoves[0].token });
        }
        // بوت: خطوة واحدة (رمي أو حركة) — تبدو طبيعية للآخرين
        if (seat.isBot) return engine.autoStep(s, { rollDie });
        // انتهت مهلة لاعب
        return engine.handleTimeout(s, { rollDie });
    });
}

let ticking = false;
let tickTimer = null;

async function tick() {
    if (ticking) return;
    ticking = true;
    try {
        const now = Date.now();
        const due = await store.dueGames(now);
        for (const id of due) {
            try {
                await processDue(id, now);
            } catch (e) {
                if (e.code === 'GAME_NOT_FOUND') {
                    await store.deleteGame(id).catch(() => {});
                } else if (e.code !== 'LOCK_BUSY') {
                    console.error(`ludo tick ${id}:`, e.code || '', e.message);
                }
            }
        }
    } catch (e) {
        if (e.code !== 'GAMES_UNAVAILABLE') console.error('ludo tick error:', e.message);
    } finally {
        ticking = false;
    }
}

function startLudoTicker() {
    if (tickTimer) return;
    tickTimer = setInterval(tick, TICK_MS);
    tickTimer.unref?.();
    console.log('🎲 مؤقّت هلا لودو يعمل');
}

function stopLudoTicker() {
    if (tickTimer) clearInterval(tickTimer);
    tickTimer = null;
}

module.exports = {
    setIo,
    createMatch,
    playerRoll,
    playerMove,
    playerLeave,
    currentGame,
    processDue,
    tick,
    startLudoTicker,
    stopLudoTicker,
    view,
    constants: { TURN_MS, BOT_DELAY_MS, AUTO_MOVE_MS }
};
