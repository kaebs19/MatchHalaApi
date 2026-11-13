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

module.exports = { send, constants: { MAX_LEN, CHAT_KEEP, COOLDOWN_MS } };
