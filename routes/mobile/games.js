// MatchHala - ألعاب المحادثة (حقيقة أم جرأة · هل تفضّل؟ · لم أفعل قط · حقيقتان وكذبة)
//
// اللعبة رسالة واحدة type:'game' تتحدّث في مكانها. المنطق كله في
// utils/gameEngine.js؛ هذا الملف يحرس الوصول ويحفظ ويبثّ فقط.
//
// النصوص الحرّة التي نستقبلها هنا: عبارات «حقيقتان وكذبة» + «أسئلتي» (أسئلة المستخدم).
// كلاهما يمرّ على فلاتر الكلمات المحظورة والترويج قبل الحفظ. الإجابات نفسها تُكتب في
// المحادثة كرسائل عادية فتمرّ على الفلاتر المعتادة.

const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');

const { protect } = require('../../middleware/auth');
const Message = require('../../models/Message');
const Conversation = require('../../models/Conversation');
const GameConfig = require('../../models/GameConfig');
const UserGameQuestion = require('../../models/UserGameQuestion');
const Notification = require('../../models/Notification');
const { getBanks } = require('../../utils/gameBanks');
const pushNotificationService = require('../../services/pushNotificationService');
const {
    getBestUserImage,
    blockGuardForConversation,
    isOtherParticipantDeleted,
    isUserFullyBanned,
    isUserSocketConnected
} = require('./helpers');
const { checkBannedWords } = require('../bannedWords');
const { detectExternalPromotion } = require('../../utils/externalPromotionDetector');
const { KINDS, SOURCES, LEVELS, GameError, createGame, applyAction, isExpired, fallbackText } = require('../../utils/gameEngine');

const START_COOLDOWN_MS = 60 * 1000;

const KIND_TITLES = {
    truth_dare: 'حقيقة أم جرأة',
    would_you_rather: 'هل تفضّل؟',
    never_have_i_ever: 'لم أفعل قط',
    two_truths_lie: 'حقيقتان وكذبة'
};

// النص الحرّ الوحيد في الألعاب: عبارات «حقيقتان وكذبة». نفس فلاتر الرسائل
// (ترويج خارجي + كلمات محظورة) لكن بلا تسجيل مخالفات: نرفض ليعدّل صاحبها.
async function statementsBlocked(statements) {
    if (!Array.isArray(statements)) return false;
    for (const t of statements) {
        if (typeof t !== 'string' || !t.trim()) continue;
        if (detectExternalPromotion(t).detected) return true;
        const banned = await checkBannedWords(t);
        if (banned.hasBannedWords) return true;
    }
    return false;
}

function emitToPlayers(game, event, payload) {
    if (!global.io) return;
    for (const id of game.players) {
        global.io.to(`user:${id}`).emit(event, payload);
    }
}

// نصوص الإشعار (push + تنبيه داخل التطبيق) لكل حدث. null = لا إشعار (رفض/إنهاء يكفيهما تحديث البطاقة).
function gameCopy(event, game, actorName, kindTitle) {
    const title = event === 'invite' ? '🎮 دعوة للعب' : `🎮 ${kindTitle}`;
    const n = actorName || 'صديقك';
    switch (event) {
        case 'invite':
            return {
                title,
                body: `${n} يدعوك للعب «${kindTitle}»${game.level === 'bold' ? ' بمستوى جريء 🌶️' : ''} — اضغط للقبول`
            };
        case 'accept':
            if (game.kind === 'truth_dare') return { title, body: `${n} قبل دعوتك 🎉 ابدأ باختيار حقيقة أو جرأة` };
            if (game.kind === 'two_truths_lie') return { title, body: `${n} قبل دعوتك 🎉 اكتب عباراتك الثلاث` };
            return { title, body: `${n} قبل دعوتك 🎉 اختر إجابتك` };
        case 'done':
        case 'skip':
            return { title, body: `${n} أنهى جولته — دورك الآن` };
        case 'submit':
            return { title, body: `${n} كتب عباراته 🕵️ خمّن أيّها الكذبة` };
        case 'guess':
            return { title, body: `${n} خمّن ${game.current?.correct ? 'صح 🎯' : 'خطأ 😅'} — شاهد النتيجة` };
        case 'pick':
            return game.phase === 'reveal'
                ? { title, body: 'ظهرت النتيجة! شاهد إجابتيكما 🎉' }
                : { title, body: `${n} اختار — بانتظار اختيارك` };
        case 'next':
            return game.kind === 'two_truths_lie'
                ? { title, body: 'جولة جديدة — دورك لكتابة عباراتك ✍️' }
                : { title, body: `${n} فتح سؤالاً جديداً — اختر إجابتك` };
        default:
            return null;
    }
}

