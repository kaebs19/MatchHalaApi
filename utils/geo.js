const geoip = require('geoip-lite');

/**
 * استنتاج الموقع من عنوان IP — يغطّي المستخدمين الذين لم يمنحوا إذن الموقع.
 *
 * قاعدة البيانات محلّية (geoip-lite) عمداً: البدائل عبر HTTP تعني إرسال عناوين
 * IP لمستخدمينا إلى طرف ثالث، وتفرض حدود معدّل، وتضيف زمن انتظار لكل تسجيل دخول.
 * الدقة على مستوى المدينة تقريبية، وتخطئ مع VPN — لذا يُعرض المصدر للأدمن دائماً.
 */

/** ينظّف صيغ IP التي يمرّرها البروكسي: `::ffff:1.2.3.4`، وقائمة X-Forwarded-For. */
function normalizeIp(raw) {
    if (!raw || typeof raw !== 'string') return null;
    let ip = raw.split(',')[0].trim();
    if (ip.startsWith('::ffff:')) ip = ip.slice(7);
    if (ip === '::1') ip = '127.0.0.1';
    return ip || null;
}

/**
 * @returns {{ip:string, city:string|null, region:string|null, country:string|null,
 *            timezone:string|null, coordinates:number[]|null}|null}
 */
function lookupIp(rawIp) {
    const ip = normalizeIp(rawIp);
    if (!ip) return null;

    let hit = null;
    try {
        hit = geoip.lookup(ip);
    } catch (e) {
        console.error('geoip lookup فشل:', e.message);
        return null;
    }
    if (!hit) return { ip, city: null, region: null, country: null, timezone: null, coordinates: null };

    // geoip يعطي [lat, lng] بينما GeoJSON يتوقّع [lng, lat]
    const ll = Array.isArray(hit.ll) && hit.ll.length === 2 ? [hit.ll[1], hit.ll[0]] : null;

    return {
        ip,
        city: hit.city || null,
        region: hit.region || null,
        country: hit.country || null,
        timezone: hit.timezone || null,
        coordinates: ll
    };
}

/** يبني كائن `ipLocation` الجاهز للحفظ في مستند المستخدم (أو null لو تعذّر). */
function buildIpLocation(rawIp) {
    const info = lookupIp(rawIp);
    if (!info) return null;
    return { ...info, updatedAt: new Date() };
}

/** يستخرج IP العميل من خلف البروكسي (نفس ترتيب الأولويات المستخدم في auth.js). */
function getClientIP(req) {
    return req.headers['x-forwarded-for']?.split(',')[0]?.trim()
        || req.headers['x-real-ip']
        || req.connection?.remoteAddress
        || req.ip
        || null;
}

module.exports = { normalizeIp, lookupIp, buildIpLocation, getClientIP };
