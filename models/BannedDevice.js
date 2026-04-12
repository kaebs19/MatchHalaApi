const mongoose = require('mongoose');

/**
 * BannedDevice Model
 * يحفظ بصمات الأجهزة المحظورة — يمنع إنشاء حسابات جديدة من نفس الجهاز
 *
 * طبقتين:
 * 1. deviceFingerprint — hash من عدة عوامل (موديل + شاشة + لغة + timezone)
 * 2. keychainToken — UUID ثابت في Keychain (يبقى حتى بعد حذف التطبيق)
 */
const bannedDeviceSchema = new mongoose.Schema({
    // بصمة الجهاز (SHA-256 hash)
    deviceFingerprint: {
        type: String,
        index: true
    },
    // توكن Keychain الثابت
    keychainToken: {
        type: String,
        index: true
    },
    // المستخدم الأصلي اللي انحظر
    originalUserId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    // معلومات الجهاز التفصيلية (للتحليل)
    deviceInfo: {
        model: String,
        systemVersion: String,
        deviceName: String,
        screenWidth: String,
        screenHeight: String,
        language: String,
        timezone: String
    },
    // سبب الحظر
    reason: {
        type: String,
        enum: ['spam', 'harassment', 'fake_profile', 'violation', 'manual', 'repeated_spam', 'admin', 'other'],
        default: 'manual'
    },
    reasonDetails: String,
    // من حظره
    bannedBy: {
        type: String,
        enum: ['admin', 'auto', 'spam_system'],
        default: 'admin'
    },
    adminId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    // هل الحظر فعّال
    isActive: {
        type: Boolean,
        default: true
    },
    // محاولات التسجيل من هذا الجهاز بعد الحظر
    rejectedAttempts: [{
        attemptedAt: { type: Date, default: Date.now },
        email: String,
        name: String,
        ip: String
    }]
}, {
    timestamps: true
});

// Index مركب للبحث السريع
bannedDeviceSchema.index({ deviceFingerprint: 1, isActive: 1 });
bannedDeviceSchema.index({ keychainToken: 1, isActive: 1 });
bannedDeviceSchema.index({ originalUserId: 1, isActive: 1 });
bannedDeviceSchema.index({ isActive: 1, createdAt: -1 });

module.exports = mongoose.model('BannedDevice', bannedDeviceSchema);
