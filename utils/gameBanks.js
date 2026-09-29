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

function staticBanks() {
    const withIds = (arr) => arr.map((q, i) => ({ id: `s${i}`, ar: q.ar, en: q.en }));
    return {
        truth: withIds(STATIC.TRUTHS),
        dare: withIds(STATIC.DARES),
        never: withIds(STATIC.NEVER_HAVE_I_EVER),
        wyr: STATIC.WOULD_YOU_RATHER.map((q, i) => ({ id: `s${i}`, a: q.a, b: q.b }))
    };
}

// نسخة الزرع: ارفعها عند إضافة أسئلة جديدة إلى gameQuestions(+Extra).js.
// نزرع فقط ما بعد العدد المزروع سابقاً — فلا يعود سؤال حذفه الأدمن.
// المطالبة ذرّية (findOneAndUpdate على seedVersion) فلا تزرع نسختا PM2 معاً.
const SEED_VERSION = 2;
let seeded = false;
let seeding = null;

async function runSeed() {
    const GameConfig = require('../models/GameConfig');
    await GameConfig.getConfig();
    const old = await GameConfig.findOneAndUpdate(
        { key: 'main', $or: [{ seedVersion: { $exists: false } }, { seedVersion: { $lt: SEED_VERSION } }] },
        { $set: { seedVersion: SEED_VERSION } },
        { returnDocument: 'before' }
    );
    if (!old) return;   // نسخة أخرى زرعت (أو زُرع مسبقاً)

    try {
        const banks = {
            truth: STATIC.TRUTHS, dare: STATIC.DARES, never: STATIC.NEVER_HAVE_I_EVER, wyr: STATIC.WOULD_YOU_RATHER
        };
        // مجموعة فيها أسئلة ولا سجلّ زرع = زُرعت بالنسخة الأولى (الأعداد الأساسية)
        const hadDocs = await GameQuestion.estimatedDocumentCount() > 0;
        const from = old.seededCounts || (hadDocs ? STATIC.BASE_COUNTS : { truth: 0, dare: 0, wyr: 0, never: 0 });

        const docs = [];
        for (const [bank, arr] of Object.entries(banks)) {
            for (const q of arr.slice(from[bank] || 0)) {
                docs.push(bank === 'wyr'
                    ? { bank, a: q.a, b: q.b, seeded: true }
                    : { bank, ar: q.ar, en: q.en, seeded: true });
            }
        }
        if (docs.length) await GameQuestion.insertMany(docs);
        await GameConfig.updateOne({ key: 'main' }, {
            $set: { seededCounts: { truth: banks.truth.length, dare: banks.dare.length, wyr: banks.wyr.length, never: banks.never.length } }
        });
        cache = null;
    } catch (err) {
        // تراجع كي تُعاد المحاولة عند الطلب التالي
        await GameConfig.updateOne({ key: 'main' }, { $set: { seedVersion: old.seedVersion || 0 } }).catch(() => {});
        throw err;
    }
}

async function ensureSeeded() {
    if (seeded) return;
    if (!seeding) {
        seeding = runSeed().then(() => { seeded = true; }).finally(() => { seeding = null; });
    }
    await seeding;
}

async function getBanks() {
    if (cache && Date.now() - cachedAt < TTL_MS) return cache;
    try {
        await ensureSeeded();
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

module.exports = { getBanks, invalidateBanks, staticBanks, ensureSeeded };
