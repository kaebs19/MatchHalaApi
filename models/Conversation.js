// HalaChat Dashboard - Conversation Model
// نموذج المحادثة في قاعدة البيانات

const mongoose = require('mongoose');

const conversationSchema = new mongoose.Schema({
    title: {
        type: String,
        trim: true,
        default: 'محادثة جديدة'
    },
    type: {
        type: String,
        enum: ['private', 'group'],
        default: 'private'
    },
    participants: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    }],
    admins: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }],
    creator: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    groupImage: {
        type: String,
        default: null
    },
    description: {
        type: String,
        default: ''
    },
    lastMessage: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Message'
    },
    isActive: {
        type: Boolean,
        default: true
    },
    isLocked: {
        type: Boolean,
        default: false
    },
    status: {
        type: String,
        enum: ['pending', 'accepted', 'rejected'],
        default: 'accepted' // المحادثات القديمة تكون مقبولة بشكل افتراضي
    },
    // ✅ وضع المحادثة (سناب = الافتراضي)
    chatMode: {
        type: String,
        enum: ['snap', '24h', 'keep'],
        default: 'snap'
        // snap = تنحذف عند الخروج من المحادثة (مثل سناب شات)
        // 24h = تنحذف بعد 24 ساعة
        // keep = تبقى دائماً
        // ملاحظة: الرسائل تبقى في السيرفر دائماً للأدمن
    },
    // ✅ تتبع آخر مسح رسائل لكل مستخدم (snap/24h)
    clearedAt: [{
        user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        date: { type: Date, default: null }
    }],
    settings: {
        allowMembersToSend: {
            type: Boolean,
            default: true
        },
        allowMembersToAddOthers: {
            type: Boolean,
            default: false
        },
        autoDeleteMessages: {
            type: Boolean,
            default: false
        },
        autoDeleteDays: {
            type: Number,
            default: 0
        }
    },
    metadata: {
        totalMessages: {
            type: Number,
            default: 0
        },
        totalParticipants: {
            type: Number,
            default: 0
        },
        activeMembers: {
            type: Number,
            default: 0
        },
        totalReports: {
            type: Number,
            default: 0
        }
    }
}, {
    timestamps: true
});

// Index للبحث السريع
conversationSchema.index({ participants: 1 });
conversationSchema.index({ createdAt: -1 });
conversationSchema.index({ isActive: 1 });
// ✅ Compound index لفلترة محادثات المستخدم (يسرّع /home و /conversations)
conversationSchema.index({ participants: 1, status: 1, isActive: 1, updatedAt: -1 });

// دالة لحساب عدد المشاركين تلقائياً
conversationSchema.pre('save', function() {
    this.metadata.totalParticipants = this.participants.length;
});

const Conversation = mongoose.model('Conversation', conversationSchema);

module.exports = Conversation;
