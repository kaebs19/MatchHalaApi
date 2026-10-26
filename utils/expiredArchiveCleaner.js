// تنظيف أرشيف الوسائط المؤقتة (uploads/_expired) — instance 0 فقط، كل 6 ساعات.
//
// الوسيط المؤقت (فيديو المحادثة، الصورة المؤقتة، صورة القصة) يُنقل إلى _expired عند انتهائه ليراه
// المشرف في البلاغات (utils/disappearingMedia.js، utils/storySweeper.js). كان لا يُنظَّف أبداً (9.9GB).
// الآن يُحذف نهائياً بعد ARCHIVE_RETENTION_DAYS من أرشفته — إلا ما يخصّ بلاغاً مفتوحاً (pending/reviewing):
// يبقى حتى يُغلق المشرف البلاغ، ثم يُحذف في أول تشغيل بعده (عمره تجاوز المدة غالباً).
//
// ⚠️ عمر الملف = ctime لا mtime: rename يحدّث ctime (وقت الأرشفة)، وmtime يبقى وقت الرفع —
//    صورة مؤقتة رُفعت قبل 40 يوماً وأُرشفت أمس كانت ستُحذف فوراً.
// مسارات المشرف تتحقّق من وجود الملف وتردّ «الملف غير موجود في الأرشيف» — لا حاجة لتعديل قاعدة البيانات.

const fs = require('fs');
const path = require('path');
const { EXPIRED_DIR } = require('./disappearingMedia');

const ARCHIVE_RETENTION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const CLEAN_INTERVAL_MS = 6 * 60 * 60 * 1000;
// استراحة قصيرة كل دفعة — القرص مشترك مع MongoDB
const BATCH = 500;
const PAUSE_MS = 100;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// أسماء ملفات الأرشيف المرتبطة ببلاغ مفتوح — لا تُحذف مهما كان عمرها
async function protectedFileNames() {
    const Report = require('../models/Report');
    const Message = require('../models/Message');
    const Story = require('../models/Story');

    const open = await Report.find({
        status: { $in: ['pending', 'reviewing'] },
        $or: [{ reportedMessage: { $ne: null } }, { reportedStory: { $ne: null } }]
    }).select('reportedMessage reportedStory').lean();

    const messageIds = open.map(r => r.reportedMessage).filter(Boolean);
    const storyIds = open.map(r => r.reportedStory).filter(Boolean);
    const [messages, stories] = await Promise.all([
        messageIds.length ? Message.find({ _id: { $in: messageIds } }).select('disappearing.archivedPath').lean() : [],
        storyIds.length ? Story.find({ _id: { $in: storyIds } }).select('archivedPath').lean() : []
    ]);

    const names = new Set();
    for (const m of messages) {
        const p = m.disappearing?.archivedPath;
        if (p) names.add(path.basename(p));
    }
    for (const s of stories) {
        if (s.archivedPath) names.add(path.basename(s.archivedPath));
    }
    return names;
}

async function cleanExpiredArchive({ retentionDays = ARCHIVE_RETENTION_DAYS } = {}) {
    let entries;
    try {
        entries = await fs.promises.readdir(EXPIRED_DIR);
    } catch (e) {
        if (e.code === 'ENOENT') return { deleted: 0, kept: 0, bytes: 0 };
        throw e;
    }

    const cutoff = Date.now() - retentionDays * DAY_MS;
    const keep = await protectedFileNames();
    let deleted = 0;
    let kept = 0;
    let bytes = 0;

    for (let i = 0; i < entries.length; i++) {
        const name = entries[i];
        const file = path.join(EXPIRED_DIR, name);
        try {
            const st = await fs.promises.stat(file);
            if (!st.isFile()) continue;
            if (Math.max(st.ctimeMs, st.mtimeMs) > cutoff) continue;
            if (keep.has(name)) { kept++; continue; }
            await fs.promises.unlink(file);
            deleted++;
            bytes += st.size;
        } catch (e) {
            if (e.code !== 'ENOENT') console.error('⚠️ تنظيف الأرشيف:', name, e.message);
        }
        if ((i + 1) % BATCH === 0) await sleep(PAUSE_MS);
    }
    return { deleted, kept, bytes };
}

function startExpiredArchiveCleaner() {
    const run = () => cleanExpiredArchive()
        .then(({ deleted, kept, bytes }) => {
            if (deleted > 0 || kept > 0) {
                console.log(`🧹 أرشيف الوسائط المؤقتة: حُذف ${deleted} (${(bytes / 1048576).toFixed(1)}MB)، مُبقى لبلاغات مفتوحة ${kept}`);
            }
        })
        .catch(e => console.error('⚠️ تنظيف أرشيف الوسائط المؤقتة:', e.message));
    // بعد الإقلاع بعشر دقائق — لا يزاحم تسخين النسخة
    setTimeout(run, 10 * 60 * 1000);
    setInterval(run, CLEAN_INTERVAL_MS);
}

module.exports = { cleanExpiredArchive, startExpiredArchiveCleaner, ARCHIVE_RETENTION_DAYS };
