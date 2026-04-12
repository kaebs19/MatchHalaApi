// MatchHala - Flagged Message Model
// نموذج الرسائل المبلغ عنها تلقائياً بسبب كلمات محظورة

const mongoose = require('mongoose');

const flaggedMessageSchema = new mongoose.Schema({
    message: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Message',
        required: true
    },
    conversation: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Conversation',
        required: true
    },
    sender: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    receiver: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    originalContent: {
        type: String,
        required: true
    },
    matchedWords: [{
        type: String
    }],
    status: {
        type: String,
        enum: ['pending', 'reviewed', 'dismissed', 'action_taken'],
        default: 'pending'
    },
    reviewedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    reviewedAt: {
        type: Date
    },
    action: {
        type: String,
        enum: ['none', 'dismiss', 'warning', 'message_deleted', 'user_suspended', 'user_suspended_1h', 'user_suspended_24h', 'user_suspended_3d', 'user_suspended_7d', 'user_banned', 'delete_account'],
        default: 'none'
    },
    notes: {
        type: String
    }
}, {
    timestamps: true
});

flaggedMessageSchema.index({ status: 1, createdAt: -1 });
flaggedMessageSchema.index({ sender: 1 });

const FlaggedMessage = mongoose.model('FlaggedMessage', flaggedMessageSchema);

module.exports = FlaggedMessage;
