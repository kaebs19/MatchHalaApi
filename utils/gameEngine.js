// MatchHala - محرّك ألعاب المحادثة (منطق صرف بلا قاعدة بيانات)
//
// أربع ألعاب: حقيقة أم جرأة · هل تفضّل؟ · لم أفعل قط · حقيقتان وكذبة
// الحالة تعيش داخل رسالة واحدة (type: 'game') وتتحدّث في مكانها.
//
// ⚠️ النص الحرّ الوحيد: عبارات «حقيقتان وكذبة». تُفحَص في المسار (routes/mobile/games.js)
//    بفلاتر الكلمات المحظورة والترويج قبل وصولها هنا؛ المحرّك يتحقق من الشكل والطول فقط.
//    باقي الألعاب أسئلتها من البنك، والإجابة تُكتب في المحادثة كرسالة عادية.
//
// اختيارات «هل تفضّل؟» سرّية حتى يختار الطرفان، لذا تُخزَّن في `secret`
// (حقل gameSecret في الرسالة، select:false) ولا تصل للعميل قبل الكشف.

const { TRUTHS, DARES, WOULD_YOU_RATHER, NEVER_HAVE_I_EVER } = require('./gameQuestions');

// بنوك افتراضية (ثابتة) — الإنتاج يمرّر بنوك قاعدة البيانات (utils/gameBanks.js)
const DEFAULT_BANKS = {
    truth: TRUTHS.map((q, i) => ({ id: i, ar: q.ar, en: q.en })),
    dare: DARES.map((q, i) => ({ id: i, ar: q.ar, en: q.en })),
    never: NEVER_HAVE_I_EVER.map((q, i) => ({ id: i, ar: q.ar, en: q.en })),
    wyr: WOULD_YOU_RATHER.map((q, i) => ({ id: i, a: q.a, b: q.b }))
};

const KINDS = ['truth_dare', 'would_you_rather', 'never_have_i_ever', 'two_truths_lie'];
// ألعاب يختار فيها الطرفان معاً ثم يُكشف الاثنان
const PICK_KINDS = ['would_you_rather', 'never_have_i_ever'];
const MAX_STATEMENT_LEN = 100;
const MAX_SWAPS = 2;
const EXPIRY_MS = 24 * 60 * 60 * 1000;

class GameError extends Error {
    constructor(code, message, status = 400) {
        super(message);
        this.code = code;
        this.status = status;
    }
}

const other = (game, userId) => game.players.find(p => p !== userId);
const isPlayer = (game, userId) => game.players.includes(userId);

function pickQuestion(bank, used, rand = Math.random) {
    if (!bank || bank.length === 0) throw new GameError('NO_QUESTIONS', 'لا توجد أسئلة متاحة', 503);
    let pool = bank.filter(q => !used.includes(q.id));
    if (pool.length === 0) pool = bank; // استُنفد البنك → ندور من جديد
    return pool[Math.floor(rand() * pool.length)];
}

function usedKey(game, bankName) {
    game.used = game.used || {};
    game.used[bankName] = game.used[bankName] || [];
    return game.used[bankName];
}

function drawTruthOrDare(game, choice, rand, banks) {
    const bankName = choice === 'truth' ? 'truth' : 'dare';
    const used = usedKey(game, bankName);
    const q = pickQuestion(banks[bankName], used, rand);
    used.push(q.id);
    return { id: q.id, ar: q.ar, en: q.en };
}

function drawWouldYouRather(game, rand, banks) {
    const used = usedKey(game, 'wyr');
    const q = pickQuestion(banks.wyr, used, rand);
    used.push(q.id);
    return { id: q.id, a: q.a, b: q.b };
}

function drawNever(game, rand, banks) {
    const used = usedKey(game, 'never');
    const q = pickQuestion(banks.never, used, rand);
    used.push(q.id);
    return { id: q.id, ar: q.ar, en: q.en };
}

function drawPickQuestion(game, rand, banks) {
    return game.kind === 'never_have_i_ever' ? drawNever(game, rand, banks) : drawWouldYouRather(game, rand, banks);
}

function createGame(kind, starterId, otherId, now = new Date()) {
    if (!KINDS.includes(kind)) throw new GameError('INVALID_KIND', 'لعبة غير مدعومة');
    return {
        kind,
        status: 'invited',
        players: [String(starterId), String(otherId)],
        turn: null,
        phase: null,
        round: 0,
        current: null,
        used: {},
        stats: { done: 0, skipped: 0, correct: 0 },
        endedBy: null,
        updatedAt: now.toISOString()
    };
}

