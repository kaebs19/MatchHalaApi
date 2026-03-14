// MatchHala - Match Model
// نموذج التطابق في قاعدة البيانات

const mongoose = require('mongoose');

const matchSchema = new mongoose.Schema({
    // المستخدمان المتطابقان
    users: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    }],
    // المحادثة المنشأة تلقائياً
    conversation: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Conversation'
    },
    // هل التطابق فعال
    isActive: {
        type: Boolean,
        default: true
    },
    // من ألغى التطابق (إن وُجد)
    unmatchedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null
    }
}, {
    timestamps: true
});

// Indexes
matchSchema.index({ users: 1 });
matchSchema.index({ users: 1, isActive: 1 });
matchSchema.index({ createdAt: -1 });

const Match = mongoose.model('Match', matchSchema);

module.exports = Match;
