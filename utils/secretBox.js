// تشفير أسرار صغيرة قبل حفظها في القاعدة (AES-256-GCM). المفتاح من INTEGRATIONS_KEY وإلا JWT_SECRET.
// ⚠️ تغيير المفتاح يُبطل الأسرار المحفوظة (يلزم إعادة الربط) — لا يُفقد شيء آخر.
const crypto = require('crypto');

function key() {
    const base = process.env.INTEGRATIONS_KEY || process.env.JWT_SECRET;
    if (!base) throw new Error('INTEGRATIONS_KEY/JWT_SECRET غير مضبوط');
    return crypto.createHash('sha256').update(`matchhala:integrations:${base}`).digest();
}

function seal(plain) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
    const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
    return [iv, cipher.getAuthTag(), enc].map(b => b.toString('base64')).join('.');
}

function open(sealed) {
    const [iv, tag, enc] = String(sealed || '').split('.').map(s => Buffer.from(s, 'base64'));
    if (!iv || !tag || !enc) throw new Error('سرّ تالف');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}

module.exports = { seal, open };
