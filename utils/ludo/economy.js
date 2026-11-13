// MatchHala - اقتصاد هلا لودو: العملات والجواهر، الدوريات، المتجر، الإحصاءات، الترتيب الأسبوعي وجوائزه
//
// قواعد لا تُرخى:
// - العملات عملة لعب: لا تُستبدل بمال. والتسمية «رسوم الدخول» و«الجائزة» (لا «رهان»).
// - الرسوم تُخصم عند **بدء المباراة** لا عند دخول الطابور (فلا استرداد عند الإلغاء).
// - الجائزة = مجموع رسوم المقاعد كلها (مقاعد البوتات تُحسب)، يأخذها الفائز؛ في الفرق يتقاسمها الفائزان.
// - الدوري للّعب أونلاين (الطابور) وحده. الغرف الخاصة وضدّ الكمبيوتر ودعوة المحادثة ودّية بلا رسوم.
// - كل تغيير في رصيد ذرّي، والتسوية مرة واحدة لكل مباراة (finalize في service.js).
// - الجواهر تُشترى بمعاملة أبل موثّقة (JWS) وتُمنح مرة واحدة لكل transactionId (models/LudoPurchase).
// - مزايا الجواهر داخل المباراة (إعادة الرمي، نرد الحظ) **ظاهرة لكل اللاعبين** — لا ميزة خفية.
// ⚠️ أي رقم هنا يصل التطبيق من الخادم (ludo:wallet / ludo:store) — لا تنسخه في التطبيق.

const LudoWallet = require('../../models/LudoWallet');
const { LudoError } = require('../ludoEngine');

// قيم حيّة تتغيّر من لوحة التحكم (utils/ludo/config.js ← setLive) — لا تُنسخ في متغيّرات ثابتة
const LIVE = {
    startCoins: Number(process.env.LUDO_START_COINS) || 10000,
    startGems: Number(process.env.LUDO_START_GEMS) || 20,
    dailyBonus: Number(process.env.LUDO_DAILY_BONUS) || 1000,
    adDailyMax: Number(process.env.LUDO_AD_DAILY_MAX) || 5
};
function setLive(patch) { Object.assign(LIVE, patch); }
const DAILY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAILY_MS;

// الترتيب = ترتيب العرض في التطبيق. points = نجوم الفوز
const LEAGUES = {
    // رسوم الدخول: ألف · عشرة آلاف · مئة ألف (قرار المالك ١٤ نوفمبر ٢٠٢٦؛ كانت 500/5K/20K)
    bronze: { fee: 1000, points: 10 },
    silver: { fee: 10000, points: 30 },
    gold: { fee: 100000, points: 100 }
};

// المرتبة من مجموع النجوم (عرض فقط — لا تمنع دخول دوري)
const TIERS = [
    { id: 'bronze', from: 0 },
    { id: 'silver', from: 100 },
    { id: 'gold', from: 500 }
];

// ── الجواهر ──
// نرد الحظ: مرة لكل مباراة، يرفع وزن الـ 6 لصاحبه (service.js: BOOST_SIX_WEIGHT)
const BOOST_COST = Number(process.env.LUDO_BOOST_COST) || 5;
// عملات مقابل جواهر
const COIN_PACKS = [
    { id: 'coins_s', coins: 5000, gems: 10 },
    { id: 'coins_m', coins: 30000, gems: 50 },
    { id: 'coins_l', coins: 100000, gems: 150 }
];
// منتجات App Store Connect (كلها Consumable) — المالك ينشئها بهذه المعرّفات نفسها.
// كل منتج يمنح جواهر أو عملات أو الاثنين (الباقات المجمّعة). ⚠️ معرّف جديد هنا = منتج في App Store Connect أولاً.
const IAP_PRODUCTS = {
    'com.app.hala.ludo.gems60': { gems: 60 },
    'com.app.hala.ludo.gems330': { gems: 330 },
    'com.app.hala.ludo.gems900': { gems: 900 },
    'com.app.hala.ludo.coins50k': { coins: 50000 },
    'com.app.hala.ludo.coins300k': { coins: 300000 },
    'com.app.hala.ludo.coins1m': { coins: 1000000 },
    'com.app.hala.ludo.bundle.starter': { gems: 60, coins: 50000, bundle: 'starter' },
    'com.app.hala.ludo.bundle.pro': { gems: 330, coins: 300000, bundle: 'pro' }
};
const GEM_PRODUCTS = Object.fromEntries(
    Object.entries(IAP_PRODUCTS).filter(([, p]) => p.gems && !p.coins).map(([id, p]) => [id, p.gems]));

