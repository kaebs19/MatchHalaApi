// MatchHala - الوسائط المؤقتة (الصور المؤقتة + فيديو المحادثة)
//
// ملف الوسيط المنتهي يُنقل إلى uploads/_expired (أرشيف الأدمن، محجوب في Nginx) — الإشراف يحتاجه
// في البلاغات — ويُحذف نهائياً بعد 30 يوماً إلا ما يخصّ بلاغاً مفتوحاً (utils/expiredArchiveCleaner.js).
// رابطه في الرسالة يصير null.
//
// الصور: تُدمَّر كسلاً عند القراءة/المحاولة (destroyDisappearingIfDue).
// الفيديو: كنس دوري أيضاً (startEphemeralSweeper) — فيديو «24 ساعة» قد لا يفتح
//          أحد محادثته بعد انقضائه، وملفه يجب ألا يبقى مُتاحاً.

const fs = require('fs');
const path = require('path');
const Message = require('../models/Message');
const DisappearingHold = require('../models/DisappearingHold');

const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');
const EXPIRED_DIR = path.join(UPLOADS_DIR, '_expired');

// ↩️ مهلة إعادة الفتح لمشترك هلا+ بعد انتهاء المشاهدة الأولى
const REPLAY_WINDOW_SECONDS = 10 * 60;

// ✅ نقل ملف وسيط مؤقت منتهٍ إلى أرشيف الأدمن.
//    يُرجع المسار النسبي داخل الأرشيف، أو null لو تعذّر.
function archiveDisappearingFile(mediaUrl) {
    try {
        if (!mediaUrl) return null;
        const url = String(mediaUrl).split('?')[0];
        const fileName = path.basename(url);
        if (!fileName) return null;

        // الفيديو في uploads/ephemeral، الصور المؤقتة في uploads/messages
        const sourceDir = url.includes('/uploads/ephemeral/') ? 'ephemeral' : 'messages';
        const source = path.join(UPLOADS_DIR, sourceDir, fileName);
        if (!fs.existsSync(source)) return null;

        fs.mkdirSync(EXPIRED_DIR, { recursive: true });
        fs.renameSync(source, path.join(EXPIRED_DIR, fileName));
        return `_expired/${fileName}`;
    } catch (e) {
        // لا نُفشل الطلب — الأهم أن mediaUrl أُبطل في قاعدة البيانات
        console.error('⚠️ أرشفة الوسيط المؤقت فشلت:', e.message);
        return null;
    }
}

// ✅ تدمير وسيط مؤقت انقضى وقته — بغضّ النظر عن كون العارض مفتوحاً.
//    المدة تُحسب بساعة الحائط (expiresAt)، فلو أغلق المستخدم العارض مبكراً
//    ثم انقضت المدة وهو خارجها يجب أن يُدمَّر أيضاً.
//    يُرجع true لو دُمِّر الآن.
async function destroyDisappearingIfDue(message) {
    const d = message?.disappearing;
    if (!d?.enabled || d.destroyed) return false;
    if (!d.expiresAt) return false;
    // ↩️ المحجوز لإعادة الفتح يبقى حتى انقضاء مهلتها
    const dueAt = d.replayUntil && new Date(d.replayUntil) > new Date(d.expiresAt) ? d.replayUntil : d.expiresAt;
    if (new Date(dueAt) > new Date()) return false;

    const archived = archiveDisappearingFile(message.mediaUrl);
    d.destroyed = true;
    d.destroyedAt = new Date();
    d.archivedPath = archived;
    (d.viewedBy || []).forEach(v => { v.expired = true; });
    message.mediaUrl = null;
    await message.save();

    if (global.io) {
        const payload = {
            messageId: String(message._id),
            conversationId: String(message.conversation),
            destroyed: true
        };
        // بثّ واحد لغرفتين — لا يصل من فيهما مرتين
        global.io.to([`user:${message.sender}`, `conversation-${message.conversation}`]).emit('photo-expired', payload);
    }
    return true;
}

// ✅ كنس الفيديوهات المنتهية — يستعمل الفهرس الجزئي على type:'video'
const SWEEP_BATCH = 200;
async function sweepExpiredVideos() {
    const due = await Message.find({
        type: 'video',
        'disappearing.enabled': true,
        'disappearing.destroyed': { $ne: true },
        'disappearing.expiresAt': { $lte: new Date() }
    })
        .sort({ 'disappearing.expiresAt': 1 })
        .limit(SWEEP_BATCH);

    let destroyed = 0;
    for (const message of due) {
        try {
            if (await destroyDisappearingIfDue(message)) destroyed++;
        } catch (e) {
            console.error('⚠️ كنس فيديو فشل:', String(message._id), e.message);
        }
    }
    return destroyed;
}

// ↩️ كنس الوسائط المحجوزة لإعادة الفتح — الصورة لا يشملها كنس الفيديو
async function sweepReplayHolds() {
    const holds = await DisappearingHold.find({ dueAt: { $lte: new Date() } }).limit(SWEEP_BATCH).lean();
    let destroyed = 0;
    for (const hold of holds) {
        try {
            const message = await Message.findById(hold.message);
            const done = !message || message.disappearing?.destroyed;
            if (!done && await destroyDisappearingIfDue(message)) destroyed++;
            if (done || message.disappearing?.destroyed) {
                await DisappearingHold.deleteOne({ _id: hold._id });
            }
        } catch (e) {
            console.error('⚠️ كنس حجز إعادة الفتح فشل:', String(hold.message), e.message);
        }
    }
    return destroyed;
}

// على instance 0 فقط (server.js) — كل 5 دقائق
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;
function startEphemeralSweeper() {
    const run = () => sweepExpiredVideos()
        .then(n => { if (n > 0) console.log(`🎥 كنس الفيديو المؤقت: ${n}`); })
        .then(sweepReplayHolds)
        .then(n => { if (n > 0) console.log(`↩️ كنس حجز إعادة الفتح: ${n}`); })
        .catch(e => console.error('⚠️ كنس الفيديو المؤقت:', e.message));
    setTimeout(run, 60 * 1000);
    setInterval(run, SWEEP_INTERVAL_MS);
}

module.exports = {
    EXPIRED_DIR,
    REPLAY_WINDOW_SECONDS,
    archiveDisappearingFile,
    destroyDisappearingIfDue,
    sweepExpiredVideos,
    sweepReplayHolds,
    startEphemeralSweeper
};
