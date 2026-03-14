// نموذج الإشعارات - Notification Model
const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
    // العنوان
    title: {
        type: String,
        required: [true, 'عنوان الإشعار مطلوب'],
        trim: true,
        maxlength: [100, 'العنوان يجب أن يكون أقل من 100 حرف']
    },

    // المحتوى
    body: {
        type: String,
        required: [true, 'محتوى الإشعار مطلوب'],
        trim: true,
        maxlength: [500, 'المحتوى يجب أن يكون أقل من 500 حرف']
    },

    // نوع الإشعار
    type: {
        type: String,
        enum: ['general', 'message', 'report', 'announcement', 'system', 'new_message', 'new_follower', 'like', 'comment', 'conversation_request', 'broadcast', 'super_like', 'profile_view', 'verification', 'new_match', 'new_like'],
        default: 'general'
    },

    // المستقبلون
    recipients: {
        type: String,
        enum: ['all', 'specific'],
        default: 'all'
    },

    // المستخدمون المحددون (إذا كان specific)
    targetUsers: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }],

    // البيانات الإضافية
    data: {
        type: mongoose.Schema.Types.Mixed,
        default: {}
    },

    // الصورة أو الأيقونة
    image: {
        type: String,
        default: ''
    },

    // الصوت
    sound: {
        type: String,
        default: 'default'
    },

    // Badge (عداد الإشعارات)
    badge: {
        type: Number,
        default: 1
    },

    // الأولوية
    priority: {
        type: String,
        enum: ['low', 'normal', 'high'],
        default: 'normal'
    },

    // الحالة
    status: {
        type: String,
        enum: ['pending', 'sent', 'failed'],
        default: 'pending'
    },

    // عدد المستخدمين الذين تم إرسال الإشعار لهم
    sentCount: {
        type: Number,
        default: 0
    },

    // عدد المستخدمين الذين فشل إرسال الإشعار لهم
    failedCount: {
        type: Number,
        default: 0
    },

    // المستخدمين الذين قرأوا الإشعار
    readBy: [{
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User'
        },
        readAt: {
            type: Date,
            default: Date.now
        }
    }],

    // وقت الجدولة (إذا كان مجدولاً)
    scheduledAt: {
        type: Date,
        default: null
    },

    // وقت الإرسال الفعلي
    sentAt: {
        type: Date,
        default: null
    },

    // المرسل (Admin)
    sender: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },

    // تفعيل/إلغاء
    isActive: {
        type: Boolean,
        default: true
    },

    // تاريخ الإنشاء والتحديث
    createdAt: {
        type: Date,
        default: Date.now
    },
    updatedAt: {
        type: Date,
        default: Date.now
    }
}, {
    timestamps: true
});

// Index للبحث السريع
notificationSchema.index({ sender: 1, createdAt: -1 });
notificationSchema.index({ recipients: 1, status: 1 });
notificationSchema.index({ targetUsers: 1 });
notificationSchema.index({ type: 1 });

// دالة لعد المستخدمين الذين قرأوا الإشعار
notificationSchema.methods.getReadCount = function() {
    return this.readBy.length;
};

// دالة لعد المستخدمين الذين لم يقرأوا الإشعار
notificationSchema.methods.getUnreadCount = function() {
    if (this.recipients === 'all') {
        // سيحتاج حساب إجمالي المستخدمين
        return 0;
    }
    return this.targetUsers.length - this.readBy.length;
};

// دالة للتحقق من قراءة المستخدم للإشعار
notificationSchema.methods.isReadByUser = function(userId) {
    return this.readBy.some(item => item.user.toString() === userId.toString());
};

module.exports = mongoose.model('Notification', notificationSchema);
