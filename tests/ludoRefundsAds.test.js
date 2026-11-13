// استرداد أبل (App Store Server Notifications) + التحقق من مكافأة AdMob (SSV) — بلا Mongo ولا Redis
// node --test tests/ludoRefundsAds.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const mongoose = require('mongoose');

const oid = () => new mongoose.Types.ObjectId().toString();
const matches = (doc, filter) => Object.entries(filter).every(([k, v]) => {
    const val = doc[k];
    if (v && typeof v === 'object' && !Array.isArray(v)) {
        if ('$gte' in v) return (val || 0) >= v.$gte;
        if ('$ne' in v) return (val ?? null) !== v.$ne;
        return false;
    }
    if (v === null) return val === null || val === undefined;
    return String(val) === String(v);
});
const apply = (doc, u) => {
    for (const [k, v] of Object.entries(u.$inc || {})) doc[k] = (doc[k] || 0) + v;
    for (const [k, v] of Object.entries(u.$set || {})) doc[k] = v;
};

// ── المحافظ ──
const LudoWallet = require('../models/LudoWallet');
const wallets = new Map();
LudoWallet.findOneAndUpdate = (filter, update, opts = {}) => ({ lean: async () => {
    let w = wallets.get(String(filter.user));
    if (!w && opts.upsert) { w = { user: String(filter.user), ...(update.$setOnInsert || {}) }; wallets.set(w.user, w); return { ...w }; }
    if (!w || !matches(w, Object.fromEntries(Object.entries(filter).filter(([k]) => k !== 'user')))) return null;
    apply(w, update);
    return { ...w };
} });
LudoWallet.updateOne = async (filter, update) => { const w = wallets.get(String(filter.user)); if (w) apply(w, update); };

// ── المشتريات ──
const LudoPurchase = require('../models/LudoPurchase');
const purchases = new Map();
LudoPurchase.findOneAndUpdate = (filter, update, opts = {}) => ({ lean: async () => {
    const p = purchases.get(String(filter.transactionId));
    if (!p || !matches(p, { refundedAt: filter.refundedAt })) return null;
    const before = { ...p };
    apply(p, update);
    return opts.new ? { ...p } : before;
} });
LudoPurchase.findOne = (f) => ({ lean: async () => purchases.get(String(f.transactionId)) || null });
LudoPurchase.updateOne = async (f, u) => { for (const p of purchases.values()) if (p._id === f._id) apply(p, u); };
const addPurchase = (user, gems, coins = 0) => {
    const id = String(Math.floor(Math.random() * 1e12));
    purchases.set(id, { _id: id, transactionId: id, user, productId: 'com.app.hala.ludo.gems330', gems, coins, refundedAt: null });
    return id;
};

// ── سجلّ الإشعارات ──
const AppleNotification = require('../models/AppleNotification');
const notes = new Map();
AppleNotification.create = async (doc) => {
    if (notes.has(doc.notificationUUID)) { const e = new Error('dup'); e.code = 11000; throw e; }
    notes.set(doc.notificationUUID, { ...doc });
};
AppleNotification.findOne = (f) => ({ select: () => ({ lean: async () => notes.get(f.notificationUUID) || null }) });
AppleNotification.updateOne = async (f, u) => apply(notes.get(f.notificationUUID), u);

// ── تحقق أبل وهمي: الحمولة JSON مباشر ──
const apple = require('../utils/appleTransactions');
apple.verifySignedNotification = async (p) => { const n = JSON.parse(p); if (n.forged) throw new Error('bad'); return n; };
apple.verifySignedTransaction = async (p) => JSON.parse(p);

const economy = require('../utils/ludo/economy');
const notifications = require('../utils/appleNotifications');
const ssv = require('../utils/admobSsv');

const note = (type, t, uuid = crypto.randomUUID()) => JSON.stringify({
    notificationUUID: uuid, notificationType: type, data: { environment: 'Sandbox', signedTransactionInfo: JSON.stringify(t) }
});

test('استرداد أبل: يسحب الممنوح مرة واحدة، وما أُنفق يُسجَّل عجزاً لا رصيداً سالباً', async () => {
    const u = oid();
    await economy.getWallet(u);
    wallets.get(u).gems = 400;
    const tx = addPurchase(u, 330);
    const t = { transactionId: tx, productId: 'com.app.hala.ludo.gems330' };

    const r = await notifications.handle(note('REFUND', t, 'n1'));
    assert.equal(r.result, 'ludo_refunded');
    assert.equal(wallets.get(u).gems, 70);
    assert.deepEqual({ g: purchases.get(tx).clawedGems, s: purchases.get(tx).shortfallGems }, { g: 330, s: 0 });
    // أبل تعيد الإرسال: لا سحب ثانٍ
    assert.equal((await notifications.handle(note('REFUND', t, 'n1'))).result, 'duplicate');
    // إشعار مختلف للمعاملة نفسها (REVOKE بعد REFUND): لا سحب ثانٍ أيضاً
    await notifications.handle(note('REVOKE', t));
    assert.equal(wallets.get(u).gems, 70);
    assert.equal(notes.get('n1').result, 'ludo_refunded');

    // أُنفق أغلبها قبل الاسترداد: يُسحب الموجود ويُسجَّل الباقي
    const tx2 = addPurchase(u, 330, 50000);
    wallets.get(u).coins = 20000;
    const r2 = await notifications.handle(note('REFUND', { transactionId: tx2, productId: 'com.app.hala.ludo.bundle.pro' }));
    assert.deepEqual({ g: r2.detail.clawedGems, sg: r2.detail.shortfallGems, c: r2.detail.clawedCoins, sc: r2.detail.shortfallCoins },
        { g: 70, sg: 260, c: 20000, sc: 30000 });
    assert.equal(wallets.get(u).gems, 0);
    assert.equal(wallets.get(u).coins, 0);

    // ألغت أبل الاسترداد: يُعاد ما سُحب فعلاً
    const back = await notifications.handle(note('REFUND_REVERSED', { transactionId: tx2, productId: 'com.app.hala.ludo.bundle.pro' }));
    assert.equal(back.result, 'ludo_restored');
    assert.deepEqual({ g: wallets.get(u).gems, c: wallets.get(u).coins }, { g: 70, c: 20000 });
    assert.equal(purchases.get(tx2).refundedAt, null);
});

