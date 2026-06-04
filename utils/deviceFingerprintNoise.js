// utils/deviceFingerprintNoise.js
// كشف القيم "الضوضائية" في deviceFingerprint / keychainToken
// السبب: iOS Simulator + iCloud Keychain + قيم fallback تنتج تصادمات
// (نفس البصمة لعشرات/مئات الحسابات غير المرتبطة).
// نستخدم cache لتجنّب الاستعلام المتكرر على نفس القيمة.

const User = require('../models/User');

const NOISE_THRESHOLD = parseInt(process.env.FP_NOISE_THRESHOLD || '8', 10);
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 دقائق

// Map<field:value, { noisy: bool, count: number, expiresAt: number }>
const cache = new Map();
const MAX_CACHE_ENTRIES = 5000;

const cacheKey = (field, value) => `${field}:${value}`;

const pruneCache = () => {
    if (cache.size <= MAX_CACHE_ENTRIES) return;
    const now = Date.now();
    for (const [k, v] of cache) {
        if (v.expiresAt < now) cache.delete(k);
        if (cache.size <= MAX_CACHE_ENTRIES) break;
    }
    // إذا بقيت كبيرة، أزل أقدم النصف
    if (cache.size > MAX_CACHE_ENTRIES) {
        const toRemove = cache.size - MAX_CACHE_ENTRIES;
        const it = cache.keys();
        for (let i = 0; i < toRemove; i++) cache.delete(it.next().value);
    }
};

/**
 * هل القيمة ضوضائية (تطابق عدد كبير من الحسابات)؟
 * @param {'deviceFingerprint'|'keychainToken'} field
 * @param {string} value
 * @returns {Promise<{ noisy: boolean, count: number }>}
 */
async function checkNoisy(field, value) {
    if (!value || typeof value !== 'string') return { noisy: false, count: 0 };
    if (field !== 'deviceFingerprint' && field !== 'keychainToken') {
        return { noisy: false, count: 0 };
    }

    const key = cacheKey(field, value);
    const now = Date.now();
    const cached = cache.get(key);
    if (cached && cached.expiresAt > now) {
        return { noisy: cached.noisy, count: cached.count };
    }

    let count = 0;
    try {
        count = await User.countDocuments({ [field]: value });
    } catch (err) {
        // فشل الاستعلام → نعتبرها غير ضوضائية (fail-open) لتجنب تعطيل الفحص
        console.error('[fpNoise] countDocuments error:', err.message);
        return { noisy: false, count: 0 };
    }

    const noisy = count >= NOISE_THRESHOLD;
    cache.set(key, { noisy, count, expiresAt: now + CACHE_TTL_MS });
    pruneCache();
    return { noisy, count };
}

const isNoisyFingerprint = (fp) => checkNoisy('deviceFingerprint', fp);
const isNoisyKeychain = (k) => checkNoisy('keychainToken', k);

/**
 * فحص متوازي لكل الإشارات. يرجع map { deviceFingerprint, keychainToken }
 */
async function checkSignals({ deviceFingerprint, keychainToken } = {}) {
    const [fpRes, kcRes] = await Promise.all([
        deviceFingerprint ? isNoisyFingerprint(deviceFingerprint) : Promise.resolve({ noisy: false, count: 0 }),
        keychainToken ? isNoisyKeychain(keychainToken) : Promise.resolve({ noisy: false, count: 0 })
    ]);
    return {
        deviceFingerprint: fpRes,
        keychainToken: kcRes,
        threshold: NOISE_THRESHOLD
    };
}

// مسح الـ cache (للاختبار/الإدارة)
const clearCache = () => cache.clear();

module.exports = {
    NOISE_THRESHOLD,
    isNoisyFingerprint,
    isNoisyKeychain,
    checkSignals,
    clearCache
};
