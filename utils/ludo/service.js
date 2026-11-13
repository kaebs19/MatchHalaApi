// MatchHala - خدمة مباريات هلا لودو: الإنشاء، أفعال اللاعبين، المؤقّت، البوت، الإنهاء
//
// المحرّك (utils/ludoEngine.js) يحسم القواعد، وهذه الطبقة تربطه بـ Redis والسوكت:
// كل فعل = قفل المباراة ← تحميل ← المحرّك ← موعد الدور التالي ← حفظ ← بثّ لغرف اللاعبين.
// النرد من crypto.randomInt — لا من الجهاز.
//
// المؤقّت يعمل على instance 0 وحده (startLudoTicker): يقرأ ludo:deadlines كل 400ms.
// - انتهت مهلة لاعب ← البوت يكمل دوره (يُحسب فائتاً، 3 متتالية = يتولّاه البوت).
// - لاعب بلا اتصال (meta.offline) ← مهلته OFFLINE_TURN_MS بدل TURN_MS؛ عودته تعيد له بقية مهلته.
// - مباراة دوري: المنقطع له RETURN_GRACE_MS ليعود (ludo:forfeits)، بعدها يُحسب منسحباً (forfeitOffline).
// - غاب كل الخصوم البشر ← engine.claimWin («أنهِ المباراة فائزاً»، ludo:claim).
// - من تولّاه البوت يستعيد مقعده بعودته (ludo:resume بـ back) — engine.reclaim، بحدّ maxComebacks.
// - دور بوت ← يلعب بعد BOT_DELAY_MS (يبدو طبيعياً).
// - حركة واحدة ممكنة ← تُنفَّذ تلقائياً بعد AUTO_MOVE_MS ولا تُحسب فائتة.

const crypto = require('crypto');
const engine = require('../ludoEngine');
const store = require('./store');
const economy = require('./economy');
const penalties = require('./penalties');
const missions = require('./missions');

const TURN_MS = Number(process.env.LUDO_TURN_MS) || 15000;
// المنقطع (لا سوكت له): لا ننتظره المهلة كاملة — الخصم لا يُعاقَب بانقطاع غيره
const OFFLINE_TURN_MS = Number(process.env.LUDO_OFFLINE_TURN_MS) || 5000;
// مباراة دوري: مهلة عودة المنقطع قبل أن تُحسب عليه انسحاباً (البوت يلعب عنه خلالها)
const RETURN_GRACE_MS = Number(process.env.LUDO_RETURN_GRACE_MS) || 60000;
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
        // اللاعبون بلا اتصال الآن (شارة «انقطع الاتصال») ومهلة دورهم الأقصر
        offline: Object.keys(record.meta.offline || {}),
        offlineTurnMs: OFFLINE_TURN_MS,
        // الدوري: موعد حسم المباراة على كل منقطع إن لم يعد — و now ليحسب التطبيق الفرق عن ساعته
        forfeitAt: forfeitTimes(record),
        returnGraceMs: record.meta.stake ? RETURN_GRACE_MS : null,
        now: Date.now(),
        // مباراة دوري: { league, fee, prize } — null للودّية
        stake: record.meta.stake || null,
        // 💎 من فعّل نرد الحظ في هذه المباراة (يراه الجميع) وسعره
        boosts: Object.keys(record.meta.boosts || {}),
        // الدردشة حتى الآن — لمن يعود للمباراة أو يفتحها متأخراً
        chat: (record.meta.chat || []).slice(-30),
        boostCost: economy.constants.BOOST_COST,
        ...engine.publicState(record.state)
    };
}

function forfeitTimes(record) {
    if (!record.meta.stake || record.state.phase === 'ended') return {};
    const out = {};
    for (const [id, since] of Object.entries(record.meta.offline || {})) {
        if (record.state.seats.some(s => s.id === id && s.status === 'active')) out[id] = since + RETURN_GRACE_MS;
    }
    return out;
}

