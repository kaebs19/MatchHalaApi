// MatchHala - تنبيه أمان للطرف الآخر عند محاولة مشاركة حسابات خارجية
//
// عند حجب رسالة فيها حساب خارجي (Snap/Insta/رقم…) يرى الطرف المتلقّي بطاقة تنبيه قصيرة في المحادثة:
// المرسل قد يكون محتالاً، والمنع لحمايته لا لتقييده. رسالة نظام JSON:
//   { action:'external_promo_warning', forUser:<المتلقّي>, titleAr/En, textAr/En }
// - forUser: التطبيق يرسمها لصاحبها فقط (تُخفى عن المرسل)؛ الإصدارات القديمة تقرأ textAr/textEn فقط.
// - مرة واحدة كل 12 ساعة لكل (مرسل، محادثة) كي لا تتكرر مع كل رسالة.
// - لا تُحدِّث lastMessage ولا تُرسَل push: الرسالة المحجوبة نفسها تصل المتلقّي أصلاً.

const Message = require('../models/Message');

const COOLDOWN_MS = 12 * 60 * 60 * 1000;
const ACTION = 'external_promo_warning';

const COPY = {
    titleAr: 'تنبيه أمان',
    titleEn: 'Safety notice',
    textAr: 'حاول هذا المستخدم مشاركة حسابات خارجية، وقد يكون حساب نصب أو احتيال. تفاعلك معه على مسؤوليتك الشخصية. نمنع هذه الحسابات لحمايتك، لا لتقييدك.',
    textEn: 'This user tried to share external accounts, which can be a sign of a scam. Interacting with them is at your own responsibility. We block these accounts to protect you, not to restrict you.'
};

// يُرجع رسالة النظام المُنشأة، أو null (داخل فترة الهدوء / لا مستلمين)
async function createExternalPromoNotice(conversationId, senderId, recipientIds) {
    const recipients = (recipientIds || []).map(String).filter(id => id !== String(senderId));
    if (recipients.length === 0) return null;

    const recent = await Message.exists({
        conversation: conversationId,
        sender: senderId,
        type: 'system',
        content: { $regex: `"action":"${ACTION}"` },
        createdAt: { $gte: new Date(Date.now() - COOLDOWN_MS) }
    });
    if (recent) return null;

    // المحادثات ثنائية: مستلم واحد. (لو تعدّدوا يُنشأ للأول فقط — لا توجد محادثات جماعية هنا.)
    const message = await Message.create({
        conversation: conversationId,
        sender: senderId,
        type: 'system',
        content: JSON.stringify({ action: ACTION, forUser: recipients[0], ...COPY })
    });

    if (global.io) {
        const payload = { message: message.toObject(), conversationId: String(conversationId) };
        global.io.to(`user:${recipients[0]}`).emit('new-message', payload);
    }
    return message;
}

module.exports = { createExternalPromoNotice, ACTION, COPY };
