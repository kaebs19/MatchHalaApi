// MatchHala - محرّك ألعاب المحادثة (منطق صرف بلا قاعدة بيانات)
//
// لعبتان: حقيقة أم جرأة (truth_dare) · هل تفضّل؟ (would_you_rather)
// الحالة تعيش داخل رسالة واحدة (type: 'game') وتتحدّث في مكانها.
//
// ⚠️ لا نصوص حرّة من اللاعبين هنا إطلاقاً: الأسئلة من البنك، والإجابة تُكتب في
//    المحادثة كرسالة عادية فتمرّ على فلاتر الكلمات المحظورة والترويج والسبام.
//    اللعبة تتتبّع الدور فقط.
//
// اختيارات «هل تفضّل؟» سرّية حتى يختار الطرفان، لذا تُخزَّن في `secret`
// (حقل gameSecret في الرسالة، select:false) ولا تصل للعميل قبل الكشف.

const { TRUTHS, DARES, WOULD_YOU_RATHER } = require('./gameQuestions');

const KINDS = ['truth_dare', 'would_you_rather'];
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

function pickIndex(bank, used, rand = Math.random) {
    let pool = bank.map((_, i) => i).filter(i => !used.includes(i));
    if (pool.length === 0) pool = bank.map((_, i) => i); // استُنفد البنك → ندور من جديد
    return pool[Math.floor(rand() * pool.length)];
}

function usedKey(game, bankName) {
    game.used = game.used || {};
    game.used[bankName] = game.used[bankName] || [];
    return game.used[bankName];
}

function drawTruthOrDare(game, choice, rand) {
    const bankName = choice === 'truth' ? 'truth' : 'dare';
    const bank = choice === 'truth' ? TRUTHS : DARES;
    const used = usedKey(game, bankName);
    const idx = pickIndex(bank, used, rand);
    used.push(idx);
    return { id: idx, ar: bank[idx].ar, en: bank[idx].en };
}

function drawWouldYouRather(game, rand) {
    const used = usedKey(game, 'wyr');
    const idx = pickIndex(WOULD_YOU_RATHER, used, rand);
    used.push(idx);
    const q = WOULD_YOU_RATHER[idx];
    return { id: idx, a: q.a, b: q.b };
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
        stats: { done: 0, skipped: 0 },
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
function applyAction(inputGame, inputSecret, userId, action, payload = {}, now = new Date(), rand = Math.random) {
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
            } else {
                game.round = 1;
                game.phase = 'pick';
                game.current = { question: drawWouldYouRather(game, rand), pickedBy: [], picks: null };
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
            game.current = { choice, question: drawTruthOrDare(game, choice, rand), swaps: 0 };
            game.phase = 'answer';
            break;
        }

        case 'swap': {
            requireActive();
            if (game.kind !== 'truth_dare' || game.phase !== 'answer') throw new GameError('BAD_PHASE', 'إجراء غير متاح الآن', 409);
            requireTurn();
            if (game.current.swaps >= MAX_SWAPS) throw new GameError('NO_SWAPS_LEFT', 'انتهت مرات التبديل', 409);
            game.current.swaps += 1;
            game.current.question = drawTruthOrDare(game, game.current.choice, rand);
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
            if (game.kind !== 'would_you_rather' || game.phase !== 'pick') throw new GameError('BAD_PHASE', 'إجراء غير متاح الآن', 409);
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
            if (game.kind !== 'would_you_rather' || game.phase !== 'reveal') throw new GameError('BAD_PHASE', 'إجراء غير متاح الآن', 409);
            game.round += 1;
            game.phase = 'pick';
            game.current = { question: drawWouldYouRather(game, rand), pickedBy: [], picks: null };
            secret = { picks: {} };
            notify = opponent;
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
    return kind === 'truth_dare'
        ? '🎮 لعبة «حقيقة أم جرأة» — حدّث التطبيق للعب'
        : '🎮 لعبة «هل تفضّل؟» — حدّث التطبيق للعب';
}

module.exports = { KINDS, GameError, createGame, applyAction, isExpired, fallbackText, MAX_SWAPS, EXPIRY_MS };
