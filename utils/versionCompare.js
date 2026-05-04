// MatchHala - Version Comparison Utility
// لمقارنة version strings (semver-like): "6.3" vs "6.2.1" vs "6.3.0"

/**
 * يقارن version strings — يدعم major.minor[.patch[.build]]
 * @param {string} a
 * @param {string} b
 * @returns {number} 1 لو a > b, -1 لو a < b, 0 لو متساويين
 */
function compareVersions(a, b) {
    if (!a && !b) return 0;
    if (!a) return -1;
    if (!b) return 1;

    const partsA = String(a).split('.').map(n => parseInt(n, 10) || 0);
    const partsB = String(b).split('.').map(n => parseInt(n, 10) || 0);
    const maxLen = Math.max(partsA.length, partsB.length);

    for (let i = 0; i < maxLen; i++) {
        const x = partsA[i] || 0;
        const y = partsB[i] || 0;
        if (x > y) return 1;
        if (x < y) return -1;
    }
    return 0;
}

/**
 * هل الـ client version يدعم الميزة؟ (>= minRequired)
 * @param {string} clientVersion - من header App-Version
 * @param {string} minRequired - الحد الأدنى المطلوب
 * @returns {boolean}
 */
function clientSupports(clientVersion, minRequired) {
    if (!clientVersion || !minRequired) return false;
    return compareVersions(clientVersion, minRequired) >= 0;
}

module.exports = { compareVersions, clientSupports };
