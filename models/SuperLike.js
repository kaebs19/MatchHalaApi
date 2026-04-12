// HalaChat - SuperLike Model
// نموذج الإعجاب المميز

const mongoose = require('mongoose');

const superLikeSchema = new mongoose.Schema({
    sender: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    receiver: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
}, { timestamps: false });

// Indexes
superLikeSchema.index({ sender: 1, createdAt: -1 });
superLikeSchema.index({ receiver: 1, createdAt: -1 });

module.exports = mongoose.model('SuperLike', superLikeSchema);
