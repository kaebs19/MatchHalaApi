// MatchHala - تذكير لطيف بلعبة تنتظر ردّك
//
// كل 15 دقيقة: ألعاب حيّة مرّت 6 ساعات على آخر إجراء ولم تنتهِ مهلتها (24س) → push واحد فقط
// لمن ينتظره الطرف الآخر. المطالبة ذرّية (game.reminded) فلا يتكرر التذكير ولا تتنافس نسخ PM2.

const Message = require('../models/Message');
const pushNotificationService = require('../services/pushNotificationService');

const INTERVAL_MS = 15 * 60 * 1000;
const REMIND_AFTER_MS = 6 * 60 * 60 * 1000;
const EXPIRY_MS = 24 * 60 * 60 * 1000;

const TITLES = {
    truth_dare: 'حقيقة أم جرأة',
    would_you_rather: 'هل تفضّل؟',
    never_have_i_ever: 'لم أفعل قط',
    two_truths_lie: 'حقيقتان وكذبة'
};

// من ينتظره الآخرون الآن؟ null = لا أحد (كشف/منتهية)
function waitingOn(game) {
    if (game.status === 'invited') return game.players[1];
    if (game.status !== 'active') return null;
    if (game.kind === 'truth_dare' || game.kind === 'two_truths_lie') return game.turn || null;
    if (game.phase === 'pick') {
        const picked = game.current?.pickedBy || [];
        return game.players.find(p => !picked.includes(p)) || null;
    }
    return null;
}

async function runOnce(now = new Date()) {
    const oldest = new Date(now.getTime() - EXPIRY_MS).toISOString();
    const cutoff = new Date(now.getTime() - REMIND_AFTER_MS).toISOString();

    const candidates = await Message.find({
        type: 'game',
        'game.status': { $in: ['invited', 'active'] },
        'game.reminded': { $ne: true },
        'game.updatedAt': { $lt: cutoff, $gt: oldest }
    }).select('_id game conversation sender').limit(200).lean();

    let sent = 0;
    for (const m of candidates) {
        const target = waitingOn(m.game);
        if (!target) continue;

        // مطالبة ذرّية: من يفوز بها يرسل
        const claimed = await Message.findOneAndUpdate(
            { _id: m._id, 'game.reminded': { $ne: true }, 'game.updatedAt': m.game.updatedAt },
            { $set: { 'game.reminded': true } },
            { projection: { _id: 1 } }
        );
        if (!claimed) continue;

        const waiter = m.game.players.find(p => p !== target);
        try {
            const User = require('../models/User');
            const other = await User.findById(waiter).select('name profileImage').lean();
            const kind = TITLES[m.game.kind] || 'لعبة';
            const name = other?.name || 'صديقك';
            const body = m.game.status === 'invited'
                ? `${name} ينتظر ردّك على دعوة اللعب «${kind}»`
                : `${name} ينتظر دورك في «${kind}» ⏳`;
            await pushNotificationService.sendNewMessageNotification(
                target, name, body, String(m.conversation), other?.profileImage || null, waiter, m._id,
                { title: `🎮 ${kind}`, data: { gameEvent: 'reminder' } }
            );
            sent += 1;
        } catch (err) {
            console.error('🎮 reminder push:', err.message);
        }
    }
    return sent;
}

function startGameReminders() {
    setInterval(() => { runOnce().catch(e => console.error('🎮 reminders:', e.message)); }, INTERVAL_MS);
    console.log('🎮 مذكّر الألعاب يعمل (كل 15 دقيقة)');
}

module.exports = { startGameReminders, runOnce, waitingOn };
