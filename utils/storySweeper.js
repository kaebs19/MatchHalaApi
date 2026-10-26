// كنس قصص البروفايل المنتهية (24 ساعة) — instance 0 فقط، كل 5 دقائق.
// المسارات تفحص expiresAt بنفسها، فالكنس لا يحدّد ظهور القصة؛ مهمته الملف والمشاهدات:
//   • كل صورة قصة تنتهي (انتهاء/حذف صاحبها/حذف المشرف) تُنقل لأرشيف الأدمن (_expired) للمراجعة —
//     قرار منتج ٢٥ أكتوبر ٢٠٢٦ (كانت تُحذف إلا المُبلَّغ عنها). المحجوب في Nginx، يُعرض للمشرف فقط.
//     يُحذف نهائياً بعد 30 يوماً إلا ما يخصّ بلاغاً مفتوحاً (utils/expiredArchiveCleaner.js).
// ومشاهداتها (StoryView) تُحذف — لا حاجة لها بعد الانتهاء.

const Story = require('../models/Story');
const StoryView = require('../models/StoryView');
const { archiveDisappearingFile } = require('./disappearingMedia');

const SWEEP_INTERVAL_MS = 5 * 60 * 1000;
const SWEEP_BATCH = 500;

// ينهي قصة واحدة: الملف + الحالة + المشاهدات. status: expired | deleted | removed
async function endStory(story, status) {
    const archivedPath = story.imageUrl ? archiveDisappearingFile(story.imageUrl) : null;
    await Story.updateOne(
        { _id: story._id },
        { $set: { status, imageUrl: null, archivedPath, endedAt: new Date() } }
    );
    await StoryView.deleteMany({ story: story._id });
}

async function sweepExpiredStories() {
    const due = await Story.find({ status: 'active', expiresAt: { $lte: new Date() } })
        .select('imageUrl reportCount')
        .limit(SWEEP_BATCH)
        .lean();
    for (const story of due) {
        try {
            await endStory(story, 'expired');
        } catch (e) {
            console.error('⚠️ إنهاء قصة فشل:', String(story._id), e.message);
        }
    }
    return due.length;
}

function startStorySweeper() {
    const run = () => sweepExpiredStories()
        .then(n => { if (n > 0) console.log(`📸 كنس القصص المنتهية: ${n}`); })
        .catch(e => console.error('⚠️ كنس القصص:', e.message));
    setTimeout(run, 90 * 1000);
    setInterval(run, SWEEP_INTERVAL_MS);
}

module.exports = { endStory, sweepExpiredStories, startStorySweeper };
