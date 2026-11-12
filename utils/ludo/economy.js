// MatchHala - اقتصاد هلا لودو: الرصيد، الدوريات (برونز/فضة/ذهب)، رسوم الدخول والجوائز
//
// قواعد لا تُرخى:
// - عملات لعب فقط — لا شراء ولا تحويل ولا استبدال بمال. والتسمية «رسوم الدخول» و«الجائزة» (لا «رهان»).
// - الرسوم تُخصم عند **بدء المباراة** لا عند دخول الطابور (فلا استرداد عند الإلغاء).
// - الجائزة = مجموع رسوم المقاعد كلها (مقاعد البوتات تُحسب)، يأخذها الفائز؛ في الفرق يتقاسمها الفائزان.
// - الدوري للّعب أونلاين (الطابور) وحده. الغرف الخاصة وضدّ الكمبيوتر ودعوة المحادثة ودّية بلا رسوم.
// - كل تغيير في الرصيد ذرّي، والتسوية مرة واحدة لكل مباراة (finalize في service.js).

const LudoWallet = require('../../models/LudoWallet');
const { LudoError } = require('../ludoEngine');

const START_COINS = Number(process.env.LUDO_START_COINS) || 10000;
const DAILY_BONUS = Number(process.env.LUDO_DAILY_BONUS) || 1000;
const DAILY_MS = 24 * 60 * 60 * 1000;

// الترتيب = ترتيب العرض في التطبيق
const LEAGUES = {
    bronze: { fee: 500 },
    silver: { fee: 5000 },
    gold: { fee: 20000 }
};

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
    prize: { two: prizeFor(id, 'classic', 2), four: prizeFor(id, 'classic', 4), teams: prizeFor(id, 'teams', 4) }
}));

function walletView(w, now = Date.now()) {
    const claimed = w.dailyClaimedAt ? new Date(w.dailyClaimedAt).getTime() : 0;
    return {
        coins: w.coins,
        played: w.played || 0,
        wins: w.wins || 0,
        losses: w.losses || 0,
        dailyBonus: DAILY_BONUS,
        // 0 = متاحة الآن
        dailyAvailableAt: claimed && claimed + DAILY_MS > now ? claimed + DAILY_MS : 0
    };
}

// يُنشئ المحفظة عند أول طلب برصيد البداية
async function getWallet(userId) {
    const upsert = () => LudoWallet.findOneAndUpdate(
        { user: userId },
        { $setOnInsert: { coins: START_COINS } },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean();
    try {
        return await upsert();
    } catch (e) {
        if (e.code !== 11000) throw e;      // طلبان متزامنان لأول مرة
        return upsert();
    }
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

// نتيجة مباراة دوري: الجائزة للفائز، والعدّادات للجميع (الرسوم خُصمت عند البدء)
async function settle(userId, { won, prize }) {
    await LudoWallet.updateOne(
        { user: userId },
        { $inc: { coins: won ? prize : 0, played: 1, wins: won ? 1 : 0, losses: won ? 0 : 1 } }
    );
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

module.exports = {
    getWallet, assertCanAfford, charge, refund, settle, claimDaily,
    assertLeague, prizeFor, stakeFor, leaguesView, walletView,
    constants: { START_COINS, DAILY_BONUS, DAILY_MS, LEAGUES }
};
