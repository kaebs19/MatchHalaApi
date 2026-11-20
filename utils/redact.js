// 🔒 إخفاء الأسرار من نصوص السجلّ — رسائل أخطاء المكتبات قد تحمل التوكن نفسه
// (google-auth-library: «Wrong number of segments in token: ya29…» طبع رمز دخول جوجل كاملاً في السجلّ).
// استعمله لأي رسالة خطأ مصدرها تحقق توكن/مفتاح خارجي: console.error('…', redactSecrets(error)).

const PATTERNS = [
    /ya29\.[A-Za-z0-9_\-.]+/g,                                   // Google OAuth access token
    /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}(\.[A-Za-z0-9_-]*)?/g, // JWT (Google/Apple ID token، توكناتنا)
    /EAA[A-Za-z0-9]{20,}/g,                                      // Facebook access token
    /\b[A-Za-z0-9_\-]{80,}\b/g                                   // أي سلسلة طويلة جداً تشبه مفتاحاً
];

function redactSecrets(value) {
    let text = value instanceof Error ? `${value.name}: ${value.message}` : String(value ?? '');
    for (const re of PATTERNS) text = text.replace(re, '[redacted]');
    return text;
}

module.exports = { redactSecrets };
