// HalaChat Dashboard - Message Model
// نموذج الرسالة في قاعدة البيانات

const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
    // نوع المحادثة (لتحديد أي نموذج نستخدم)
    chatType: {
        type: String,
        enum: ['conversation', 'room'],
        required: [true, 'نوع المحادثة مطلوب']
    },

    // للمحادثات العادية (private/group)
    conversation: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Conversation',
        required: function() {
            return this.chatType === 'conversation';
        }
    },

    // لغرف المحادثة (public/private rooms)
    room: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'ChatRoom',
        required: function() {
            return this.chatType === 'room';
        }
    },

    sender: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: [true, 'المرسل مطلوب']
    },
    content: {
        type: String,
        required: [function() { return this.type === 'text'; }, 'محتوى الرسالة مطلوب'],
        trim: true,
        default: ''
    },
    // رابط الوسائط (للصور والفيديو والملفات)
    mediaUrl: {
        type: String,
        default: ''
    },
    type: {
        type: String,
        enum: ['text', 'image', 'file', 'audio', 'video'],
        default: 'text'
    },
    status: {
        type: String,
        enum: ['sent', 'delivered', 'read'],
        default: 'sent'
    },
    // تتبع من قرأ الرسالة (للمحادثات الجماعية والخاصة)
    readBy: [{
        user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        readAt: { type: Date, default: Date.now }
    }],
    isDeleted: {
        type: Boolean,
        default: false
    },
    deletedAt: {
        type: Date
    },
    metadata: {
        fileUrl: String,
        fileName: String,
        fileSize: Number,
        mimeType: String
    },

    // ============ فحص الكلمات المحظورة ============
    hasBannedWords: {
        type: Boolean,
        default: false
    },
    bannedWordsFound: [{
        word: String,
        severity: String,
        action: String
    }],
    bannedWordSeverity: {
        type: String,
        enum: ['low', 'medium', 'high', null],
        default: null
    }
}, {
    timestamps: true
});

// Indexes للبحث السريع
messageSchema.index({ chatType: 1 });
messageSchema.index({ conversation: 1, createdAt: -1 });
messageSchema.index({ room: 1, createdAt: -1 });
messageSchema.index({ sender: 1 });
messageSchema.index({ isDeleted: 1 });
messageSchema.index({ chatType: 1, conversation: 1, room: 1 });
messageSchema.index({ hasBannedWords: 1, createdAt: -1 });

// دالة للحذف الناعم
messageSchema.methods.softDelete = function() {
    this.isDeleted = true;
    this.deletedAt = new Date();
    return this.save();
};

// دالة للحصول على معرف المحادثة (conversation أو room)
messageSchema.methods.getChatId = function() {
    return this.chatType === 'conversation' ? this.conversation : this.room;
};

// دالة للتحقق من نوع المحادثة
messageSchema.methods.isConversationMessage = function() {
    return this.chatType === 'conversation';
};

messageSchema.methods.isRoomMessage = function() {
    return this.chatType === 'room';
};

// التحقق من صحة البيانات قبل الحفظ
messageSchema.pre('validate', function() {
    // التأكد من أن واحد فقط من conversation أو room محدد
    if (this.chatType === 'conversation' && this.room) {
        this.room = undefined;
    }
    if (this.chatType === 'room' && this.conversation) {
        this.conversation = undefined;
    }
});

const Message = mongoose.model('Message', messageSchema);

module.exports = Message;