async function pushGame(recipientId, senderUser, conversationId, messageId, copy, event) {
    try {
        if (!copy) return;
        if (await isUserSocketConnected(recipientId)) return;   // متصل: يصله تنبيه داخل التطبيق
        await pushNotificationService.sendNewMessageNotification(
            recipientId,
            senderUser.name,
            copy.body,
            String(conversationId),
            getBestUserImage(senderUser),
            senderUser._id,
            messageId,
            { title: copy.title, data: { gameEvent: event } }
        );
    } catch (err) {
        console.error('🎮 push error:', err.message);
    }
}

// حارس الوصول المشترك: عضو + محادثة مقبولة نشطة + بلا حظر + الطرف الآخر سليم.
// يُرجع { error:{status,body} } أو { conversation }.
async function guardConversation(conversationId, user) {
    if (!mongoose.isValidObjectId(conversationId)) {
        return { error: { status: 400, body: { success: false, message: 'معرّف غير صالح' } } };
    }
    const conversation = await Conversation.findById(conversationId)
        .populate('participants', 'name isActive bannedWords suspension deviceToken profileImage birthDate');
    if (!conversation) {
        return { error: { status: 404, body: { success: false, message: 'المحادثة غير موجودة' } } };
    }
    const userId = String(user._id);
    if (!conversation.participants.some(p => String(p._id) === userId)) {
        return { error: { status: 403, body: { success: false, message: 'ليس لديك صلاحية لهذه المحادثة' } } };
    }
    if (conversation.participants.length !== 2) {
        return { error: { status: 400, body: { success: false, message: 'الألعاب للمحادثات الثنائية فقط', code: 'GAME_NOT_SUPPORTED' } } };
    }
    if (await isOtherParticipantDeleted(conversation, userId)) {
        return { error: { status: 410, body: { success: false, message: 'تم حذف حساب هذا المستخدم', code: 'USER_DELETED' } } };
    }
    const blockGuard = await blockGuardForConversation(conversation, userId);
    if (blockGuard) return { error: { status: 403, body: blockGuard } };

    const otherBanned = conversation.participants.some(
        p => String(p._id) !== userId && isUserFullyBanned(p)
    );
    if (otherBanned) {
        return { error: { status: 403, body: { success: false, message: 'الحساب غير متاح', code: 'RECIPIENT_SUSPENDED' } } };
    }
    if (conversation.status !== 'accepted' || !conversation.isActive) {
        return { error: { status: 400, body: { success: false, message: 'الألعاب متاحة في المحادثات المقبولة فقط', code: 'CONVERSATION_INACTIVE' } } };
    }
    return { conversation };
}

function ageOf(birthDate) {
    if (!birthDate) return 0;
    return Math.floor((Date.now() - new Date(birthDate).getTime()) / (365.25 * 24 * 60 * 60 * 1000));
}

// سياق الأسئلة لإجراء: بنوك المستوى + أسئلة اللاعبين الخاصة (فقط عند الحاجة لسحب سؤال)
const DRAW_ACTIONS = ['accept', 'choose', 'swap', 'next'];
async function buildCtx(game, action) {
    const banks = await getBanks(game.level === 'bold' ? 'bold' : 'light');
    const custom = {};
    if ((game.source || 'default') !== 'default' && DRAW_ACTIONS.includes(action)) {
        const rows = await UserGameQuestion.find({
            owner: { $in: game.players },
            active: true,
            // pending_review: اقتراحه للجميع لا يعطّل استخدامه الشخصي
            status: { $in: ['active', 'pending_review', 'approved'] }
        }).select('owner bank ar en a b').lean();
        for (const r of rows) {
            const owner = String(r.owner);
            custom[owner] = custom[owner] || { truth: [], dare: [], wyr: [], never: [] };
            custom[owner][r.bank].push(r.bank === 'wyr'
                ? { id: `u:${r._id}`, a: r.a, b: r.b }
                : { id: `u:${r._id}`, ar: r.ar, en: r.en });
        }
    }
    return { banks, custom };
}