// ── مكافأة مشاهدة إعلان ──
// يصدر رمزاً عند البدء، والمنح مرة واحدة بالرمز وبسقف يومي. طريقان للمنح:
//   - AdMob SSV (utils/admobSsv.js ← ssvReward): جوجل تؤكد اكتمال المشاهدة بتوقيعها — الطريق الموثوق.
//   - ludo:ad:claim من التطبيق برمز عمره AD_MIN_MS على الأقل — يُغلق حين LUDO_AD_SSV=1 (بعد ضبط رابط SSV في AdMob).
const adSsvRequired = () => process.env.LUDO_AD_SSV === '1';
const AD_REWARD = { coins: Number(process.env.LUDO_AD_COINS) || 500, gems: Number(process.env.LUDO_AD_GEMS) || 1 };
const AD_MIN_MS = 5000;
const AD_MAX_MS = 10 * 60 * 1000;
const dayKeyOf = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);
const adsLeft = (w, now = Date.now()) => Math.max(0, LIVE.adDailyMax - (w.adDay === dayKeyOf(now) ? (w.adCount || 0) : 0));

// ── الترتيب الأسبوعي ──
const LEADERBOARD_SIZE = 50;
const WEEKLY_PRIZES = [
    { gems: 50, coins: 50000 },
    { gems: 30, coins: 25000 },
    { gems: 15, coins: 10000 },
    ...Array.from({ length: 7 }, () => ({ gems: 0, coins: 5000 }))     // المراكز 4–10
];

// اثنين الأسبوع (UTC) كمفتاح
function weekStart(now = Date.now()) {
    const d = new Date(now);
    const day = (d.getUTCDay() + 6) % 7;        // الاثنين = 0
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day);
}
const weekKeyOf = (now = Date.now()) => new Date(weekStart(now)).toISOString().slice(0, 10);

function assertLeague(league) {
    if (!Object.prototype.hasOwnProperty.call(LEAGUES, league)) throw new LudoError('BAD_LEAGUE', 'دوري غير معروف');
    return LEAGUES[league];
}

// جائزة كل فائز
function prizeFor(league, mode, size) {
    const pot = assertLeague(league).fee * size;
    return mode === 'teams' ? pot / 2 : pot;
}

// الدوري برسومه (للمطابقة: مجموعة برسوم مختلفة تلعب في دوري الأدنى)
function leagueOfFee(fee) {
    return Object.keys(LEAGUES).find(id => LEAGUES[id].fee === fee) || null;
}

// مستوى اللاعب للمطابقة: ترتيب مرتبته (0 برونز، 1 فضة، 2 ذهب) من مجموع النجوم
function levelOf(points) {
    let i = 0;
    while (i + 1 < TIERS.length && (points || 0) >= TIERS[i + 1].from) i++;
    return i;
}

function stakeFor(league, mode, size) {
    return { league, fee: assertLeague(league).fee, prize: prizeFor(league, mode, size) };
}

const leaguesView = () => Object.entries(LEAGUES).map(([id, l]) => ({
    id,
    fee: l.fee,
    points: l.points,
    prize: { two: prizeFor(id, 'classic', 2), four: prizeFor(id, 'classic', 4), teams: prizeFor(id, 'teams', 4) }
}));

function tierOf(points) {
    let i = 0;
    while (i + 1 < TIERS.length && points >= TIERS[i + 1].from) i++;
    return { id: TIERS[i].id, points, from: TIERS[i].from, next: TIERS[i + 1]?.from ?? null };
}

