// MatchHala - هلا لودو: الإعدادات من لوحة التحكم (بلا نشر)
//
// المصدر: LudoConfig (وثيقة واحدة). الافتراضيات = القيم المكتوبة في economy.js وmissions.js عند الإقلاع.
// apply() يعدّل كائنات الاقتصاد الحيّة في مكانها (LEAGUES، WEEKLY_PRIZES، AD_REWARD، LIVE، MISSIONS)،
// فكل الكود الذي يقرؤها يرى القيم الجديدة بلا تغيير. كل نسخة PM2 تعيد التحميل كل REFRESH_MS،
// والنسخة التي استلمت الحفظ تطبّقه فوراً — فالتغيير يصل الجميع خلال دقيقة.
// ⚠️ مباراة بدأت تحتفظ برسومها وجائزتها (meta.stake) — التغيير للمباريات الجديدة وحدها.

const economy = require('./economy');
const missions = require('./missions');

const REFRESH_MS = 60 * 1000;
const LEAGUE_IDS = ['bronze', 'silver', 'gold'];
const PRIZE_RANKS = 10;

const clone = (x) => JSON.parse(JSON.stringify(x));

// لقطة القيم الحالية (من الكود) — تُؤخذ مرة قبل أي تطبيق
const DEFAULTS = (() => {
    const c = economy.constants;
    const prizes = clone(c.WEEKLY_PRIZES).slice(0, PRIZE_RANKS);
    while (prizes.length < PRIZE_RANKS) prizes.push({ coins: 0, gems: 0 });
    return {
        leagues: Object.fromEntries(LEAGUE_IDS.map(id => [id, { fee: c.LEAGUES[id].fee, points: c.LEAGUES[id].points }])),
        startCoins: c.START_COINS,
        startGems: c.START_GEMS,
        dailyBonus: c.DAILY_BONUS,
        adReward: { coins: c.AD_REWARD.coins, gems: c.AD_REWARD.gems },
        adDailyMax: c.AD_DAILY_MAX,
        missions: Object.fromEntries(missions.constants.MISSIONS.map(m => [m.id, { target: m.target, coins: m.coins, gems: m.gems }])),
        weeklyPrizes: prizes.map(p => ({ coins: p.coins || 0, gems: p.gems || 0 }))
    };
})();

class ConfigError extends Error {
    constructor(errors) { super(errors.join(' · ')); this.errors = errors; this.status = 400; }
}

// عدد صحيح ضمن [min, max] وإلا خطأ بالاسم العربي
function int(errors, label, v, min, max) {
    const n = Number(v);
    if (!Number.isInteger(n) || n < min || n > max) {
        errors.push(`${label}: رقم صحيح بين ${min.toLocaleString('en-US')} و${max.toLocaleString('en-US')}`);
        return min;
    }
    return n;
}

const LEAGUE_NAMES = { bronze: 'البرونز', silver: 'الفضة', gold: 'الذهب' };
const MISSION_NAMES = { play3: 'العب مباريات', win1: 'فُز بمباراة', capture3: 'كُل قطعاً', friend1: 'العب مع صديق' };

