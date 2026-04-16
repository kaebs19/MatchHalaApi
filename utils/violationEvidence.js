// MatchHala - Violation Evidence Helper
// يدير نقل الأدلة (الصور المزالة خاصةً) إلى مجلد محمي:
//   /uploads/violations/<userId>/<timestamp>_<originalName>
// الفكرة: لا نحذف الصورة من القرص، فقط ننقلها خارج المجلد العام
// بحيث تبقى متاحة كـ "دليل" للأدمن فقط.

const fs = require('fs');
const path = require('path');

const UPLOADS_ROOT = path.join(__dirname, '..', 'uploads');
const VIOLATIONS_ROOT = path.join(UPLOADS_ROOT, 'violations');

/**
 * التأكد من وجود مجلد مخالفات المستخدم
 */
function ensureUserViolationsDir(userId) {
    const dir = path.join(VIOLATIONS_ROOT, String(userId));
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true, mode: 0o750 });
    }
    return dir;
}

/**
 * تحويل URL صورة إلى مسار على القرص
 * يقبل:
 *  - /uploads/profiles/xyz.jpg
 *  - https://domain.com/uploads/profiles/xyz.jpg
 *  - profiles/xyz.jpg
 */
function photoUrlToFilePath(url) {
    if (!url) return null;
    let p = String(url).trim();
    // إزالة الدومين إن وجد
    try {
        if (p.startsWith('http://') || p.startsWith('https://')) {
            const u = new URL(p);
            p = u.pathname;
        }
    } catch (e) { /* ignore */ }

    // تطبيع المسار
    p = p.replace(/^\/+/, ''); // إزالة / من البداية
    if (!p.startsWith('uploads/')) {
        // قد يكون مسار نسبي مثل "profiles/xyz.jpg"
        p = path.join('uploads', p);
    }
    return path.join(__dirname, '..', p);
}

/**
 * نقل صورة من المكان الأصلي إلى مجلد مخالفات المستخدم.
 * لا يكسر الـ flow إذا كان الملف غير موجود (قد يكون محذوف مسبقاً).
 *
 * @param {string} userId - معرف المستخدم
 * @param {string} photoUrl - URL/مسار الصورة
 * @returns {Promise<{originalPath: string, newPath: string, publicUrl: string, moved: boolean}>}
 */
async function movePhotoToViolations(userId, photoUrl) {
    const result = {
        originalPath: photoUrl || null,
        newPath: null,
        publicUrl: null,
        moved: false
    };

    if (!photoUrl) return result;

    try {
        const srcFilePath = photoUrlToFilePath(photoUrl);
        if (!srcFilePath || !fs.existsSync(srcFilePath)) {
            console.log(`⚠️ violation evidence: file not found: ${srcFilePath}`);
            return result;
        }

        const dir = ensureUserViolationsDir(userId);
        const originalName = path.basename(srcFilePath);
        const timestamp = Date.now();
        const newFileName = `${timestamp}_${originalName}`;
        const newFilePath = path.join(dir, newFileName);

        // النقل (rename أسرع من copy+unlink لو نفس filesystem)
        try {
            fs.renameSync(srcFilePath, newFilePath);
        } catch (err) {
            // إذا فشل rename (cross-device)، نستخدم copy + unlink
            fs.copyFileSync(srcFilePath, newFilePath);
            try { fs.unlinkSync(srcFilePath); } catch (e) { /* ignore */ }
        }

        // chmod 640 (admin read only)
        try { fs.chmodSync(newFilePath, 0o640); } catch (e) { /* ignore */ }

        result.newPath = newFilePath;
        // URL عام (يصلها الأدمن فقط عبر endpoint محمي)
        result.publicUrl = `/uploads/violations/${userId}/${newFileName}`;
        result.moved = true;

        console.log(`📁 violation evidence moved: ${photoUrl} → ${result.publicUrl}`);
        return result;
    } catch (e) {
        console.error('❌ movePhotoToViolations error:', e.message);
        return result;
    }
}

module.exports = {
    ensureUserViolationsDir,
    photoUrlToFilePath,
    movePhotoToViolations,
    VIOLATIONS_ROOT
};
