// POST /api/public/removal-requests — نموذج «طلب إزالة محتوى» في chathala.com/report-content
// عام بلا تسجيل دخول: صاحب الطلب غالباً ليس مستخدماً في هلا.
// الحماية: حدّ لكل IP، حقل فخّ للروبوتات، Cloudflare Turnstile إن ضُبط TURNSTILE_SECRET_KEY،
// وأدلة صور فقط (3 × 5MB) تُعاد ترميزاً بلا بيانات وصفية.

const express = require('express');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const router = express.Router();

const RemovalRequest = require('../models/RemovalRequest');
const rr = require('../utils/removalRequests');

const MAX_FILES = 3;
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024, files: MAX_FILES, fields: 20, fieldSize: 8 * 1024 },
    // HEIC لا يُفكّ في sharp المثبّت — المتصفح يحوّله JPEG حين يحدّد النموذج الصيغ
    fileFilter: (req, file, cb) => {
        const ok = /^image\/(jpeg|png|webp)$/.test(file.mimetype);
        if (!ok) req.rejectedFileType = true;
        cb(null, ok);
    }
}).array('evidence', MAX_FILES);

// 5 طلبات في الساعة لكل IP (المحدِّد العام يبقى أيضاً)
const submitLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, code: 'RATE_LIMITED', message: 'طلبات كثيرة من هذا الجهاز. حاول بعد ساعة.' }
});

const EMAIL_RE = /^[^\s@<>()]+@[^\s@<>()]+\.[a-z]{2,}$/i;
const clean = (v, max) => String(v || '').replace(/\u0000/g, '').trim().slice(0, max);

async function verifyTurnstile(token, ip) {
    const secret = process.env.TURNSTILE_SECRET_KEY;
    if (!secret) return true; // غير مفعّل بعد — الحدّ والفخّ يكفيان مؤقتاً
    if (!token) return false;
    try {
        const body = new URLSearchParams({ secret, response: String(token) });
        if (ip) body.append('remoteip', ip);
        const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body });
        const data = await r.json();
        return data.success === true;
    } catch (err) {
        console.error('[removal-requests] Turnstile verify failed:', err.message);
        return false;
    }
}

const fail = (res, status, code, ar, en) =>
    res.status(status).json({ success: false, code, message: ar, messageEn: en });

router.post('/', submitLimiter, (req, res) => {
    upload(req, res, async (uploadErr) => {
        if (uploadErr) {
            const tooBig = uploadErr.code === 'LIMIT_FILE_SIZE';
            return fail(res, 400, tooBig ? 'FILE_TOO_LARGE' : 'UPLOAD_ERROR',
                tooBig ? 'حجم الصورة أكبر من 5MB' : 'تعذّر رفع المرفقات (3 صور كحدّ أقصى)',
                tooBig ? 'Each image must be under 5MB' : 'Could not upload attachments (max 3 images)');
        }
        try {
            const b = req.body || {};
            if (req.rejectedFileType) {
                return fail(res, 400, 'INVALID_IMAGE', 'المرفقات صور فقط (JPG أو PNG أو WebP)', 'Attachments must be JPG, PNG or WebP images');
            }

            // حقل فخّ مخفي: الإنسان لا يملؤه — نردّ بنجاح شكلي دون حفظ
            if (clean(b.website, 200)) {
                return res.status(201).json({ success: true, data: { reference: 'RR-RECEIVED' } });
            }

            if (!(await verifyTurnstile(b.turnstileToken, req.ip))) {
                return fail(res, 400, 'CAPTCHA_FAILED', 'تعذّر التحقق أنك لست روبوتاً، أعد المحاولة', 'Verification failed, please try again');
            }

            const type = clean(b.type, 30);
            const relation = clean(b.relation, 30);
            const requesterName = clean(b.name, 120);
            const requesterEmail = clean(b.email, 200).toLowerCase();
            const target = clean(b.target, 500);
            const description = clean(b.description, 3000);
            const lang = b.lang === 'en' ? 'en' : 'ar';

            if (!rr.TYPE_LABELS[type]) return fail(res, 400, 'INVALID_TYPE', 'اختر نوع الطلب', 'Choose a request type');
            if (!['self', 'representative', 'rights_holder', 'other'].includes(relation)) {
                return fail(res, 400, 'INVALID_RELATION', 'حدّد صفتك في الطلب', 'Choose your relation to the content');
            }
            if (requesterName.length < 2) return fail(res, 400, 'INVALID_NAME', 'اكتب اسمك', 'Enter your name');
            if (!EMAIL_RE.test(requesterEmail)) return fail(res, 400, 'INVALID_EMAIL', 'البريد الإلكتروني غير صحيح', 'Invalid email address');
            if (target.length < 2) return fail(res, 400, 'INVALID_TARGET', 'حدّد الحساب أو المحتوى المقصود', 'Identify the account or content');
            if (description.length < 20) {
                return fail(res, 400, 'DESCRIPTION_TOO_SHORT', 'اشرح الطلب في 20 حرفاً على الأقل', 'Describe the request in at least 20 characters');
            }
            if (b.confirm !== 'true' && b.confirm !== '1' && b.confirm !== 'on') {
                return fail(res, 400, 'CONFIRM_REQUIRED', 'يجب الإقرار بصحة المعلومات', 'Please confirm the information is accurate');
            }

            // الأدلة: إعادة ترميز — ما يفشل (ملف تالف أو ليس صورة) يُرفض الطلب بسببه
            const evidence = [];
            try {
                for (const f of req.files || []) evidence.push(await rr.saveEvidence(f.buffer));
            } catch (imgErr) {
                rr.removeEvidence(evidence);
                return fail(res, 400, 'INVALID_IMAGE', 'إحدى الصور تالفة أو بصيغة غير مدعومة', 'One of the images is invalid or unsupported');
            }

            let targetUser = null;
            try { targetUser = await rr.matchTargetUser(target); } catch (_) { /* المطابقة مساعدة فقط */ }

            let request;
            for (let attempt = 0; attempt < 3; attempt++) {
                try {
                    request = await RemovalRequest.create({
                        reference: rr.newReference(),
                        type, relation, requesterName, requesterEmail, target, description, lang,
                        targetUser,
                        targetMatchedBy: targetUser ? 'auto' : null,
                        evidence,
                        ipHash: rr.hashIp(req.ip),
                        userAgent: clean(req.get('user-agent'), 300)
                    });
                    break;
                } catch (e) {
                    if (e && e.code === 11000 && attempt < 2) continue; // تصادم رقم مرجعي
                    throw e;
                }
            }

            // البريد لا يؤخّر الردّ ولا يُفشل الطلب
            rr.sendReceipt(request).catch(() => {});
            rr.notifyModerators(request).catch(() => {});

            res.status(201).json({ success: true, data: { reference: request.reference } });
        } catch (error) {
            console.error('[removal-requests] create failed:', error);
            fail(res, 500, 'SERVER_ERROR', 'حدث خطأ، حاول لاحقاً', 'Something went wrong, please try later');
        }
    });
});

module.exports = router;