// يتحقق من كل حقل ويُرجع إعدادات نظيفة كاملة (الناقص من الافتراضي) أو يرمي ConfigError
function sanitize(input = {}) {
    const src = { ...clone(DEFAULTS), ...(input || {}) };
    const e = [];
    const out = {};
    out.leagues = {};
    for (const id of LEAGUE_IDS) {
        const l = { ...DEFAULTS.leagues[id], ...(src.leagues?.[id] || {}) };
        out.leagues[id] = {
            fee: int(e, `رسوم دوري ${LEAGUE_NAMES[id]}`, l.fee, 1, 100_000_000),
            points: int(e, `نجوم الفوز في دوري ${LEAGUE_NAMES[id]}`, l.points, 0, 10_000)
        };
    }
    const fees = LEAGUE_IDS.map(id => out.leagues[id].fee);
    if (!(fees[0] < fees[1] && fees[1] < fees[2])) e.push('رسوم الدوريات يجب أن تتصاعد: برونز < فضة < ذهب');
    out.startCoins = int(e, 'رصيد البداية (عملات)', src.startCoins, 0, 100_000_000);
    out.startGems = int(e, 'رصيد البداية (جواهر)', src.startGems, 0, 100_000);
    out.dailyBonus = int(e, 'المكافأة اليومية', src.dailyBonus, 0, 10_000_000);
    out.adReward = {
        coins: int(e, 'مكافأة الإعلان (عملات)', src.adReward?.coins, 0, 10_000_000),
        gems: int(e, 'مكافأة الإعلان (جواهر)', src.adReward?.gems, 0, 1_000)
    };
    out.adDailyMax = int(e, 'إعلانات المكافأة يومياً', src.adDailyMax, 0, 50);
    out.missions = {};
    for (const id of Object.keys(DEFAULTS.missions)) {
        const m = { ...DEFAULTS.missions[id], ...(src.missions?.[id] || {}) };
        const name = MISSION_NAMES[id] || id;
        out.missions[id] = {
            target: int(e, `هدف مهمة «${name}»`, m.target, 1, 100),
            coins: int(e, `عملات مهمة «${name}»`, m.coins, 0, 10_000_000),
            gems: int(e, `جواهر مهمة «${name}»`, m.gems, 0, 1_000)
        };
    }
    const prizes = Array.isArray(src.weeklyPrizes) ? src.weeklyPrizes : [];
    if (prizes.length !== PRIZE_RANKS) e.push(`جوائز الأسبوع: ${PRIZE_RANKS} مراكز بالضبط`);
    out.weeklyPrizes = Array.from({ length: PRIZE_RANKS }, (_, i) => ({
        coins: int(e, `جائزة المركز ${i + 1} (عملات)`, prizes[i]?.coins ?? 0, 0, 1_000_000_000),
        gems: int(e, `جائزة المركز ${i + 1} (جواهر)`, prizes[i]?.gems ?? 0, 0, 1_000_000)
    }));
    if (e.length) throw new ConfigError(e);
    return out;
}

let current = clone(DEFAULTS);

// يعدّل القيم الحيّة في مكانها (الكائنات نفسها التي يقرؤها الاقتصاد والمهام)
function apply(cfg) {
    const c = economy.constants;
    for (const id of LEAGUE_IDS) Object.assign(c.LEAGUES[id], cfg.leagues[id]);
    economy.setLive({ startCoins: cfg.startCoins, startGems: cfg.startGems, dailyBonus: cfg.dailyBonus, adDailyMax: cfg.adDailyMax });
    Object.assign(c.AD_REWARD, cfg.adReward);
    c.WEEKLY_PRIZES.splice(0, c.WEEKLY_PRIZES.length, ...cfg.weeklyPrizes.map(p => ({ ...p })));
    for (const m of missions.constants.MISSIONS) if (cfg.missions[m.id]) Object.assign(m, cfg.missions[m.id]);
    current = clone(cfg);
}

async function load() {
    const LudoConfig = require('../../models/LudoConfig');
    const doc = await LudoConfig.findOne({ key: 'main' }).lean();
    let cfg;
    try {
        cfg = sanitize(doc?.data || {});
    } catch (err) {
        // وثيقة تالفة (عُدّلت يدوياً) — لا نسقط: الافتراضي، وتنبيه في السجلّ
        console.error('⚠️ إعدادات هلا لودو غير صالحة — تُستعمل الافتراضية:', err.message);
        cfg = clone(DEFAULTS);
    }
    apply(cfg);
    return { config: cfg, updatedAt: doc?.updatedAt || null, updatedBy: doc?.updatedBy || null };
}

async function save(input, adminId) {
    const cfg = sanitize(input);
    const LudoConfig = require('../../models/LudoConfig');
    const doc = await LudoConfig.findOneAndUpdate(
        { key: 'main' },
        { $set: { data: cfg, updatedBy: adminId || null } },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean();
    apply(cfg);
    return { config: cfg, updatedAt: doc.updatedAt, updatedBy: doc.updatedBy };
}

let timer = null;
function start() {
    if (timer) return;
    const run = () => load().catch(e => console.error('ludo config load:', e.message));
    run();
    timer = setInterval(run, REFRESH_MS);
    timer.unref?.();
}

module.exports = {
    sanitize, apply, load, save, start,
    current: () => clone(current),
    defaults: () => clone(DEFAULTS),
    ConfigError,
    constants: { REFRESH_MS, PRIZE_RANKS, LEAGUE_IDS }
};
