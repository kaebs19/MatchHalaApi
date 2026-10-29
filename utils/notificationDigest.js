// MatchHala - الملخّص الدوري للإشعارات
//
// من اختار «ملخّص» لتفاعلات القصص أو الإعجابات أو الزيارات لا يصله push لكل حدث؛ بوابة
// sendNotificationToUser تعدّه في User.notificationDigest. كل 15 دقيقة (instance 0):
// من مرّت 3 ساعات على أول حدث معلّق عنده و8 ساعات على آخر ملخّص ← push واحد:
// «5 تفاعلات على قصتك و3 زيارات لملفك وإعجابان».
// المطالبة ذرّية (بقيمة pendingSince) فلا يتكرر الملخّص. ساعات الهدوء تؤجّله للدورة التالية.

const User = require('../models/User');
const pushNotificationService = require('../services/pushNotificationService');
const { withDefaults } = require('../config/notificationPreferences');

const INTERVAL_MS = 15 * 60 * 1000;
const WAIT_AFTER_FIRST_MS = 3 * 60 * 60 * 1000;
const MIN_GAP_MS = 8 * 60 * 60 * 1000;

// العدّاد ← مفتاح التفضيل وقسمه (يُسقط من الملخّص ما لم يعد «ملخّصاً» منذ عُدّ)
const COUNTERS = {
    reactions: { key: 'storyReactions', section: 'stories' },
    likes: { key: 'likes', section: 'likes' },
    visits: { key: 'visits', section: 'visits' }
};

// العدد مع المعدود بالعربية: واحد / مثنى / 3–10 جمع / 11+ مفرد منصوب
function countPhrase(n, forms) {
    if (n === 1) return forms.one;
    if (n === 2) return forms.two;
    if (n <= 10) return `${n} ${forms.few}`;
    return `${n} ${forms.many}`;
}

const PHRASES = {
    reactions: n => `${countPhrase(n, { one: 'تفاعل واحد', two: 'تفاعلان', few: 'تفاعلات', many: 'تفاعلاً' })} على قصتك`,
    visits: n => `${countPhrase(n, { one: 'زيارة واحدة', two: 'زيارتان', few: 'زيارات', many: 'زيارة' })} لملفك`,
    likes: n => countPhrase(n, { one: 'إعجاب واحد', two: 'إعجابان', few: 'إعجابات', many: 'إعجاباً' })
};

function buildBody(counts) {
    const parts = ['reactions', 'visits', 'likes']
        .filter(k => counts[k] > 0)
        .map(k => PHRASES[k](counts[k]));
    if (parts.length === 0) return null;
    return parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join('، ')} و${parts[parts.length - 1]}`;
}

async function runOnce(now = new Date()) {
    const due = new Date(now.getTime() - WAIT_AFTER_FIRST_MS);
    const gap = new Date(now.getTime() - MIN_GAP_MS);

    const candidates = await User.find({
        'notificationDigest.pendingSince': { $lte: due },
        $or: [
            { 'notificationDigest.lastSentAt': { $exists: false } },
            { 'notificationDigest.lastSentAt': { $lte: gap } }
        ]
    }).select('name notificationDigest notificationPreferences privacySettings.doNotDisturb').limit(500).lean();

    let sent = 0;
    for (const u of candidates) {
        // ساعات الهدوء ← الدورة التالية (العدّادات باقية)
        if (pushNotificationService.isInQuietHours(u)) continue;

        const digest = u.notificationDigest || {};
        const claimed = await User.findOneAndUpdate(
            { _id: u._id, 'notificationDigest.pendingSince': digest.pendingSince },
            {
                $unset: {
                    'notificationDigest.reactions': 1,
                    'notificationDigest.likes': 1,
                    'notificationDigest.visits': 1,
                    'notificationDigest.loud': 1,
                    'notificationDigest.pendingSince': 1
                },
                $set: { 'notificationDigest.lastSentAt': now }
            },
            { projection: { notificationDigest: 1 } }
        ).lean();
        if (!claimed) continue;

        const d = claimed.notificationDigest || {};
        const prefs = withDefaults(u.notificationPreferences || {});
        const counts = {};
        for (const [name, rule] of Object.entries(COUNTERS)) {
            const stillDigest = prefs[rule.key] === 'digest' && prefs.delivery[rule.section] !== 'off';
            counts[name] = stillDigest ? (d[name] || 0) : 0;
        }
        const body = buildBody(counts);
        if (!body) continue;

        // الوجهة: ما فيه أكثر — التطبيق يفتح الإشعارات ثم يوجّه بحسبها
        const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
        try {
            const result = await pushNotificationService.sendNotificationToUser(u._id, {
                title: '✨ ما فاتك في هلا',
                body
            }, {
                type: 'notification_digest',
                quiet: d.loud ? '0' : '1',
                reactions: String(counts.reactions),
                likes: String(counts.likes),
                visits: String(counts.visits),
                focus: top
            }, false);
            if (result?.pushed) sent += 1;
        } catch (err) {
            console.error('🧾 digest push:', err.message);
        }
    }
    return sent;
}

function startNotificationDigest() {
    setInterval(() => {
        runOnce()
            .then(n => { if (n > 0) console.log(`🧾 الملخّص الدوري: أُرسل ${n}`); })
            .catch(e => console.error('🧾 digest:', e.message));
    }, INTERVAL_MS);
    console.log('🧾 الملخّص الدوري يعمل (كل 15 دقيقة)');
}

module.exports = { startNotificationDigest, runOnce, buildBody };
