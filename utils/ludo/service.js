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
const economy = require('./economy');

const TURN_MS = Number(process.env.LUDO_TURN_MS) || 15000;
const BOT_DELAY_MS = 1200;
const AUTO_MOVE_MS = 700;
// قرار إعادة الرمي: لا حركة ممكنة ← مهلة قصيرة ثم تخطٍّ تلقائي (لا يُحسب دوراً فائتاً)
const REROLL_DECIDE_MS = 6000;
const TICK_MS = 400;

const BOT_NAMES = ['سهم', 'نجمة', 'برق', 'موج', 'غيمة', 'صقر'];

// ⚙️ احتمال الـ 6 أعلى من النرد العادي (طلب المالك) — للجميع بالتساوي، ويرتفع أكثر حين تكون
//    كل قطع صاحب الدور في القاعدة (أكثر لحظة مملّة: لا شيء يُفعل بلا 6).
//    الوزن 1 = نرد عادي (16.7%). 1.6 ≈ 24%، 2.5 ≈ 33%.
const SIX_WEIGHT = Number(process.env.LUDO_SIX_WEIGHT) || 1.6;
const SIX_WEIGHT_ALL_BASE = Number(process.env.LUDO_SIX_WEIGHT_BASE) || 2.5;

// 💎 نرد الحظ (جواهر، مرة لكل مباراة): يُضاف لوزن الـ 6 عند صاحبه. 1 ≈ +9 نقاط مئوية (24% ← 34%).
//    ظاهر لكل اللاعبين (boosts في view) — لا ميزة خفية.
const BOOST_SIX_WEIGHT = Number(process.env.LUDO_BOOST_SIX_WEIGHT) || 1;

// 🎯 ضمان الـ 6: من علقت كل قطعه (قاعدة/بيت) ورمى PITY_SIX_AFTER مرات متتالية بلا 6، رميته التالية 6.
//    (seat.dry يعدّه المحرّك). السريع قطعتان فقط، فالانتظار الطويل للخروج أكثر ما يُملّ.
const PITY_SIX_AFTER = Number(process.env.LUDO_PITY_SIX_AFTER) || 3;

function rollDie(state, boosted = false) {
    const seat = state?.seats?.[state.turn];
    if (seat && (seat.dry || 0) >= PITY_SIX_AFTER) return 6;
    const allBase = !!seat && seat.tokens.some(p => p === -1) && seat.tokens.every(p => p === -1 || p === 56);
    const weight = (allBase ? SIX_WEIGHT_ALL_BASE : SIX_WEIGHT) + (boosted ? BOOST_SIX_WEIGHT : 0);
    const r = (crypto.randomInt(0, 1_000_000) / 1_000_000) * (5 + weight);
    return r < 5 ? 1 + Math.floor(r) : 6;
}
// نرد المباراة: يعرف من اشترى نرد الحظ
const dieFor = (record) => (state) => rollDie(state, !!record.meta.boosts?.[state.seats[state.turn]?.id]);
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
        // مباراة دوري: { league, fee, prize } — null للودّية
        stake: record.meta.stake || null,
        // 💎 من فعّل نرد الحظ في هذه المباراة (يراه الجميع) وسعره
        boosts: Object.keys(record.meta.boosts || {}),
        boostCost: economy.constants.BOOST_COST,
        ...engine.publicState(record.state)
    };
}

// موعد الخطوة التالية بحسب صاحب الدور
function scheduleNext(record, now = Date.now()) {
    const s = record.state;
    if (s.phase === 'ended') { record.deadlineAt = null; return; }
    const seat = s.seats[s.turn];
    if (seat.isBot) record.deadlineAt = now + BOT_DELAY_MS;
    else if (s.phase === 'move' && s.legalMoves.length === 0) record.deadlineAt = now + REROLL_DECIDE_MS;
    // حركة وحيدة: تلقائية سريعاً — إلا إن كان يستطيع إعادة الرمي (نعطيه وقتاً ليقرّر)
    else if (s.phase === 'move' && s.legalMoves.length === 1) {
        record.deadlineAt = now + (s.canReroll ? REROLL_DECIDE_MS : AUTO_MOVE_MS);
    }
    else record.deadlineAt = now + TURN_MS;
}

// ───────────── الإنشاء ─────────────

