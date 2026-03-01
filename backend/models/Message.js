// MatchHala - Message Model
// نموذج الرسالة في قاعدة البيانات

const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
    // للمحادثات الخاصة
    conversation: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Conversation',
        required: true
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
    // تتبع من قرأ الرسالة
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
    }
}, {
    timestamps: true
});

// Indexes للبحث السريع
messageSchema.index({ conversation: 1, createdAt: -1 });
messageSchema.index({ sender: 1 });
messageSchema.index({ isDeleted: 1 });

// دالة للحذف الناعم
messageSchema.methods.softDelete = function() {
    this.isDeleted = true;
    this.deletedAt = new Date();
    return this.save();
};

// دالة للحصول على معرف المحادثة
messageSchema.methods.getChatId = function() {
    return this.conversation;
};

const Message = mongoose.model('Message', messageSchema);

module.exports = Message;
