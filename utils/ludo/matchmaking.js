// MatchHala - هلا لودو: خوارزمية مطابقة الدوري (دالة صرفة، بلا Redis — تُختبر وحدها)
//
// الطلب (المالك، ١٤ نوفمبر ٢٠٢٦): ١) نفس الرسوم ← ٢) نفس المستوى ← ٣) الأقرب ممن يبحث الآن.
// تتّسع النافذة مع انتظار اللاعب (ثوانٍ من BOT_FILL_MS، قابلة للضبط):
//   0 … SAME_FEE        نفس الرسوم فقط، والأقرب مستوىً أولاً
//   SAME_FEE … LEVEL    + من يطابقه في المستوى (المرتبة من النجوم) ولو اختلفت رسومه
//   LEVEL … BOT_FILL    + أيّ باحث، الأقرب رسوماً ثم مستوىً
//   BOT_FILL            تكتمل المجموعة ببوتات
// ⚖️ مجموعة برسوم مختلفة تلعب بالأدنى بينها: لا أحد يدفع أكثر مما اختار. ومن اختار رسوماً أعلى لا يُنزَّل
//    قبل أن تسمح نافذة انتظاره هو (الأعلى رسوماً) — فمن بدأ يبحث للتوّ عن 100K لا يُرمى في مباراة 1K.

const stageOf = (entry, now, w) => {
    const waited = now - entry.joinedAt;
    if (waited >= w.level) return 2;
    if (waited >= w.sameFee) return 1;
    return 0;
};

// هل يُجمع a وb؟ يحكم بنافذة الأعلى رسوماً بينهما
function compatible(a, b, now, w) {
    if (a.fee === b.fee) return true;
    const higher = a.fee > b.fee ? a : b;
    const stage = stageOf(higher, now, w);
    if (stage >= 2) return true;
    return stage >= 1 && a.level === b.level;
}

// الأقرب أولاً: نفس الرسوم، ثم فرق المستوى، ثم بُعد الرسوم (نسبةً لا فرقاً)، ثم الأقدم انتظاراً
function closeness(seed, c) {
    const feeGap = Math.abs(Math.log10(c.fee) - Math.log10(seed.fee));
    return [c.fee === seed.fee ? 0 : 1, Math.abs((c.level || 0) - (seed.level || 0)), feeGap, c.joinedAt];
}
const byCloseness = (seed) => (x, y) => {
    const a = closeness(seed, x); const b = closeness(seed, y);
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
    return 0;
};

/**
 * entries: [{ userId, joinedAt, fee, league, level, blocked: [ids] }] لنمط وحجم واحد
 * يُرجع [{ members: [entries], fee }] — fee = الأدنى في المجموعة (المجموعة الناقصة تكتمل ببوتات)
 */
// حسابان على الجهاز نفسه (keychainToken/vendorId) لا يتقابلان — وإلا يلعب صاحبهما ضدّ نفسه ليجمع نجوم الترتيب
const sameDevice = (a, b) => (a.devices || []).some(d => (b.devices || []).includes(d));

function planGroups(entries, { size, now = Date.now(), windows, fillBots = false }) {
    const w = windows;
    const conflict = (a, b) => (a.blocked || []).includes(b.userId) || (b.blocked || []).includes(a.userId) || sameDevice(a, b);
    const pool = [...entries].sort((a, b) => a.joinedAt - b.joinedAt);
    const used = new Set();
    const groups = [];
    for (const seed of pool) {
        if (used.has(seed.userId)) continue;
        const group = [seed];
        const candidates = pool
            .filter(c => c.userId !== seed.userId && !used.has(c.userId) && compatible(seed, c, now, w))
            .sort(byCloseness(seed));
        for (const c of candidates) {
            if (group.length === size) break;
            // كل الأعضاء متوافقون مع المرشّح (رسوماً ونافذةً، وبلا حظر)
            if (group.every(g => !conflict(g, c) && compatible(g, c, now, w))) group.push(c);
        }
        const waitedEnough = fillBots && now - seed.joinedAt >= w.botFill;
        if (group.length < size && !waitedEnough) continue;
        group.forEach(g => used.add(g.userId));
        groups.push({ members: group, fee: Math.min(...group.map(g => g.fee)) });
    }
    return groups;
}

module.exports = { planGroups, compatible, stageOf, sameDevice };
