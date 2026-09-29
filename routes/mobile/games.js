// MatchHala - ألعاب المحادثة (حقيقة أم جرأة · هل تفضّل؟)
//
// اللعبة رسالة واحدة type:'game' تتحدّث في مكانها. المنطق كله في
// utils/gameEngine.js؛ هذا الملف يحرس الوصول ويحفظ ويبثّ فقط.
//
// الإجابات النصية تُكتب في المحادثة كرسائل عادية (فتمرّ على فلاتر الكلمات
// المحظورة والترويج) — لا نستقبل هنا أي نص حرّ من اللاعبين.

const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');

const { protect } = require('../../middleware/auth');
const Message = require('../../models/Message');
const Conversation = require('../../models/Conversation');
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
const { KINDS, GameError, createGame, applyAction, isExpired, fallbackText } = require('../../utils/gameEngine');

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

async function pushTurn(recipientId, senderUser, conversationId, messageId, text) {
    try {
        if (await isUserSocketConnected(recipientId)) return;
        await pushNotificationService.sendNewMessageNotification(
            recipientId,
            senderUser.name,
            text,
            String(conversationId),
            getBestUserImage(senderUser),
            senderUser._id,
            messageId
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
        .populate('participants', 'name isActive bannedWords suspension deviceToken profileImage');
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
    if (user.role === 'admin') {
        return { error: { status: 403, body: { success: false, message: 'غير متاح', code: 'GAME_NOT_ALLOWED' } } };
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

function isFullyMessagingRestricted(user) {
    const r = user.restrictions;
    if (!r?.messagingRestricted || r.messagingRestrictedLevel !== 'all') return false;
    return !r.messagingRestrictedUntil || new Date() < r.messagingRestrictedUntil;
}

// ─────────────────────────────────────────────────────────────
// POST /games/start { conversationId, kind }
// ─────────────────────────────────────────────────────────────
router.post('/games/start', protect, async (req, res) => {
    try {
        const { conversationId, kind } = req.body;
        if (!KINDS.includes(kind)) {
            return res.status(400).json({ success: false, message: 'لعبة غير مدعومة', code: 'INVALID_KIND' });
        }
        if (isFullyMessagingRestricted(req.user)) {
            return res.status(403).json({ success: false, message: 'حسابك مقيّد من المراسلة مؤقتاً', code: 'MESSAGING_RESTRICTED' });
        }

        const { conversation, error } = await guardConversation(conversationId, req.user);
        if (error) return res.status(error.status).json(error.body);

        const userId = String(req.user._id);
        const opponent = conversation.participants.find(p => String(p._id) !== userId);

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

        const game = createGame(kind, userId, opponent._id);
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

        pushTurn(opponent._id, req.user, conversation._id, message._id,
            `🎮 يدعوك للعب «${KIND_TITLES[kind]}»`);

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
            result = applyAction(message.game, message.gameSecret, req.user._id, action, { choice, statements, lie, index });
        } catch (err) {
            if (err instanceof GameError) {
                // انتهت بالوقت: نحفظ الحالة المنتهية ونبثّها ثم نردّ 410
                if (err.code === 'GAME_EXPIRED' && err.game) {
                    const saved = await Message.findOneAndUpdate(
                        { _id: messageId, 'game.updatedAt': previousStamp },
                        { $set: { game: err.game, gameSecret: {} } },
                        { new: true }
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
            { new: true }
        ).select('game conversation').lean();
        if (!saved) {
            const fresh = await Message.findById(messageId).select('game').lean();
            return res.status(409).json({
                success: false, message: 'تغيّرت اللعبة — أعد المحاولة', code: 'GAME_CONFLICT',
                data: { game: fresh?.game }
            });
        }

        emitToPlayers(saved.game, 'game-updated', {
            messageId, conversationId: String(saved.conversation), game: saved.game
        });

        if (result.notify && conversation && String(result.notify) !== String(req.user._id)) {
            const text = result.game.status === 'active' && result.game.phase === 'reveal'
                ? '🎮 ظهرت النتيجة!'
                : action === 'accept' ? '🎮 قبل دعوتك — ابدأ اللعب'
                : '🎮 دورك في اللعبة';
            pushTurn(result.notify, req.user, saved.conversation, messageId, text);
        }

        res.json({ success: true, data: { messageId, game: saved.game } });
    } catch (error) {
        console.error('❌ games/action:', error);
        res.status(500).json({ success: false, message: 'تعذّر تنفيذ الإجراء' });
    }
});

module.exports = router;
