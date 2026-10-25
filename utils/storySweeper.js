// كنس قصص البروفايل المنتهية (24 ساعة) — instance 0 فقط، كل 5 دقائق.
// المسارات تفحص expiresAt بنفسها، فالكنس لا يحدّد ظهور القصة؛ مهمته الملف والمشاهدات:
//   • مُبلَّغ عنها → تُنقل لأرشيف الأدمن (_expired) دليلاً.
//   • غيرها → يُحذف الملف نهائياً.
// ومشاهداتها (StoryView) تُحذف — لا حاجة لها بعد الانتهاء.

const fs = require('fs');
const path = require('path');
const Story = require('../models/Story');
const StoryView = require('../models/StoryView');
const { archiveDisappearingFile } = require('./disappearingMedia');

const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;
const SWEEP_BATCH = 500;

// ينهي قصة واحدة: الملف + الحالة + المشاهدات. status: expired | deleted | removed
async function endStory(story, status) {
    let archivedPath = null;
    if (story.imageUrl) {
        if ((story.reportCount || 0) > 0) {
            archivedPath = archiveDisappearingFile(story.imageUrl);
        } else {
            try {
                const rel = String(story.imageUrl).split('?')[0].replace(/^.*\/uploads\//, '');
                fs.unlinkSync(path.join(UPLOADS_DIR, rel));
            } catch (e) { /* الملف غير موجود — لا بأس */ }
        }
    }
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