function isFullyMessagingRestricted(user) {
    const r = user.restrictions;
    if (!r?.messagingRestricted || r.messagingRestrictedLevel !== 'all') return false;
    return !r.messagingRestrictedUntil || new Date() < r.messagingRestrictedUntil;
}

// ─────────────────────────────────────────────────────────────
// GET /games/config — الألعاب المتاحة الآن (تُدار من لوحة التحكم)
// ─────────────────────────────────────────────────────────────
router.get('/games/config', protect, async (req, res) => {
    try {
        const config = await GameConfig.getConfig();
        res.json({ success: true, data: { enabledKinds: config.enabledKinds } });
    } catch (error) {
        console.error('❌ games/config:', error);
        res.status(500).json({ success: false, message: 'تعذّر جلب الإعدادات' });
    }
});

// ─────────────────────────────────────────────────────────────
// POST /games/start { conversationId, kind }
// ─────────────────────────────────────────────────────────────
router.post('/games/start', protect, async (req, res) => {
    try {
        const { conversationId, kind } = req.body;
        const level = req.body.level || 'light';
        const source = req.body.source || 'default';
        if (!LEVELS.includes(level) || !SOURCES.includes(source)) {
            return res.status(400).json({ success: false, message: 'خيار غير صالح', code: 'INVALID_OPTION' });
        }
        if (!KINDS.includes(kind)) {
            return res.status(400).json({ success: false, message: 'لعبة غير مدعومة', code: 'INVALID_KIND' });
        }
        const gameConfig = await GameConfig.getConfig();
        if (!gameConfig.enabledKinds.includes(kind)) {
            return res.status(403).json({ success: false, message: 'هذه اللعبة غير متاحة حالياً', code: 'GAME_DISABLED' });
        }
        if (isFullyMessagingRestricted(req.user)) {
            return res.status(403).json({ success: false, message: 'حسابك مقيّد من المراسلة مؤقتاً', code: 'MESSAGING_RESTRICTED' });
        }

        const { conversation, error } = await guardConversation(conversationId, req.user);
        if (error) return res.status(error.status).json(error.body);

        const userId = String(req.user._id);
        const opponent = conversation.participants.find(p => String(p._id) !== userId);

        // 🌶️ المستوى الجريء: للبالغين فقط (الطرفان 18+)، وبقبول الدعوة يوافق الطرف الآخر
        if (level === 'bold' && !conversation.participants.every(p => ageOf(p.birthDate) >= 18)) {
            return res.status(403).json({ success: false, message: 'المستوى الجريء للبالغين فقط (18+) من الطرفين', code: 'BOLD_AGE_RESTRICTED' });
        }

        // لعبة واحدة حيّة في المحادثة. المنتهية بالوقت تُغلق كسلاً ثم نكمل.
        const live = await Message.findOne({
            conversation: conversation._id,
            type: 'game',
            'game.status': { $in: ['invited', 'active'] }
        }).select('game');
        if (live) {
            if (isExpired(live.game)) {
                live.game = { ...live.game, status: 'ended', endedBy: 'timeout', turn: null, phase: null, updatedAt: new Date().toISOString() };
                live.markModified('game');
                await live.save();
                emitToPlayers(live.game, 'game-updated', {
                    messageId: String(live._id), conversationId: String(conversation._id), game: live.game
                });
            } else {
                return res.status(409).json({
                    success: false,
                    message: 'هناك لعبة جارية في هذه المحادثة',
                    code: 'GAME_ALREADY_ACTIVE',
                    data: { messageId: String(live._id) }
                });
            }
        }

        // مهلة بين الدعوات — يمنع قصف الطرف الآخر بدعوة → رفض → دعوة
        const recent = await Message.exists({
            conversation: conversation._id,
            sender: req.user._id,
            type: 'game',
            createdAt: { $gte: new Date(Date.now() - START_COOLDOWN_MS) }
        });
        if (recent) {
            return res.status(429).json({ success: false, message: 'انتظر قليلاً قبل دعوة جديدة', code: 'GAME_COOLDOWN' });
        }

        const game = createGame(kind, userId, opponent._id, new Date(), { level, source });
        const message = await Message.create({
            conversation: conversation._id,
            sender: req.user._id,
            type: 'game',
            content: fallbackText(kind),
            status: 'sent',
            game,
            gameSecret: {}
        });

        await Conversation.updateOne(
            { _id: conversation._id },
            {
                $set: { lastMessage: message._id },
                $inc: { 'metadata.totalMessages': 1 },
                $pull: { hiddenFor: { user: { $ne: req.user._id }, reason: { $ne: 'block' } } }
            }
        );

        const populated = await Message.findById(message._id)
            .populate('sender', 'name email profileImage isPremium isActive verification.isVerified')
            .lean();

        if (global.io) {
            for (const p of conversation.participants) {
                global.io.to(`user:${p._id}`).emit('new-message', { message: populated });
            }
        }

        pushGame(opponent._id, req.user, conversation._id, message._id,
            gameCopy('invite', game, req.user.name, KIND_TITLES[kind]), 'invite');

        res.status(201).json({ success: true, data: { message: populated } });
    } catch (error) {
        console.error('❌ games/start:', error);
        res.status(500).json({ success: false, message: 'تعذّر بدء اللعبة' });
    }
});