// ── الإنجازات والألقاب: مشتقّة من إحصاءات المحفظة — لا تخزين ولا منح؛ التطبيق يسمّيها ويرسمها بالمعرّف ──
const ACHIEVEMENTS = [
    { id: 'first_win', stat: 'wins', target: 1 },
    { id: 'wins_10', stat: 'wins', target: 10 },
    { id: 'wins_50', stat: 'wins', target: 50 },
    { id: 'wins_100', stat: 'wins', target: 100 },
    { id: 'streak_3', stat: 'bestStreak', target: 3 },
    { id: 'streak_5', stat: 'bestStreak', target: 5 },
    { id: 'streak_10', stat: 'bestStreak', target: 10 },
    { id: 'played_50', stat: 'played', target: 50 },
    { id: 'friendly_10', stat: 'friendlyPlayed', target: 10 },
    { id: 'tier_silver', stat: 'points', target: TIERS[1].from },
    { id: 'tier_gold', stat: 'points', target: TIERS[2].from }
];
// اللقب بعدد انتصارات الدوري
const TITLES = [
    { id: 'rookie', wins: 0 },
    { id: 'player', wins: 10 },
    { id: 'pro', wins: 50 },
    { id: 'legend', wins: 100 }
];

function achievementsOf(w) {
    return ACHIEVEMENTS.map(a => {
        const value = w[a.stat] || 0;
        return { id: a.id, target: a.target, progress: Math.min(a.target, value), unlocked: value >= a.target };
    });
}

function titleOf(w) {
    const wins = w.wins || 0;
    let t = TITLES[0];
    for (const x of TITLES) if (wins >= x.wins) t = x;
    return t.id;
}

function walletView(w, now = Date.now()) {
    const claimed = w.dailyClaimedAt ? new Date(w.dailyClaimedAt).getTime() : 0;
    const prize = w.lastPrize && w.lastPrize.weekKey && !w.lastPrize.seen
        ? { weekKey: w.lastPrize.weekKey, rank: w.lastPrize.rank, gems: w.lastPrize.gems || 0, coins: w.lastPrize.coins || 0 }
        : null;
    return {
        coins: w.coins,
        gems: w.gems || 0,
        played: w.played || 0,
        wins: w.wins || 0,
        losses: w.losses || 0,
        winStreak: w.winStreak || 0,
        bestStreak: w.bestStreak || 0,
        coinsWon: w.coinsWon || 0,
        friendlyPlayed: w.friendlyPlayed || 0,
        friendlyWins: w.friendlyWins || 0,
        title: titleOf(w),
        achievements: achievementsOf(w),
        tier: tierOf(w.points || 0),
        weekPoints: w.weekKey === weekKeyOf(now) ? (w.weekPoints || 0) : 0,
        prize,
        ad: { coins: AD_REWARD.coins, gems: AD_REWARD.gems, left: adsLeft(w, now), max: LIVE.adDailyMax },
        dailyBonus: LIVE.dailyBonus,
        // 0 = متاحة الآن
        dailyAvailableAt: claimed && claimed + DAILY_MS > now ? claimed + DAILY_MS : 0
    };
}

// ما يراه لاعب آخر (بطاقة اللاعب): الأداء والمرتبة فقط — لا أرصدة ولا مشتريات
async function publicStats(userId, now = Date.now()) {
    const w = await getWallet(userId);
    const wk = weekKeyOf(now);
    const played = w.played || 0;
    const wins = w.wins || 0;
    const weekPoints = w.weekKey === wk ? (w.weekPoints || 0) : 0;
    const weekRank = weekPoints > 0
        ? 1 + await LudoWallet.countDocuments({ weekKey: wk, weekPoints: { $gt: weekPoints } })
        : null;
    return {
        played,
        wins,
        losses: w.losses || 0,
        winRate: played > 0 ? Math.round((wins / played) * 100) : 0,
        winStreak: w.winStreak || 0,
        bestStreak: w.bestStreak || 0,
        friendlyPlayed: w.friendlyPlayed || 0,
        friendlyWins: w.friendlyWins || 0,
        title: titleOf(w),
        achievements: achievementsOf(w),
        tier: tierOf(w.points || 0),
        weekPoints,
        weekRank
    };
}

