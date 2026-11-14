// MatchHala - دردشة مباراة هلا لودو (نصّ حرّ — قرار المالك ١٤ نوفمبر ٢٠٢٦)
//
// كل رسالة تمرّ على فلتر الترويج الخارجي والكلمات المحظورة نفسيهما في المحادثات — تُرفض لا تُطمس
// (422 CHAT_BLOCKED)، لأن الطمس يترك أثر محاولة الترويج ظاهراً للخصم. من عليه منع مراسلة كامل أو حظر كلمات
// لا يكتب. آخر CHAT_KEEP رسالة تُحفظ في المباراة (Redis) ثم مع نتيجتها في LudoMatch — للإشراف والبلاغات.

const User = require('../../models/User');
const { LudoError } = require('../ludoEngine');
const store = require('./store');

const MAX_LEN = 80;
const CHAT_KEEP = 60;
const COOLDOWN_MS = 1200;

const clean = (v) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');

function fullyRestricted(user) {
    const r = user?.restrictions;
    if (r?.messagingRestricted && r.messagingRestrictedLevel === 'all'
        && (!r.messagingRestrictedUntil || new Date() < new Date(r.messagingRestrictedUntil))) return true;
    return !!user?.bannedWords?.isBanned;
}

async function blocked(text) {
    const { detectExternalPromotion } = require('../externalPromotionDetector');
    if (detectExternalPromotion(text).detected) return true;
    const { checkBannedWords } = require('../../routes/bannedWords');
    return (await checkBannedWords(text)).hasBannedWords;
}

// يتحقق ويحفظ ويُرجع السطر المنشور { id, playerId, text, at } — البثّ على المستدعي
async function send(userId, gameId, rawText, now = Date.now()) {
    const id = String(userId);
    const text = clean(rawText);
    if (!text) throw new LudoError('CHAT_EMPTY', 'اكتب رسالة', 400);
    if (text.length > MAX_LEN) throw new LudoError('CHAT_TOO_LONG', `الرسالة أطول من ${MAX_LEN} حرفاً`, 400);

    const user = await User.findById(id).select('restrictions bannedWords isActive').lean();
    if (!user || !user.isActive) throw new LudoError('NOT_ALLOWED', 'الحساب غير متاح', 403);
    if (fullyRestricted(user)) throw new LudoError('CHAT_RESTRICTED', 'المراسلة موقوفة على حسابك مؤقتاً', 403);
    if (await blocked(text)) {
        throw new LudoError('CHAT_BLOCKED', 'لا يمكن إرسال هذه الرسالة — بلا روابط أو حسابات خارجية أو كلمات مسيئة', 422);
    }

    return store.withLock(`game:${gameId}`, async () => {
        const record = await store.getGame(String(gameId));
        if (!record || !record.meta.players.some(p => p.id === id && !p.isBot)) {
            throw new LudoError('NOT_IN_GAME', 'لست في هذه المباراة', 403);
        }
        const log = record.meta.chat || [];
        const last = [...log].reverse().find(l => l.playerId === id);
        if (last && now - last.at < COOLDOWN_MS) throw new LudoError('CHAT_COOLDOWN', 'انتظر قليلاً', 429);
        const line = { id: `${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`, playerId: id, text, at: now };
        record.meta.chat = [...log, line].slice(-CHAT_KEEP);
        await store.saveGame(record);
        return { record, line };
    });
}

// 🚩 بلاغ على لاعب من دردشة المباراة ← بلاغ عادي (type user) في «البلاغات» باللوحة، ومعه آخر رسائله في المباراة دليلاً.
// مرة لكل مُبلِّغ/لاعب/مباراة. المباراة المنتهية تُقرأ من LudoMatch (الدردشة تُحفظ مع النتيجة).
const REPORT_CATEGORIES = new Set(['harassment', 'inappropriate_content', 'spam', 'hate_speech', 'other']);
const EVIDENCE_LINES = 10;

async function report(userId, gameId, targetId, category, note) {
    const id = String(userId);
    const target = String(targetId || '');
    if (!REPORT_CATEGORIES.has(category)) throw new LudoError('BAD_REPORT', 'اختر سبب البلاغ', 400);
    if (!target || target === id || target.startsWith('bot:')) throw new LudoError('BAD_REPORT', 'لا يمكن الإبلاغ عن هذا اللاعب', 400);

    let players, chat;
    const record = await store.getGame(String(gameId));
    if (record) {
        players = record.meta.players.map(p => ({ id: p.id, isBot: p.isBot, name: p.name }));
        chat = record.meta.chat || [];
    } else {
        const LudoMatch = require('../../models/LudoMatch');
        const m = await LudoMatch.findOne({ gameId: String(gameId) }).select('players chat').lean();
        if (!m) throw new LudoError('NOT_FOUND', 'المباراة غير موجودة', 404);
        players = (m.players || []).map(p => ({ id: p.user ? String(p.user) : null, isBot: p.isBot }));
        chat = (m.chat || []).map(l => ({ playerId: String(l.playerId || l.user || ''), text: l.text, at: l.at }));
    }
    if (!players.some(p => p.id === id && !p.isBot)) throw new LudoError('NOT_IN_GAME', 'لست في هذه المباراة', 403);
    if (!players.some(p => p.id === target && !p.isBot)) throw new LudoError('BAD_REPORT', 'اللاعب ليس في هذه المباراة', 400);

    const { getClient } = require('../redisClient');
    const redis = await getClient().catch(() => null);
    if (redis) {
        const fresh = await redis.set(`ludo:report:${gameId}:${id}:${target}`, '1', { NX: true, EX: 7 * 86400 });
        if (!fresh) return { already: true };
    }

    const lines = chat.filter(l => String(l.playerId) === target).slice(-EVIDENCE_LINES);
    const fmt = (t) => new Date(Number(t) || Date.now()).toISOString().slice(11, 16);
    const description = [
        `🎲 بلاغ من دردشة مباراة «هلا لودو» (${gameId})`,
        note ? `ملاحظة المُبلِّغ: ${clean(String(note)).slice(0, 300)}` : null,
        lines.length ? `آخر رسائل اللاعب في المباراة:\n${lines.map(l => `[${fmt(l.at)}] ${l.text}`).join('\n')}` : 'لا رسائل نصّية له في المباراة (البلاغ على العبارات/الملصقات أو السلوك).'
    ].filter(Boolean).join('\n\n').slice(0, 1000);

    const Report = require('../../models/Report');
    await Report.create({
        type: 'user', reportedBy: id, reportedUser: target, category, description,
        priority: category === 'harassment' || category === 'hate_speech' ? 'high' : 'medium'
    });
    return { already: false };
}

module.exports = { send, report, constants: { MAX_LEN, CHAT_KEEP, COOLDOWN_MS } };
