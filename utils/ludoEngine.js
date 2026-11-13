// MatchHala - محرّك هلا لودو (منطق صرف بلا قاعدة بيانات ولا Redis ولا سوكت)
//
// السيرفر هو الحَكَم: النرد يُولَّد هنا بدالة عشوائية تُمرَّر (crypto في الإنتاج،
// ثابتة في الاختبارات)، وكل حركة تُتحقَّق هنا. الجهاز يعرض فقط.
// الحالة JSON صرف (تُخزَّن في Redis كما هي). كل دالة عامة تُرجع نسخة جديدة
// { state, events } ولا تعدّل المُدخل — فشل التحقّق يرمي LudoError ولا يمسّ شيئاً.
//
// القواعد (الكلاسيكية — docs/games-architecture.md في مستودع التطبيق):
// - 6 للخروج من القاعدة إلى مربع البداية.
// - الـ 6 تمنح رمية إضافية، وثلاث ستات متتالية تُسقط الدور (قابل للتعطيل).
// - الأكل: الوقوف على مربع غير آمن فيه قطع خصم يعيدها لقاعدتها + رمية إضافية.
// - المربعات الآمنة: مربعات البداية الأربعة ومربعات النجمة — لا أكل فيها.
// - الوصول للبيت بالعدد المضبوط فقط، ويمنح رمية إضافية.
// - لا حواجز (قطعتان من لون واحد لا تسدّان الطريق).
// - فرق 2 ضدّ 2: الشريكان في لونين متقابلين، لا يأكل أحدهما الآخر، ويفوز الفريق
//   حين تصل قطع الاثنين.
//
// تمثيل موضع القطعة (نسبةً لصاحبها):
//   -1        في القاعدة
//   0..50     على المسار المشترك (0 = مربع البداية)
//   51..55    ممرّ البيت الخاص (لا يصله غيره)
//   56        وصلت البيت

const TRACK_LENGTH = 52;
const LAST_TRACK_STEP = 50;      // آخر مربع على المسار المشترك قبل ممرّ البيت
const HOME = 56;
const BASE = -1;

// ترتيب الألوان باتجاه عقارب الساعة كما في اللوحة: الأحمر أعلى اليسار
const COLORS = ['red', 'green', 'yellow', 'blue'];
const START_OFFSET = { red: 0, green: 13, yellow: 26, blue: 39 };
const STAR_OFFSET = 8;           // النجمة بعد 8 مربعات من كل بداية
const SAFE_SQUARES = new Set(
    COLORS.flatMap(c => [START_OFFSET[c], (START_OFFSET[c] + STAR_OFFSET) % TRACK_LENGTH])
);

const MODES = {
    classic: { tokens: 4 },
    quick: { tokens: 2 },
    teams: { tokens: 4, teams: true }
};

const DEFAULT_OPTIONS = {
    threeSixesForfeit: true,
    // فردي: تنتهي المباراة بأول من يُنهي (الجائزة للفائز وحده — لا انتظار لبقية المراكز)
    endOnFirstFinish: true,
    // أدوار متتالية بلا تفاعل قبل أن يتولّى البوت اللاعب نهائياً
    maxMissedTurns: 3,
    // أداة «إعادة الرمي»: مرات لكل لاعب بشري في المباراة (البوت لا يستعملها)
    rerollsPerPlayer: 1,
    // إعادة رمي مدفوعة بالجواهر بعد نفاد المجانية — السعر يتصاعد مع كل مرة في المباراة.
    // المحرّك لا يعرف الأرصدة: الخدمة تضبط seat.paidOk (يقدر على السعر التالي) وتخصم قبل النداء بـ paid:true.
    paidRerollCosts: [2, 4, 8]
};

class LudoError extends Error {
    constructor(code, message, status = 400) {
        super(message);
        this.code = code;
        this.status = status;
    }
}

const clone = (x) => structuredClone(x);

// ───────────────────────── الإنشاء ─────────────────────────

