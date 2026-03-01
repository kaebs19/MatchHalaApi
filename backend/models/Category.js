// HalaChat - Category Model
// نموذج التصنيفات للغرف

const mongoose = require('mongoose');

const categorySchema = new mongoose.Schema({
    // اسم التصنيف
    name: {
        type: String,
        required: [true, 'اسم التصنيف مطلوب'],
        unique: true,
        trim: true,
        maxlength: [50, 'اسم التصنيف يجب أن يكون أقل من 50 حرف']
    },

    // اسم الأيقونة (مثل: sports, music, games)
    icon: {
        type: String,
        trim: true,
        default: 'folder'
    },

    // لون التصنيف (hex color)
    color: {
        type: String,
        trim: true,
        default: '#007AFF',
        match: [/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/, 'صيغة اللون غير صحيحة']
    },

    // وصف التصنيف
    description: {
        type: String,
        trim: true,
        maxlength: [200, 'الوصف يجب أن يكون أقل من 200 حرف']
    },

    // ترتيب العرض
    order: {
        type: Number,
        default: 0
    },

    // هل التصنيف نشط؟
    isActive: {
        type: Boolean,
        default: true
    },

    // عدد الغرف في هذا التصنيف (يتم تحديثه تلقائياً)
    roomsCount: {
        type: Number,
        default: 0
    }
}, {
    timestamps: true
});

// فهرس للترتيب والحالة
categorySchema.index({ order: 1, isActive: 1 });
categorySchema.index({ name: 1 });

// دالة لتحديث عدد الغرف
categorySchema.statics.updateRoomsCount = async function(categoryId) {
    const ChatRoom = mongoose.model('ChatRoom');
    const count = await ChatRoom.countDocuments({
        category: categoryId,
        isActive: true
    });
    await this.findByIdAndUpdate(categoryId, { roomsCount: count });
    return count;
};

// دالة للحصول على التصنيفات النشطة مرتبة
categorySchema.statics.getActiveCategories = async function() {
    return this.find({ isActive: true })
        .sort({ order: 1, name: 1 })
        .select('name icon color description roomsCount');
};

module.exports = mongoose.model('Category', categorySchema);
