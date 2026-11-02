// MatchHala - حجز وسيط مؤقت لإعادة الفتح
// مجموعة صغيرة بدل فهرس جزئي على الرسائل (16 مليوناً): الكنس يقرأ المستحقّ منها فقط،
// فالصورة المحجوزة لا تبقى حتى يفتح أحد المحادثة.

const mongoose = require('mongoose');

const disappearingHoldSchema = new mongoose.Schema({
    message: { type: mongoose.Schema.Types.ObjectId, ref: 'Message', required: true, unique: true },
    dueAt: { type: Date, required: true, index: true }
});

module.exports = mongoose.model('DisappearingHold', disappearingHoldSchema);
