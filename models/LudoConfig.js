// إعدادات هلا لودو من لوحة التحكم (وثيقة واحدة key='main') — utils/ludo/config.js يطبّقها على كل نسخة خلال دقيقة
const mongoose = require('mongoose');

const ludoConfigSchema = new mongoose.Schema({
    key: { type: String, default: 'main', unique: true },
    data: { type: mongoose.Schema.Types.Mixed, default: {} },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }
}, { timestamps: true, minimize: false });

module.exports = mongoose.model('LudoConfig', ludoConfigSchema);
