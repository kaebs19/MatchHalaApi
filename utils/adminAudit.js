// يسجّل طلب تعديل المشرف بعد انتهائه (res 'finish') — لا يؤخّر الردّ ولا يرمي.
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const SECRET_KEY = /pass|token|secret|key|otp|code|authorization|cookie/i;
const OBJECT_ID = /\b[0-9a-f]{24}\b/i;

// نسخة منقّاة مقصوصة من الجسم: بلا حقول سرّية، النصوص ≤ 200 حرف، المصفوفات ≤ 20، العمق ≤ 3
function sanitize(value, depth = 0) {
    if (value == null) return value;
    if (typeof value === 'string') return value.length > 200 ? value.slice(0, 200) + '…' : value;
    if (typeof value !== 'object') return value;
    if (depth >= 3) return '[…]';
    if (Array.isArray(value)) return value.slice(0, 20).map(v => sanitize(v, depth + 1));
    const out = {};
    for (const [k, v] of Object.entries(value).slice(0, 30)) {
        out[k] = SECRET_KEY.test(k) ? '[محذوف]' : sanitize(v, depth + 1);
    }
    return out;
}

function auditAdminRequest(req, res) {
    if (!MUTATING.has(req.method) || !req.user) return;
    res.once('finish', () => {
        try {
            const AdminAuditLog = require('../models/AdminAuditLog');
            const path = String(req.originalUrl || req.url || '').split('?')[0].slice(0, 300);
            const m = path.match(OBJECT_ID);
            const isMultipart = String(req.headers['content-type'] || '').startsWith('multipart/');
            AdminAuditLog.create({
                admin: req.user._id,
                adminName: req.user.name || null,
                method: req.method,
                path,
                targetId: m ? m[0] : null,
                body: isMultipart ? { _multipart: true } : sanitize(req.body && Object.keys(req.body).length ? req.body : null),
                status: res.statusCode,
                ip: req.headers['cf-connecting-ip'] || req.ip || null
            }).catch(err => console.error('[adminAudit] write failed:', err.message));
        } catch (err) {
            console.error('[adminAudit] failed:', err.message);
        }
    });
}

module.exports = { auditAdminRequest, sanitize };