// players: [{ id, isBot? }] — 2 أو 4. في لاعبَين يأخذان لونين متقابلين.
function createGame({ players, mode = 'classic', options = {}, now = Date.now() }) {
    const def = MODES[mode];
    if (!def) throw new LudoError('BAD_MODE', 'نمط غير معروف');
    if (!Array.isArray(players) || ![2, 4].includes(players.length)) {
        throw new LudoError('BAD_PLAYERS', 'عدد اللاعبين 2 أو 4');
    }
    if (def.teams && players.length !== 4) {
        throw new LudoError('BAD_PLAYERS', 'نمط الفرق يحتاج 4 لاعبين');
    }
    const ids = players.map(p => String(p.id));
    if (new Set(ids).size !== ids.length) throw new LudoError('BAD_PLAYERS', 'لاعب مكرّر');

    const colors = players.length === 2 ? ['red', 'yellow'] : COLORS;
    const seats = players.map((p, i) => ({
        id: String(p.id),
        color: colors[i],
        // الفرق: المقعدان المتقابلان (0،2) و(1،3)
        team: def.teams ? i % 2 : i,
        tokens: Array(def.tokens).fill(BASE),
        status: 'active',        // active | finished | left
        isBot: !!p.isBot,
        missed: 0,
        rerolls: 0               // يُضبط بعد دمج الخيارات
    }));
    const opts = { ...DEFAULT_OPTIONS, ...options };
    seats.forEach(s => { s.rerolls = s.isBot ? 0 : opts.rerollsPerPlayer; });

    return {
        mode,
        options: opts,
        seats,
        turn: 0,                 // فهرس المقعد صاحب الدور
        phase: 'roll',           // roll | move | ended
        dice: null,
        sixes: 0,                // ستات متتالية في الدور الحالي
        legalMoves: [],
        canReroll: false,
        finishOrder: [],         // معرّفات بترتيب الإنهاء
        winners: null,           // يُضبط عند الانتهاء
        version: 0,
        startedAt: now,
        turnStartedAt: now,
        lastAction: null
    };
}

// ───────────────────────── الهندسة ─────────────────────────

// المربع العام على المسار المشترك، أو null خارجه (قاعدة/ممرّ البيت/البيت)
function globalSquare(color, pos) {
    if (pos < 0 || pos > LAST_TRACK_STEP) return null;
    return (START_OFFSET[color] + pos) % TRACK_LENGTH;
}

const isSafeSquare = (square) => SAFE_SQUARES.has(square);

function targetOf(pos, dice) {
    if (pos === BASE) return dice === 6 ? 0 : null;
    if (pos === HOME) return null;
    const to = pos + dice;
    return to > HOME ? null : to;
}

const sameSide = (a, b) => a.team === b.team;

function legalMovesFor(state, seatIndex, dice) {
    const seat = state.seats[seatIndex];
    if (seat.status !== 'active') return [];
    const moves = [];
    seat.tokens.forEach((pos, token) => {
        const to = targetOf(pos, dice);
        if (to !== null) moves.push({ token, from: pos, to });
    });
    return moves;
}

// ───────────────────────── التحقّق ─────────────────────────

function assertTurn(state, playerId, expectVersion) {
    if (state.phase === 'ended') throw new LudoError('GAME_ENDED', 'انتهت المباراة', 409);
    if (expectVersion !== undefined && expectVersion !== state.version) {
        throw new LudoError('STALE_VERSION', 'الحالة تغيّرت — حدّث اللوحة', 409);
    }
    const seat = state.seats[state.turn];
    if (seat.id !== String(playerId)) throw new LudoError('NOT_YOUR_TURN', 'ليس دورك', 403);
}

// ───────────────────────── الدور ─────────────────────────

function isActive(seat) { return seat.status === 'active'; }

function nextActiveSeat(state, from) {
    const n = state.seats.length;
    for (let step = 1; step <= n; step++) {
        const i = (from + step) % n;
        if (isActive(state.seats[i])) return i;
    }
    return from;
}