// ─────────────────────────────────────────────────────────────
// POST /games/:messageId/action { action, choice? }
// ─────────────────────────────────────────────────────────────
router.post('/games/:messageId/action', protect, async (req, res) => {
    try {
        const { messageId } = req.params;
        const { action, choice, statements, lie, index } = req.body;
        if (!mongoose.isValidObjectId(messageId)) {
            return res.status(400).json({ success: false, message: 'معرّف غير صالح' });
        }

        const message = await Message.findById(messageId).select('+gameSecret');
        if (!message || message.type !== 'game' || !message.game) {
            return res.status(404).json({ success: false, message: 'اللعبة غير موجودة' });
        }

        // إنهاء لعبة ينبغي أن يبقى ممكناً حتى لو الحظر/التقييد قائم — لا نحبس أحداً في لعبة.
        const { conversation, error } = await guardConversation(message.conversation, req.user);
        if (error && action !== 'end') return res.status(error.status).json(error.body);

        if (action === 'submit' && await statementsBlocked(statements)) {
            return res.status(422).json({
                success: false,
                message: 'إحدى العبارات تحتوي محتوى غير مسموح — عدّلها وأعد المحاولة',
                code: 'GAME_TEXT_BLOCKED'
            });
        }

        const previousStamp = message.game.updatedAt;
        let result;
        try {
            result = applyAction(message.game, message.gameSecret, req.user._id, action,
                { choice, statements, lie, index }, new Date(), Math.random, await buildCtx(message.game, action));
        } catch (err) {
            if (err instanceof GameError) {
                // انتهت بالوقت: نحفظ الحالة المنتهية ونبثّها ثم نردّ 410
                if (err.code === 'GAME_EXPIRED' && err.game) {
                    const saved = await Message.findOneAndUpdate(
                        { _id: messageId, 'game.updatedAt': previousStamp },
                        { $set: { game: err.game, gameSecret: {} } },
                        { returnDocument: 'after' }
                    ).select('game conversation').lean();
                    if (saved) {
                        emitToPlayers(saved.game, 'game-updated', {
                            messageId, conversationId: String(saved.conversation), game: saved.game
                        });
                    }
                    return res.status(410).json({ success: false, message: err.message, code: err.code, data: { game: err.game } });
                }
                return res.status(err.status).json({
                    success: false,
                    message: err.message,
                    code: err.code,
                    data: { game: message.game }   // يعيد العميل مزامنة حالته
                });
            }
            throw err;
        }

        // كتابة متفائلة: تفشل لو تحرّكت اللعبة بين القراءة والكتابة (ضغطتان معاً)
        const saved = await Message.findOneAndUpdate(
            { _id: messageId, 'game.updatedAt': previousStamp },
            { $set: { game: result.game, gameSecret: result.secret } },
            { returnDocument: 'after' }
        ).select('game conversation').lean();
        if (!saved) {
            const fresh = await Message.findById(messageId).select('game').lean();
            return res.status(409).json({
                success: false, message: 'تغيّرت اللعبة — أعد المحاولة', code: 'GAME_CONFLICT',
                data: { game: fresh?.game }
            });
        }

        // من يُنبَّه؟ من انتقل إليه الدور/المطلوب منه فعل — يحمل الحدث نصّ التنبيه ليعرضه التطبيق
        // داخلياً إن لم تكن المحادثة مفتوحة، ويُرسَل push فقط لغير المتصل.
        const notifyUser = result.notify && String(result.notify) !== String(req.user._id) ? String(result.notify) : null;
        const copy = notifyUser ? gameCopy(action, saved.game, req.user.name, KIND_TITLES[saved.game.kind]) : null;

        emitToPlayers(saved.game, 'game-updated', {
            messageId,
            conversationId: String(saved.conversation),
            game: saved.game,
            event: action,
            actorId: String(req.user._id),
            notifyUser: copy ? notifyUser : null,
            notifyTitle: copy?.title || null,
            notifyBody: copy?.body || null
        });

        if (copy && conversation) {
            pushGame(notifyUser, req.user, saved.conversation, messageId, copy, action);
        }

        res.json({ success: true, data: { messageId, game: saved.game } });
    } catch (error) {
        console.error('❌ games/action:', error);
        res.status(500).json({ success: false, message: 'تعذّر تنفيذ الإجراء' });
    }
});

