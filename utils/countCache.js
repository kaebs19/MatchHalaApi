// MatchHala - كاش أعداد النتائج (في ذاكرة النسخة)
//
// «N نتيجة» وعدد صفحات الاكتشاف يُحسبان بـ countDocuments على عشرات آلاف المستخدمين مع كل طلب
// (وكل صفحة تالية تعيد العدّ نفسه). الرقم لا يتغيّر في دقائق — يُحفظ لكل مستخدم وفلاتره.
const NodeCache = require('node-cache');

const cache = new NodeCache({ stdTTL: 600, checkperiod: 120, maxKeys: 20000, useClones: false });

async function cachedCount(key, compute, ttlSeconds = 600) {
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    const n = await compute();
    try { cache.set(key, n, ttlSeconds); } catch (_) { /* امتلأ الكاش — نكتفي بالحساب */ }
    return n;
}

module.exports = { cachedCount };
