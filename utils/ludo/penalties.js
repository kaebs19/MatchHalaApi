// MatchHala - هلا لودو: عقوبة الخروج المتكرر من مباريات الدوري
//
// «الخروج» = انسحاب من مباراة دوري جارية، أو حسمها للخصم بعد انقطاع تجاوز مهلة العودة.
// QUIT_LIMIT مرات خلال QUIT_WINDOW_MS ← منع من طابور الدوري بمدة تتصاعد (BAN_MINUTES)،
// والمستوى يتصفّر بعد يوم بلا عقوبة. اللعب الودّي لا يتأثر.
// كله في Redis (مفاتيح بمهلة) — لا يمسّ قاعدة البيانات ولا تقييدات الحساب.

const store = require('./store');

const QUIT_LIMIT = Number(process.env.LUDO_QUIT_LIMIT) || 3;
const QUIT_WINDOW_MS = 60 * 60 * 1000;
const BAN_MINUTES = [10, 30, 120];
const LEVEL_TTL_S = 24 * 60 * 60;

// يسجّل خروجاً، ويعيد { until, minutes } إن بدأ منع الآن
async function recordLeagueQuit(userId, now = Date.now()) {
    const id = String(userId);
    const count = await store.addQuit(id, now, QUIT_WINDOW_MS);
    if (count < QUIT_LIMIT) return null;
    const level = await store.bumpQuitLevel(id, LEVEL_TTL_S);
    const minutes = BAN_MINUTES[Math.min(level, BAN_MINUTES.length) - 1];
    const until = now + minutes * 60 * 1000;
    await store.setQuitBan(id, until, minutes * 60 * 1000);
    return { until, minutes };
}

// المنع الساري: { until, minutes (المتبقي) } أو null
async function leagueBan(userId, now = Date.now()) {
    const until = await store.getQuitBan(String(userId));
    if (!until || until <= now) return null;
    return { until, minutes: Math.max(1, Math.ceil((until - now) / 60000)) };
}

module.exports = { recordLeagueQuit, leagueBan, constants: { QUIT_LIMIT, QUIT_WINDOW_MS, BAN_MINUTES } };