// ─────────────────────────────────────────────────────────────
// POST /games/:messageId/react { emoji } — تفاعل سريع على النتيجة/آخر جولة
// ذرّي ولا يمسّ updatedAt: لا يتعارض مع إجراءات اللعب ولا يمدّ مهلة الـ 24 ساعة.
// الضغط على نفس الإيموجي مرة ثانية يسحب التفاعل.
// ─────────────────────────────────────────────────────────────
const REACTION_EMOJIS = ['😂', '🔥', '😮', '🙈', '👏', '✋', '😎', '❤️'];

router.post('/games/:messageId/react', protect, async (req, res) => {
    try {
        const { messageId } = req.params;
        const { emoji } = req.body;
        if (!mongoose.isValidObjectId(messageId)) {
            return res.status(400).json({ success: false, message: 'معرّف غير صالح' });
        }
        if (!REACTION_EMOJIS.includes(emoji)) {
            return res.status(400).json({ success: false, message: 'تفاعل غير مدعوم', code: 'INVALID_REACTION' });
        }

        const message = await Message.findById(messageId).select('game conversation type');
        if (!message || message.type !== 'game' || !message.game) {
            return res.status(404).json({ success: false, message: 'اللعبة غير موجودة' });
        }
        const game = message.game;
        const userId = String(req.user._id);
        if (!game.players.includes(userId)) {
            return res.status(403).json({ success: false, message: 'لست طرفاً في هذه اللعبة' });
        }
        if (game.status !== 'active' || isExpired(game)) {
            return res.status(409).json({ success: false, message: 'انتهت اللعبة', code: 'GAME_ENDED' });
        }
        const reactable = (game.kind === 'truth_dare' && game.last) || game.phase === 'reveal';
        if (!reactable) {
            return res.status(409).json({ success: false, message: 'لا يوجد ما يُتفاعل عليه الآن', code: 'NOT_REACTABLE' });
        }

        const toggleOff = game.reactions?.[userId] === emoji;
        const update = toggleOff
            ? { $unset: { [`game.reactions.${userId}`]: '' } }
            : { $set: { [`game.reactions.${userId}`]: emoji } };
        const saved = await Message.findOneAndUpdate(
            { _id: messageId, 'game.updatedAt': game.updatedAt },   // نفس الجولة
            update,
            { returnDocument: 'after' }
        ).select('game conversation').lean();
        if (!saved) {
            return res.status(409).json({ success: false, message: 'تغيّرت اللعبة', code: 'GAME_CONFLICT' });
        }

        emitToPlayers(saved.game, 'game-updated', {
            messageId, conversationId: String(saved.conversation), game: saved.game,
            event: 'react', actorId: userId
        });
        res.json({ success: true, data: { messageId, game: saved.game } });
    } catch (error) {
        console.error('❌ games/react:', error);
        res.status(500).json({ success: false, message: 'تعذّر إرسال التفاعل' });
    }
});

