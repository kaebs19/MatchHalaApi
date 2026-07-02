// Lucky Wheel — عجلة الحظ الخادمية بالكامل (منع الغش)
// السيرفر يقرر الجائزة ويمنحها؛ العميل يعرض الأنيميشن فقط.
const express = require('express');
const router = express.Router();
const { protect } = require('../../middleware/auth');
const User = require('../../models/User');
const Settings = require('../../models/Settings');

// تاريخ اليوم (UTC) بصيغة YYYY-MM-DD — لإعادة ضبط العدّادات اليومية
const todayStr = () => new Date().toISOString().slice(0, 10);

// اختيار جائزة حسب الأوزان
function pickWeightedPrize(prizes) {
    const pool = prizes.filter(p => (p.weight || 0) > 0);
    if (pool.length === 0) return null;
    const total = pool.reduce((s, p) => s + p.weight, 0);
    let r = Math.random() * total;
    for (const p of pool) {
        r -= p.weight;
        if (r <= 0) return p;
    }
    return pool[pool.length - 1];
}

// عدّادات اليوم الفعلية (تُعامَل كصفر إذا تغيّر اليوم)
function todayCounters(u) {
    const today = todayStr();
    if (u.luckyWheel?.countersDate !== today) {
        return { gemSpinsToday: 0, adSpinsToday: 0 };
    }
    return {
        gemSpinsToday: u.luckyWheel?.gemSpinsToday || 0,
        adSpinsToday: u.luckyWheel?.adSpinsToday || 0
    };
}

// تجهيز رد الحالة الموحّد
function buildState(u, wheel) {
    const now = Date.now();
    const freeSpinAt = u.luckyWheel?.freeSpinAt ? new Date(u.luckyWheel.freeSpinAt).getTime() : 0;
    const secondsUntilFreeSpin = freeSpinAt > now ? Math.ceil((freeSpinAt - now) / 1000) : 0;
    const counters = todayCounters(u);
    const gemLimit = wheel.gemSpinDailyLimit || 0;
    const adLimit = wheel.adSpinDailyLimit || 0;
    return {
        gems: u.rewards?.gems || 0,
        points: u.rewards?.points || 0,
        freeSpinAt: u.luckyWheel?.freeSpinAt || null,
        secondsUntilFreeSpin,
        freeSpinAvailable: secondsUntilFreeSpin === 0,
        gemSpinsToday: counters.gemSpinsToday,
        adSpinsToday: counters.adSpinsToday,
        gemSpinsLeft: gemLimit > 0 ? Math.max(0, gemLimit - counters.gemSpinsToday) : null,
        adSpinsLeft: adLimit > 0 ? Math.max(0, adLimit - counters.adSpinsToday) : null
    };
}

// @route   GET /api/mobile/wheel
// @desc    إعدادات العجلة + حالة المستخدم (رصيد + مؤقّتات)
// @access  Private
router.get('/wheel', protect, async (req, res) => {
    try {
        const settings = await Settings.getSettings();
        const wheel = settings.luckyWheel || {};
        const u = await User.findById(req.user._id).select('rewards luckyWheel');

        res.json({
            success: true,
            data: {
                enabled: wheel.enabled !== false,
                config: {
                    freeSpinCooldownHours: wheel.freeSpinCooldownHours || 24,
                    gemSpinCost: wheel.gemSpinCost || 10,
                    gemSpinDailyLimit: wheel.gemSpinDailyLimit || 0,
                    adSpinDailyLimit: wheel.adSpinDailyLimit || 0,
                    // الجوائز بترتيبها (بدون weights — لا نكشف الاحتمالات)
                    prizes: (wheel.prizes || []).map((p, i) => ({
                        index: i, label: p.label, type: p.type, amount: p.amount
                    }))
                },
                state: buildState(u, wheel)
            }
        });
    } catch (error) {
        console.error('wheel GET error:', error);
        res.status(500).json({ success: false, message: 'خطأ في السيرفر' });
    }
});