test('إشعارات أبل: توقيع مزوّر يُرفض، ومعاملة لم نمنحها أو منتج آخر تُسجَّل فقط', async () => {
    await assert.rejects(notifications.handle(JSON.stringify({ forged: true })), { code: 'BAD_SIGNATURE' });
    const unknown = await notifications.handle(note('REFUND', { transactionId: '999', productId: 'com.app.hala.ludo.gems60' }));
    assert.equal(unknown.result, 'ludo_unknown_purchase');
    const sub = await notifications.handle(note('REFUND', { transactionId: '5', productId: 'com.halachat.premium.monthly' }));
    assert.equal(sub.result, 'logged');
    const t = await notifications.handle(JSON.stringify({ notificationUUID: 'test-1', notificationType: 'TEST', data: {} }));
    assert.equal(t.result, 'ignored');
});

// ── AdMob SSV ──
const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
ssv.__setKeys({ 3335741209: publicKey.export({ type: 'spki', format: 'pem' }) });
const signedQuery = (params, key = privateKey) => {
    const q = new URLSearchParams(params).toString();
    const sig = crypto.sign('sha256', Buffer.from(q), { key, dsaEncoding: 'der' }).toString('base64url');
    return `${q}&signature=${sig}&key_id=3335741209`;
};

test('SSV: توقيع جوجل يُتحقَّق منه، والتلاعب بأي معامل يُرفض', async () => {
    const q = signedQuery({ ad_network: '5450213213286189855', ad_unit: '1234', custom_data: 'tok', reward_amount: '1', reward_item: 'coins', timestamp: '1', transaction_id: 'abc', user_id: 'u1' });
    const p = await ssv.verify(q);
    assert.equal(p.custom_data, 'tok');
    assert.equal(p.user_id, 'u1');
    await assert.rejects(ssv.verify(q.replace('user_id=u1', 'user_id=u2')), /SSV_BAD_SIGNATURE/);
    await assert.rejects(ssv.verify('user_id=u1&custom_data=tok'), /SSV_NO_SIGNATURE/);
    const other = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey;
    await assert.rejects(ssv.verify(signedQuery({ user_id: 'u1' }, other)), /SSV_BAD_SIGNATURE/);
});

test('مكافأة الإعلان: SSV يمنح مرة واحدة، والتطبيق بعده ينجح بلا منح ثانٍ، والإلزام يغلق طريق التطبيق', async () => {
    const u = oid();
    await economy.getWallet(u);
    const coins0 = wallets.get(u).coins;
    const { token } = await economy.startAd(u);
    assert.equal(await economy.ssvReward(u, token), true);
    assert.equal(await economy.ssvReward(u, token), false);           // جوجل تعيد الاستدعاء
    assert.equal(wallets.get(u).coins, coins0 + 500);
    const viaApp = await economy.claimAd(u, token, Date.now() + 6000);  // التطبيق يطالب بعده
    assert.equal(viaApp.coins, coins0 + 500);
    assert.equal(await economy.ssvReward(u, 'forged'), false);
    assert.equal(await economy.ssvReward('not-an-id', token), false);

    process.env.LUDO_AD_SSV = '1';
    try {
        const { token: t2 } = await economy.startAd(u);
        await assert.rejects(economy.claimAd(u, t2, Date.now() + 6000), { code: 'AD_PENDING' });
        await assert.rejects(economy.claimAd(u, 'nope'), { code: 'AD_NOT_VERIFIED' });
        assert.equal(await economy.ssvReward(u, t2), true);
        assert.equal((await economy.claimAd(u, t2)).coins, coins0 + 1000);
    } finally {
        delete process.env.LUDO_AD_SSV;
    }
    // بلا إلزام: طريق التطبيق القديم يبقى (النسخ قبل SSV)
    const { token: t3 } = await economy.startAd(u);
    await assert.rejects(economy.claimAd(u, t3, Date.now() + 1000), { code: 'AD_NOT_VERIFIED' });   // قبل مدة الإعلان
    assert.equal((await economy.claimAd(u, t3, Date.now() + 6000)).coins, coins0 + 1500);
});
