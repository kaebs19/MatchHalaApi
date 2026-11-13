// نتيجة مباراة هلا لودو — تُحفظ مرة عند الانتهاء (الحركات نفسها في Redis فقط)
const mongoose = require('mongoose');

const ludoMatchSchema = new mongoose.Schema({
    gameId: { type: String, required: true, unique: true },
    mode: { type: String, enum: ['classic', 'quick', 'teams'], required: true },
    source: { type: String, enum: ['queue', 'room', 'solo', 'invite', 'challenge'], required: true },
    players: [{
        user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },  // null = بوت
        color: String,
        team: Number,
        place: Number,
        left: { type: Boolean, default: false },
        isBot: { type: Boolean, default: false },
        takenOver: { type: Boolean, default: false }   // تولّاه البوت بعد أدوار فائتة
    }],
    winners: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    rolls: { type: Number, default: 0 },
    // مباراة دوري (utils/ludo/economy.js) — غائبة في الودّية
    league: { type: String, enum: ['bronze', 'silver', 'gold'] },
    fee: Number,
    prize: Number,          // جائزة كل فائز
    // دردشة المباراة (utils/ludo/chat.js) — آخر 60 رسالة، للإشراف والبلاغات
    chat: [{
        _id: false,
        user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        text: String,
        at: Date
    }],
    startedAt: Date,
    endedAt: Date
}, { timestamps: false });

// سجلّ مباريات المستخدم (الأحدث أولاً) والإحصاءات
ludoMatchSchema.index({ 'players.user': 1, endedAt: -1 });

module.exports = mongoose.model('LudoMatch', ludoMatchSchema);
