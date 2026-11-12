// سجلّ إجراءات المشرفين — كل طلب تعديل (POST/PUT/PATCH/DELETE) يمرّ بـ adminOnly يُسجَّل تلقائياً
// (middleware/auth.js). من فعل ماذا، بمن، ومتى، وهل نجح. يُحذف بعد 180 يوماً (TTL).
const mongoose = require('mongoose');

const adminAuditLogSchema = new mongoose.Schema({
    admin: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    adminName: { type: String, default: null },
    method: { type: String, required: true },
    path: { type: String, required: true },          // بلا query
    targetId: { type: mongoose.Schema.Types.ObjectId, default: null },   // أول معرّف في المسار
    body: { type: mongoose.Schema.Types.Mixed, default: null },        // ملخّص منقّى (بلا أسرار، مقصوص)
    status: { type: Number, default: null },
    ip: { type: String, default: null },
    at: { type: Date, default: Date.now }
}, { versionKey: false });

adminAuditLogSchema.index({ at: -1 });
adminAuditLogSchema.index({ targetId: 1, at: -1 });
adminAuditLogSchema.index({ admin: 1, at: -1 });
adminAuditLogSchema.index({ at: 1 }, { name: 'ttl_180d', expireAfterSeconds: 180 * 24 * 60 * 60 });

module.exports = mongoose.model('AdminAuditLog', adminAuditLogSchema);
