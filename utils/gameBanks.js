// MatchHala - بنوك أسئلة الألعاب من قاعدة البيانات (كاش 60ث)
//
// - أول استخدام والمجموعة فارغة: نزرع البنوك الابتدائية من utils/gameQuestions.js.
// - بنك بلا أسئلة نشطة (عطّلها الأدمن كلها): نرجع للابتدائي كي لا تنكسر لعبة جارية.
// - المعرّف = _id كنصّ. الكاش يُبطَل عند أي تعديل من لوحة التحكم.

const GameQuestion = require('../models/GameQuestion');
const STATIC = require('./gameQuestions');

const TTL_MS = 60 * 1000;
let cache = null;
let cachedAt = 0;
let seeding = null;

function staticBanks() {
    const withIds = (arr) => arr.map((q, i) => ({ id: `s${i}`, ar: q.ar, en: q.en }));
    return {
        truth: withIds(STATIC.TRUTHS),
        dare: withIds(STATIC.DARES),
        never: withIds(STATIC.NEVER_HAVE_I_EVER),
        wyr: STATIC.WOULD_YOU_RATHER.map((q, i) => ({ id: `s${i}`, a: q.a, b: q.b }))
    };
}

async function seedIfEmpty() {
    if (await GameQuestion.estimatedDocumentCount() > 0) return;
    if (!seeding) {
        seeding = (async () => {
            if (await GameQuestion.countDocuments() > 0) return;
            const b = { truth: STATIC.TRUTHS, dare: STATIC.DARES, never: STATIC.NEVER_HAVE_I_EVER };
            const docs = [];
            for (const [bank, arr] of Object.entries(b)) {
                for (const q of arr) docs.push({ bank, ar: q.ar, en: q.en, seeded: true });
            }
            for (const q of STATIC.WOULD_YOU_RATHER) docs.push({ bank: 'wyr', a: q.a, b: q.b, seeded: true });
            await GameQuestion.insertMany(docs);
        })().finally(() => { seeding = null; });
    }
    await seeding;
}

async function getBanks() {
    if (cache && Date.now() - cachedAt < TTL_MS) return cache;
    try {
        await seedIfEmpty();
        const rows = await GameQuestion.find({ active: true }).select('bank ar en a b').lean();
        const fallback = staticBanks();
        const out = { truth: [], dare: [], never: [], wyr: [] };
        for (const r of rows) {
            if (r.bank === 'wyr') out.wyr.push({ id: String(r._id), a: r.a, b: r.b });
            else out[r.bank].push({ id: String(r._id), ar: r.ar, en: r.en });
        }
        for (const k of Object.keys(out)) if (out[k].length === 0) out[k] = fallback[k];
        cache = out;
        cachedAt = Date.now();
        return out;
    } catch (err) {
        console.error('🎮 gameBanks:', err.message);
        return cache || staticBanks();
    }
}

function invalidateBanks() { cache = null; cachedAt = 0; }

module.exports = { getBanks, invalidateBanks, staticBanks };
