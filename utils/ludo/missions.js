// MatchHala - هلا لودو: مهام اليوم
//
// قائمة ثابتة تتجدّد يومياً (UTC، مثل مكافأة الإعلان). التقدّم في Redis (hash لكل لاعب/يوم، مهلة 48س):
//   العدّ HINCRBY، والاستلام HSETNX (مرة واحدة حتى مع طلبين متزامنين). المكافأة عملات/جواهر لعب فقط.
// «العب مع صديق» تحلّ محلّ «مكافأة دعوة صديق»: إحالة حسابات جديدة تُستغلّ بتعدّد الحسابات — قرار للمالك.

const { LudoError } = require('../ludoEngine');
const store = require('./store');
const economy = require('./economy');

const MISSIONS = [
    { id: 'play3', key: 'play', target: 3, coins: 300, gems: 0 },
    { id: 'win1', key: 'win', target: 1, coins: 500, gems: 0 },
    { id: 'capture3', key: 'capture', target: 3, coins: 300, gems: 1 },
    { id: 'friend1', key: 'friend', target: 1, coins: 500, gems: 1 }
];

const DAY_MS = 24 * 60 * 60 * 1000;
const dayKeyOf = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);
const nextReset = (now = Date.now()) => Math.floor(now / DAY_MS) * DAY_MS + DAY_MS;

// يزيد تقدّم مفتاح (play | win | capture | friend) — ثانوي: فشله لا يمسّ المباراة
async function track(userId, key, n = 1, now = Date.now()) {
    try {
        await store.missionIncr(String(userId), dayKeyOf(now), key, n);
    } catch (e) {
        if (e.code !== 'GAMES_UNAVAILABLE') console.error('ludo mission track:', e.message);
    }
}

async function view(userId, now = Date.now()) {
    const h = await store.missionGet(String(userId), dayKeyOf(now)).catch(() => ({}));
    return {
        resetsAt: nextReset(now),
        missions: MISSIONS.map(m => ({
            id: m.id,
            target: m.target,
            progress: Math.min(m.target, Number(h[m.key]) || 0),
            reward: { coins: m.coins, gems: m.gems },
            claimed: h[`claimed:${m.id}`] === '1'
        }))
    };
}

async function claim(userId, missionId, now = Date.now()) {
    const id = String(userId);
    const m = MISSIONS.find(x => x.id === String(missionId));
    if (!m) throw new LudoError('BAD_MISSION', 'مهمة غير معروفة', 400);
    const day = dayKeyOf(now);
    const h = await store.missionGet(id, day);
    if ((Number(h[m.key]) || 0) < m.target) throw new LudoError('MISSION_NOT_DONE', 'لم تكتمل المهمة بعد', 409);
    if (!(await store.missionClaim(id, day, m.id))) {
        throw new LudoError('MISSION_CLAIMED', 'استلمت مكافأة هذه المهمة', 409);
    }
    try {
        return await economy.grant(id, { coins: m.coins, gems: m.gems });
    } catch (e) {
        await store.missionUnclaim(id, day, m.id).catch(() => {});
        throw e;
    }
}

module.exports = { track, view, claim, constants: { MISSIONS } };