function passTurn(state, now) {
    state.turn = nextActiveSeat(state, state.turn);
    state.phase = 'roll';
    state.dice = null;
    state.sixes = 0;
    state.legalMoves = [];
    state.canReroll = false;
    state.turnStartedAt = now;
}

function keepTurn(state, now) {
    state.phase = 'roll';
    state.dice = null;
    state.legalMoves = [];
    state.canReroll = false;
    state.turnStartedAt = now;
}

// ───────────────────────── الانتهاء ─────────────────────────

function checkEnd(state) {
    if (state.phase === 'ended') return true;
    const seats = state.seats;
    const playing = seats.filter(s => s.status !== 'left');

    if (MODES[state.mode].teams) {
        // فريق خرج أحد لاعبيه كلياً = خاسر؛ الفريق الذي أنهى الاثنان فائز
        const teamDone = (t) => seats.filter(s => s.team === t).every(s => s.status === 'finished');
        const teamLeft = (t) => seats.some(s => s.team === t && s.status === 'left');
        for (const t of [0, 1]) {
            const o = 1 - t;
            if (teamDone(t) || teamLeft(o)) {
                state.winners = seats.filter(s => s.team === t).map(s => s.id);
                state.phase = 'ended';
                return true;
            }
        }
        return false;
    }

    // فردي: ينتهي بأول منهٍ (endOnFirstFinish)، أو حين يبقى لاعب واحد لم يُنهِ
    const stillPlaying = playing.filter(s => s.status === 'active');
    if (state.options.endOnFirstFinish && state.finishOrder.length > 0) {
        state.winners = state.finishOrder.slice(0, 1);
        state.phase = 'ended';
        return true;
    }
    if (stillPlaying.length <= 1) {
        stillPlaying.forEach(s => {
            if (!state.finishOrder.includes(s.id)) state.finishOrder.push(s.id);
        });
        state.winners = state.finishOrder.slice(0, 1);
        state.phase = 'ended';
        return true;
    }
    return false;
}

// الترتيب النهائي: المنهون بترتيبهم، ثم من بقي، ثم المنسحبون
function ranking(state) {
    if (MODES[state.mode].teams) {
        const win = new Set(state.winners || []);
        return state.seats.map(s => ({ id: s.id, place: win.has(s.id) ? 1 : 2, left: s.status === 'left' }));
    }
    const order = [...state.finishOrder];
    // من لم يُنهِ: الأكثر تقدّماً أولاً (مجموع خطوات قطعه، والقاعدة صفر)
    const progress = (s) => s.tokens.reduce((sum, p) => sum + (p === BASE ? 0 : p + 1), 0);
    state.seats
        .filter(s => s.status === 'active' && !order.includes(s.id))
        .sort((a, b) => progress(b) - progress(a))
        .forEach(s => order.push(s.id));
    const left = state.seats.filter(s => s.status === 'left').map(s => s.id);
    return [...order, ...left.filter(id => !order.includes(id))]
        .map((id, i) => ({ id, place: i + 1, left: left.includes(id) }));
}

// ───────────────────────── الأفعال ─────────────────────────

// يُبقي الرمية مفتوحة للإعادة؟ (لاعب بشري بقي له رصيد إعادة)
const paidRerollCost = (state, seat) => {
    const costs = state.options.paidRerollCosts || [];
    return seat.paidOk ? (costs[seat.paidRerolls || 0] ?? null) : null;
};
const hasReroll = (state, seat) => !seat.isBot && ((seat.rerolls || 0) > 0 || paidRerollCost(state, seat) !== null);
const canRerollNow = (state, seat) => hasReroll(state, seat) && state.phase === 'move';
// سعر إعادة الرمية الحالية: 0 مجانية، رقم = جواهر، null = غير متاحة
function rerollCost(state) {
    if (!state.canReroll) return null;
    const seat = state.seats[state.turn];
    return (seat.rerolls || 0) > 0 ? 0 : paidRerollCost(state, seat);
}

