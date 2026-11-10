// أدوات طلبات إزالة المحتوى: حفظ الأدلة، مطابقة الحساب، الرقم المرجعي، والبريد.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');
const mongoose = require('mongoose');

const { sendEmail, layout, escapeHtml } = require('../services/emailService');

// ⚠️ خارج uploads/ عمداً: Nginx يخدم /uploads/ مباشرة للعموم. هذا المجلد لا يصله إلا
//    مسار اللوحة المصادَق. غير متتبَّع في git (.gitignore) فلا يمحوه النشر.
const EVIDENCE_DIR = path.join(__dirname, '..', 'private', 'removal-requests');

const TYPE_LABELS = {
    impersonation: { ar: 'انتحال شخصية', en: 'Impersonation' },
    my_photos: { ar: 'صوري منشورة بلا إذن', en: 'My photos used without permission' },
    offensive: { ar: 'محتوى مسيء أو ضار', en: 'Offensive or harmful content' },
    copyright: { ar: 'حقوق ملكية فكرية', en: 'Copyright / intellectual property' },
    underage: { ar: 'حساب لقاصر', en: 'Account of a minor' },
    other: { ar: 'أخرى', en: 'Other' }
};

const STATUS_LABELS = {
    new: 'جديد',
    reviewing: 'قيد المراجعة',
    removed: 'أُزيل المحتوى',
    rejected: 'مرفوض'
};

function ensureDir() {
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
}

