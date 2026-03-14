// MatchHala - Swipe Model
// نموذج السوايب في قاعدة البيانات

const mongoose = require('mongoose');

const swipeSchema = new mongoose.Schema({
    // من قام بالسوايب
    swiper: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: [true, 'المستخدم مطلوب']
    },
    // من تم السوايب عليه
    swiped: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: [true, 'المستخدم المستهدف مطلوب']
    },
    // نوع السوايب
    type: {
        type: String,
        enum: ['like', 'dislike', 'superlike'],
        required: [true, 'نوع السوايب مطلوب']
    }
}, {
    timestamps: true
});

// Indexes
swipeSchema.index({ swiper: 1, swiped: 1 }, { unique: true });
swipeSchema.index({ swiped: 1, type: 1 });
swipeSchema.index({ createdAt: -1 });

const Swipe = mongoose.model('Swipe', swipeSchema);

module.exports = Swipe;