// ─────────────────────────────────────────────────────────────
// GET /games/history/:conversationId — سجلّ ألعاب المحادثة
// ─────────────────────────────────────────────────────────────
router.get('/games/history/:conversationId', protect, async (req, res) => {
    try {
        const { conversationId } = req.params;
        if (!mongoose.isValidObjectId(conversationId)) {
            return res.status(400).json({ success: false, message: 'معرّف غير صالح' });
        }
        const conversation = await Conversation.findById(conversationId).select('participants').lean();
        if (!conversation || !conversation.participants.some(p => String(p) === String(req.user._id))) {
            return res.status(403).json({ success: false, message: 'ليس لديك صلاحية لهذه المحادثة' });
        }
        const rows = await Message.find({ conversation: conversationId, type: 'game', isDeleted: { $ne: true } })
            .sort({ createdAt: -1 }).limit(40).select('game createdAt').lean();
        const items = rows.map(r => ({
            id: String(r._id),
            kind: r.game.kind,
            level: r.game.level || 'light',
            status: isExpired(r.game) ? 'ended' : r.game.status,
            rounds: r.game.round || 0,
            stats: r.game.stats || {},
            endedBy: r.game.endedBy || null,
            createdAt: r.createdAt
        }));
        res.json({ success: true, data: { items } });
    } catch (error) {
        console.error('❌ games/history:', error);
        res.status(500).json({ success: false, message: 'تعذّر جلب السجل' });
    }
});

// ─────────────────────────────────────────────────────────────
// «أسئلتي» — أسئلة يكتبها المستخدم لألعابه
// ─────────────────────────────────────────────────────────────
const MY_QUESTIONS_LIMIT = 20;
const MY_QUESTION_MAX_LEN = 120;
const BANK_IDS = ['truth', 'dare', 'wyr', 'never'];
const cleanText = (v) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '');

// يبني حقول السؤال من الجسم أو يرجع { error }
function buildUserQuestion(bank, body) {
    if (!BANK_IDS.includes(bank)) return { error: 'نوع سؤال غير صالح' };
    const fields = bank === 'wyr'
        ? { a: { ar: cleanText(body.a?.ar), en: cleanText(body.a?.en) }, b: { ar: cleanText(body.b?.ar), en: cleanText(body.b?.en) } }
        : { ar: cleanText(body.ar), en: cleanText(body.en) };
    const texts = bank === 'wyr'
        ? [fields.a.ar, fields.a.en, fields.b.ar, fields.b.en]
        : [fields.ar, fields.en];
    const required = bank === 'wyr' ? [fields.a.ar, fields.b.ar] : [fields.ar];
    if (required.some(t => !t)) return { error: bank === 'wyr' ? 'اكتب الخيارين' : 'اكتب نص السؤال' };
    if (texts.some(t => t.length > MY_QUESTION_MAX_LEN)) return { error: `الحد الأقصى ${MY_QUESTION_MAX_LEN} حرفاً` };
    return { fields, texts: texts.filter(Boolean) };
}

const OWNER_VISIBLE = ['active', 'pending_review', 'approved', 'reported'];

// 3 أسئلة مُبلَّغ عنها خلال 30 يوماً → إيقاف إضافة أسئلة جديدة 7 أيام من آخر بلاغ
const STRIKE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const STRIKE_LIMIT = 3;
const SUSPEND_MS = 7 * 24 * 60 * 60 * 1000;

// يرجع تاريخ انتهاء الإيقاف إن كان المستخدم موقوفاً عن إضافة أسئلة، وإلا null
async function questionsSuspendedUntil(ownerId) {
    const recent = await UserGameQuestion.find({
        owner: ownerId,
        reportedAt: { $gte: new Date(Date.now() - STRIKE_WINDOW_MS) }
    }).select('reportedAt').sort({ reportedAt: -1 }).lean();
    if (recent.length < STRIKE_LIMIT) return null;
    const until = new Date(new Date(recent[0].reportedAt).getTime() + SUSPEND_MS);
    return until > new Date() ? until : null;
}

// إشعار صاحب السؤال: سجلّ ظاهر في تبويب الإشعارات + push حرِج (غير إداري، يتجاوز الكتم)
async function notifyQuestionOwner(ownerId, title, body, extra = {}) {
    try {
        await Notification.create({
            title, body, type: 'system', recipients: 'specific', targetUsers: [ownerId],
            data: { type: 'game_question_reported', ...extra }, status: 'sent', sentAt: new Date()
        });
        await pushNotificationService.sendNotificationToUser(
            ownerId, { title, body }, { type: 'report_alert', ...extra }, false
        );
    } catch (err) {
        console.error('🎮 notify question owner:', err.message);
    }
}

