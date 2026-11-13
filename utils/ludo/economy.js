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

const START_COINS = Number(process.env.LUDO_START_COINS) || 10000;
const START_GEMS = Number(process.env.LUDO_START_GEMS) || 20;
const DAILY_BONUS = Number(process.env.LUDO_DAILY_BONUS) || 1000;
const DAILY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAILY_MS;

// الترتيب = ترتيب العرض في التطبيق. points = نجوم الفوز
const LEAGUES = {
    bronze: { fee: 500, points: 10 },
    silver: { fee: 5000, points: 30 },
    gold: { fee: 20000, points: 100 }
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
// منتجات App Store Connect (Consumable) — المالك ينشئها بهذه المعرّفات نفسها
const GEM_PRODUCTS = {
    'com.app.hala.ludo.gems60': 60,
    'com.app.hala.ludo.gems330': 330,
    'com.app.hala.ludo.gems900': 900
};

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
        tier: tierOf(w.points || 0),
        weekPoints: w.weekKey === weekKeyOf(now) ? (w.weekPoints || 0) : 0,
        prize,
        dailyBonus: DAILY_BONUS,
        // 0 = متاحة الآن
        dailyAvailableAt: claimed && claimed + DAILY_MS > now ? claimed + DAILY_MS : 0
    };
}

// يُنشئ المحفظة عند أول طلب برصيد البداية
async function getWallet(userId) {
    const upsert = () => LudoWallet.findOneAndUpdate(
        { user: userId },
        { $setOnInsert: { coins: START_COINS, gems: START_GEMS } },
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
            { user: userId, gems: { $exists: false } }, { $set: { gems: START_GEMS } }, { new: true }
        ).lean();
        w = fixed || { ...w, gems: START_GEMS };
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
async function settle(userId, { won, prize, league }, now = Date.now()) {
    const w = await getWallet(userId);
    const wk = weekKeyOf(now);
    const points = won ? assertLeague(league).points : 0;
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

async function claimDaily(userId, now = Date.now()) {
    await getWallet(userId);
    const w = await LudoWallet.findOneAndUpdate(
        { user: userId, $or: [{ dailyClaimedAt: null }, { dailyClaimedAt: { $lte: new Date(now - DAILY_MS) } }] },
        { $inc: { coins: DAILY_BONUS }, $set: { dailyClaimedAt: new Date(now) } },
        { new: true }
    ).lean();
    if (!w) throw new LudoError('DAILY_NOT_READY', 'أخذت مكافأة اليوم — ارجع غداً', 409);
    return w;
}

// ───────────── المتجر ─────────────

const storeView = () => ({
    coinPacks: COIN_PACKS,
    gemProducts: Object.entries(GEM_PRODUCTS).map(([productId, gems]) => ({ productId, gems })),
    boostCost: BOOST_COST
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

// شراء جواهر: معاملة StoreKit 2 موثّقة بشهادات أبل. تُمنح مرة واحدة (transactionId فريد)،
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
    const gems = GEM_PRODUCTS[t.productId];
    if (!gems) throw new LudoError('IAP_UNKNOWN_PRODUCT', 'منتج غير معروف', 400);
    if (t.revoked) throw new LudoError('IAP_REVOKED', 'هذه العملية مستردّة أو ملغاة', 400);

    const LudoPurchase = require('../../models/LudoPurchase');
    await getWallet(userId);
    try {
        await LudoPurchase.create({
            transactionId: t.transactionId, user: userId, productId: t.productId, gems, environment: t.environment
        });
    } catch (e) {
        if (e.code !== 11000) throw e;
        const existing = await LudoPurchase.findOne({ transactionId: t.transactionId }).select('user').lean();
        if (existing && String(existing.user) !== String(userId)) {
            throw new LudoError('IAP_IN_USE', 'هذه العملية مستعملة في حساب آخر', 409);
        }
        return { wallet: await getWallet(userId), granted: 0, transactionId: t.transactionId };
    }
    const w = await LudoWallet.findOneAndUpdate({ user: userId }, { $inc: { gems } }, { new: true }).lean();
    return { wallet: w, granted: gems, transactionId: t.transactionId };
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

// جوائز الأسبوع المنتهي — مرة واحدة (فرادة weekKey في LudoSeason تحسم السباق بين النسخ)
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
    storeView, buyCoins, redeemPurchase,
    leaderboard, awardLastWeek, markPrizeSeen, startSeasonSweeper,
    assertLeague, prizeFor, stakeFor, leaguesView, walletView, tierOf, weekKeyOf,
    constants: { START_COINS, START_GEMS, DAILY_BONUS, DAILY_MS, LEAGUES, BOOST_COST, COIN_PACKS, GEM_PRODUCTS, WEEKLY_PRIZES, TIERS }
};
