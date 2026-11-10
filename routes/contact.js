// POST /api/public/contact — نموذج «اتصل بنا» في chathala.com/contact
// يرسل الرسالة بريداً إلى فريق الدعم (CONTACT_EMAIL، افتراضياً info@chathala.com) وReply-To = بريد المرسل،
// فالردّ من صندوق الدعم يصل للمرسل مباشرة. لا رد آلي للمرسل عمداً: النموذج عام، ورسالة آلية
// لأي عنوان يكتبه زائر تجعلنا وسيلة لإرسال بريد مزعج وتضرّ سمعة نطاق الإرسال.

const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();

const { deliver, layout, escapeHtml } = require('../services/emailService');

const CONTACT_EMAIL = process.env.CONTACT_EMAIL || 'info@chathala.com';
const EMAIL_RE = /^[^\s@<>()]+@[^\s@<>()]+\.[a-z]{2,}$/i;
const clean = (v, max) => String(v || '').replace(/[\u0000\r]/g, '').trim().slice(0, max);

const contactLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, code: 'RATE_LIMITED', message: 'رسائل كثيرة من هذا الجهاز. حاول بعد ساعة.' }
});

const fail = (res, status, code, message) => res.status(status).json({ success: false, code, message });

router.post('/', contactLimiter, async (req, res) => {
    try {
        const b = req.body || {};

        // حقل فخّ مخفي: الإنسان لا يملؤه — نجاح شكلي بلا إرسال
        if (clean(b.website, 200)) return res.json({ success: true });

        const name = clean(b.name, 120);
        const email = clean(b.email, 200).toLowerCase();
        const subject = clean(b.subject, 150).replace(/\n/g, ' ');
        const message = clean(b.message, 5000);

        if (name.length < 2) return fail(res, 400, 'INVALID_NAME', 'اكتب اسمك');
        if (!EMAIL_RE.test(email)) return fail(res, 400, 'INVALID_EMAIL', 'البريد الإلكتروني غير صحيح');
        if (subject.length < 2) return fail(res, 400, 'INVALID_SUBJECT', 'اكتب موضوع الرسالة');
        if (message.length < 10) return fail(res, 400, 'MESSAGE_TOO_SHORT', 'اكتب رسالتك (10 أحرف على الأقل)');

        const body = `
            <p style="margin:0 0 6px;"><strong>من:</strong> ${escapeHtml(name)} — <a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a></p>
            <p style="margin:0 0 14px;"><strong>الموضوع:</strong> ${escapeHtml(subject)}</p>
            <div style="background:#f6f7fb;padding:12px 14px;border-radius:6px;white-space:pre-wrap;line-height:1.8;" dir="auto">${escapeHtml(message)}</div>
            <p style="margin:14px 0 0;font-size:12px;color:#999;">أُرسلت من نموذج «اتصل بنا» في chathala.com — الردّ على هذا البريد يصل للمرسل مباشرة.</p>`;

        await deliver({
            to: CONTACT_EMAIL,
            replyTo: email,
            subject: `[اتصل بنا] ${subject}`,
            html: layout({ title: 'رسالة جديدة من الموقع', body, preheader: `${name}: ${subject}` }),
            text: `من: ${name} <${email}>\nالموضوع: ${subject}\n\n${message}`
        });

        res.json({ success: true });
    } catch (error) {
        console.error('[contact] send failed:', error.message);
        fail(res, 502, 'SEND_FAILED', 'تعذّر إرسال الرسالة الآن، حاول لاحقاً أو راسلنا مباشرة على ' + CONTACT_EMAIL);
    }
});

module.exports = router;
