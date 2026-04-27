// utils/strictDeviceMode.js
// ✅ تحديد متى نُلزم التطبيق بإرسال بصمة الجهاز
// النسخ ≥ MIN_STRICT_VERSION ملزمة. النسخ الأقدم → fail-open (للتوافق).

const MIN_STRICT_VERSION = '5.4';
const STRICT_PLATFORM = 'ios';

/**
 * يقارن نسختين بصيغة "X.Y" أو "X.Y.Z"
 * @returns true لو a >= b
 */
function versionGte(a, b) {
    const pa = String(a || '').split('.').map(n => parseInt(n, 10) || 0);
    const pb = String(b || '').split('.').map(n => parseInt(n, 10) || 0);
    const len = Math.max(pa.length, pb.length);
    for (let i = 0; i < len; i++) {
        const x = pa[i] || 0;
        const y = pb[i] || 0;
        if (x > y) return true;
        if (x < y) return false;
    }
    return true; // متساويتان
}

/**
 * هل هذا الـ request من نسخة ملزمة بإرسال بصمة الجهاز؟
 */
function isStrictDeviceVersion(req) {
    const platform = (req.headers['x-app-platform'] || '').toLowerCase();
    const version = req.headers['x-app-version'] || '';
    if (platform !== STRICT_PLATFORM) return false;
    if (!version) return false;
    return versionGte(version, MIN_STRICT_VERSION);
}

module.exports = {
    isStrictDeviceVersion,
    versionGte,
    MIN_STRICT_VERSION
};