function rollValue(rollDie, state) {
    // النرد يرى الحالة (الخدمة ترفع احتمال الـ 6 حين تكون كل القطع في القاعدة)
    const dice = rollDie(state);
    if (!Number.isInteger(dice) || dice < 1 || dice > 6) throw new LudoError('BAD_DIE', 'نرد غير صالح', 500);
    return dice;
}

// يطبّق نتيجة رمية على state (مشترك بين roll وreroll)
function applyRoll(state, seat, dice, action, now) {
    // رميات متتالية بلا 6 وكل القطع خارج اللعب (قاعدة/بيت) — الخدمة تضمن الـ 6 بعد حدّ (service.rollDie)
    const stuck = seat.tokens.some(p => p === BASE) && seat.tokens.every(p => p === BASE || p === HOME);
    seat.dry = stuck && dice !== 6 ? (seat.dry || 0) + 1 : 0;
    state.dice = dice;
    state.sixes = dice === 6 ? state.sixes + 1 : 0;
    state.canReroll = false;

    if (state.sixes === 3 && state.options.threeSixesForfeit) {
        action.forfeit = 'three_sixes';
        passTurn(state, now);
        return;
    }
    const moves = legalMovesFor(state, state.turn, dice);
    if (moves.length === 0) {
        action.noMoves = true;
        if (hasReroll(state, seat)) {
            // يبقى الدور: إعادة الرمي أو التخطّي (pass) — المهلة تتخطّى تلقائياً
            state.phase = 'move';
            state.legalMoves = [];
            state.canReroll = true;
            return;
        }
        // 6 بلا حركة ممكنة تبقى رمية إضافية
        if (dice === 6) keepTurn(state, now); else passTurn(state, now);
    } else {
        state.phase = 'move';
        state.legalMoves = moves;
        state.canReroll = canRerollNow(state, seat);
    }
}

// rollDie: (state) => 1..6
function roll(input, { playerId, rollDie, expectVersion, now = Date.now() }) {
    assertTurn(input, playerId, expectVersion);
    if (input.phase !== 'roll') throw new LudoError('NOT_ROLL_PHASE', 'حرّك قطعة أولاً', 409);

    const state = clone(input);
    const seat = state.seats[state.turn];
    const dice = rollValue(rollDie, state);

    seat.missed = 0;
    state.version++;
    const action = { type: 'roll', playerId: seat.id, dice };
    applyRoll(state, seat, dice, action, now);

    state.lastAction = action;
    return { state, events: [action] };
}

// إعادة الرمي (أداة مساعدة): بعد الرمي وقبل التحريك، rerollsPerPlayer مرة لكل لاعب في المباراة.
// الرمية الملغاة لا تُحسب في عدّ الستات المتتالية.
// paid: الخدمة خصمت الجواهر (سعر rerollCost) — بلا هذا العلم لا تُقبل إلا المجانية.
function reroll(input, { playerId, rollDie, expectVersion, now = Date.now(), paid = false }) {
    assertTurn(input, playerId, expectVersion);
    if (input.phase !== 'move' || !input.canReroll) {
        throw new LudoError('CANNOT_REROLL', 'لا يمكن إعادة الرمي الآن', 409);
    }
    const state = clone(input);
    const seat = state.seats[state.turn];
    const free = (seat.rerolls || 0) > 0;
    if (!free && !(paid && paidRerollCost(state, seat) !== null)) {
        throw new LudoError('NO_REROLLS', 'استعملت إعادة الرمي', 409);
    }
    if (free) seat.rerolls -= 1;
    else seat.paidRerolls = (seat.paidRerolls || 0) + 1;
    seat.missed = 0;
    if (state.dice === 6) state.sixes = Math.max(0, state.sixes - 1);
    const previous = state.dice;
    const dice = rollValue(rollDie, state);
    state.version++;
    const action = { type: 'roll', playerId: seat.id, dice, reroll: true, previous, ...(free ? {} : { paid: true }) };
    applyRoll(state, seat, dice, action, now);

    state.lastAction = action;
    return { state, events: [action] };
}

