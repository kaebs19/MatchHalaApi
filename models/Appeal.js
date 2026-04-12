// HalaChat Dashboard - Appeal Model
// نموذج الاستئناف في قاعدة البيانات

const mongoose = require('mongoose');

const appealSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: [true, 'المستخدم مطلوب'],
        index: true
    },
    reason: {
        type: String,
        required: [true, 'سبب الاستئناف مطلوب'],
        maxlength: [1000, 'سبب الاستئناف يجب ألا يتجاوز 1000 حرف'],
        trim: true
    },
    status: {
        type: String,
        enum: ['pending', 'forwarded', 'under_review', 'approved', 'rejected'],
        default: 'pending'
    },
    statusHistory: [{
        status: {
            type: String,
            enum: ['pending', 'forwarded', 'under_review', 'approved', 'rejected'],
            required: true
        },
        note: {
            type: String,
            default: ''
        },
        changedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User'
        },
        changedAt: {
            type: Date,
            default: Date.now
        }
    }],
    adminNote: {
        type: String,
        default: ''
    },
    actionType: {
        type: String,
        enum: ['suspension', 'ban', 'device_ban', 'restriction'],
        required: [true, 'نوع الإجراء المستأنف مطلوب']
    },
    suspensionLevel: {
        type: Number,
        min: 1,
        max: 5
    },
    resolvedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    resolvedAt: {
        type: Date
    }
}, {
    timestamps: true
});

// Indexes للبحث السريع
appealSchema.index({ status: 1 });
appealSchema.index({ actionType: 1 });
appealSchema.index({ createdAt: -1 });
appealSchema.index({ user: 1, status: 1 });

const Appeal = mongoose.model('Appeal', appealSchema);

module.exports = Appeal;
