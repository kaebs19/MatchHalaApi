// MatchHala - FriendList Model
// قوائم الأصدقاء المخصصة — تجميع الأصدقاء في قوائم (مثل: المقربون، شباب الرياض)

const mongoose = require('mongoose');

const friendListSchema = new mongoose.Schema({
    // صاحب القائمة
    owner: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    // اسم القائمة
    name: {
        type: String,
        required: true,
        trim: true,
        maxlength: 30
    },
    // إيموجي القائمة (اختياري)
    emoji: {
        type: String,
        default: '',
        maxlength: 8
    },
    // ترتيب القائمة بين قوائم المالك (يدوي — سحب وإفلات)
    order: {
        type: Number,
        default: 0
    },
    // أعضاء القائمة (userIds لأصدقاء المالك)
    members: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }]
}, {
    timestamps: true
});

friendListSchema.index({ owner: 1, order: 1 });

const FriendList = mongoose.model('FriendList', friendListSchema);

module.exports = FriendList;
