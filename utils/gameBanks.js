// MatchHala - بنوك أسئلة الألعاب من قاعدة البيانات (كاش 60ث)
//
// - الزرع: نسخة SEED_VERSION تزرع ما بعد العدد المزروع سابقاً (لا يعود ما حذفه الأدمن).
// - المستوى: light (الافتراضي) / bold (الجريء). بنك جريء أقلّ من 5 أسئلة يُكمَّل بالخفيف.
// - بنك بلا أسئلة نشطة (عطّلها الأدمن كلها): نرجع للابتدائي كي لا تنكسر لعبة جارية.
// - المعرّف = _id كنصّ. الكاش يُبطَل عند أي تعديل من لوحة التحكم.

const GameQuestion = require('../models/GameQuestion');
const STATIC = require('./gameQuestions');
const BOLD = require('./gameQuestionsBold');

const TTL_MS = 60 * 1000;
const MIN_BOLD = 5;
let cache = null;       // { light: banks, bold: banks }
let cachedAt = 0;

const BANK_NAMES = ['truth', 'dare', 'wyr', 'never'];

function staticBanks(level = 'light') {
    const src = level === 'bold'
        ? { truth: BOLD.TRUTHS, dare: BOLD.DARES, never: BOLD.NEVER_HAVE_I_EVER, wyr: BOLD.WOULD_YOU_RATHER }
        : { truth: STATIC.TRUTHS, dare: STATIC.DARES, never: STATIC.NEVER_HAVE_I_EVER, wyr: STATIC.WOULD_YOU_RATHER };
    const p = level === 'bold' ? 'b' : 's';
    const text = (arr) => arr.map((q, i) => ({ id: `${p}${i}`, ar: q.ar, en: q.en }));
    return {
        truth: text(src.truth),
        dare: text(src.dare),
        never: text(src.never),
        wyr: src.wyr.map((q, i) => ({ id: `${p}${i}`, a: q.a, b: q.b }))
    };
}

// نسخة الزرع: ارفعها عند إضافة أسئلة جديدة إلى gameQuestions(+Extra/+Bold).js.
// نزرع فقط ما بعد العدد المزروع سابقاً — فلا يعود سؤال حذفه الأدمن.
// المطالبة ذرّية (findOneAndUpdate على seedVersion) فلا تزرع نسختا PM2 معاً.
const SEED_VERSION = 3;
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
        const light = {
            truth: STATIC.TRUTHS, dare: STATIC.DARES, never: STATIC.NEVER_HAVE_I_EVER, wyr: STATIC.WOULD_YOU_RATHER
        };
        const bold = {
            truth: BOLD.TRUTHS, dare: BOLD.DARES, never: BOLD.NEVER_HAVE_I_EVER, wyr: BOLD.WOULD_YOU_RATHER
        };
        // مجموعة فيها أسئلة ولا سجلّ زرع = زُرعت بالنسخة الأولى (الأعداد الأساسية)
        const hadDocs = await GameQuestion.estimatedDocumentCount() > 0;
        const from = old.seededCounts || (hadDocs ? STATIC.BASE_COUNTS : { truth: 0, dare: 0, wyr: 0, never: 0 });

        const docs = [];
        const push = (bank, q, level) => docs.push(bank === 'wyr'
            ? { bank, level, a: q.a, b: q.b, seeded: true }
            : { bank, level, ar: q.ar, en: q.en, seeded: true });

        for (const bank of BANK_NAMES) {
            for (const q of light[bank].slice(from[bank] || 0)) push(bank, q, 'light');
            for (const q of bold[bank].slice(from[`${bank}_bold`] || 0)) push(bank, q, 'bold');
        }
        if (docs.length) await GameQuestion.insertMany(docs);

        const counts = {};
        for (const bank of BANK_NAMES) {
            counts[bank] = light[bank].length;
            counts[`${bank}_bold`] = bold[bank].length;
        }
        await GameConfig.updateOne({ key: 'main' }, { $set: { seededCounts: counts } });
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

function build(rows, level) {
    const out = { truth: [], dare: [], never: [], wyr: [] };
    const lightOnly = { truth: [], dare: [], never: [], wyr: [] };
    for (const r of rows) {
        const item = r.bank === 'wyr'
            ? { id: String(r._id), a: r.a, b: r.b }
            : { id: String(r._id), ar: r.ar, en: r.en };
        const rowLevel = r.level || 'light';
        if (rowLevel === level) out[r.bank].push(item);
        if (rowLevel === 'light') lightOnly[r.bank].push(item);
    }
    const fallback = staticBanks(level);
    const fallbackLight = staticBanks('light');
    for (const k of BANK_NAMES) {
        if (level === 'bold' && out[k].length < MIN_BOLD) out[k] = out[k].concat(lightOnly[k].length ? lightOnly[k] : fallbackLight[k]);
        if (out[k].length === 0) out[k] = fallback[k];
    }
    return out;
}

// level: 'light' | 'bold'
async function getBanks(level = 'light') {
    const lv = level === 'bold' ? 'bold' : 'light';
    if (cache && Date.now() - cachedAt < TTL_MS) return cache[lv];
    try {
        await ensureSeeded();
        const rows = await GameQuestion.find({ active: true }).select('bank level ar en a b').lean();
        cache = { light: build(rows, 'light'), bold: build(rows, 'bold') };
        cachedAt = Date.now();
        return cache[lv];
    } catch (err) {
        console.error('🎮 gameBanks:', err.message);
        return cache ? cache[lv] : staticBanks(lv);
    }
}

function invalidateBanks() { cache = null; cachedAt = 0; }

module.exports = { getBanks, invalidateBanks, staticBanks, ensureSeeded };