// تخطّي الدور حين لا حركة ممكنة (بدل إعادة الرمي)
function pass(input, { playerId, expectVersion, now = Date.now() }) {
    assertTurn(input, playerId, expectVersion);
    if (input.phase !== 'move' || input.legalMoves.length > 0) {
        throw new LudoError('CANNOT_PASS', 'لا يمكن التخطّي الآن', 409);
    }
    const state = clone(input);
    const seat = state.seats[state.turn];
    seat.missed = 0;
    state.version++;
    state.canReroll = false;
    const action = { type: 'pass', playerId: seat.id };
    if (state.dice === 6) keepTurn(state, now); else passTurn(state, now);
    state.lastAction = action;
    return { state, events: [action] };
}

function move(input, { playerId, token, expectVersion, now = Date.now() }) {
    assertTurn(input, playerId, expectVersion);
    if (input.phase !== 'move') throw new LudoError('NOT_MOVE_PHASE', 'ارمِ النرد أولاً', 409);
    const chosen = input.legalMoves.find(m => m.token === token);
    if (!chosen) throw new LudoError('ILLEGAL_MOVE', 'حركة غير مسموحة');

    const state = clone(input);
    const seat = state.seats[state.turn];
    seat.missed = 0;
    state.canReroll = false;
    seat.tokens[token] = chosen.to;
    state.version++;

    const action = {
        type: 'move',
        playerId: seat.id,
        dice: state.dice,
        token,
        from: chosen.from,
        to: chosen.to,
        captured: [],
        extraTurn: false
    };

    // الأكل
    const square = globalSquare(seat.color, chosen.to);
    if (square !== null && !isSafeSquare(square)) {
        state.seats.forEach(other => {
            if (other === seat || sameSide(other, seat) || other.status === 'left') return;
            other.tokens.forEach((p, t) => {
                if (globalSquare(other.color, p) === square) {
                    other.tokens[t] = BASE;
                    action.captured.push({ playerId: other.id, token: t, from: p });
                }
            });
        });
    }

    // الإنهاء
    if (chosen.to === HOME && seat.tokens.every(p => p === HOME)) {
        seat.status = 'finished';
        state.finishOrder.push(seat.id);
        action.finished = true;
    }

    const ended = checkEnd(state);
    if (!ended) {
        action.extraTurn = seat.status === 'active' &&
            (state.dice === 6 || action.captured.length > 0 || chosen.to === HOME);
        if (action.extraTurn) {
            keepTurn(state, now);
        } else {
            passTurn(state, now);
        }
    } else {
        state.dice = null;
        state.legalMoves = [];
    }

    state.lastAction = action;
    return { state, events: [action] };
}

// خروج نهائي (انسحاب): قطعه تُزال، ويُرتَّب أخيراً. إن كان دوره ينتقل الدور.
function leave(input, { playerId, now = Date.now() }) {
    if (input.phase === 'ended') throw new LudoError('GAME_ENDED', 'انتهت المباراة', 409);
    const index = input.seats.findIndex(s => s.id === String(playerId));
    if (index < 0) throw new LudoError('NOT_IN_GAME', 'لست في هذه المباراة', 403);
    if (input.seats[index].status !== 'active') {
        throw new LudoError('ALREADY_OUT', 'خرجت أو أنهيت المباراة', 409);
    }

    const state = clone(input);
    const seat = state.seats[index];
    seat.status = 'left';
    seat.tokens = seat.tokens.map(() => BASE);
    state.version++;
    const action = { type: 'leave', playerId: seat.id };

    if (!checkEnd(state) && state.turn === index) passTurn(state, now);
    state.lastAction = action;
    return { state, events: [action] };
}

