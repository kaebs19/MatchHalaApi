// طلبات إزالة المحتوى من خارج التطبيق (chathala.com/report-content)
// صاحب الطلب غالباً ليس مستخدماً في هلا: انتحال شخصية، صور منشورة بلا إذن، محتوى مسيء، حقوق ملكية.
// الأدلة صور تُحفظ خارج /uploads (لا يخدمها Nginx) وتُعرض للمشرف عبر مسار مصادَق.

const mongoose = require('mongoose');

const removalRequestSchema = new mongoose.Schema({
    // رقم مرجعي يُرسل لصاحب الطلب (RR-XXXXXX)
    reference: { type: String, required: true, unique: true },

    type: {
        type: String,
        enum: ['impersonation', 'my_photos', 'offensive', 'copyright', 'underage', 'other'],
        required: true
    },
    relation: {
        type: String,
        enum: ['self', 'representative', 'rights_holder', 'other'],
        required: true
    },

    requesterName: { type: String, required: true, maxlength: 120 },
    requesterEmail: { type: String, required: true, lowercase: true, trim: true, maxlength: 200 },

    // ما كتبه صاحب الطلب عن الحساب/المحتوى: رابط، Hala ID، اسم…
    target: { type: String, required: true, maxlength: 500 },
    description: { type: String, required: true, maxlength: 3000 },

    // الحساب المقصود — يُطابَق تلقائياً من target (Hala ID / المعرّف / البريد) أو يحدّده المشرف
    targetUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    targetMatchedBy: { type: String, enum: ['auto', 'admin', null], default: null },

    // أسماء ملفات الأدلة داخل private/removal-requests (لا مسارات كاملة)
    evidence: [{ type: String }],

    status: {
        type: String,
        enum: ['new', 'reviewing', 'removed', 'rejected'],
        default: 'new',
        index: true
    },
    adminNote: { type: String, maxlength: 3000, default: '' },          // داخلي، لا يُرسل
    responseMessage: { type: String, maxlength: 3000, default: '' },    // آخر رسالة أُرسلت لصاحب الطلب
    handledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    handledAt: { type: Date, default: null },

    // لمكافحة الإساءة فقط
    ipHash: { type: String, default: '' },
    userAgent: { type: String, maxlength: 300, default: '' },
    lang: { type: String, enum: ['ar', 'en'], default: 'ar' }
}, {
    timestamps: true
});

removalRequestSchema.index({ createdAt: -1 });
removalRequestSchema.index({ targetUser: 1, createdAt: -1 });

module.exports = mongoose.model('RemovalRequest', removalRequestSchema);