// إعادة ترميز JPEG: تُسقط EXIF/GPS وأي حمولة مخفية، وتحدّ الأبعاد
async function saveEvidence(buffer) {
    ensureDir();
    const name = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}.jpg`;
    await sharp(buffer, { failOn: 'error', limitInputPixels: 40e6 })
        .rotate()
        .resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 82 })
        .toFile(path.join(EVIDENCE_DIR, name));
    return name;
}

// اسم ملف آمن فقط — لا مسارات
function evidencePath(name) {
    if (!/^[0-9]+-[0-9a-f]{16}\.jpg$/.test(String(name))) return null;
    return path.join(EVIDENCE_DIR, name);
}

function removeEvidence(names = []) {
    for (const n of names) {
        const p = evidencePath(n);
        if (p) fs.promises.unlink(p).catch(() => {});
    }
}

function newReference() {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const bytes = crypto.randomBytes(6);
    let s = '';
    for (const b of bytes) s += alphabet[b % alphabet.length];
    return `RR-${s}`;
}

function hashIp(ip) {
    return crypto.createHash('sha256').update(`rr:${ip || ''}`).digest('hex').slice(0, 32);
}

// مطابقة الحساب من نصّ صاحب الطلب: معرّف Mongo، أو Hala ID، أو بريد. لا regex حرّ على الأسماء.
async function matchTargetUser(target) {
    const User = require('../models/User');
    const text = String(target || '');

    const oid = text.match(/\b[0-9a-f]{24}\b/i);
    if (oid && mongoose.isValidObjectId(oid[0])) {
        const u = await User.findById(oid[0]).select('_id').lean();
        if (u) return u._id;
    }

    const email = text.match(/[^\s@<>()]+@[^\s@<>()]+\.[a-z]{2,}/i);
    if (email) {
        const u = await User.findOne({ email: email[0].toLowerCase() }).select('_id').lean();
        if (u) return u._id;
    }

    // Hala ID: كلمات من حروف/أرقام بطول معقول — نجرّب كل مرشّح بمطابقة تامة (غير حسّاسة لحالة الأحرف)
    const candidates = [...new Set((text.match(/[A-Za-z0-9_.-]{4,32}/g) || []))].slice(0, 6);
    for (const c of candidates) {
        const escaped = c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const u = await User.findOne({ halaId: { $regex: `^${escaped}$`, $options: 'i' } }).select('_id').lean();
        if (u) return u._id;
    }
    return null;
}

// ── البريد ─────────────────────────────────────────────────────

async function sendReceipt(request) {
    const en = request.lang === 'en';
    const typeLabel = (TYPE_LABELS[request.type] || TYPE_LABELS.other)[en ? 'en' : 'ar'];
    const title = en ? 'We received your removal request' : 'استلمنا طلب إزالة المحتوى';
    const body = en
        ? `<div dir="ltr" style="text-align:left">
            <p style="margin:0 0 12px;">Hello ${escapeHtml(request.requesterName)},</p>
            <p style="margin:0 0 12px;">Thank you for contacting Hala (ChatHala). Our moderation team will review your request and reply to this email.</p>
            <p style="margin:0 0 6px;"><strong>Reference:</strong> <code>${escapeHtml(request.reference)}</code></p>
            <p style="margin:0 0 12px;"><strong>Type:</strong> ${escapeHtml(typeLabel)}</p>
            <p style="margin:0;font-size:13px;color:#777;">Please keep the reference number if you contact us again about this request.</p>
           </div>`
        : `<p style="margin:0 0 12px;">مرحباً ${escapeHtml(request.requesterName)}،</p>
           <p style="margin:0 0 12px;">شكراً لتواصلك مع هلا (ChatHala). سيراجع فريق الإشراف طلبك ونردّ عليك على هذا البريد.</p>
           <p style="margin:0 0 6px;"><strong>الرقم المرجعي:</strong> <code>${escapeHtml(request.reference)}</code></p>
           <p style="margin:0 0 12px;"><strong>نوع الطلب:</strong> ${escapeHtml(typeLabel)}</p>
           <p style="margin:0;font-size:13px;color:#777;">احتفظ بالرقم المرجعي إن تواصلت معنا مجدداً بشأن هذا الطلب.</p>`;

    return sendEmail({
        to: request.requesterEmail,
        subject: `${title} — ${request.reference}`,
        html: layout({ title, body, preheader: request.reference, recipient: request.requesterEmail })
    });
}

async function sendDecision(request, message) {
    const en = request.lang === 'en';
    const removed = request.status === 'removed';
    const title = en
        ? (removed ? 'Your request was approved' : 'Update on your removal request')
        : (removed ? 'تمت إزالة المحتوى المبلَّغ عنه' : 'تحديث على طلب إزالة المحتوى');
    const accent = removed ? '#28a745' : request.status === 'rejected' ? '#dc3545' : undefined;
    const msgHtml = message
        ? `<div style="background:#f6f7fb;padding:12px 14px;margin:0 0 16px;border-radius:6px;white-space:pre-wrap;line-height:1.7;">${escapeHtml(message)}</div>`
        : '';
    const body = en
        ? `<div dir="ltr" style="text-align:left">${msgHtml}
            <p style="margin:0;font-size:13px;color:#777;">Reference: <code>${escapeHtml(request.reference)}</code></p></div>`
        : `${msgHtml}<p style="margin:0;font-size:13px;color:#777;">الرقم المرجعي: <code>${escapeHtml(request.reference)}</code></p>`;

    return sendEmail({
        to: request.requesterEmail,
        subject: `${title} — ${request.reference}`,
        html: layout({ title, body, accent, preheader: request.reference, recipient: request.requesterEmail })
    });
}

// تنبيه اختياري لفريق الإشراف (REMOVAL_NOTIFY_EMAIL في .env) — بلا تفاصيل شخصية
async function notifyModerators(request) {
    const to = process.env.REMOVAL_NOTIFY_EMAIL;
    if (!to) return false;
    const typeLabel = (TYPE_LABELS[request.type] || TYPE_LABELS.other).ar;
    return sendEmail({
        to,
        subject: `طلب إزالة جديد (${typeLabel}) — ${request.reference}`,
        html: layout({
            title: 'طلب إزالة محتوى جديد',
            body: `<p style="margin:0 0 8px;">النوع: <strong>${escapeHtml(typeLabel)}</strong></p>
                   <p style="margin:0;">الرقم المرجعي: <code>${escapeHtml(request.reference)}</code> — راجعه من لوحة التحكم ← طلبات الإزالة.</p>`
        })
    });
}

module.exports = {
    EVIDENCE_DIR,
    TYPE_LABELS,
    STATUS_LABELS,
    saveEvidence,
    evidencePath,
    removeEvidence,
    newReference,
    hashIp,
    matchTargetUser,
    sendReceipt,
    sendDecision,
    notifyModerators
};