// ───────────────────────── البوت والمهلة ─────────────────────────

// اختيار حركة البوت — تقييم لكل حركة ممكنة (الأعلى يُلعب):
//   أكل قطعة خصم (أثمن كلما كانت أبعد تقدّماً) > الوصول للبيت > الخروج من القاعدة > دخول ممرّ البيت >
//   مربع آمن > الهروب من خطر، مع خصم يتناسب مع **عدد** الخصوم القادرين على أكلها وقيمة القطعة المهدَّدة،
//   وتفضيل تحريك قطعة المسار المكشوفة على قطعة آمنة في الممرّ، ومطاردة خصم على بُعد رمية.
// حتمي بلا عشوائية (التعادل لأول حركة) — الاختبارات تعتمد على ذلك.
function chooseBotMove(state) {
    const seat = state.seats[state.turn];
    const moves = state.legalMoves;
    if (moves.length === 0) return null;

    const enemySquares = [];
    state.seats.forEach(o => {
        if (o === seat || sameSide(o, seat) || o.status !== 'active') return;
        o.tokens.forEach(p => {
            const sq = globalSquare(o.color, p);
            if (sq !== null) enemySquares.push(sq);
        });
    });
    // تقدّم كل قطعة خصم على مربعها (لتقدير قيمة الأكل)
    const enemyProgress = new Map();
    state.seats.forEach(o => {
        if (o === seat || sameSide(o, seat) || o.status !== 'active') return;
        o.tokens.forEach(p => {
            const sq = globalSquare(o.color, p);
            if (sq !== null) enemyProgress.set(sq, Math.max(enemyProgress.get(sq) || 0, p));
        });
    });
    // كم خصماً يستطيع أكل قطعة على هذا المربع بالرمية القادمة (خلفه بمسافة 1..6)
    const attackers = (sq) => sq === null || isSafeSquare(sq) ? 0 :
        enemySquares.filter(e => {
            const d = (sq - e + TRACK_LENGTH) % TRACK_LENGTH;
            return d >= 1 && d <= 6;
        }).length;
    // خصم أمامي بمسافة 1..6 على مربع غير آمن — أستطيع أكله في رميتي القادمة
    const canChase = (sq) => sq !== null && enemySquares.some(e => {
        const d = (e - sq + TRACK_LENGTH) % TRACK_LENGTH;
        return d >= 1 && d <= 6 && !isSafeSquare(e);
    });

    let best = null;
    let bestScore = -Infinity;
    for (const m of moves) {
        const toSq = globalSquare(seat.color, m.to);
        const fromSq = globalSquare(seat.color, m.from);
        const riskFrom = attackers(fromSq);
        const riskTo = attackers(toSq);
        let score = m.to;                                   // التقدّم
        // الأكل: يعيد الخصم لقاعدته — أثمن كلما كان أبعد تقدّماً
        if (toSq !== null && !isSafeSquare(toSq) && enemyProgress.has(toSq)) score += 1000 + enemyProgress.get(toSq) * 6;
        if (m.to === HOME) score += 800;
        if (m.from === BASE) score += 600;
        if (m.to > LAST_TRACK_STEP && m.from <= LAST_TRACK_STEP) score += 400;   // دخل ممرّ البيت
        if (toSq !== null && isSafeSquare(toSq)) score += 200;
        // الهروب: قطعة مكشوفة تنتقل لمكان أأمن — أهمّ كلما كانت أبعد تقدّماً
        if (riskFrom > 0 && riskTo < riskFrom) score += 150 + m.from * 3;
        // الخطر في الوجهة: بعدد المهاجمين وبقيمة ما سأخسره
        if (riskTo > 0) score -= 220 * riskTo + m.to * 4;
        // ترك مربع آمن إلى مكشوف بلا مكسب — يُعاقَب
        if (fromSq !== null && isSafeSquare(fromSq) && riskTo > 0) score -= 120;
        // قطعة في ممرّ البيت آمنة أصلاً: تحريكها (دون الوصول) أقلّ إلحاحاً من قطعة على المسار
        if (m.from > LAST_TRACK_STEP && m.to !== HOME) score -= 80;
        // مطاردة: الوقوف خلف خصم على بُعد رمية (إن لم أكن مكشوفاً أكثر)
        if (riskTo === 0 && canChase(toSq)) score += 90;
        if (score > bestScore) { bestScore = score; best = m; }
    }
    return best;
}