// موعد الخطوة التالية بحسب صاحب الدور
function scheduleNext(record, now = Date.now()) {
    const s = record.state;
    delete record.meta.fullDeadlineAt;
    if (s.phase === 'ended') { record.deadlineAt = null; return; }
    const seat = s.seats[s.turn];
    if (seat.isBot) record.deadlineAt = now + BOT_DELAY_MS;
    else if (s.phase === 'move' && s.legalMoves.length === 0) record.deadlineAt = now + REROLL_DECIDE_MS;
    // حركة وحيدة: تلقائية سريعاً — إلا إن كان يستطيع إعادة الرمي (نعطيه وقتاً ليقرّر)
    else if (s.phase === 'move' && s.legalMoves.length === 1) {
        record.deadlineAt = now + (s.canReroll ? REROLL_DECIDE_MS : AUTO_MOVE_MS);
    }
    else record.deadlineAt = now + TURN_MS;
    if (!seat.isBot && record.meta.offline?.[seat.id]) shortenForOffline(record, now);
}

// صاحب الدور منقطع: المهلة OFFLINE_TURN_MS على الأكثر. الموعد الأصلي يُحفظ ليعود له إن رجع قبل انتهائه
// (لا من لحظة العودة — وإلا صار قطع الاتصال ووصله وسيلة لتمديد الدور).
function shortenForOffline(record, now) {
    const short = now + OFFLINE_TURN_MS;
    if (!record.deadlineAt || record.deadlineAt <= short) return;
    record.meta.fullDeadlineAt = record.deadlineAt;
    record.deadlineAt = short;
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

// انقطع لاعب في مباراة دوري وبدأت مهلة عودته — مستمعو إشعار «ارجع قبل أن تُحسب خسارة»
const awayHooks = [];
function onAway(fn) { awayHooks.push(fn); }

// خروج من مباراة دوري (انسحاب أو حسم بعد انقطاع) ← عدّاد عقوبة الخروج المتكرر
async function countLeagueQuit(record, userId) {
    if (!record?.meta?.stake) return;
    try { await penalties.recordLeagueQuit(userId); } catch (e) { console.error('ludo quit penalty:', e.message); }
}

async function finalize(record) {
    if (record.meta.persisted) return;
    record.meta.persisted = true;
    const ranking = engine.ranking(record.state);
    const placeOf = new Map(ranking.map(r => [r.id, r]));
    const stake = record.meta.stake || null;
    // التسوية مرة واحدة: gameId فريد في LudoMatch — إن كانت النتيجة محفوظة من قبل فلا جائزة ثانية
    let alreadySaved = false;
    // 🛡️ فائزون على الجهاز نفسه مع خصم بشري — مباراة دوري فقط (الودّية بلا نجوم أصلاً)
    const linked = stake ? await linkedWinners(record) : new Set();
    if (linked.size) console.warn(`🛡️ هلا لودو ${record.id}: فائز على جهاز خصمه (${[...linked].join(',')}) — بلا نجوم`);
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
            linkedPlayers: linked.size > 0,
            chat: (record.meta.chat || []).map(l => ({ user: l.playerId, text: l.text, at: new Date(l.at) })),
            ...(stake ? { league: stake.league, fee: stake.fee, prize: stake.prize } : {}),
            startedAt: new Date(record.meta.startedAt),
            endedAt: new Date()
        });
    } catch (e) {
        if (e.code === 11000) alreadySaved = true;
        console.error('ludo finalize error:', e.message);
    }
    const rewards = stake && !alreadySaved ? await settleStake(record, stake, linked) : [];
    if (!alreadySaved) await afterMatch(record, ranking, stake, rewards);
    await store.clearUserGame(humans(record), record.id);
    emitToPlayers(record, 'ludo:ended', {
        gameId: record.id, winners: record.state.winners, ranking,
        ...(stake ? { stake, rewards } : {})
    });
    for (const fn of finalizeHooks) {
        try { await fn(record, ranking); } catch (e) { console.error('ludo finalize hook:', e.message); }
    }
}

