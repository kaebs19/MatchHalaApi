// 🛡️ كشف العُري في الصور العامة قبل ظهورها (القصص + صور الملف) — قرار المالك ٢٠ نوفمبر: الفحص على خادمنا، والمكشوف يُمنع.
//
// - الصورة لا تغادر الخادم: sharp يصغّرها 224×224 وتُرسل بكسلاتها لخدمة محلية (service.js) يشغّلها instance 0.
// - «يفشل مفتوحاً»: الخدمة غائبة (reload/تعطّل) أو أبطأ من المهلة ← الصورة تمرّ ويُسجَّل ذلك. النشر لا يتعطّل بسببها.
// - المكشوف يُحفظ نسخةً في private/blocked-images (خارج /uploads) ← لوحة التحكم «🛡️ الصور الممنوعة».
// - الإعداد: NSFW_CHECK=0 يطفئه · NSFW_BLOCK_THRESHOLD (افتراضي 0.7) على porn+hentai · NSFW_PORT (5099).
// ⚠️ «sexy» (ملابس سباحة/داخلية) لا يُمنع — النموذج يخلط فيها كثيراً، والمنع للعُري الصريح فقط.

const path = require('path');
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');
const { fork } = require('child_process');

const PORT = parseInt(process.env.NSFW_PORT, 10) || 5099;
const TIMEOUT_MS = 6000;
const SIZE = 224;
const BLOCKED_DIR = path.join(__dirname, '..', '..', 'private', 'blocked-images');
const KEEP_DAYS = 90;

const enabled = () => process.env.NSFW_CHECK !== '0';
const threshold = () => {
    const v = parseFloat(process.env.NSFW_BLOCK_THRESHOLD);
    return Number.isFinite(v) && v > 0 && v <= 1 ? v : 0.7;
};

/** يُشغَّل من instance 0 فقط. يُعاد تشغيل الخدمة إن ماتت (بتأخير متزايد) */
let child = null;
let restarts = 0;
function startService() {
    if (!enabled() || child) return;
    const launch = () => {
        child = fork(path.join(__dirname, 'service.js'), [], {
            env: { ...process.env, NSFW_PORT: String(PORT) },
            // تحميل النموذج المضمَّن (base64) يقفز بالـ heap فوق 768MB لحظياً ثم يستقرّ ~25MB
            execArgv: ['--max-old-space-size=1536'],
            stdio: ['ignore', 'inherit', 'inherit', 'ipc']
        });
        child.on('exit', (code) => {
            child = null;
            if (restarts++ < 20) setTimeout(launch, Math.min(60000, 2000 * restarts));
            else console.error('🛡️ خدمة كشف العُري توقفت نهائياً بعد', restarts, 'محاولة — الصور تمرّ بلا فحص');
            if (code) console.error('🛡️ خدمة كشف العُري خرجت بالرمز', code);
        });
    };
    launch();
    // كنس النسخ المحفوظة الأقدم من 90 يوماً (يومياً)
    setInterval(sweepOldFiles, 24 * 3600 * 1000).unref();
}

function sweepOldFiles() {
    try {
        const cutoff = Date.now() - KEEP_DAYS * 86400000;
        for (const f of fs.existsSync(BLOCKED_DIR) ? fs.readdirSync(BLOCKED_DIR) : []) {
            const p = path.join(BLOCKED_DIR, f);
            if (fs.statSync(p).mtimeMs < cutoff) fs.unlinkSync(p);
        }
    } catch (e) {
        console.error('🛡️ كنس الصور الممنوعة:', e.message);
    }
}

function post(body) {
    return new Promise((resolve, reject) => {
        const req = http.request({
            host: '127.0.0.1', port: PORT, path: '/classify', method: 'POST',
            headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': body.length },
            timeout: TIMEOUT_MS
        }, (res) => {
            let data = '';
            res.on('data', c => { data += c; });
            res.on('end', () => {
                if (res.statusCode !== 200) return reject(new Error(`status ${res.statusCode}`));
                try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
            });
        });
        req.on('timeout', () => req.destroy(new Error('timeout')));
        req.on('error', reject);
        req.end(body);
    });
}

/**
 * يفحص ملف صورة. يُرجع { checked, nude, scores }.
 * checked=false ⇒ لم يُفحص (مطفأ/الخدمة غائبة) — المتصل يسمح بالصورة.
 */
async function checkImageFile(filePath) {
    if (!enabled()) return { checked: false, nude: false };
    try {
        const sharp = require('sharp');
        const raw = await sharp(filePath).rotate().resize(SIZE, SIZE, { fit: 'fill' }).removeAlpha().raw().toBuffer();
        const { scores } = await post(raw);
        const explicit = (scores.porn || 0) + (scores.hentai || 0);
        return { checked: true, nude: explicit >= threshold(), scores };
    } catch (e) {
        console.warn('🛡️ فحص العُري لم يتم (الصورة مُرِّرت):', e.message);
        return { checked: false, nude: false };
    }
}

/**
 * يفحص ويمنع: إن كانت الصورة عارية يحفظ نسخة للمراجعة ويحذف المرفوع ويُرجع ردّ الرفض (422)، وإلا null.
 * source: story | profile | gallery
 */
async function blockIfNude({ filePath, userId, source }) {
    const result = await checkImageFile(filePath);
    if (!result.nude) return null;

    let saved = null;
    try {
        fs.mkdirSync(BLOCKED_DIR, { recursive: true });
        saved = `${source}-${Date.now()}-${crypto.randomBytes(8).toString('hex')}.jpg`;
        await require('sharp')(filePath).rotate()
            .resize({ width: 1080, height: 1080, fit: 'inside', withoutEnlargement: true })
            .jpeg({ quality: 80 }).toFile(path.join(BLOCKED_DIR, saved));
    } catch (e) {
        console.error('🛡️ تعذّر حفظ نسخة الصورة الممنوعة:', e.message);
        saved = null;
    }
    try { fs.unlinkSync(filePath); } catch (e) { /* ignore */ }

    try {
        const BlockedImage = require('../../models/BlockedImage');
        await BlockedImage.create({ user: userId, source, file: saved, scores: result.scores });
    } catch (e) {
        console.error('🛡️ تعذّر تسجيل الصورة الممنوعة:', e.message);
    }

    return {
        status: 422,
        body: {
            success: false,
            code: 'IMAGE_NUDITY_BLOCKED',
            message: 'لا يمكن نشر هذه الصورة لأنها تبدو صورة عارية. إن كان هذا خطأ فاختر صورة أخرى — تُحفظ نسخة منها لفريق المراجعة.',
            messageEn: 'This photo can’t be posted because it appears to contain nudity. If this is a mistake, choose another photo — a copy is kept for our review team.'
        }
    };
}

function blockedFilePath(name) {
    if (!name || name.includes('/') || name.includes('..')) return null;
    return path.join(BLOCKED_DIR, name);
}

module.exports = { startService, checkImageFile, blockIfNude, blockedFilePath, BLOCKED_DIR };