// players: [{ id, name, photo }] بشر فقط؛ bots: عدد البوتات المكمِّلة
// link: ربط اختياري بمصدر خارجي (دعوة المحادثة: { messageId }) — يصل مستمعي onFinalize
// stake: مباراة دوري { league, fee, prize } — الرسوم خُصمت قبل النداء (lobby.tryMatch)
async function createMatch({ players, bots = 0, mode = 'classic', source, link = null, stake = null }) {
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
    // إعادة الرمي المدفوعة: متاحة لمن تكفي جواهره السعر الأول (تُحدَّث بعد كل شراء)
    const firstCost = state.options.paidRerollCosts?.[0];
    if (firstCost) {
        await Promise.all(state.seats.filter(s => !s.isBot).map(async (s) => {
            const w = await economy.getWallet(s.id).catch(() => null);
            s.paidOk = !!w && (w.gems || 0) >= firstCost;
        }));
    }
    const record = {
        id: newGameId(),
        state,
        meta: { mode, source, players: all, startedAt: Date.now(), rolls: 0, ...(link ? { link } : {}), ...(stake ? { stake } : {}) },
        deadlineAt: null
    };
    scheduleNext(record);
    await store.saveGame(record);
    await store.setUserGame(humans(record), record.id);
    emitToPlayers(record, 'ludo:match-found', view(record));
    return record;
}

// ───────────── تطبيق فعل على مباراة ─────────────

// مستمعو نهاية المباراة (بطاقة الدعوة في المحادثة) — بلا require دائري
const finalizeHooks = [];
function onFinalize(fn) { finalizeHooks.push(fn); }

// انتقل الدور إلى لاعب بشري (رمية جديدة لا رمية إضافية) — مستمعو إشعار «دورك» (routes/mobile/games.js)
const turnHooks = [];
function onTurn(fn) { turnHooks.push(fn); }

async function finalize(record) {
    if (record.meta.persisted) return;
    record.meta.persisted = true;
    const ranking = engine.ranking(record.state);
    const placeOf = new Map(ranking.map(r => [r.id, r]));
    const stake = record.meta.stake || null;
    // التسوية مرة واحدة: gameId فريد في LudoMatch — إن كانت النتيجة محفوظة من قبل فلا جائزة ثانية
    let alreadySaved = false;
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
            ...(stake ? { league: stake.league, fee: stake.fee, prize: stake.prize } : {}),
            startedAt: new Date(record.meta.startedAt),
            endedAt: new Date()
        });
    } catch (e) {
        if (e.code === 11000) alreadySaved = true;
        console.error('ludo finalize error:', e.message);
    }
    const rewards = stake && !alreadySaved ? await settleStake(record, stake) : [];
    await store.clearUserGame(humans(record), record.id);
    emitToPlayers(record, 'ludo:ended', {
        gameId: record.id, winners: record.state.winners, ranking,
        ...(stake ? { stake, rewards } : {})
    });
    for (const fn of finalizeHooks) {
        try { await fn(record, ranking); } catch (e) { console.error('ludo finalize hook:', e.message); }
    }
}

// الفائز يأخذ الجائزة، والخاسر خسر رسومه (خُصمت عند البدء). delta = صافي المباراة للّاعب.
async function settleStake(record, stake) {
    const winners = new Set(record.state.winners || []);
    const rewards = [];
    for (const id of humans(record)) {
        const won = winners.has(id);
        try {
            const points = await economy.settle(id, { won, prize: stake.prize, league: stake.league });
            rewards.push({ id, won, prize: won ? stake.prize : 0, delta: (won ? stake.prize : 0) - stake.fee, points });
        } catch (e) {
            console.error(`ludo settle ${record.id} ${id}:`, e.message);
        }
    }
    return rewards;
}

