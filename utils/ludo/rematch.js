// 🔁 هلا لودو — «إعادة المباراة» بنفس اللاعبين البشر (2 إلى 4، من أي مصدر: دعوة، تحدٍّ، غرفة، طابور).
//
// أول من يضغط يقترح (ويُحسب موافقاً)، والبقية يصلهم ludo:rematch بالحالة. تبدأ فوراً حين يوافق الجميع؛
// وعند انتهاء المهلة (30ث) تبدأ إن وافق اثنان فأكثر، ومقعد من لم يوافق يلعبه الكمبيوتر. وإلا تُلغى.
// ⚠️ الإعادة ودّية دائماً (بلا رسوم ولا نجوم) حتى بعد مباراة دوري — الرسوم لا تُخصم بلا طابور.
// الحالة في Redis (ludo:rematch:<gameId>) والمؤقّت على النسخة التي أنشأتها؛ إعادة تشغيلها تُسقط الاقتراح (يُقترح من جديد).

const { getClient } = require('../redisClient');
const { LudoError } = require('../ludoEngine');
const store = require('./store');
const service = require('./service');

const REMATCH_TTL_MS = Number(process.env.LUDO_REMATCH_TTL_MS) || 30 * 1000;
const key = (gameId) => `ludo:rematch:${gameId}`;
const timers = new Map();

async function load(gameId) {
    const raw = await (await getClient()).get(key(gameId));
    return raw ? JSON.parse(raw) : null;
}

async function save(rm) {
    const ttl = Math.max(1000, rm.expiresAt - Date.now() + 5000);
    await (await getClient()).set(key(rm.gameId), JSON.stringify(rm), { PX: ttl });
}

function viewOf(rm) {
    return {
        gameId: rm.gameId,
        from: rm.from,
        players: rm.players,
        accepted: rm.accepted,
        declined: rm.declined,
        expiresAt: rm.expiresAt,
        status: rm.status,
        newGameId: rm.newGameId || null,
        now: Date.now()
    };
}

function emit(rm) {
    global.io?.to(rm.players.map(p => `user:${p.id}`)).emit('ludo:rematch', viewOf(rm));
}

// الموافقون الأحرار (لا مباراة أخرى لهم الآن) وأهليتهم سليمة
async function freeAccepted(rm) {
    const { loadEligible } = require('./lobby');
    const out = [];
    for (const id of rm.accepted) {
        try {
            await loadEligible(id);
            if (await store.getUserGame(id)) continue;
            out.push(rm.players.find(p => p.id === id));
        } catch (e) { /* حساب صار مقيّداً — يأخذ الكمبيوتر مقعده */ }
    }
    return out.filter(Boolean);
}

async function start(rm) {
    const players = await freeAccepted(rm);
    if (players.length < 2) {
        rm.status = 'cancelled';
        return rm;
    }
    await store.dequeue(players.map(p => p.id)).catch(() => {});
    const record = await service.createMatch({
        players,
        bots: rm.size - players.length,
        mode: rm.mode,
        source: 'room'           // ودّية بين لاعبين اختاروا بعضهم (مهمة «العب مع صديق» تُحسب كالغرفة)
    });
    rm.status = 'started';
    rm.newGameId = record.id;
    return rm;
}

// تُحسم الحالة: الكل وافق ← ابدأ؛ لم يبقَ من يمكن أن يكمل اثنين ← ألغِ
async function settle(rm, { timeout = false } = {}) {
    const undecided = rm.players.filter(p => !rm.accepted.includes(p.id) && !rm.declined.includes(p.id)).length;
    if (undecided === 0 || timeout) {
        if (rm.accepted.length >= 2) return start(rm);
        rm.status = 'cancelled';
        return rm;
    }
    if (rm.accepted.length + undecided < 2) rm.status = 'cancelled';
    return rm;
}

async function finish(rm) {
    if (rm.status === 'pending') {
        await save(rm);
    } else {
        await (await getClient()).del(key(rm.gameId));
        const t = timers.get(rm.gameId);
        if (t) { clearTimeout(t); timers.delete(rm.gameId); }
    }
    emit(rm);
    return viewOf(rm);
}

function scheduleTimeout(gameId, at) {
    const t = setTimeout(() => {
        timers.delete(gameId);
        store.withLock(`rematch:${gameId}`, async () => {
            const rm = await load(gameId);
            if (!rm || rm.status !== 'pending') return;
            await finish(await settle(rm, { timeout: true }));
        }).catch(e => console.error('🎲 rematch timeout:', e.message));
    }, Math.max(0, at - Date.now()));
    t.unref?.();
    timers.set(gameId, t);
}

/** accept=true: اقتراح أو موافقة. accept=false: اعتذار. */
async function respond(userId, gameId, accept = true) {
    const id = String(userId);
    gameId = String(gameId || '');
    if (!gameId) throw new LudoError('GAME_NOT_FOUND', 'المباراة غير موجودة', 404);

    return store.withLock(`rematch:${gameId}`, async () => {
        let rm = await load(gameId);
        if (!rm) {
            if (!accept) return { status: 'none' };
            const record = await store.getGame(gameId);
            if (!record || record.state.phase !== 'ended') {
                throw new LudoError('REMATCH_UNAVAILABLE', 'انتهت مهلة إعادة هذه المباراة', 410);
            }
            const humans = record.meta.players.filter(p => !p.isBot);
            if (!humans.some(p => String(p.id) === id)) throw new LudoError('NOT_IN_GAME', 'لست في هذه المباراة', 403);
            if (humans.length < 2) {
                throw new LudoError('REMATCH_NO_HUMANS', 'لا خصوم بشر في هذه المباراة — العب مرة ثانية بدلاً منها', 409);
            }
            if (await store.getUserGame(id)) throw new LudoError('IN_GAME', 'عندك مباراة جارية — ارجع لها أولاً', 409);
            rm = {
                gameId,
                from: id,
                mode: record.meta.mode,
                size: record.meta.players.length,
                players: humans.map(p => ({ id: String(p.id), name: p.name, photo: p.photo || null })),
                accepted: [id],
                declined: [],
                expiresAt: Date.now() + REMATCH_TTL_MS,
                status: 'pending'
            };
            scheduleTimeout(gameId, rm.expiresAt);
            return finish(await settle(rm));
        }

        if (rm.status !== 'pending') return viewOf(rm);
        if (!rm.players.some(p => p.id === id)) throw new LudoError('NOT_IN_GAME', 'لست في هذه المباراة', 403);
        rm.accepted = rm.accepted.filter(x => x !== id);
        rm.declined = rm.declined.filter(x => x !== id);
        if (accept) {
            if (await store.getUserGame(id)) throw new LudoError('IN_GAME', 'عندك مباراة جارية — ارجع لها أولاً', 409);
            rm.accepted.push(id);
        } else {
            rm.declined.push(id);
        }
        // انتهت المهلة ولم يصل المؤقّت (نسخة أخرى أُعيد تشغيلها): نحسم الآن
        return finish(await settle(rm, { timeout: Date.now() >= rm.expiresAt }));
    });
}

module.exports = { respond, REMATCH_TTL_MS, _viewOf: viewOf };