function isExpired(game, now = new Date()) {
    if (game.status !== 'invited' && game.status !== 'active') return false;
    return now.getTime() - new Date(game.updatedAt).getTime() > EXPIRY_MS;
}

// يطبّق إجراءً. يُرجع { game, secret, notify } — notify = معرّف من يجب تنبيهه
// (الدور انتقل إليه) أو null. لا يعدّل المُدخلات.
function applyAction(inputGame, inputSecret, userId, action, payload = {}, now = new Date(), rand = Math.random, banks = DEFAULT_BANKS) {
    const game = JSON.parse(JSON.stringify(inputGame));
    let secret = inputSecret ? JSON.parse(JSON.stringify(inputSecret)) : {};
    userId = String(userId);
    let notify = null;

    if (!isPlayer(game, userId)) throw new GameError('NOT_PLAYER', 'لست طرفاً في هذه اللعبة', 403);

    if (isExpired(game, now)) {
        game.status = 'ended';
        game.endedBy = 'timeout';
        game.turn = null;
        game.phase = null;
        game.updatedAt = now.toISOString();
        throw Object.assign(new GameError('GAME_EXPIRED', 'انتهت اللعبة لعدم الرد', 410), { game, secret: {} });
    }

    const finished = game.status === 'ended' || game.status === 'declined';
    if (finished) throw new GameError('GAME_ENDED', 'انتهت هذه اللعبة', 409);

    const opponent = other(game, userId);
    const requireActive = () => {
        if (game.status !== 'active') throw new GameError('NOT_ACTIVE', 'اللعبة لم تبدأ بعد', 409);
    };
    const requireTurn = () => {
        if (game.turn !== userId) throw new GameError('NOT_YOUR_TURN', 'ليس دورك', 409);
    };

    switch (action) {
        case 'accept': {
            if (game.status !== 'invited') throw new GameError('NOT_INVITED', 'لا توجد دعوة معلّقة', 409);
            if (userId !== game.players[1]) throw new GameError('NOT_INVITEE', 'الدعوة ليست لك', 403);
            game.status = 'active';
            if (game.kind === 'truth_dare') {
                game.turn = game.players[0]; // صاحب الدعوة يبدأ
                game.phase = 'choose';
                notify = game.turn;
            } else if (game.kind === 'two_truths_lie') {
                game.round = 1;
                game.turn = game.players[0];
                game.phase = 'write';
                notify = game.turn;
            } else {
                game.round = 1;
                game.phase = 'pick';
                game.current = { question: drawPickQuestion(game, rand, banks), pickedBy: [], picks: null };
                secret = { picks: {} };
                notify = game.players[0];
            }
            break;
        }

        case 'decline': {
            if (game.status !== 'invited') throw new GameError('NOT_INVITED', 'لا توجد دعوة معلّقة', 409);
            if (userId !== game.players[1]) throw new GameError('NOT_INVITEE', 'الدعوة ليست لك', 403);
            game.status = 'declined';
            game.endedBy = userId;
            game.turn = null;
            game.phase = null;
            break;
        }

        case 'end': {
            game.status = 'ended';
            game.endedBy = userId;
            game.turn = null;
            game.phase = null;
            secret = {};
            break;
        }

        case 'choose': {
            requireActive();
            if (game.kind !== 'truth_dare' || game.phase !== 'choose') throw new GameError('BAD_PHASE', 'إجراء غير متاح الآن', 409);
            requireTurn();
            const choice = payload.choice;
            if (choice !== 'truth' && choice !== 'dare') throw new GameError('INVALID_CHOICE', 'اختيار غير صالح');
            game.round += 1;
            game.current = { choice, question: drawTruthOrDare(game, choice, rand, banks), swaps: 0 };
            game.phase = 'answer';
            break;
        }

        case 'swap': {
            requireActive();
            if (game.kind !== 'truth_dare' || game.phase !== 'answer') throw new GameError('BAD_PHASE', 'إجراء غير متاح الآن', 409);
            requireTurn();
            if (game.current.swaps >= MAX_SWAPS) throw new GameError('NO_SWAPS_LEFT', 'انتهت مرات التبديل', 409);
            game.current.swaps += 1;
            game.current.question = drawTruthOrDare(game, game.current.choice, rand, banks);
            break;
        }

        case 'done':
        case 'skip': {
            requireActive();
            if (game.kind !== 'truth_dare' || game.phase !== 'answer') throw new GameError('BAD_PHASE', 'إجراء غير متاح الآن', 409);
            requireTurn();
            game.stats[action === 'done' ? 'done' : 'skipped'] += 1;
            game.turn = opponent;
            game.phase = 'choose';
            game.current = null;
            notify = opponent;
            break;
        }

        case 'pick': {
            requireActive();
            if (!PICK_KINDS.includes(game.kind) || game.phase !== 'pick') throw new GameError('BAD_PHASE', 'إجراء غير متاح الآن', 409);
            const choice = payload.choice;
            if (choice !== 'a' && choice !== 'b') throw new GameError('INVALID_CHOICE', 'اختيار غير صالح');
            secret.picks = secret.picks || {};
            if (secret.picks[userId]) throw new GameError('ALREADY_PICKED', 'اخترت مسبقاً', 409);
            secret.picks[userId] = choice;
            game.current.pickedBy = Object.keys(secret.picks);
            if (game.current.pickedBy.length === 2) {
                game.current.picks = secret.picks;
                game.phase = 'reveal';
                secret = {};
                notify = game.players[0] === userId ? game.players[1] : game.players[0];
            } else {
                notify = opponent;
            }
            break;
        }

        case 'next': {
            requireActive();
            if (game.kind === 'two_truths_lie' && game.phase === 'reveal') {
                // من خمّن للتوّ يكتب الجولة التالية (turn ما زال عنده)
                game.round += 1;
                game.phase = 'write';
                game.current = null;
                notify = game.turn === userId ? null : game.turn;
                break;
            }
            if (!PICK_KINDS.includes(game.kind) || game.phase !== 'reveal') throw new GameError('BAD_PHASE', 'إجراء غير متاح الآن', 409);
            game.round += 1;
            game.phase = 'pick';
            game.current = { question: drawPickQuestion(game, rand, banks), pickedBy: [], picks: null };
            secret = { picks: {} };
            notify = opponent;
            break;
        }

        case 'submit': {
            requireActive();
            if (game.kind !== 'two_truths_lie' || game.phase !== 'write') throw new GameError('BAD_PHASE', 'إجراء غير متاح الآن', 409);
            requireTurn();
            const statements = payload.statements;
            const lie = payload.lie;
            if (!Array.isArray(statements) || statements.length !== 3) throw new GameError('INVALID_STATEMENTS', 'اكتب ثلاث عبارات');
            const clean = statements.map(t => (typeof t === 'string' ? t.trim().replace(/\s+/g, ' ') : ''));
            if (clean.some(t => t.length < 2 || t.length > MAX_STATEMENT_LEN)) {
                throw new GameError('INVALID_STATEMENTS', `كل عبارة بين 2 و${MAX_STATEMENT_LEN} حرفاً`);
            }
            if (new Set(clean.map(t => t.toLowerCase())).size !== 3) throw new GameError('INVALID_STATEMENTS', 'العبارات الثلاث يجب أن تكون مختلفة');
            if (!Number.isInteger(lie) || lie < 0 || lie > 2) throw new GameError('INVALID_LIE', 'حدّد أيّها الكذبة');
            game.current = { writer: userId, statements: clean, guess: null, lie: null, correct: null };
            secret = { lie };
            game.turn = opponent;
            game.phase = 'guess';
            notify = opponent;
            break;
        }

        case 'guess': {
            requireActive();
            if (game.kind !== 'two_truths_lie' || game.phase !== 'guess') throw new GameError('BAD_PHASE', 'إجراء غير متاح الآن', 409);
            requireTurn();
            const index = payload.index;
            if (!Number.isInteger(index) || index < 0 || index > 2) throw new GameError('INVALID_CHOICE', 'اختيار غير صالح');
            const correct = index === secret.lie;
            game.current.guess = index;
            game.current.lie = secret.lie;
            game.current.correct = correct;
            if (correct) game.stats.correct = (game.stats.correct || 0) + 1;
            game.phase = 'reveal';
            secret = {};
            notify = game.current.writer;
            break;
        }

        default:
            throw new GameError('INVALID_ACTION', 'إجراء غير معروف');
    }

    game.updatedAt = now.toISOString();
    return { game, secret, notify };
}

// نصّ احتياطي في content — يراه العملاء القدامى وقوائم المحادثات
function fallbackText(kind) {
    const titles = {
        truth_dare: 'حقيقة أم جرأة',
        would_you_rather: 'هل تفضّل؟',
        never_have_i_ever: 'لم أفعل قط',
        two_truths_lie: 'حقيقتان وكذبة'
    };
    return `🎮 لعبة «${titles[kind] || 'جديدة'}» — حدّث التطبيق للعب`;
}

module.exports = { KINDS, GameError, createGame, applyAction, isExpired, fallbackText, MAX_SWAPS, EXPIRY_MS };