// الفائزون الذين يشاركون جهازاً (keychainToken/vendorId) مع بشريّ من الطرف الخاسر — الطابور يمنع جمعهم،
// وهذا احتياط لما يفلت (معرّف ضُبط بعد دخول الطابور، أو دخول قبل النشر)
async function linkedWinners(record) {
    const winners = new Set(record.state.winners || []);
    const ids = humans(record);
    if (ids.length < 2 || winners.size === 0) return new Set();
    try {
        const User = require('../../models/User');
        const { deviceIds } = require('./lobby');
        const devices = new Map();
        for (const id of ids) {
            const u = await User.findById(id).select('keychainToken vendorId').lean();
            devices.set(id, u ? deviceIds(u) : []);
        }
        const teamOf = (id) => record.state.seats.find(s => s.id === id)?.team;
        const out = new Set();
        for (const w of winners) {
            if (!devices.has(w)) continue;
            const rivals = ids.filter(o => o !== w && teamOf(o) !== teamOf(w));
            if (rivals.some(o => devices.get(o).some(d => devices.get(w).includes(d)))) out.add(w);
        }
        return out;
    } catch (e) {
        console.error('ludo linkedWinners:', e.message);
        return new Set();
    }
}

// لعبا معاً ← يحقّ لهما تحدّي بعضهما (مباراة ثانية) خلال هذه المدة
const RIVAL_TTL_S = 10 * 60;
// مصادر المباراة التي يختار فيها اللاعب خصمه (لا الطابور)
const FRIEND_SOURCES = new Set(['invite', 'challenge', 'room']);

// بعد الحفظ: إحصاءات الودّية، آخر نتيجة لكل لاعب (يراها من انتهت مباراته وهو غائب)، وحقّ المباراة الثانية.
// كلها ثانوية — فشلها لا يمسّ النتيجة ولا الجوائز.
async function afterMatch(record, ranking, stake, rewards) {
    const ids = humans(record);
    const winners = new Set(record.state.winners || []);
    const placeOf = new Map(ranking.map(r => [r.id, r.place]));
    try {
        for (const id of ids) {
            const seat = record.state.seats.find(s => s.id === id);
            const won = winners.has(id);
            if (!stake && ids.length >= 2) await economy.recordFriendly(id, won);
            // من خرج (انسحاب أو حسم بالانقطاع) يعرف نتيجته من لحظتها
            if (seat?.status === 'left') continue;
            // 🎯 مهام اليوم — لمن أكمل المباراة: لعب، فاز، ولعب مع صديق (دعوة/تحدٍّ/غرفة فيها بشريّ آخر)
            await missions.track(id, 'play');
            if (won) await missions.track(id, 'win');
            if (ids.length >= 2 && FRIEND_SOURCES.has(record.meta.source)) await missions.track(id, 'friend');
            const reward = rewards.find(r => r.id === id);
            await store.setLastResult(id, lastResult(record, id, {
                won, place: placeOf.get(id) ?? null, reason: 'ended',
                delta: reward ? reward.delta : 0, points: reward ? reward.points : 0
            }));
        }
        if (ids.length >= 2) await store.markRivals(ids, RIVAL_TTL_S);
    } catch (e) {
        console.error('ludo afterMatch:', e.message);
    }
}

function lastResult(record, userId, extra) {
    const stake = record.meta.stake || null;
    return {
        gameId: record.id,
        league: stake?.league || null,
        fee: stake?.fee || 0,
        prize: stake?.prize || 0,
        // الخصوم البشر — للعرض («ضدّ نورة»)
        rivals: record.meta.players.filter(p => !p.isBot && p.id !== userId).map(p => p.name),
        endedAt: Date.now(),
        ...extra
    };
}