router.get('/games/my-questions', protect, async (req, res) => {
    try {
        const items = await UserGameQuestion.find({ owner: req.user._id, status: { $in: OWNER_VISIBLE } })
            .sort({ createdAt: -1 }).select('-reports').lean();
        res.json({ success: true, data: { items, limit: MY_QUESTIONS_LIMIT } });
    } catch (error) {
        console.error('❌ games/my-questions list:', error);
        res.status(500).json({ success: false, message: 'تعذّر جلب أسئلتك' });
    }
});

router.post('/games/my-questions', protect, async (req, res) => {
    try {
        const { bank } = req.body;
        const { fields, texts, error } = buildUserQuestion(bank, req.body);
        if (error) return res.status(400).json({ success: false, message: error });

        if (isFullyMessagingRestricted(req.user)) {
            return res.status(403).json({ success: false, message: 'حسابك مقيّد مؤقتاً', code: 'MESSAGING_RESTRICTED' });
        }
        if (await statementsBlocked(texts)) {
            return res.status(422).json({ success: false, message: 'النص يحتوي محتوى غير مسموح — عدّله وأعد المحاولة', code: 'GAME_TEXT_BLOCKED' });
        }

        const suspendedUntil = await questionsSuspendedUntil(req.user._id);
        if (suspendedUntil) {
            return res.status(403).json({
                success: false,
                message: 'أُوقفت إضافة أسئلة جديدة مؤقتاً بسبب بلاغات على أسئلتك السابقة',
                code: 'QUESTIONS_SUSPENDED',
                data: { until: suspendedUntil.toISOString() }
            });
        }

        const count = await UserGameQuestion.countDocuments({ owner: req.user._id, status: { $in: OWNER_VISIBLE } });
        if (count >= MY_QUESTIONS_LIMIT) {
            return res.status(403).json({ success: false, message: `الحد الأقصى ${MY_QUESTIONS_LIMIT} سؤالاً — احذف سؤالاً لإضافة جديد`, code: 'QUESTION_LIMIT' });
        }
        const dupQuery = bank === 'wyr'
            ? { 'a.ar': fields.a.ar, 'b.ar': fields.b.ar }
            : { ar: fields.ar };
        if (await UserGameQuestion.exists({ owner: req.user._id, bank, status: { $in: OWNER_VISIBLE }, ...dupQuery })) {
            return res.status(409).json({ success: false, message: 'أضفت هذا السؤال من قبل', code: 'DUPLICATE_QUESTION' });
        }

        const created = await UserGameQuestion.create({ owner: req.user._id, bank, ...fields });
        res.status(201).json({ success: true, data: { item: created.toObject() } });
    } catch (error) {
        console.error('❌ games/my-questions create:', error);
        res.status(500).json({ success: false, message: 'تعذّر حفظ السؤال' });
    }
});

async function ownedQuestion(req, res) {
    if (!mongoose.isValidObjectId(req.params.id)) {
        res.status(400).json({ success: false, message: 'معرّف غير صالح' });
        return null;
    }
    const q = await UserGameQuestion.findOne({ _id: req.params.id, owner: req.user._id, status: { $in: OWNER_VISIBLE } });
    if (!q) res.status(404).json({ success: false, message: 'السؤال غير موجود' });
    return q;
}

router.put('/games/my-questions/:id', protect, async (req, res) => {
    try {
        const q = await ownedQuestion(req, res);
        if (!q) return;

        if (typeof req.body.active === 'boolean') q.active = req.body.active;
        const hasText = ['ar', 'en', 'a', 'b'].some(k => req.body[k] !== undefined);
        if (hasText) {
            if (q.status === 'reported') {
                return res.status(409).json({ success: false, message: 'السؤال معطّل بسبب بلاغ — احذفه وأنشئ غيره', code: 'QUESTION_REPORTED' });
            }
            const { fields, texts, error } = buildUserQuestion(q.bank, req.body);
            if (error) return res.status(400).json({ success: false, message: error });
            if (await statementsBlocked(texts)) {
                return res.status(422).json({ success: false, message: 'النص يحتوي محتوى غير مسموح — عدّله وأعد المحاولة', code: 'GAME_TEXT_BLOCKED' });
            }
            Object.assign(q, fields);
            if (q.status === 'pending_review') q.status = 'active';   // تغيّر النص → يُسحب الاقتراح
        }
        await q.save();
        res.json({ success: true, data: { item: q.toObject() } });
    } catch (error) {
        console.error('❌ games/my-questions update:', error);
        res.status(500).json({ success: false, message: 'تعذّر الحفظ' });
    }
});