// يُنشئ المحفظة عند أول طلب برصيد البداية
async function getWallet(userId) {
    const upsert = () => LudoWallet.findOneAndUpdate(
        { user: userId },
        { $setOnInsert: { coins: LIVE.startCoins, gems: LIVE.startGems } },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean();
    let w;
    try {
        w = await upsert();
    } catch (e) {
        if (e.code !== 11000) throw e;      // طلبان متزامنان لأول مرة
        w = await upsert();
    }
    // محافظ أُنشئت قبل الجواهر: جواهر البداية مرة واحدة
    if (w.gems === undefined) {
        const fixed = await LudoWallet.findOneAndUpdate(
            { user: userId, gems: { $exists: false } }, { $set: { gems: LIVE.startGems } }, { new: true }
        ).lean();
        w = fixed || { ...w, gems: LIVE.startGems };
    }
    return w;
}

async function assertCanAfford(userId, league) {
    const { fee } = assertLeague(league);
    const w = await getWallet(userId);
    if (w.coins < fee) throw new LudoError('NOT_ENOUGH_COINS', 'رصيدك لا يكفي لرسوم دخول هذا الدوري', 402);
    return w;
}

// خصم ذرّي — false إن لم يكفِ الرصيد
async function charge(userId, amount) {
    await getWallet(userId);
    const w = await LudoWallet.findOneAndUpdate(
        { user: userId, coins: { $gte: amount } },
        { $inc: { coins: -amount } },
        { new: true }
    ).lean();
    return !!w;
}

async function refund(userId, amount) {
    await LudoWallet.updateOne({ user: userId }, { $inc: { coins: amount } });
}

// خصم جواهر ذرّي — يُرجع المحفظة بعد الخصم، أو يرمي NOT_ENOUGH_GEMS
async function chargeGems(userId, amount) {
    const w = await LudoWallet.findOneAndUpdate(
        { user: userId, gems: { $gte: amount } },
        { $inc: { gems: -amount } },
        { new: true }
    ).lean();
    if (!w) throw new LudoError('NOT_ENOUGH_GEMS', 'جواهرك لا تكفي', 402);
    return w;
}

async function refundGems(userId, amount) {
    await LudoWallet.updateOne({ user: userId }, { $inc: { gems: amount } });
}

// نتيجة مباراة دوري: الجائزة والنجوم للفائز، والعدّادات للجميع (الرسوم خُصمت عند البدء).
// مباراة واحدة لكل لاعب في الوقت نفسه، فقراءة السلسلة ثم ضبطها آمنة؛ الأرصدة نفسها بـ $inc.
async function settle(userId, { won, prize, league, noPoints = false }, now = Date.now()) {
    const w = await getWallet(userId);
    const wk = weekKeyOf(now);
    const points = won && !noPoints ? assertLeague(league).points : 0;
    const streak = won ? (w.winStreak || 0) + 1 : 0;
    const sameWeek = w.weekKey === wk;
    await LudoWallet.updateOne({ user: userId }, {
        $inc: {
            coins: won ? prize : 0,
            coinsWon: won ? prize : 0,
            played: 1,
            wins: won ? 1 : 0,
            losses: won ? 0 : 1,
            points,
            ...(sameWeek ? { weekPoints: points } : {})
        },
        $set: {
            winStreak: streak,
            bestStreak: Math.max(w.bestStreak || 0, streak),
            ...(sameWeek ? {} : { weekKey: wk, weekPoints: points })
        }
    });
    return points;
}

// مكافأة مباشرة (مهام اليوم): عملات/جواهر تُضاف ذرّياً — يعيد المحفظة بعد الإضافة
async function grant(userId, { coins = 0, gems = 0 }) {
    await getWallet(userId);
    const w = await LudoWallet.findOneAndUpdate({ user: userId }, { $inc: { coins, gems } }, { new: true }).lean();
    if (!w) throw new LudoError('WALLET_UNAVAILABLE', 'تعذّر إضافة المكافأة — حاول مجدداً', 500);
    return w;
}

// مباراة ودّية بين بشر: عدّاد منفصل للعرض — لا عملات ولا نجوم ولا سلاسل
async function recordFriendly(userId, won) {
    await getWallet(userId);
    await LudoWallet.updateOne({ user: userId }, { $inc: { friendlyPlayed: 1, friendlyWins: won ? 1 : 0 } });
}

async function claimDaily(userId, now = Date.now()) {
    await getWallet(userId);
    const w = await LudoWallet.findOneAndUpdate(
        { user: userId, $or: [{ dailyClaimedAt: null }, { dailyClaimedAt: { $lte: new Date(now - DAILY_MS) } }] },
        { $inc: { coins: LIVE.dailyBonus }, $set: { dailyClaimedAt: new Date(now) } },
        { new: true }
    ).lean();
    if (!w) throw new LudoError('DAILY_NOT_READY', 'أخذت مكافأة اليوم — ارجع غداً', 409);
    return w;
}

// ───────────── مكافأة الإعلان ─────────────

async function startAd(userId, now = Date.now()) {
    const w = await getWallet(userId);
    if (adsLeft(w, now) <= 0) throw new LudoError('AD_LIMIT', 'وصلت حدّ مكافآت الإعلانات اليوم — ارجع غداً', 429);
    const token = require('crypto').randomBytes(12).toString('base64url');
    await LudoWallet.updateOne({ user: userId }, { $set: { adToken: token, adTokenAt: new Date(now) } });
    return { token };
}

async function claimAd(userId, token, now = Date.now()) {
    const w = await getWallet(userId);
    // منحها SSV قبل وصول طلب التطبيق ← نجاح بلا منح ثانٍ
    if (token && w.adLastToken === String(token)) return w;
    const age = w.adTokenAt ? now - new Date(w.adTokenAt).getTime() : -1;
    if (adSsvRequired()) {
        // المنح من جوجل وحدها: الرمز ما زال ينتظر تأكيدها ← التطبيق يعيد المحاولة بعد لحظة
        if (token && w.adToken === String(token) && age >= 0 && age <= AD_MAX_MS) {
            throw new LudoError('AD_PENDING', 'نتحقّق من المشاهدة…', 409);
        }
        throw new LudoError('AD_NOT_VERIFIED', 'لم تكتمل مشاهدة الإعلان', 400);
    }
    if (!token || w.adToken !== String(token) || age < AD_MIN_MS || age > AD_MAX_MS) {
        throw new LudoError('AD_NOT_VERIFIED', 'لم تكتمل مشاهدة الإعلان', 400);
    }
    if (adsLeft(w, now) <= 0) throw new LudoError('AD_LIMIT', 'وصلت حدّ مكافآت الإعلانات اليوم — ارجع غداً', 429);
    const updated = await grantAd(userId, token, w, now);
    if (!updated) throw new LudoError('AD_NOT_VERIFIED', 'لم تكتمل مشاهدة الإعلان', 400);
    return updated;
}

// منح مكافأة الإعلان مرة واحدة: الرمز في الشرط — طلبان بالرمز نفسه (أو SSV والتطبيق معاً) يمنح أحدهما فقط
async function grantAd(userId, token, w, now = Date.now()) {
    const today = dayKeyOf(now);
    const sameDay = w.adDay === today;
    // الرمز في الشرط: طلبان بالرمز نفسه يمنح أحدهما فقط
    const updated = await LudoWallet.findOneAndUpdate(
        { user: userId, adToken: String(token) },
        {
            $inc: { coins: AD_REWARD.coins, gems: AD_REWARD.gems, ...(sameDay ? { adCount: 1 } : {}) },
            $set: { adToken: null, adTokenAt: null, adLastToken: String(token), ...(sameDay ? {} : { adDay: today, adCount: 1 }) }
        },
        { new: true }
    ).lean();
    return updated;
}

// AdMob SSV: جوجل أكّدت اكتمال المشاهدة (التوقيع تحقّق منه routes/rewardCallbacks.js).
// userId و token ضبطهما التطبيق في الإعلان — المنح بالشروط نفسها (رمز ساري، سقف اليوم). true إن مُنحت.
async function ssvReward(userId, token, meta = {}, now = Date.now()) {
    if (!/^[a-f0-9]{24}$/i.test(String(userId))) return false;
    const w = await getWallet(String(userId));
    const age = w.adTokenAt ? now - new Date(w.adTokenAt).getTime() : -1;
    if (w.adToken !== String(token) || age < 0 || age > AD_MAX_MS || adsLeft(w, now) <= 0) {
        if (w.adLastToken !== String(token)) console.warn(`[admob-ssv] رمز غير ساري للمستخدم ${userId} (${meta.transactionId || '-'})`);
        return false;
    }
    return !!(await grantAd(String(userId), token, w, now));
}

// ───────────── المتجر ─────────────

const storeView = () => ({
    coinPacks: COIN_PACKS,
    gemProducts: Object.entries(GEM_PRODUCTS).map(([productId, gems]) => ({ productId, gems })),
    coinProducts: Object.entries(IAP_PRODUCTS).filter(([, p]) => p.coins && !p.gems)
        .map(([productId, p]) => ({ productId, coins: p.coins })),
    bundles: Object.entries(IAP_PRODUCTS).filter(([, p]) => p.bundle)
        .map(([productId, p]) => ({ productId, id: p.bundle, gems: p.gems, coins: p.coins })),
    boostCost: BOOST_COST,
    // أسعار إعادة الرمي المدفوعة بالترتيب (المصدر: خيارات المحرّك)
    rerollCosts: require('../ludoEngine').createGame({ players: [{ id: 'a' }, { id: 'b' }] }).options.paidRerollCosts
});

// عملات مقابل جواهر — عملية واحدة ذرّية (الخصم والإضافة معاً)
async function buyCoins(userId, packId) {
    const pack = COIN_PACKS.find(p => p.id === packId);
    if (!pack) throw new LudoError('BAD_PACK', 'باقة غير معروفة');
    await getWallet(userId);
    const w = await LudoWallet.findOneAndUpdate(
        { user: userId, gems: { $gte: pack.gems } },
        { $inc: { gems: -pack.gems, coins: pack.coins } },
        { new: true }
    ).lean();
    if (!w) throw new LudoError('NOT_ENOUGH_GEMS', 'جواهرك لا تكفي', 402);
    return w;
}

// شراء (جواهر، عملات، أو باقة مجمّعة): معاملة StoreKit 2 موثّقة بشهادات أبل. تُمنح مرة واحدة (transactionId فريد)،
// وإعادة إرسال المعاملة نفسها تُرجع الرصيد بلا منح ثانٍ (التطبيق يعيد المحاولة حتى ينهي المعاملة).
async function redeemPurchase(userId, signedTransaction) {
    const apple = require('../appleTransactions');
    let t;
    try {
        t = await apple.verifySignedTransaction(signedTransaction);
    } catch (e) {
        console.warn(`[ludo-iap] رُفض تحقق أبل للمستخدم ${userId}: ${e.message || e}`);
        throw new LudoError('IAP_VERIFICATION_FAILED', 'تعذّر التحقق من عملية الشراء', 400);
    }
    const product = IAP_PRODUCTS[t.productId];
    if (!product) throw new LudoError('IAP_UNKNOWN_PRODUCT', 'منتج غير معروف', 400);
    const gems = product.gems || 0;
    const coins = product.coins || 0;
    if (t.revoked) throw new LudoError('IAP_REVOKED', 'هذه العملية مستردّة أو ملغاة', 400);

    const LudoPurchase = require('../../models/LudoPurchase');
    await getWallet(userId);
    try {
        await LudoPurchase.create({
            transactionId: t.transactionId, user: userId, productId: t.productId, gems, coins, environment: t.environment
        });
    } catch (e) {
        if (e.code !== 11000) throw e;
        const existing = await LudoPurchase.findOne({ transactionId: t.transactionId }).select('user').lean();
        if (existing && String(existing.user) !== String(userId)) {
            throw new LudoError('IAP_IN_USE', 'هذه العملية مستعملة في حساب آخر', 409);
        }
        return { wallet: await getWallet(userId), granted: 0, grantedCoins: 0, transactionId: t.transactionId };
    }
    const w = await LudoWallet.findOneAndUpdate({ user: userId }, { $inc: { gems, coins } }, { new: true }).lean();
    return { wallet: w, granted: gems, grantedCoins: coins, transactionId: t.transactionId };
}

// ───────────── استرداد أبل (App Store Server Notifications — utils/appleNotifications.js) ─────────────

// يسحب ما منحته المعاملة. ما أُنفق قبل الاسترداد لا يُسحب (لا أرصدة سالبة) — يُسجَّل في shortfall* للمراجعة.
// مرة واحدة: refundedAt شرط في التحديث. يُرجع null إن لم تكن المعاملة عندنا (لم يُطالب بها التطبيق قط).
async function refundPurchase(transactionId) {
    const LudoPurchase = require('../../models/LudoPurchase');
    const p = await LudoPurchase.findOneAndUpdate(
        { transactionId: String(transactionId), refundedAt: null },
        { $set: { refundedAt: new Date() } },
        { new: true }
    ).lean();
    if (!p) {
        const existing = await LudoPurchase.findOne({ transactionId: String(transactionId) }).lean();
        return existing ? { user: String(existing.user), alreadyRefunded: true, clawedGems: existing.clawedGems, clawedCoins: existing.clawedCoins } : null;
    }
    let clawedGems = 0; let clawedCoins = 0;
    // قراءة ثم خصم مشروط بالرصيد نفسه — إن تغيّر بينهما (مباراة، شراء) نعيد المحاولة
    for (let attempt = 0; attempt < 5; attempt++) {
        const w = await getWallet(p.user);
        const g = Math.min(p.gems || 0, w.gems || 0);
        const c = Math.min(p.coins || 0, w.coins || 0);
        const done = await LudoWallet.findOneAndUpdate(
            { user: p.user, gems: { $gte: g }, coins: { $gte: c } },
            { $inc: { gems: -g, coins: -c } },
            { new: true }
        ).lean();
        if (done) { clawedGems = g; clawedCoins = c; break; }
    }
    const shortfallGems = (p.gems || 0) - clawedGems;
    const shortfallCoins = (p.coins || 0) - clawedCoins;
    await LudoPurchase.updateOne({ _id: p._id }, { $set: { clawedGems, clawedCoins, shortfallGems, shortfallCoins } });
    return { user: String(p.user), productId: p.productId, clawedGems, clawedCoins, shortfallGems, shortfallCoins };
}

// أبل ألغت الاسترداد (REFUND_REVERSED) ← يُعاد ما سُحب فعلاً
async function restorePurchase(transactionId) {
    const LudoPurchase = require('../../models/LudoPurchase');
    const p = await LudoPurchase.findOneAndUpdate(
        { transactionId: String(transactionId), refundedAt: { $ne: null } },
        { $set: { refundedAt: null, clawedGems: 0, clawedCoins: 0, shortfallGems: 0, shortfallCoins: 0 } }
    ).lean();
    if (!p) return null;
    await LudoWallet.updateOne({ user: p.user }, { $inc: { gems: p.clawedGems || 0, coins: p.clawedCoins || 0 } });
    return { user: String(p.user), restoredGems: p.clawedGems || 0, restoredCoins: p.clawedCoins || 0 };
}

// ───────────── الترتيب الأسبوعي ─────────────

// viewer: وثيقة المستخدم (blockedUsers) — لا يظهر له من حظره أو حظرهم، ولا غير النشط/المعلّق
async function leaderboard(viewer, now = Date.now()) {
    const wk = weekKeyOf(now);
    const viewerId = String(viewer._id);
    const blocked = new Set((viewer.blockedUsers || []).map(String));
    const rows = await LudoWallet.find({ weekKey: wk, weekPoints: { $gt: 0 } })
        .sort({ weekPoints: -1, updatedAt: 1 })
        .limit(LEADERBOARD_SIZE + 20)
        .select('user weekPoints wins points')
        .populate('user', 'name profileImage isActive suspension blockedUsers')
        .lean();
    const visible = rows.filter(r => {
        const u = r.user;
        if (!u || !u.isActive || u.suspension?.isSuspended) return false;
        if (String(u._id) === viewerId) return true;
        return !blocked.has(String(u._id)) && !(u.blockedUsers || []).map(String).includes(viewerId);
    }).slice(0, LEADERBOARD_SIZE);

    const mine = await getWallet(viewerId);
    const myPoints = mine.weekKey === wk ? (mine.weekPoints || 0) : 0;
    const myRank = myPoints > 0
        ? 1 + await LudoWallet.countDocuments({ weekKey: wk, weekPoints: { $gt: myPoints } })
        : null;
    return {
        weekKey: wk,
        endsAt: weekStart(now) + WEEK_MS,
        prizes: WEEKLY_PRIZES.map((p, i) => ({ rank: i + 1, ...p })),
        top: visible.map((r, i) => ({
            rank: i + 1,
            id: String(r.user._id),
            name: r.user.name,
            photo: r.user.profileImage || null,
            points: r.weekPoints,
            tier: tierOf(r.points || 0).id
        })),
        me: { rank: myRank, points: myPoints }
    };
}

// ترتيب أسبوع للوحة التحكم: أعلى N بنقاطه وما سيأخذه كل مركز (بلا تصفية حظر — المشرف يرى الكل)
async function weekStandings(limit = WEEKLY_PRIZES.length, now = Date.now(), weekKey = weekKeyOf(now)) {
    const rows = await LudoWallet.find({ weekKey, weekPoints: { $gt: 0 } })
        .sort({ weekPoints: -1, updatedAt: 1 })
        .limit(limit)
        .select('user weekPoints wins points')
        .populate('user', 'name profileImage isActive suspension')
        .lean();
    return {
        weekKey,
        endsAt: weekStart(now) + WEEK_MS,
        rows: rows.map((r, i) => ({
            rank: i + 1,
            id: r.user ? String(r.user._id) : null,
            name: r.user?.name || '—',
            photo: r.user?.profileImage || null,
            inactive: !r.user || !r.user.isActive || !!r.user.suspension?.isSuspended,
            weekPoints: r.weekPoints,
            prize: WEEKLY_PRIZES[i] ? { ...WEEKLY_PRIZES[i] } : null
        }))
    };
}

// جوائز الأسبوع المنتهي — مرة واحدة (فرادة weekKey في LudoSeason تحسم السباق بين النسخ)
// مُنحت جائزة أسبوعية للاعب — مستمعو الإشعار (routes/mobile/games.js)
const prizeHooks = [];
function onPrize(fn) { prizeHooks.push(fn); }

async function awardLastWeek(now = Date.now()) {
    const LudoSeason = require('../../models/LudoSeason');
    const last = weekKeyOf(weekStart(now) - 1);
    const top = await LudoWallet.find({ weekKey: last, weekPoints: { $gt: 0 } })
        .sort({ weekPoints: -1, updatedAt: 1 })
        .limit(WEEKLY_PRIZES.length)
        .select('user weekPoints')
        .lean();
    if (top.length === 0) return 0;
    const winners = top.map((w, i) => ({ user: w.user, rank: i + 1, points: w.weekPoints, ...WEEKLY_PRIZES[i] }));
    try {
        await LudoSeason.create({ weekKey: last, winners });
    } catch (e) {
        if (e.code === 11000) return 0;     // وُزّعت من قبل
        throw e;
    }
    for (const w of winners) {
        await LudoWallet.updateOne({ user: w.user }, {
            $inc: { gems: w.gems, coins: w.coins },
            $set: { lastPrize: { weekKey: last, rank: w.rank, gems: w.gems, coins: w.coins, seen: false } }
        }).then(() => {
            const prize = { userId: String(w.user), weekKey: last, rank: w.rank, gems: w.gems, coins: w.coins };
            for (const fn of prizeHooks) Promise.resolve().then(() => fn(prize)).catch(e => console.error('ludo prize hook:', e.message));
        }).catch(e => console.error(`ludo prize ${last} ${w.user}:`, e.message));
    }
    console.log(`🏆 هلا لودو: وُزّعت جوائز أسبوع ${last} على ${winners.length}`);
    return winners.length;
}

async function markPrizeSeen(userId) {
    await LudoWallet.updateOne({ user: userId }, { $set: { 'lastPrize.seen': true } });
}

let seasonTimer = null;
function startSeasonSweeper() {
    if (seasonTimer) return;
    const run = () => awardLastWeek().catch(e => console.error('ludo season sweep:', e.message));
    setTimeout(run, 60 * 1000).unref?.();
    seasonTimer = setInterval(run, 60 * 60 * 1000);
    seasonTimer.unref?.();
}

module.exports = {
    getWallet, assertCanAfford, charge, refund, chargeGems, refundGems, settle, claimDaily,
    storeView, buyCoins, redeemPurchase, startAd, claimAd,
    leaderboard, weekStandings, awardLastWeek, markPrizeSeen, startSeasonSweeper,
    assertLeague, prizeFor, stakeFor, leaguesView, leagueOfFee, levelOf, walletView, publicStats, recordFriendly, grant, onPrize, ssvReward, refundPurchase, restorePurchase, tierOf, weekKeyOf,
    setLive,
    // getters: القيم الحيّة (قد تتغيّر من لوحة التحكم) لا لقطة وقت التحميل
    constants: {
        get START_COINS() { return LIVE.startCoins; },
        get START_GEMS() { return LIVE.startGems; },
        get DAILY_BONUS() { return LIVE.dailyBonus; },
        get AD_DAILY_MAX() { return LIVE.adDailyMax; },
        DAILY_MS, LEAGUES, BOOST_COST, COIN_PACKS, GEM_PRODUCTS, IAP_PRODUCTS, WEEKLY_PRIZES, TIERS, AD_REWARD, AD_MIN_MS
    }
};
