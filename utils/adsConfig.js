// 📺 إعدادات إعلانات التطبيق — تُدار من اللوحة (الإعدادات ← الإعلانات) ويقرؤها التطبيق مع /app/bootstrap.
//
// الافتراضي = القيم المكتوبة في التطبيق اليوم (AdConfig في AdMobManager.swift)، فوثيقة فارغة لا تغيّر شيئاً.
// ⚠️ المشترك في هلا+ معفى دائماً — قاعدة منتج لا إعداد (الاشتراك يُباع «بلا إعلانات»).
// ⚠️ النسخ ≤ 12.2 لا تقرأ هذه الإعدادات — تبقى على قيمها المكتوبة.

const PLACEMENTS = [
    'exploreBanner',        // بانر أعلى الاكتشاف
    'exploreNative',        // بطاقة مدمجة بين بطاقات الاكتشاف
    'exploreInterstitial',  // ملء الشاشة في محطات الاكتشاف (بالتناوب مع المدمجة)
    'searchBanner',         // بانر صفحة البحث
    'searchNative',         // إعلان داخل شبكة/قائمة البحث
    'searchInterstitial',   // ملء الشاشة عند فتح البحث
    'storiesNative',        // إعلان بين القصص
    'chatInterstitial',     // ملء الشاشة عند الخروج من محادثة
    'profileInterstitial',  // ملء الشاشة عند إغلاق ملف بعد تصفّح
    'ludoRewarded'          // إعلان بمكافأة في متجر اللودو
];

// [افتراضي، أدنى، أعلى]
const RULES = {
    cardsBetweenAdBreaks:       [6, 3, 50],     // بطاقات الاكتشاف بين محطتَي إعلان
    searchNativeEvery:          [6, 4, 40],     // كل كم بطاقة في البحث يظهر إعلان
    storiesBetweenAds:          [6, 2, 50],     // قصص الآخرين بين إعلانين
    nativeAdReadSeconds:        [5, 0, 15],     // ثوانٍ قبل زرّ «متابعة» على الإعلان المدمج
    interstitialCooldownMinutes:[45, 1, 1440],  // الفاصل بين إعلانَي ملء شاشة
    maxInterstitialsPerDay:     [5, 0, 50],     // السقف اليومي (0 = بلا ملء شاشة)
    launchGraceSeconds:         [90, 0, 900],   // لا ملء شاشة في أول ثوانٍ من فتح التطبيق
    interstitialDelaySeconds:   [5, 0, 30],     // انتظار قبل ملء الشاشة في نقاط الخروج
    profileMinBrowseSeconds:    [15, 0, 300],   // تصفّح الملف قبل إعلان إغلاقه
    storyExitQuietSeconds:      [45, 0, 600]    // لا ملء شاشة بعد إغلاق القصص
};

const UNIT_KEYS = ['banner', 'interstitial', 'native', 'rewarded'];
const UNIT_RE = /^ca-app-pub-\d{10,20}\/\d{6,14}$/;

const AUDIENCE = {
    exemptNewAccountDays: [0, 0, 90],           // لا إعلانات لحساب عمره أقل من N يوم
};

function defaults() {
    return {
        enabled: true,
        placements: Object.fromEntries(PLACEMENTS.map(p => [p, true])),
        rules: Object.fromEntries(Object.entries(RULES).map(([k, [d]]) => [k, d])),
        audience: { exemptNewAccountDays: AUDIENCE.exemptNewAccountDays[0], exemptAdmins: false },
        units: Object.fromEntries(UNIT_KEYS.map(k => [k, '']))
    };
}

const clampInt = (v, [, min, max], fallback) => {
    const n = Math.round(Number(v));
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
};

/** يدمج المُدخَل مع الافتراضي ويرفض القيم غير الصالحة — يُرجع { config, errors } */
function sanitize(input = {}) {
    const base = defaults();
    const errors = [];
    const src = input && typeof input === 'object' ? input : {};

    if (typeof src.enabled === 'boolean') base.enabled = src.enabled;

    const pl = src.placements || {};
    for (const p of PLACEMENTS) if (typeof pl[p] === 'boolean') base.placements[p] = pl[p];

    const rules = src.rules || {};
    for (const [k, spec] of Object.entries(RULES)) {
        if (rules[k] === undefined || rules[k] === '') continue;
        const n = Number(rules[k]);
        if (!Number.isFinite(n)) { errors.push(`قيمة غير صالحة: ${k}`); continue; }
        base.rules[k] = clampInt(n, spec, spec[0]);
    }

    const aud = src.audience || {};
    if (aud.exemptNewAccountDays !== undefined && aud.exemptNewAccountDays !== '') {
        base.audience.exemptNewAccountDays = clampInt(aud.exemptNewAccountDays, AUDIENCE.exemptNewAccountDays, 0);
    }
    if (typeof aud.exemptAdmins === 'boolean') base.audience.exemptAdmins = aud.exemptAdmins;

    const units = src.units || {};
    for (const k of UNIT_KEYS) {
        const v = String(units[k] || '').trim();
        if (!v) continue;
        if (!UNIT_RE.test(v)) { errors.push(`معرّف وحدة غير صالح (${k}): يجب أن يكون بصيغة ca-app-pub-XXXX/YYYY`); continue; }
        base.units[k] = v;
    }
    return { config: base, errors };
}

/** ما يُرسَل للتطبيق: الإعدادات + هل الإعلانات مفعّلة لهذا المستخدم (الإعفاءات تُحسب هنا) */
function forUser(stored, user) {
    const { config } = sanitize(stored || {});
    let exemptReason = null;
    if (config.audience.exemptAdmins && user?.role === 'admin') exemptReason = 'admin';
    const days = config.audience.exemptNewAccountDays;
    if (!exemptReason && days > 0 && user?.createdAt
        && Date.now() - new Date(user.createdAt).getTime() < days * 86400000) {
        exemptReason = 'new_account';
    }
    return {
        ...config,
        active: config.enabled && !exemptReason,
        exemptReason
    };
}

// الإعدادات المحفوظة بذاكرة 60ث — /app/bootstrap يُنادى مع كل فتح للتطبيق (النسخ الأخرى تلحق خلال دقيقة من الحفظ)
const TTL_MS = 60 * 1000;
let cached = null;
let cachedAt = 0;
async function storedConfig() {
    if (cached && Date.now() - cachedAt < TTL_MS) return cached;
    const Settings = require('../models/Settings');
    const doc = await Settings.findOne().select('adsConfig').lean();
    cached = doc?.adsConfig || {};
    cachedAt = Date.now();
    return cached;
}
function invalidate() { cached = null; cachedAt = 0; }

module.exports = { PLACEMENTS, RULES, UNIT_KEYS, defaults, sanitize, forUser, storedConfig, invalidate };
