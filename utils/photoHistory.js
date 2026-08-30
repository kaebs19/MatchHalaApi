// MatchHala - Photo History Helper
// سجل الصور الشخصية: كل صورة تُستبدل أو تُحذف تُنقل إلى
//   /uploads/photo-history/<userId>/<timestamp>_<name>
// بدل fs.unlinkSync. المشكلة التي يحلّها: المستخدم يُبلَّغ عنه ثم يغيّر
// صورته وينكر — وكان الملف يُمحى فلا يبقى دليل.
//
// المجلد محجوب عاماً في server.js؛ الأدمن يصله عبر
//   GET /api/users/:id/photo-history-file/:filename

const fs = require('fs');
const path = require('path');
const { photoUrlToFilePath } = require('./violationEvidence');

const HISTORY_ROOT = path.join(__dirname, '..', 'uploads', 'photo-history');

// حدّ الاحتفاظ لكل مستخدم — أقدم من ذلك يُحذف ملفه ويبقى سطر السجل
const MAX_ARCHIVED_FILES = 30;

function ensureUserDir(userId) {
    const dir = path.join(HISTORY_ROOT, String(userId));
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true, mode: 0o750 });
    }
    return dir;
}

/**
 * نقل الصورة الحالية إلى الأرشيف وإضافة سطر في user.photoHistory.
 * لا يرمي أبداً — فشل الأرشفة لا يجوز أن يمنع المستخدم من تغيير صورته.
 *
 * @param {object} user - مستند المستخدم (يُعدَّل ولا يُحفظ هنا)
 * @param {string} photoUrl - الصورة المُستبدَلة/المحذوفة
 * @param {object} opts - { reason, by, alreadyArchivedPath }
 * @returns {boolean} هل سُجّل سطر في السجل
 */
function archivePhoto(user, photoUrl, opts = {}) {
    const { reason = 'user_replaced', by = null, alreadyArchivedPath = null } = opts;
    if (!photoUrl) return false;

    // الصور الافتراضية ليست دليلاً على شيء
    if (String(photoUrl).includes('/defaults/')) return false;

    const entry = {
        photo: photoUrl,
        archivedPath: alreadyArchivedPath,   // مسار محمي إن نُقل الملف
        addedAt: user.lastPhotoChange || user.createdAt || null,
        replacedAt: new Date(),
        reason,
        by
    };

    // الأدمن ينقلها أصلاً إلى /uploads/violations — لا ننقلها مرتين
    if (!alreadyArchivedPath) {
        try {
            const src = photoUrlToFilePath(photoUrl);
            if (src && fs.existsSync(src)) {
                const dir = ensureUserDir(user._id);
                const fileName = `${Date.now()}_${path.basename(src)}`;
                const dest = path.join(dir, fileName);
                try {
                    fs.renameSync(src, dest);
                } catch (err) {
                    fs.copyFileSync(src, dest);
                    try { fs.unlinkSync(src); } catch (e) { /* ignore */ }
                }
                try { fs.chmodSync(dest, 0o640); } catch (e) { /* ignore */ }
                entry.archivedPath = `/uploads/photo-history/${user._id}/${fileName}`;
            }
        } catch (e) {
            console.error('❌ archivePhoto error:', e.message);
        }
    }

    if (!Array.isArray(user.photoHistory)) user.photoHistory = [];
    user.photoHistory.push(entry);
    trimOldFiles(user);
    return true;
}

/**
 * حذف ملفات الأرشيف الزائدة عن الحدّ — تبقى أسطر السجل (متى ومن غيّر)
 * لكن بلا صورة، فلا ينمو القرص بلا سقف.
 */
function trimOldFiles(user) {
    try {
        const archived = user.photoHistory.filter(e => e.archivedPath && e.archivedPath.includes('/photo-history/'));
        const excess = archived.length - MAX_ARCHIVED_FILES;
        if (excess <= 0) return;
        for (let i = 0; i < excess; i++) {
            const e = archived[i];
            const file = path.join(__dirname, '..', e.archivedPath.replace(/^\//, ''));
            if (fs.existsSync(file)) {
                try { fs.unlinkSync(file); } catch (err) { /* ignore */ }
            }
            e.archivedPath = null;
            e.purged = true;
        }
    } catch (e) { /* ignore */ }
}

module.exports = { archivePhoto, HISTORY_ROOT, MAX_ARCHIVED_FILES };
