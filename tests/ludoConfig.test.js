// إعدادات هلا لودو من لوحة التحكم: التحقق والتطبيق الحيّ على الاقتصاد والمهام
// node --test tests/ludoConfig.test.js
const test = require('node:test');
const assert = require('node:assert/strict');

const LudoConfig = require('../models/LudoConfig');
let stored = null;
LudoConfig.findOne = () => ({ lean: async () => stored });
LudoConfig.findOneAndUpdate = (f, u) => ({ lean: async () => { stored = { key: 'main', data: u.$set.data, updatedBy: u.$set.updatedBy, updatedAt: new Date() }; return stored; } });

const config = require('../utils/ludo/config');
const economy = require('../utils/ludo/economy');
const missions = require('../utils/ludo/missions');

const prizes = (pairs) => pairs.map(([coins, gems]) => ({ coins, gems }));
const OWNER_PRIZES = prizes([[1e6, 1000], [5e5, 500], [25e4, 250], [1e5, 100], [1e5, 100], [5e4, 50], [5e4, 50], [5e4, 50], [5e4, 50], [5e4, 50]]);

test('الافتراضي = قيم الكود، والتحقق يرفض الأرقام الخاطئة برسائل عربية', () => {
    const d = config.defaults();
    assert.equal(d.leagues.silver.fee, 10000);
    assert.equal(d.weeklyPrizes.length, 10);
    assert.deepEqual(config.sanitize({}), d);                                   // الناقص من الافتراضي
    assert.throws(() => config.sanitize({ leagues: { bronze: { fee: 50000 } } }), /تتصاعد/);
    assert.throws(() => config.sanitize({ startCoins: -1 }), /رصيد البداية/);
    assert.throws(() => config.sanitize({ dailyBonus: 1.5 }), /المكافأة اليومية/);
    assert.throws(() => config.sanitize({ weeklyPrizes: [{ coins: 1, gems: 1 }] }), /10 مراكز/);
    assert.throws(() => config.sanitize({ missions: { win1: { target: 0 } } }), /فُز بمباراة/);
    try { config.sanitize({ startCoins: 'x', adDailyMax: 99 }); assert.fail(); }
    catch (e) { assert.equal(e.errors.length, 2); assert.equal(e.status, 400); }
});

test('الحفظ يطبّق فوراً: الرسوم والجوائز والمهام ورصيد البداية والمكافآت', async () => {
    const before = config.defaults();
    const saved = await config.save({
        leagues: { bronze: { fee: 2000, points: 12 }, silver: { fee: 20000, points: 35 }, gold: { fee: 200000, points: 120 } },
        startCoins: 15000, startGems: 40, dailyBonus: 2500,
        adReward: { coins: 700, gems: 2 }, adDailyMax: 3,
        missions: { win1: { target: 2, coins: 900, gems: 1 } },
        weeklyPrizes: OWNER_PRIZES
    }, 'admin1');
    assert.equal(saved.config.missions.play3.target, before.missions.play3.target);   // غير المذكور يبقى
    const c = economy.constants;
    assert.equal(c.LEAGUES.silver.fee, 20000);
    assert.deepEqual(economy.stakeFor('silver', 'quick', 2), { league: 'silver', fee: 20000, prize: 40000 });
    assert.equal(economy.leaguesView().find(l => l.id === 'gold').points, 120);
    assert.equal(c.START_COINS, 15000);
    assert.equal(c.START_GEMS, 40);
    assert.equal(c.DAILY_BONUS, 2500);
    assert.equal(c.AD_DAILY_MAX, 3);
    assert.deepEqual({ ...c.AD_REWARD }, { coins: 700, gems: 2 });
    assert.deepEqual(c.WEEKLY_PRIZES[0], { coins: 1e6, gems: 1000 });
    assert.equal(c.WEEKLY_PRIZES.length, 10);
    const win = missions.constants.MISSIONS.find(m => m.id === 'win1');
    assert.deepEqual({ target: win.target, coins: win.coins, gems: win.gems }, { target: 2, coins: 900, gems: 1 });
    // walletView يعرض القيم الجديدة
    const v = economy.walletView({ coins: 1, gems: 0, played: 0, wins: 0, losses: 0, dailyClaimedAt: null });
    assert.equal(v.dailyBonus, 2500);
    assert.equal(v.ad.max, 3);
    assert.equal(v.ad.coins, 700);

    // نسخة أخرى تقرأ الوثيقة نفسها (load) فتصل للنتيجة ذاتها
    config.apply(config.defaults());
    assert.equal(c.LEAGUES.silver.fee, 10000);
    const loaded = await config.load();
    assert.equal(loaded.config.leagues.silver.fee, 20000);
    assert.equal(c.LEAGUES.silver.fee, 20000);

    // وثيقة تالفة ← الافتراضي بلا سقوط
    stored = { key: 'main', data: { startCoins: 'oops' } };
    await config.load();
    assert.equal(c.START_COINS, before.startCoins);
    config.apply(config.defaults());
});

test('🎁 هدية الإطلاق: مطفأة افتراضياً، والتواريخ تُتحقَّق، والحفظ يفتحها', async () => {
    const d = config.defaults();
    assert.deepEqual(d.launchGift, { coins: 100000, gems: 1000, startsAt: null, endsAt: null });
    assert.equal(economy.launchGiftOpen(), false);
    assert.throws(() => config.sanitize({ launchGift: { startsAt: '2026-11-20' } }), /معاً/);
    assert.throws(() => config.sanitize({ launchGift: { startsAt: '2026-11-20', endsAt: '2026-11-19' } }), /بعد البداية/);
    assert.throws(() => config.sanitize({ launchGift: { startsAt: '2026-01-01', endsAt: '2026-12-31' } }), /120/);
    assert.throws(() => config.sanitize({ launchGift: { startsAt: 'x', endsAt: '2026-11-19' } }), /تاريخ/);

    const now = Date.now();
    const startsAt = new Date(now - 3600e3).toISOString();
    const endsAt = new Date(now + 30 * 86400e3).toISOString();
    await config.save({ ...config.current(), launchGift: { coins: 100000, gems: 1000, startsAt, endsAt } }, null);
    assert.equal(economy.launchGiftOpen(now), true);
    assert.equal(economy.launchGiftOpen(Date.parse(endsAt) + 1), false);
    const view = economy.walletView({ coins: 0, gems: 0 }, now);
    assert.deepEqual(view.launchGift, { coins: 100000, gems: 1000, endsAt });
    assert.equal(economy.walletView({ coins: 0, gems: 0, launchGiftAt: new Date() }, now).launchGift, null);

    await config.save({ ...config.current(), launchGift: { coins: 1, gems: 1, startsAt: null, endsAt: null } }, null);
    assert.equal(economy.launchGiftOpen(now), false);
});
