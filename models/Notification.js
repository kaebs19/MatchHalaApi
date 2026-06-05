// نموذج الإشعارات - Notification Model
const mongoose = require('mongoose');
const { getTypeMeta, isChannelType } = require('../config/notificationCategories');

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
        enum: ['general', 'message', 'report', 'announcement', 'system', 'new_message', 'new_follower', 'like', 'comment', 'conversation_request', 'conversation_accepted', 'conversation_reminder', 'conversation_expired', 'broadcast', 'super_like', 'profile_view', 'verification', 'new_match', 'new_like', 'flagged_message', 'warning', 'account_suspended', 'account_unsuspended', 'account_restricted', 'chat_mode_changed', 'name_action', 'bio_action', 'photo_action', 'photo_removed', 'security_alert', 'appeal_update', 'report_result', 'report_warning', 'official_warning', 'restriction', 'conversations_censored', 'conversations_wiped', 'account_hidden', 'account_unhidden', 'report_cancelled'],
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

    // المرسل (Admin) — optional للإشعارات التلقائية من النظام
    sender: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null
    },

    // تفعيل/إلغاء
    isActive: {
        type: Boolean,
        default: true
    },

    // ✅ التصنيف الموحّد (يُحسب تلقائياً من type عبر pre-save hook)
    category: {
        type: String,
        enum: ['personal', 'social', 'admin', 'channel'],
        default: 'personal',
        index: true
    },
    // ✅ flag للإشعارات الإدارية — لا تظهر في تطبيق المستخدم
    adminOnly: {
        type: Boolean,
        default: false,
        index: true
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
notificationSchema.index({ targetUsers: 1, status: 1, createdAt: -1 });
// ✅ index لـ filter السريع (category + adminOnly + targetUsers)
notificationSchema.index({ targetUsers: 1, adminOnly: 1, category: 1, createdAt: -1 });
// ✅ index لـ cleanup cron (createdAt + adminOnly)
notificationSchema.index({ createdAt: 1, adminOnly: 1 });

// ✅ Pre-save hook: تحديد category و adminOnly تلقائياً من type
notificationSchema.pre('save', async function() {
    if (this.isNew || this.isModified('type')) {
        const meta = getTypeMeta(this.type);
        this.category = meta.category;
        this.adminOnly = meta.adminOnly;

        // ✋ منع حفظ channel notifications (الرسائل) — يجب لا تُحفظ في DB
        if (isChannelType(this.type)) {
            const err = new Error(`Notifications of type "${this.type}" should not be persisted (channel-only)`);
            err.code = 'CHANNEL_NOTIFICATION_REJECTED';
            throw err;
        }
    }
});

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
