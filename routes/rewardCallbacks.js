// استدعاءات من خدمات خارجية لا من التطبيق — بلا protect (لا توكن مستخدم)؛ الحماية بالتوقيع وحده.
//   POST /api/apple/notifications   App Store Server Notifications V2 (رابط يُضبط في App Store Connect)
//   GET  /api/admob/ssv             AdMob Server-Side Verification (رابط يُضبط في وحدة Rewarded في AdMob)
const express = require('express');

const apple = express.Router();
apple.post('/', async (req, res) => {
    const signedPayload = req.body?.signedPayload;
    if (typeof signedPayload !== 'string') return res.status(400).json({ ok: false });
    try {
        const r = await require('../utils/appleNotifications').handle(signedPayload);
        res.status(200).json({ ok: true, result: r.result });
    } catch (e) {
        if (e.code === 'BAD_SIGNATURE') {
            console.warn('[apple-notifications] توقيع مرفوض:', e.message);
            return res.status(400).json({ ok: false });
        }
        // خطأ عندنا ← 500 لتعيد أبل الإرسال لاحقاً
        console.error('[apple-notifications] فشل المعالجة:', e.message);
        res.status(500).json({ ok: false });
    }
});

const admob = express.Router();
admob.get('/ssv', async (req, res) => {
    const raw = req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?') + 1) : '';
    let params;
    try {
        params = await require('../utils/admobSsv').verify(raw);
    } catch (e) {
        console.warn('[admob-ssv] رُفض:', e.message);
        return res.status(403).end();
    }
    try {
        // زرّ «Verify URL» في AdMob يرسل استدعاءً بلا user_id/custom_data — نردّ 200
        if (params.user_id && params.custom_data) {
            await require('../utils/ludo/economy').ssvReward(params.user_id, params.custom_data, {
                transactionId: params.transaction_id, adUnit: params.ad_unit
            });
        }
        res.status(200).end();
    } catch (e) {
        console.error('[admob-ssv] فشل المنح:', e.message);
        res.status(500).end();
    }
});

module.exports = { apple, admob };
