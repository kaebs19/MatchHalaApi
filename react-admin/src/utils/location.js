/**
 * أدوات عرض موقع المستخدم في لوحة التحكم.
 *
 * المصدران يأتيان من الخادم:
 *  - `gpsLocation` + `location.coordinates` — دقيق، لمن منح إذن الموقع في التطبيق.
 *  - `ipLocation` — مستنتج من IP عند كل تسجيل دخول، يغطّي الجميع لكنه تقريبي ويخطئ مع VPN.
 * لذلك يُعرض المصدر دائماً بجانب القيمة بدل دمجهما في سطر واحد مضلّل.
 */

const hasCoords = (coords) =>
    Array.isArray(coords) && coords.length === 2 &&
    (Number(coords[0]) !== 0 || Number(coords[1]) !== 0);

/** إحداثيات GPS كما يخزّنها GeoJSON: [lng, lat]. */
export const gpsCoords = (user) =>
    hasCoords(user?.location?.coordinates) ? user.location.coordinates : null;

export const ipCoords = (user) =>
    hasCoords(user?.ipLocation?.coordinates) ? user.ipLocation.coordinates : null;

/** رابط خريطة جوجل من [lng, lat]. */
export const mapsUrl = (coords) =>
    coords ? `https://www.google.com/maps?q=${coords[1]},${coords[0]}` : null;

export const formatCoords = (coords) =>
    coords ? `${Number(coords[1]).toFixed(4)}, ${Number(coords[0]).toFixed(4)}` : '';

/** «مدينة، دولة» من أي مصدر، متجاهلاً القيم الفارغة. */
export const placeText = (city, country) =>
    [city, country].filter(Boolean).join('، ') || null;

/**
 * أفضل موقع متاح للعرض المختصر (في قائمة المستخدمين):
 * GPS أولاً لأنه الأدق، ثم IP، ثم الدولة المسجّلة في الملف.
 * @returns {{text:string, source:'gps'|'ip'|'profile', icon:string, coords:number[]|null, updatedAt:string|null}|null}
 */
export const bestLocation = (user) => {
    if (!user) return null;

    const gpsPlace = placeText(user.gpsLocation?.city, user.gpsLocation?.country);
    const gps = gpsCoords(user);
    if (gpsPlace || gps) {
        return {
            text: gpsPlace || formatCoords(gps),
            source: 'gps',
            icon: '📍',
            coords: gps,
            updatedAt: user.gpsLocation?.updatedAt || null
        };
    }

    const ipPlace = placeText(user.ipLocation?.city, user.ipLocation?.country);
    if (ipPlace) {
        return {
            text: ipPlace,
            source: 'ip',
            icon: '🌐',
            coords: ipCoords(user),
            updatedAt: user.ipLocation?.updatedAt || null
        };
    }

    const profilePlace = placeText(user.city, user.country);
    if (profilePlace) {
        return { text: profilePlace, source: 'profile', icon: '🗂️', coords: null, updatedAt: null };
    }
    return null;
};

export const sourceLabel = (source) => ({
    gps: 'GPS من التطبيق (دقيق)',
    ip: 'مستنتج من IP (تقريبي)',
    profile: 'من ملف المستخدم'
}[source] || '');

/** المسافة بالكيلومترات بين إحداثيَّين [lng, lat] — تُستخدم لكشف تعارض GPS/IP. */
export const distanceKm = (a, b) => {
    if (!a || !b) return null;
    const toRad = (d) => (d * Math.PI) / 180;
    const [lng1, lat1] = a.map(Number);
    const [lng2, lat2] = b.map(Number);
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const h = Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return Math.round(6371 * 2 * Math.asin(Math.sqrt(h)));
};

/** تعارض واضح بين المصدرين ⇒ مؤشّر VPN أو موقع مزيّف. */
export const MISMATCH_KM = 500;
