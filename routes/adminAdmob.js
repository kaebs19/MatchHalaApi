// 📊 /api/admin/admob — ربط حساب AdMob وتقرير الأداء (utils/admobReport.js)
// الربط: connect-url (مشرف) ← صفحة موافقة Google ← oauth/callback (عام، محمي بـ state لمرة واحدة) ← العودة للوحة.
const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { protect, adminOnly } = require('../middleware/auth');
const admob = require('../utils/admobReport');
const { getClient } = require('../utils/redisClient');

const STATE_TTL_S = 10 * 60;
const dashboardUrl = (q) => `${(process.env.BASE_URL || 'https://matchhala.chathala.com').replace(/\/$/, '')}/admin/#/settings?tab=ads&admob=${q}`;

// ── رجوع Google (بلا توكن المشرف: المتصفح يُعاد توجيهه) ──
router.get('/oauth/callback', async (req, res) => {
    const { code, state, error } = req.query;
    if (error) return res.redirect(dashboardUrl('denied'));
    try {
        const redis = await getClient();
        const adminId = state && redis ? await redis.getDel(`admob:oauth:${state}`) : null;
        if (!adminId || !code) return res.redirect(dashboardUrl('expired'));
        await admob.completeConnect(String(code), adminId);
        res.redirect(dashboardUrl('connected'));
    } catch (err) {
        console.error('admob oauth callback:', err.message);
        res.redirect(dashboardUrl('failed'));
    }
});

router.use(protect, adminOnly);

router.get('/status', async (req, res) => {
    try {
        res.set('Cache-Control', 'no-store');
        res.json({ success: true, data: await admob.status() });
    } catch (err) {
        res.status(500).json({ success: false, message: 'تعذّر قراءة حالة الربط' });
    }
});

router.post('/connect', async (req, res) => {
    try {
        if (!admob.isConfigured()) {
            return res.status(400).json({ success: false, code: 'NOT_CONFIGURED', message: 'أضف ADMOB_OAUTH_CLIENT_ID و ADMOB_OAUTH_CLIENT_SECRET في .env أولاً' });
        }
        const redis = await getClient();
        if (!redis) return res.status(503).json({ success: false, message: 'Redis غير متاح' });
        const state = crypto.randomBytes(24).toString('hex');
        await redis.set(`admob:oauth:${state}`, String(req.user._id), { EX: STATE_TTL_S });
        res.json({ success: true, data: { url: admob.authUrl(state) } });
    } catch (err) {
        res.status(500).json({ success: false, message: 'تعذّر بدء الربط' });
    }
});

router.post('/disconnect', async (req, res) => {
    try {
        await admob.disconnect();
        res.json({ success: true, message: 'أُلغي ربط AdMob' });
    } catch (err) {
        res.status(500).json({ success: false, message: 'تعذّر إلغاء الربط' });
    }
});

router.get('/report', async (req, res) => {
    try {
        res.set('Cache-Control', 'no-store');
        res.json({ success: true, data: await admob.report(req.query.days) });
    } catch (err) {
        const status = err.code === 'NOT_CONNECTED' ? 409 : err.code === 'AUTH_FAILED' ? 401 : 502;
        res.status(status).json({ success: false, code: err.code || 'ERROR', message: err.message });
    }
});

module.exports = router;