// الفائز يأخذ الجائزة، والخاسر خسر رسومه (خُصمت عند البدء). delta = صافي المباراة للّاعب.
async function settleStake(record, stake, linked = new Set()) {
    const winners = new Set(record.state.winners || []);
    const rewards = [];
    for (const id of humans(record)) {
        const won = winners.has(id);
        try {
            // المرتبط بخصمه يأخذ عملاته (لا ربح صافٍ — دفعها حسابه الآخر) لكن بلا نجوم ترتيب
            const points = await economy.settle(id, { won, prize: stake.prize, league: stake.league, noPoints: linked.has(id) });
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
        // حالة المقاعد قبل الفعل — لمعرفة هل الحركة بيد اللاعب أم الكمبيوتر
        const previousSeats = new Map(record.state.seats.map(x => [x.id, { isBot: x.isBot }]));
        const result = await fn(record);
        if (!result) return record;
        record.state = result.state;
        record.meta.rolls += result.events.filter(e => e.type === 'roll').length;
        // keepDeadline: تغيّر لا يمسّ الدور (حضور لاعب) — لا يُعاد ضبط مؤقّت صاحب الدور
        if (!result.keepDeadline) scheduleNext(record);
        await store.saveGame(record);
        emitToPlayers(record, 'ludo:state', { ...view(record), events: result.events });
        // 🎯 مهام اليوم: أكل قطع الخصم (بلا انتظار — لا يؤخّر القفل)
        for (const e of result.events) {
            // أكل اللاعب بيده فقط — لا ما أكله الكمبيوتر وهو يلعب عنه (takenOver أو انتهت مهلته)
            const before = previousSeats.get(e.playerId);
            if (e.type === 'move' && e.captured?.length && before && !before.isBot && !result.timedOut) {
                missions.track(e.playerId, 'capture', e.captured.length);
            }
        }
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
    await store.removeForfeit(gameId, String(userId)).catch(() => {});
    await countLeagueQuit(r, userId);
    return view(r);
}

// «أنهِ المباراة فائزاً»: غاب كل خصومي البشر — الجائزة والترتيب كأي فوز
async function playerClaim(userId, gameId) {
    const r = await mutate(gameId, (record) => {
        assertPlayer(record, userId);
        return engine.claimWin(record.state, { playerId: userId });
    });
    return view(r);
}

// انتهت مهلة عودة منقطع في مباراة دوري: يُحسب منسحباً (في لاعبَين تُحسم للخصم فوراً)
async function forfeitOffline(gameId, userId, now = Date.now()) {
    const id = String(userId);
    let forfeited = false;
    const r = await mutate(gameId, (record) => {
        if (record.state.phase === 'ended' || !record.meta.stake) return null;
        const since = record.meta.offline?.[id];
        if (!since || since + RETURN_GRACE_MS > now) return null;      // عاد، أو انقطع من جديد بمهلة جديدة
        const { [id]: _gone, ...rest } = record.meta.offline;
        record.meta.offline = rest;
        const seat = record.state.seats.find(s => s.id === id);
        if (!seat || seat.status !== 'active') return { state: bump(record.state), events: [], keepDeadline: true };
        const result = engine.leave(record.state, { playerId: id });
        result.events[0].reason = 'offline';
        forfeited = true;
        return result;
    });
    if (forfeited) {
        await store.clearUserGame([id], gameId);
        await countLeagueQuit(r, id);
        // يعود فيجد المباراة اختفت — نخبره لماذا وكم خسر
        await store.setLastResult(id, lastResult(r, id, {
            won: false, place: null, reason: 'forfeit', delta: -(r.meta.stake?.fee || 0), points: 0
        })).catch(() => {});
    }
    return forfeited;
}

// ───────────── الحضور والعودة ─────────────

// نسخة جديدة بلا تغيير في اللعب — ليقبلها التطبيق (يتجاهل ما لا يتقدّم رقم نسخته)
const bump = (state) => ({ ...state, version: state.version + 1 });

// انقطع/عاد اتصال لاعب في مباراة جارية: يُبثّ للجميع (شارة على صورته) وتُقصَّر/تُستعاد مهلته إن كان دوره.
// reclaim: عاد فعلاً لشاشة المباراة ← يستعيد مقعده إن كان البوت تولّاه وبقيت له مرات.
async function setPresence(userId, online, { reclaim = false } = {}) {
    const id = String(userId);
    const gameId = await store.getUserGame(id);
    if (!gameId) return null;
    let presenceChange = null;      // دوري فقط: 'away' بدأت مهلة العودة · 'back' أُلغيت
    const result = await mutate(gameId, (record) => {
        if (record.state.phase === 'ended') return null;
        if (!record.meta.players.some(p => p.id === id && !p.isBot)) return null;
        const seat = record.state.seats.find(s => s.id === id);
        if (!seat || seat.status !== 'active') return null;

        const wasOffline = !!record.meta.offline?.[id];
        const canReclaim = online && reclaim && seat.takenOver
            && (seat.comebacks || 0) < (record.state.options.maxComebacks ?? 0);
        if (online === !wasOffline && !canReclaim) return null;

        const now = Date.now();
        const events = [];
        if (online && wasOffline) {
            const { [id]: _gone, ...rest } = record.meta.offline;
            record.meta.offline = rest;
            events.push({ type: 'presence', playerId: id, online: true });
        } else if (!online) {
            record.meta.offline = { ...(record.meta.offline || {}), [id]: now };
            events.push({ type: 'presence', playerId: id, online: false });
        }

        if (record.meta.stake) presenceChange = online ? 'back' : 'away';

        if (canReclaim) {
            const r = engine.reclaim(record.state, { playerId: id });
            events.push(...r.events);
            // دوره الآن (كان البوت سيلعب بعد لحظة) ← مهلة لاعب كاملة؛ وإلا لا يُمسّ مؤقّت غيره
            const myTurn = r.state.seats[r.state.turn].id === id;
            return { state: r.state, events, keepDeadline: !myTurn };
        }

        const myTurn = record.state.seats[record.state.turn].id === id && !seat.isBot;
        if (myTurn && !online) shortenForOffline(record, now);
        if (myTurn && online && record.meta.fullDeadlineAt > record.deadlineAt) {
            record.deadlineAt = record.meta.fullDeadlineAt;
            delete record.meta.fullDeadlineAt;
        }
        return { state: bump(record.state), events, keepDeadline: true };
    });
    if (presenceChange === 'away') {
        const since = result.meta.offline?.[id];
        if (since) {
            await store.addForfeit(gameId, id, since + RETURN_GRACE_MS);
            const snapshot = { gameId, userId: id, graceMs: RETURN_GRACE_MS };
            for (const fn of awayHooks) Promise.resolve().then(() => fn(snapshot)).catch(e => console.error('ludo away hook:', e.message));
        }
    } else if (presenceChange === 'back') {
        await store.removeForfeit(gameId, id);
    }
    return result;
}

// ludo:resume — العودة للمباراة: متصل من جديد، و(back) يستعيد مقعده من البوت
async function playerReturn(userId, { reclaim = false } = {}) {
    try {
        await setPresence(userId, true, { reclaim });
    } catch (e) {
        if (!['GAME_NOT_FOUND', 'LOCK_BUSY'].includes(e.code)) console.error('ludo return:', e.code || '', e.message);
    }
    return currentGame(userId);
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
        // انتهت مهلة لاعب — الكمبيوتر أكمل دوره (لا يُحسب له في المهام)
        return { ...engine.handleTimeout(s, { rollDie: dieFor(record) }), timedOut: true };
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
        // مهلة عودة المنقطعين في الدوري
        for (const f of await store.dueForfeits(now)) {
            try {
                await forfeitOffline(f.gameId, f.userId, now);
                await store.removeForfeit(f.gameId, f.userId);
            } catch (e) {
                if (e.code === 'LOCK_BUSY') continue;                  // يُعاد في الدورة التالية
                await store.removeForfeit(f.gameId, f.userId).catch(() => {});
                if (e.code !== 'GAME_NOT_FOUND') console.error(`ludo forfeit ${f.gameId}:`, e.code || '', e.message);
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
    playerClaim,
    forfeitOffline,
    currentGame,
    setPresence,
    playerReturn,
    processDue,
    tick,
    startLudoTicker,
    stopLudoTicker,
    view,
    rollDie,
    onFinalize,
    onTurn,
    onAway,
    constants: { TURN_MS, OFFLINE_TURN_MS, RETURN_GRACE_MS, BOT_DELAY_MS, AUTO_MOVE_MS, REROLL_DECIDE_MS, SIX_WEIGHT, SIX_WEIGHT_ALL_BASE, PITY_SIX_AFTER }
};
