// التحقق من مكافآت AdMob من جهة الخادم (Server-Side Verification)
//
// جوجل تستدعي رابطنا (GET) بعد اكتمال مشاهدة الإعلان بمكافأة، بمعاملات منها user_id و custom_data
// (يضبطهما التطبيق قبل العرض: معرّف المستخدم ورمز ludo:ad:start) ثم signature و key_id في آخر الرابط.
// التوقيع ECDSA/SHA-256 على نصّ الاستعلام قبل «&signature=»، بمفاتيح جوجل العامة (تُجلب وتُخزَّن 24س).
// https://developers.google.com/admob/ios/ssv

const crypto = require('crypto');

const KEYS_URL = 'https://www.gstatic.com/admob/reward/verifier-keys.json';
const KEYS_TTL_MS = 24 * 60 * 60 * 1000;

let cache = { keys: null, at: 0 };

async function fetchKeys() {
    const res = await fetch(KEYS_URL, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`AdMob keys HTTP ${res.status}`);
    const body = await res.json();
    const keys = new Map((body.keys || []).map(k => [String(k.keyId), k.pem]));
    if (keys.size === 0) throw new Error('AdMob keys empty');
    cache = { keys, at: Date.now() };
    return keys;
}

async function keyFor(keyId) {
    if (!cache.keys || Date.now() - cache.at > KEYS_TTL_MS) await fetchKeys();
    let pem = cache.keys.get(String(keyId));
    // مفتاح جديد لم نره (جوجل تدوّر مفاتيحها) ← جلب واحد إضافي
    if (!pem && Date.now() - cache.at > 60 * 1000) pem = (await fetchKeys()).get(String(keyId));
    return pem || null;
}

/**
 * يتحقق من استدعاء SSV. rawQuery = نصّ الاستعلام كما وصل (بعد «?» وبلا فكّ ترميز).
 * @returns {Promise<Record<string,string>>} المعاملات المفكوكة — يرمي إن لم يصحّ التوقيع
 */
async function verify(rawQuery) {
    const query = String(rawQuery || '');
    const cut = query.indexOf('&signature=');
    if (cut < 0) throw new Error('SSV_NO_SIGNATURE');
    const message = query.slice(0, cut);
    const params = Object.fromEntries(new URLSearchParams(query));
    if (!params.signature || !params.key_id) throw new Error('SSV_NO_SIGNATURE');
    const pem = await keyFor(params.key_id);
    if (!pem) throw new Error('SSV_UNKNOWN_KEY');
    const signature = Buffer.from(params.signature, 'base64url');
    const ok = crypto.verify('sha256', Buffer.from(message), { key: pem, dsaEncoding: 'der' }, signature);
    if (!ok) throw new Error('SSV_BAD_SIGNATURE');
    return params;
}

// للاختبارات: مفاتيح محلية بدل جلبها من جوجل
function __setKeys(map) { cache = { keys: new Map(Object.entries(map)), at: Date.now() }; }

module.exports = { verify, __setKeys };
