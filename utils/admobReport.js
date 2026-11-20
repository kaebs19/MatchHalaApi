// 📊 تقارير AdMob للوحة (شاشة أداء الإعلانات) — AdMob API v1 بربط OAuth من اللوحة.
//
// ⚠️ AdMob API لا يقبل حسابات الخدمة: المالك يضغط «ربط حساب AdMob» مرة ← موافقة Google ← رمز تحديث
//    يُحفظ مشفّراً (models/AdminIntegration + utils/secretBox). المطلوب في .env فقط:
//    ADMOB_OAUTH_CLIENT_ID و ADMOB_OAUTH_CLIENT_SECRET (عميل OAuth من نوع Web application في Google Cloud،
//    مع تفعيل AdMob API، وRedirect URI = <BASE_URL>/api/admin/admob/oauth/callback).
// قراءة فقط (admob.readonly). التقرير بذاكرة 10 دقائق لكل مدى (أرقام AdMob تتحدّث كل ساعات أصلاً).

const AdminIntegration = require('../models/AdminIntegration');
const { seal, open } = require('./secretBox');

const SCOPE = 'https://www.googleapis.com/auth/admob.readonly';
const API = 'https://admob.googleapis.com/v1';

const clientId = () => process.env.ADMOB_OAUTH_CLIENT_ID || '';
const clientSecret = () => process.env.ADMOB_OAUTH_CLIENT_SECRET || '';
const isConfigured = () => Boolean(clientId() && clientSecret());
const redirectUri = () => `${(process.env.BASE_URL || 'https://matchhala.chathala.com').replace(/\/$/, '')}/api/admin/admob/oauth/callback`;

// وحداتنا المعروفة ← اسم الموضع في اللوحة (AdConfig.AdUnitID في التطبيق)
const KNOWN_UNITS = {
    'ca-app-pub-8219247197168750/4959452092': 'بانر (الاكتشاف + البحث)',
    'ca-app-pub-8219247197168750/2278831328': 'ملء الشاشة',
    'ca-app-pub-8219247197168750/2689698627': 'مدمج (الاكتشاف + البحث + القصص)',
    'ca-app-pub-8219247197168750/3444580004': 'مكافأة (متجر اللودو)'
};