// fn(record) يُرجع { state, events } أو null (لا شيء يُفعل)
async function mutate(gameId, fn) {
    return store.withLock(`game:${gameId}`, async () => {
        const record = await store.getGame(gameId);
        if (!record) throw new engine.LudoError('GAME_NOT_FOUND', 'المباراة غير موجودة', 404);
        const previousTurnId = record.state.seats[record.state.turn]?.id;
        const result = await fn(record);
        if (!result) return record;
        record.state = result.state;
        record.meta.rolls += result.events.filter(e => e.type === 'roll').length;
        scheduleNext(record);
        await store.saveGame(record);
        emitToPlayers(record, 'ludo:state', { ...view(record), events: result.events });
        const seat = record.state.seats[record.state.turn];
        if (seat && seat.id !== previousTurnId && !seat.isBot && seat.status !== 'left'
            && record.state.phase === 'roll' && turnHooks.length) {
            const snapshot = { gameId: record.id, userId: seat.id, deadlineAt: record.deadlineAt, players: record.meta.players };
            // بلا انتظار: الإشعار لا يؤخّر القفل ولا الردّ
            for (const fn of turnHooks) Promise.resolve().then(() => fn(snapshot)).catch(e => console.error('ludo turn hook:', e.message));
        }
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
        return engine.roll(record.state, { playerId: userId, rollDie: dieFor(record), expectVersion: version });
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

// المجانية أولاً؛ بعدها بالجواهر بسعر يتصاعد (engine.rerollCost) — الخصم قبل الرمية، ويُردّ إن رُفضت
async function playerReroll(userId, gameId, version) {
    const r = await mutate(gameId, async (record) => {
        assertPlayer(record, userId);
        const s = record.state;
        const mine = s.seats[s.turn]?.id === String(userId);
        const cost = mine ? engine.rerollCost(s) : null;
        if (!cost) return engine.reroll(s, { playerId: userId, rollDie: dieFor(record), expectVersion: version });

        const wallet = await economy.chargeGems(String(userId), cost);
        let result;
        try {
            result = engine.reroll(s, { playerId: userId, rollDie: dieFor(record), expectVersion: version, paid: true });
        } catch (e) {
            await economy.refundGems(String(userId), cost).catch(() => {});
            throw e;
        }
        // هل تكفي جواهره المرة القادمة؟ (وإلا لا ننتظر قراره عند كل رمية)
        const seat = result.state.seats.find(x => x.id === String(userId));
        const nextCost = result.state.options.paidRerollCosts?.[seat.paidRerolls || 0];
        seat.paidOk = nextCost !== undefined && (wallet.gems || 0) >= nextCost;
        if (!seat.paidOk && (seat.rerolls || 0) <= 0 && result.state.seats[result.state.turn].id === seat.id) {
            result.state.canReroll = false;
        }
        return result;
    });
    return view(r);
}

// 💎 نرد الحظ: مرة لكل مباراة لكل لاعب، في أي وقت قبل النهاية
async function playerBoost(userId, gameId) {
    const id = String(userId);
    const r = await mutate(gameId, async (record) => {
        assertPlayer(record, id);
        if (record.state.phase === 'ended') throw new engine.LudoError('GAME_ENDED', 'انتهت المباراة', 409);
        if (record.meta.boosts?.[id]) throw new engine.LudoError('BOOST_ACTIVE', 'نرد الحظ مفعّل في هذه المباراة', 409);
        await economy.chargeGems(id, economy.constants.BOOST_COST);
        record.meta.boosts = { ...(record.meta.boosts || {}), [id]: true };
        // نسخة جديدة ليقبلها التطبيق (يتجاهل ما لا يتقدّم رقم نسخته)
        return { state: { ...record.state, version: record.state.version + 1 }, events: [{ type: 'boost', playerId: id }] };
    });
    return view(r);
}

async function playerPass(userId, gameId, version) {
    const r = await mutate(gameId, (record) => {
        assertPlayer(record, userId);
        return engine.pass(record.state, { playerId: userId, expectVersion: version });
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
        // لا حركة ممكنة (كان يقرّر إعادة الرمي) ← تخطٍّ بلا احتساب دور فائت
        if (!seat.isBot && s.phase === 'move' && s.legalMoves.length === 0) {
            return engine.pass(s, { playerId: seat.id });
        }
        // حركة وحيدة للاعب: تُنفَّذ بلا احتساب دور فائت
        if (!seat.isBot && s.phase === 'move' && s.legalMoves.length === 1) {
            return engine.move(s, { playerId: seat.id, token: s.legalMoves[0].token });
        }
        // بوت: خطوة واحدة (رمي أو حركة) — تبدو طبيعية للآخرين
        if (seat.isBot) return engine.autoStep(s, { rollDie: dieFor(record) });
        // انتهت مهلة لاعب
        return engine.handleTimeout(s, { rollDie: dieFor(record) });
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
    playerReroll,
    playerBoost,
    playerPass,
    playerLeave,
    currentGame,
    processDue,
    tick,
    startLudoTicker,
    stopLudoTicker,
    view,
    rollDie,
    onFinalize,
    onTurn,
    constants: { TURN_MS, BOT_DELAY_MS, AUTO_MOVE_MS, REROLL_DECIDE_MS, SIX_WEIGHT, SIX_WEIGHT_ALL_BASE, PITY_SIX_AFTER }
};