router.delete('/games/my-questions/:id', protect, async (req, res) => {
    try {
        const q = await ownedQuestion(req, res);
        if (!q) return;
        if (q.status === 'reported') {
            // المُبلَّغ عنه لا يُحذف فعلياً: يبقى سجلّ البلاغ (وعدّاد المخالفات) للأدمن
            q.status = 'rejected';
            q.active = false;
            await q.save();
        } else {
            await q.deleteOne();
        }
        res.json({ success: true });
    } catch (error) {
        console.error('❌ games/my-questions delete:', error);
        res.status(500).json({ success: false, message: 'تعذّر الحذف' });
    }
});

// اقترح للجميع → قائمة مراجعة الأدمن
router.post('/games/my-questions/:id/suggest', protect, async (req, res) => {
    try {
        const q = await ownedQuestion(req, res);
        if (!q) return;
        if (q.status !== 'active') {
            return res.status(409).json({ success: false, message: 'لا يمكن اقتراح هذا السؤال الآن', code: 'NOT_SUGGESTABLE' });
        }
        q.status = 'pending_review';
        await q.save();
        res.json({ success: true, data: { item: q.toObject() } });
    } catch (error) {
        console.error('❌ games/my-questions suggest:', error);
        res.status(500).json({ success: false, message: 'تعذّر الاقتراح' });
    }
});

// بلاغ عن سؤال مخصّص ظهر في لعبة: يُعطَّل فوراً ويُرفع للأدمن
router.post('/games/report-question', protect, async (req, res) => {
    try {
        const { questionId, messageId } = req.body;
        const raw = typeof questionId === 'string' && questionId.startsWith('u:') ? questionId.slice(2) : '';
        if (!mongoose.isValidObjectId(raw)) {
            return res.status(400).json({ success: false, message: 'سؤال غير صالح' });
        }
        // المُبلِّغ لاعب في لعبة (تمنع بلاغات عشوائية على أسئلة لم يرها)
        if (!mongoose.isValidObjectId(messageId)) {
            return res.status(400).json({ success: false, message: 'لعبة غير صالحة' });
        }
        const message = await Message.findById(messageId).select('game type').lean();
        if (!message || message.type !== 'game' || !message.game?.players?.includes(String(req.user._id))) {
            return res.status(403).json({ success: false, message: 'غير مصرّح' });
        }

        const q = await UserGameQuestion.findById(raw);
        if (!q) return res.status(404).json({ success: false, message: 'السؤال غير موجود' });
        if (String(q.owner) === String(req.user._id)) {
            return res.status(400).json({ success: false, message: 'لا يمكنك الإبلاغ عن سؤالك' });
        }
        if (!q.reports.some(r => String(r.by) === String(req.user._id))) q.reports.push({ by: req.user._id });
        const firstReport = q.status !== 'reported';
        if (firstReport) {
            q.status = 'reported';
            q.reportedAt = new Date();
        }
        await q.save();

        // أبلِغ صاحب السؤال (مرة عند أول بلاغ)، وأخبره لو بلغ حدّ الإيقاف المؤقت
        if (firstReport) {
            const suspendedUntil = await questionsSuspendedUntil(q.owner);
            if (suspendedUntil) {
                await notifyQuestionOwner(
                    q.owner,
                    'تنبيه بخصوص أسئلتك في الألعاب',
                    'تلقّت أسئلتك عدة بلاغات، لذا أُوقفت إضافة أسئلة جديدة لمدة 7 أيام. يرجى الالتزام بقواعد الاستخدام.',
                    { questionId: String(q._id), suspended: true }
                );
            } else {
                await notifyQuestionOwner(
                    q.owner,
                    'تنبيه بخصوص أسئلتك في الألعاب',
                    'عُطّل أحد أسئلتك بعد بلاغ من لاعب وسيراجعه فريق الإدارة. تكرار البلاغات قد يوقف إضافة أسئلة جديدة.',
                    { questionId: String(q._id), suspended: false }
                );
            }
        }

        if (global.io) {
            global.io.to('admin-dashboard').emit('game-question-reported', { questionId: String(q._id), bank: q.bank });
        }
        res.json({ success: true });
    } catch (error) {
        console.error('❌ games/report-question:', error);
        res.status(500).json({ success: false, message: 'تعذّر الإبلاغ' });
    }
});

module.exports = router;