function authUrl(state) {
    const p = new URLSearchParams({
        client_id: clientId(),
        redirect_uri: redirectUri(),
        response_type: 'code',
        scope: SCOPE,
        access_type: 'offline',
        prompt: 'consent',            // يضمن refresh_token حتى لو سبق الربط
        include_granted_scopes: 'true',
        state
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}

async function postForm(url, params) {
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(params)
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error_description || json.error || `HTTP ${res.status}`);
    return json;
}

let accessCache = { token: null, exp: 0 };

async function accessToken() {
    if (accessCache.token && Date.now() < accessCache.exp - 60000) return accessCache.token;
    const doc = await AdminIntegration.findOne({ provider: 'admob' }).select('+refreshTokenEnc').lean();
    if (!doc?.refreshTokenEnc) {
        const e = new Error('حساب AdMob غير مربوط'); e.code = 'NOT_CONNECTED'; throw e;
    }
    try {
        const json = await postForm('https://oauth2.googleapis.com/token', {
            client_id: clientId(), client_secret: clientSecret(),
            refresh_token: open(doc.refreshTokenEnc), grant_type: 'refresh_token'
        });
        accessCache = { token: json.access_token, exp: Date.now() + (json.expires_in || 3600) * 1000 };
        return accessCache.token;
    } catch (err) {
        // invalid_grant = أُلغي الإذن من حساب Google ← يلزم إعادة الربط
        await AdminIntegration.updateOne({ provider: 'admob' }, { lastError: err.message, lastErrorAt: new Date() });
        const e = new Error(/invalid_grant/i.test(err.message)
            ? 'انتهى إذن AdMob أو أُلغي — أعد الربط'
            : `تعذّر تجديد إذن AdMob: ${err.message}`);
        e.code = 'AUTH_FAILED';
        throw e;
    }
}

async function api(path, { method = 'GET', body } = {}) {
    const token = await accessToken();
    const res = await fetch(`${API}${path}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) {
        const msg = json?.error?.message || json?.[0]?.error?.message || `HTTP ${res.status}`;
        const e = new Error(res.status === 403 && /has not been used|disabled/i.test(msg)
            ? 'AdMob API غير مفعّل في مشروع Google Cloud — فعّله ثم أعد المحاولة'
            : `AdMob: ${msg}`);
        e.code = 'API_ERROR';
        throw e;
    }
    return json;
}

/** بعد موافقة Google: يحفظ رمز التحديث مشفّراً ويقرأ حساب الناشر */
async function completeConnect(code, adminId) {
    const json = await postForm('https://oauth2.googleapis.com/token', {
        code, client_id: clientId(), client_secret: clientSecret(),
        redirect_uri: redirectUri(), grant_type: 'authorization_code'
    });
    if (!json.refresh_token) throw new Error('لم تُرجع Google رمز تحديث — أعد المحاولة');
    await AdminIntegration.findOneAndUpdate(
        { provider: 'admob' },
        { refreshTokenEnc: seal(json.refresh_token), connectedBy: adminId, connectedAt: new Date(), lastError: null, lastErrorAt: null },
        { upsert: true }
    );
    accessCache = { token: json.access_token, exp: Date.now() + (json.expires_in || 3600) * 1000 };
    const accounts = await api('/accounts');
    const acc = accounts.account?.[0];
    if (acc) {
        await AdminIntegration.updateOne({ provider: 'admob' }, {
            accountId: acc.name, publisherId: acc.publisherId, currencyCode: acc.currencyCode || null
        });
    }
    reportCache.clear();
}

async function disconnect() {
    const doc = await AdminIntegration.findOne({ provider: 'admob' }).select('+refreshTokenEnc').lean();
    if (doc?.refreshTokenEnc) {
        try { await postForm('https://oauth2.googleapis.com/revoke', { token: open(doc.refreshTokenEnc) }); } catch (e) { /* أُلغي مسبقاً */ }
    }
    await AdminIntegration.deleteOne({ provider: 'admob' });
    accessCache = { token: null, exp: 0 };
    reportCache.clear();
}

async function status() {
    const doc = await AdminIntegration.findOne({ provider: 'admob' }).lean();
    return {
        configured: isConfigured(),
        connected: Boolean(doc?.connectedAt),
        publisherId: doc?.publisherId || null,
        currencyCode: doc?.currencyCode || null,
        connectedAt: doc?.connectedAt || null,
        lastError: doc?.lastError || null,
        redirectUri: redirectUri()
    };
}

// ───────────── التقرير ─────────────

const ymd = (d) => ({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() });
const num = (m) => (m?.microsValue !== undefined ? Number(m.microsValue) / 1e6
    : m?.integerValue !== undefined ? Number(m.integerValue)
        : m?.doubleValue !== undefined ? Number(m.doubleValue) : 0);

/** صفوف networkReport:generate ← مجاميع (دالة صرفة — tests/admobReport.test.js) */
function aggregate(rows, { days, today = new Date() }) {
    const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
    const curStart = new Date(end.getTime() - (days - 1) * 86400000);
    const key = (d) => d.toISOString().slice(0, 10).replace(/-/g, '');
    const curFrom = key(curStart);

    const blank = () => ({ earnings: 0, impressions: 0, requests: 0, matched: 0, clicks: 0 });
    const METRICS = ['earnings', 'impressions', 'requests', 'matched', 'clicks'];
    const add = (t, r) => { for (const k of METRICS) t[k] += r[k]; };
    const derive = (t) => ({
        ...t,
        earnings: Math.round(t.earnings * 100) / 100,
        ecpm: t.impressions ? Math.round((t.earnings / t.impressions) * 1000 * 100) / 100 : 0,
        matchRate: t.requests ? Math.round((t.matched / t.requests) * 1000) / 10 : 0,
        showRate: t.matched ? Math.round((t.impressions / t.matched) * 1000) / 10 : 0,
        ctr: t.impressions ? Math.round((t.clicks / t.impressions) * 10000) / 100 : 0
    });

    const current = blank(); const previous = blank();
    const byDay = new Map(); const byUnit = new Map(); const byPlatform = new Map();
    for (let i = 0; i < days; i++) byDay.set(key(new Date(curStart.getTime() + i * 86400000)), blank());

    for (const r of rows) {
        const dv = r.dimensionValues || {}; const mv = r.metricValues || {};
        const date = dv.DATE?.value;
        if (!date) continue;
        const m = {
            earnings: num(mv.ESTIMATED_EARNINGS), impressions: num(mv.IMPRESSIONS),
            requests: num(mv.AD_REQUESTS), matched: num(mv.MATCHED_REQUESTS), clicks: num(mv.CLICKS)
        };
        if (date < curFrom) { add(previous, m); continue; }
        add(current, m);
        if (byDay.has(date)) add(byDay.get(date), m);
        const unitId = dv.AD_UNIT?.value || 'unknown';
        if (!byUnit.has(unitId)) {
            byUnit.set(unitId, {
                unitId,
                name: KNOWN_UNITS[unitId] || dv.AD_UNIT?.displayLabel || unitId,
                format: dv.FORMAT?.value || null,
                platform: dv.PLATFORM?.value || null,
                ...blank()
            });
        }
        add(byUnit.get(unitId), m);
        const pf = dv.PLATFORM?.value || 'OTHER';
        if (!byPlatform.has(pf)) byPlatform.set(pf, { platform: pf, ...blank() });
        add(byPlatform.get(pf), m);
    }

    return {
        days,
        totals: derive(current),
        previous: derive(previous),
        byDay: [...byDay.entries()].map(([d, t]) => ({ date: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}`, ...derive(t) })),
        byUnit: [...byUnit.values()].map(derive).sort((a, b) => b.earnings - a.earnings),
        byPlatform: [...byPlatform.values()].map(derive).sort((a, b) => b.earnings - a.earnings)
    };
}