// خطوة واحدة نيابة عن صاحب الدور (بوت، أو لاعب انتهت مهلته)
function autoStep(state, { rollDie, now }) {
    const playerId = state.seats[state.turn].id;
    if (state.phase === 'roll') return roll(state, { playerId, rollDie, now });
    // لا حركة ممكنة وكان بانتظار قرار إعادة الرمي ← تخطٍّ
    if (state.legalMoves.length === 0) return pass(state, { playerId, now });
    const m = chooseBotMove(state);
    return move(state, { playerId, token: m.token, now });
}

// انتهت مهلة الدور: البوت يكمل الدور كاملاً (رمي + حركة)، ويُعدّ دوراً فائتاً.
// بعد maxMissedTurns متتالية يصير اللاعب بوتاً حتى نهاية المباراة (takenOver).
function handleTimeout(input, { rollDie, expectVersion, now = Date.now() }) {
    if (input.phase === 'ended') throw new LudoError('GAME_ENDED', 'انتهت المباراة', 409);
    if (expectVersion !== undefined && expectVersion !== input.version) {
        throw new LudoError('STALE_VERSION', 'الحالة تغيّرت', 409);
    }
    const seatIndex = input.turn;
    let state = clone(input);
    const seat = state.seats[seatIndex];
    const missed = seat.missed + 1;
    const events = [];

    // دور واحد فقط: حتى ينتقل الدور أو تنتهي المباراة (الرميات الإضافية ضمنه)
    let guard = 0;
    do {
        const r = autoStep(state, { rollDie, now });
        state = r.state;
        events.push(...r.events);
        if (++guard > 50) throw new LudoError('TIMEOUT_LOOP', 'حلقة غير متوقعة', 500);
    } while (state.phase !== 'ended' && state.turn === seatIndex);

    const s = state.seats[seatIndex];
    s.missed = missed;
    if (missed >= state.options.maxMissedTurns && !s.isBot) {
        s.isBot = true;
        events.push({ type: 'taken_over', playerId: s.id });
    }
    return { state, events };
}

// ───────────────────────── العرض ─────────────────────────

// ما يُرسل للعملاء — لا أسرار في اللودو، لكن نُبقي الشكل ثابتاً ومستقلاً عن التخزين
function publicState(state) {
    return {
        mode: state.mode,
        seats: state.seats.map(s => ({
            id: s.id, color: s.color, team: s.team, tokens: s.tokens,
            status: s.status, isBot: s.isBot, rerolls: s.rerolls || 0
        })),
        turn: state.turn,
        currentPlayerId: state.seats[state.turn]?.id || null,
        phase: state.phase,
        dice: state.dice,
        legalMoves: state.legalMoves,
        canReroll: !!state.canReroll,
        rerollCost: rerollCost(state),
        winners: state.winners,
        ranking: state.phase === 'ended' ? ranking(state) : null,
        version: state.version,
        turnStartedAt: state.turnStartedAt,
        lastAction: state.lastAction
    };
}

module.exports = {
    createGame,
    roll,
    reroll,
    pass,
    move,
    leave,
    handleTimeout,
    autoStep,
    chooseBotMove,
    legalMovesFor,
    globalSquare,
    isSafeSquare,
    ranking,
    publicState,
    rerollCost,
    LudoError,
    constants: { TRACK_LENGTH, LAST_TRACK_STEP, HOME, BASE, COLORS, START_OFFSET, MODES }
};
