// HalaChat Dashboard - Activity Log Model
// نموذج تسجيل النشاطات والأحداث

const mongoose = require('mongoose');

const activityLogSchema = new mongoose.Schema({
    // المستخدم الذي قام بالنشاط
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: [true, 'المستخدم مطلوب']
    },

    // نوع النشاط
    action: {
        type: String,
        required: [true, 'نوع النشاط مطلوب'],
        enum: [
            // نشاطات المستخدمين
            'user_login',
            'user_logout',
            'user_register',
            'user_update_profile',
            'user_change_password',
            'user_delete_account',
            'profile_update',
            'profile_image_upload',
            'upload_room_image',

            // نشاطات الغرف
            'room_create',
            'room_update',
            'room_delete',
            'room_join',
            'room_leave',
            'room_lock',
            'room_unlock',

            // نشاطات المحادثات
            'conversation_create',
            'conversation_update',
            'conversation_delete',
            'conversation_join',
            'conversation_leave',

            // نشاطات الرسائل
            'message_send',
            'message_edit',
            'message_delete',
            'message_bulk_delete',

            // نشاطات المستخدمين (Admin)
            'admin_user_create',
            'admin_user_update',
            'admin_user_delete',
            'admin_user_ban',
            'admin_user_unban',
            'admin_user_activate',
            'admin_user_deactivate',

            // نشاطات البلاغات
            'report_create',
            'report_assign',
            'report_resolve',
            'report_reject',

            // نشاطات الإعدادات
            'settings_update',

            // نشاطات أخرى
            'export_data',
            'import_data'
        ]
    },

    // وصف النشاط بالتفصيل
    description: {
        type: String,
        required: true
    },

    // نوع الكائن المستهدف
    targetType: {
        type: String,
        enum: ['User', 'ChatRoom', 'Conversation', 'Message', 'Report', 'Settings', 'System', null],
        default: null
    },

    // معرف الكائن المستهدف
    targetId: {
        type: mongoose.Schema.Types.ObjectId,
        refPath: 'targetType'
    },

    // اسم الكائن المستهدف (للحفظ السريع)
    targetName: {
        type: String
    },

    // البيانات الإضافية (قبل/بعد التغيير)
    metadata: {
        before: mongoose.Schema.Types.Mixed,  // القيم قبل التغيير
        after: mongoose.Schema.Types.Mixed,   // القيم بعد التغيير
        additionalInfo: mongoose.Schema.Types.Mixed  // معلومات إضافية
    },

    // معلومات الطلب
    requestInfo: {
        ipAddress: {
            type: String
        },
        userAgent: {
            type: String
        },
        method: {
            type: String,
            enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH']
        },
        url: {
            type: String
        }
    },

    // مستوى الأهمية
    severity: {
        type: String,
        enum: ['low', 'medium', 'high', 'critical'],
        default: 'low'
    },

    // حالة النشاط
    status: {
        type: String,
        enum: ['success', 'failed', 'pending'],
        default: 'success'
    },

    // رسالة الخطأ (إن وجد)
    errorMessage: {
        type: String
    }
}, {
    timestamps: true
});

// Indexes للبحث السريع
activityLogSchema.index({ user: 1, createdAt: -1 });
activityLogSchema.index({ action: 1, createdAt: -1 });
activityLogSchema.index({ targetType: 1, targetId: 1 });
activityLogSchema.index({ severity: 1, status: 1 });
activityLogSchema.index({ createdAt: -1 });
activityLogSchema.index({ 'requestInfo.ipAddress': 1 });

// دالة للحصول على لون حسب نوع النشاط
activityLogSchema.methods.getActionColor = function() {
    const colorMap = {
        user_login: 'green',
        user_logout: 'gray',
        user_register: 'blue',
        room_create: 'green',
        room_delete: 'red',
        message_delete: 'red',
        admin_user_ban: 'red',
        report_create: 'orange'
    };
    return colorMap[this.action] || 'gray';
};

// دالة للحصول على أيقونة حسب نوع النشاط
activityLogSchema.methods.getActionIcon = function() {
    const iconMap = {
        user_login: '🔓',
        user_logout: '🔒',
        user_register: '👤',
        room_create: '➕',
        room_delete: '🗑️',
        message_send: '✉️',
        message_delete: '❌',
        admin_user_ban: '🚫',
        report_create: '⚠️'
    };
    return iconMap[this.action] || '📝';
};

// Static method لإنشاء سجل نشاط جديد بسهولة
activityLogSchema.statics.logActivity = async function({
    user,
    action,
    description,
    targetType = null,
    targetId = null,
    targetName = null,
    metadata = {},
    requestInfo = {},
    severity = 'low',
    status = 'success',
    errorMessage = null
}) {
    try {
        const log = await this.create({
            user,
            action,
            description,
            targetType,
            targetId,
            targetName,
            metadata,
            requestInfo,
            severity,
            status,
            errorMessage
        });
        return log;
    } catch (error) {
        console.error('خطأ في تسجيل النشاط:', error);
        return null;
    }
};

// Middleware للحذف التلقائي بعد فترة (optional)
// يمكن إضافة TTL Index لحذف السجلات القديمة تلقائياً
// activityLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 7776000 }); // 90 يوم

const ActivityLog = mongoose.model('ActivityLog', activityLogSchema);

module.exports = ActivityLog;