const reportCache = new Map();
const REPORT_TTL_MS = 10 * 60 * 1000;

async function report(days) {
    days = [7, 14, 30, 90].includes(Number(days)) ? Number(days) : 7;
    const hit = reportCache.get(days);
    if (hit && Date.now() - hit.at < REPORT_TTL_MS) return { ...hit.data, cached: true };

    const doc = await AdminIntegration.findOne({ provider: 'admob' }).lean();
    if (!doc?.accountId) { const e = new Error('حساب AdMob غير مربوط'); e.code = 'NOT_CONNECTED'; throw e; }

    const today = new Date();
    const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
    const start = new Date(end.getTime() - (days * 2 - 1) * 86400000);   // المدى + المدى السابق للمقارنة
    const json = await api(`/${doc.accountId}/networkReport:generate`, {
        method: 'POST',
        body: {
            reportSpec: {
                dateRange: { startDate: ymd(start), endDate: ymd(end) },
                dimensions: ['DATE', 'AD_UNIT', 'FORMAT', 'PLATFORM'],
                metrics: ['ESTIMATED_EARNINGS', 'IMPRESSIONS', 'AD_REQUESTS', 'MATCHED_REQUESTS', 'CLICKS'],
                localizationSettings: { currencyCode: doc.currencyCode || 'USD' }
            }
        }
    });
    const rows = (Array.isArray(json) ? json : []).map(x => x.row).filter(Boolean);
    const data = {
        ...aggregate(rows, { days, today }),
        currencyCode: doc.currencyCode || 'USD',
        publisherId: doc.publisherId,
        generatedAt: new Date().toISOString()
    };
    reportCache.set(days, { at: Date.now(), data });
    return data;
}

module.exports = { isConfigured, authUrl, completeConnect, disconnect, status, report, aggregate, redirectUri, KNOWN_UNITS };
