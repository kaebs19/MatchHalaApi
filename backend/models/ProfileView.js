// HalaChat - ProfileView Model
// نموذج زيارات البروفايل

const mongoose = require('mongoose');

const profileViewSchema = new mongoose.Schema({
    viewer: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    viewed: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    isHidden: {
        type: Boolean,
        default: false // true عندما يكون الزائر في وضع التخفي
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
}, { timestamps: false });

// Indexes
profileViewSchema.index({ viewer: 1, viewed: 1, createdAt: -1 });
profileViewSchema.index({ viewed: 1, createdAt: -1 });

module.exports = mongoose.model('ProfileView', profileViewSchema);
