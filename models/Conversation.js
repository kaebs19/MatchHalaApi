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
        // cancelled = أنهى أحد الطرفين المحادثة؛ الرسائل تبقى لكن الإرسال ممنوع
        //             حتى يُرسل أحدهما طلباً جديداً يُقبل من الآخر (يعود pending→accepted)
        enum: ['pending', 'accepted', 'rejected', 'expired', 'cancelled'],
        default: 'accepted' // المحادثات القديمة تكون مقبولة بشكل افتراضي
    },
    // ✅ تتبّع إنهاء/إلغاء المحادثة (لا يحذف الرسائل)
    cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    cancelledAt: { type: Date, default: null },
    // ✅ وضع المحادثة (keep = الافتراضي — الرسائل تبقى للمستخدم)
    // snap = تنحذف عند الخروج من المحادثة (مثل سناب شات)
    // 24h = تنحذف بعد 24 ساعة من قراءتها
    // keep = تبقى دائماً (الافتراضي)
    // ملاحظة: الرسائل تبقى في السيرفر دائماً للأدمن
    chatMode: {
        type: String,
        enum: ['snap', '24h', 'keep'],
        default: 'keep'
    },
    // هل تم إرسال تذكير للمستقبل بعد 24 ساعة
    reminderSent: {
        type: Boolean,
        default: false
        // snap = تنحذف عند الخروج من المحادثة (مثل سناب شات)
        // 24h = تنحذف بعد 24 ساعة (الافتراضي)
        // keep = تبقى دائماً
        // ملاحظة: الرسائل تبقى في السيرفر دائماً للأدمن
    },
    // ✅ تتبع آخر مسح رسائل لكل مستخدم (snap/24h)
    clearedAt: [{
        user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        date: { type: Date, default: null }
    }],
    // ✅ مخفية عن مستخدمين محددين (بواسطة النظام التلقائي — لا تُحذف من DB)
    //    عند fetch في التطبيق، نستبعد المحادثات التي فيها currentUser في hiddenFor
    hiddenFor: [{
        user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
        hiddenAt: { type: Date, default: Date.now },
        reason: { type: String, default: null }
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