// @route   POST /api/mobile/wheel/spin
// @desc    دوران واحد — السيرفر يتحقق من الأهلية ويقرر الجائزة ويمنحها
// @body    { source: 'free' | 'ad' | 'gems' }
// @access  Private
router.post('/wheel/spin', protect, async (req, res) => {
    try {
        const source = (req.body.source || 'free').toString();
        const userId = req.user._id;
        const settings = await Settings.getSettings();
        const wheel = settings.luckyWheel || {};

        if (wheel.enabled === false) {
            return res.status(403).json({ success: false, message: 'عجلة الحظ غير متاحة حالياً', code: 'WHEEL_DISABLED' });
        }
        const prizes = wheel.prizes || [];
        if (prizes.length === 0) {
            return res.status(500).json({ success: false, message: 'لا توجد جوائز مُعدّة' });
        }

        const now = new Date();
        const today = todayStr();

        // إعادة ضبط العدّادات اليومية إذا تغيّر اليوم (ذرّي، مرّة واحدة)
        await User.updateOne(
            { _id: userId, 'luckyWheel.countersDate': { $ne: today } },
            { $set: { 'luckyWheel.countersDate': today, 'luckyWheel.gemSpinsToday': 0, 'luckyWheel.adSpinsToday': 0 } }
        );

        // ── بوابة الأهلية الذرّية حسب المصدر ──
        let gatePassed = false;

        if (source === 'free') {
            const cooldownMs = (wheel.freeSpinCooldownHours || 24) * 3600 * 1000;
            const gate = await User.findOneAndUpdate(
                { _id: userId, $or: [{ 'luckyWheel.freeSpinAt': null }, { 'luckyWheel.freeSpinAt': { $lte: now } }] },
                { $set: { 'luckyWheel.freeSpinAt': new Date(now.getTime() + cooldownMs) } },
                { new: true }
            );
            if (!gate) {
                const u = await User.findById(userId).select('rewards luckyWheel');
                return res.status(429).json({
                    success: false, message: 'الدوران المجاني غير متاح بعد', code: 'FREE_SPIN_COOLDOWN',
                    data: { state: buildState(u, wheel) }
                });
            }
            gatePassed = true;

        } else if (source === 'gems') {
            const cost = wheel.gemSpinCost || 10;
            const limit = wheel.gemSpinDailyLimit || 0;
            const cond = { _id: userId, 'rewards.gems': { $gte: cost } };
            if (limit > 0) cond['luckyWheel.gemSpinsToday'] = { $lt: limit };
            const gate = await User.findOneAndUpdate(
                cond,
                { $inc: { 'rewards.gems': -cost, 'luckyWheel.gemSpinsToday': 1 } },
                { new: true }
            );
            if (!gate) {
                const u = await User.findById(userId).select('rewards luckyWheel');
                const counters = todayCounters(u);
                const insufficient = (u.rewards?.gems || 0) < cost;
                return res.status(insufficient ? 400 : 429).json({
                    success: false,
                    message: insufficient ? 'رصيد الجواهر غير كافٍ' : 'وصلت للحد اليومي لدورانات الجواهر',
                    code: insufficient ? 'INSUFFICIENT_GEMS' : 'GEM_SPIN_LIMIT',
                    data: { needed: cost, have: u.rewards?.gems || 0, gemSpinsToday: counters.gemSpinsToday, state: buildState(u, wheel) }
                });
            }
            gatePassed = true;

        } else if (source === 'ad') {
            // ⚠️ يثق بالعميل أنه شاهد الإعلان (التحقق الآمن = AdMob SSV — المرحلة 3)
            const limit = wheel.adSpinDailyLimit || 0;
            const cond = { _id: userId };
            if (limit > 0) cond['luckyWheel.adSpinsToday'] = { $lt: limit };
            const gate = await User.findOneAndUpdate(
                cond,
                { $inc: { 'luckyWheel.adSpinsToday': 1 } },
                { new: true }
            );
            if (!gate) {
                const u = await User.findById(userId).select('rewards luckyWheel');
                return res.status(429).json({
                    success: false, message: 'وصلت للحد اليومي لدورانات الإعلان', code: 'AD_SPIN_LIMIT',
                    data: { state: buildState(u, wheel) }
                });
            }
            gatePassed = true;

        } else {
            return res.status(400).json({ success: false, message: 'مصدر دوران غير صالح', code: 'INVALID_SOURCE' });
        }

        if (!gatePassed) {
            return res.status(400).json({ success: false, message: 'تعذّر تنفيذ الدوران' });
        }

        // ── اختيار الجائزة ومنحها ──
        const prize = pickWeightedPrize(prizes);
        const prizeIndex = prizes.findIndex(p => p === prize);

        const upd = { $set: { 'luckyWheel.lastSpinAt': now }, $inc: { 'luckyWheel.totalSpins': 1 } };
        if (prize.type === 'gems' && prize.amount > 0) upd.$inc['rewards.gems'] = prize.amount;
        if (prize.type === 'points' && prize.amount > 0) upd.$inc['rewards.points'] = prize.amount;
        // دورة إضافية → إتاحة دوران مجاني فوري (نُلغي التبريد الذي ضُبط في بوابة free)
        if (prize.type === 'extra_spin') upd.$set['luckyWheel.freeSpinAt'] = null;

        const finalUser = await User.findByIdAndUpdate(userId, upd, { new: true, select: 'rewards luckyWheel' });

        res.json({
            success: true,
            data: {
                prize: { index: prizeIndex, label: prize.label, type: prize.type, amount: prize.amount },
                state: buildState(finalUser, wheel)
            }
        });
    } catch (error) {
        console.error('wheel spin error:', error);
        res.status(500).json({ success: false, message: 'خطأ في السيرفر' });
    }
});

module.exports = router;
