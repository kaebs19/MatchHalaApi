// IcebreakerSession Model — لعبة 20 سؤال داخل المحادثة
const mongoose = require('mongoose');

const icebreakerSessionSchema = new mongoose.Schema({
    conversation: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Conversation',
        required: true,
        unique: true
    },
    initiator: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    currentQuestionIndex: { type: Number, default: 0 },
    answers: [{
        questionIndex: Number,
        question: String,
        userA: {
            user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
            answer: String,
            answeredAt: { type: Date, default: Date.now }
        },
        userB: {
            user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
            answer: String,
            answeredAt: { type: Date, default: Date.now }
        },
        revealedAt: Date
    }],
    status: {
        type: String,
        enum: ['active', 'paused', 'completed'],
        default: 'active'
    }
}, { timestamps: true });

// index handled by unique:true on field

module.exports = mongoose.model('IcebreakerSession', icebreakerSessionSchema);
