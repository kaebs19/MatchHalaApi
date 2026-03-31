// HalaChat Dashboard - User Model
// نموذج المستخدم في قاعدة البيانات

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
    name: {
        type: String,
        required: [true, 'الاسم مطلوب'],
        trim: true,
        minlength: [2, 'الاسم يجب أن يكون حرفين على الأقل']
    },
    email: {
        type: String,
        required: [true, 'البريد الإلكتروني مطلوب'],
        unique: true,
        lowercase: true,
        trim: true,
        match: [/^\S+@\S+\.\S+$/, 'البريد الإلكتروني غير صحيح']
    },
    password: {
        type: String,
        required: false, // غير مطلوبة للتسجيل عبر Google/Apple
        minlength: [6, 'كلمة المرور يجب أن تكون 6 أحرف على الأقل'],
        select: false // لا نرجع كلمة المرور في الاستعلامات العادية
    },
    role: {
        type: String,
        enum: ['admin', 'user'],
        default: 'user'
    },
    isActive: {
        type: Boolean,
        default: true
    },
    lastLogin: {
        type: Date
    },
    isOnline: {
        type: Boolean,
        default: false
    },
    // حقول إعادة تعيين كلمة المرور
    resetPasswordToken: {
        type: String,
        select: false
    },
    resetPasswordExpire: {
        type: Date,
        select: false
    },
    // حقول الملف الشخصي
    profileImage: {
        type: String,
        default: null
    },
    // صور بأحجام متعددة (thumbnail, medium, original)
    photos: [{
        original: { type: String },
        medium: { type: String },
        thumbnail: { type: String },
        order: { type: Number, default: 0 }
    }],
    birthDate: {
        type: Date,
        default: null
    },
    gender: {
        type: String,
        enum: ['male', 'female', null],
        default: null
    },
    country: {
        type: String,
        default: null,
        trim: true
    },
    bio: {
        type: String,
        default: null,
        maxlength: [500, 'النبذة يجب أن لا تتجاوز 500 حرف']
    },
    // نوع التسجيل (app, google, apple)
    authProvider: {
        type: String,
        enum: ['app', 'google', 'apple'],
        default: 'app'
    },
    // معرفات التسجيل الخارجية
    googleId: {
        type: String,
        default: null,
        sparse: true
    },
    appleId: {
        type: String,
        default: null,
        sparse: true
    },
    // Device Token للإشعارات (APNs)
    deviceToken: {
        type: String,
        default: null
    },
    // FCM Token للإشعارات (Firebase Cloud Messaging)
    fcmToken: {
        type: String,
        default: null
    },
    // معلومات الجهاز
    deviceInfo: {
        platform: { type: String, default: null },
        osVersion: { type: String, default: null },
        appVersion: { type: String, default: null },
        deviceModel: { type: String, default: null },  // iPhone 15 Pro, etc.
        language: { type: String, default: null }       // ar, en
    },

    // معلومات الشبكة والموقع التفصيلي
    city: { type: String, default: null },
    lastIP: { type: String, default: null, select: false },

    // سجل تسجيل الدخول (آخر 20 دخول)
    loginHistory: [{
        ip: String,
        country: String,
        city: String,
        deviceModel: String,
        platform: String,
        appVersion: String,
        loginAt: { type: Date, default: Date.now }
    }],
    // إعدادات الخصوصية
    privacySettings: {
        // إخفاء الملف الشخصي: public (للجميع), contacts (جهات الاتصال فقط), private (مخفي)
        profileVisibility: {
            type: String,
            enum: ['public', 'contacts', 'private'],
            default: 'public'
        },
        // إخفاء آخر ظهور
        showLastSeen: {
            type: Boolean,
            default: true
        },
        // صوت الإشعارات
        notificationSound: {
            type: Boolean,
            default: true
        }
    },
    // قائمة المستخدمين المحظورين
    blockedUsers: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }],
    // قائمة المحادثات المكتومة
    mutedConversations: [{
        conversationId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Conversation'
        },
        mutedUntil: {
            type: Date,
            default: null // null = مكتوم للأبد
        }
    }],
    // ============ Premium Features ============

    // الاشتراك المميز
    isPremium: { type: Boolean, default: false },
    premiumPlan: {
        type: String,
        enum: ['weekly', 'monthly', 'quarterly', null],
        default: null
    },
    premiumExpiresAt: { type: Date, default: null },

    // بيانات StoreKit 2 (Apple)
    subscriptionTransactionId: { type: String, default: null },
    subscriptionOriginalTransactionId: { type: String, default: null },

    // الموقع الجغرافي (GeoJSON)
    location: {
        type: { type: String, enum: ['Point'], default: 'Point' },
        coordinates: { type: [Number], default: [0, 0] } // [longitude, latitude]
    },

    // وضع التخفي (للمشتركين فقط)
    stealthMode: { type: Boolean, default: false },
    // إخفاء/إظهار المسافة عن المستخدمين الآخرين
    showDistance: { type: Boolean, default: true },

    // توثيق الحساب
    verification: {
        isVerified: { type: Boolean, default: false },
        selfieUrl: { type: String, default: null },
        status: {
            type: String,
            enum: ['none', 'pending', 'approved', 'rejected'],
            default: 'none'
        },
        submittedAt: { type: Date, default: null },
        reviewedAt: { type: Date, default: null }
    },

    // Super Likes
    superLikes: {
        daily: { type: Number, default: 0 },
        lastReset: { type: Date, default: Date.now }
    },

    // مخالفات الكلمات المحظورة
    bannedWords: {
        violations: { type: Number, default: 0 },
        isBanned: { type: Boolean, default: false },
        bannedAt: { type: Date, default: null },
        banReason: { type: String, default: null }
    },

    // ✅ تعليق العضوية (إيقاف مؤقت)
    suspension: {
        isSuspended: { type: Boolean, default: false },
        suspendedAt: { type: Date, default: null },
        suspendedUntil: { type: Date, default: null },   // null = دائم
        reason: { type: String, default: null },
        suspendedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }
    },

    // ✅ حالة الاسم (عادي / محظور / معلق)
    nameStatus: {
        status: {
            type: String,
            enum: ['normal', 'suspended', 'banned'],
            default: 'normal'
        },
        originalName: { type: String, default: null },       // الاسم الأصلي قبل التعليق
        reason: { type: String, default: null },
        changedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
        changedAt: { type: Date, default: null }
    },

    // ✅ آخر تغيير للصورة والاسم (cooldown)
    lastPhotoChange: { type: Date, default: null },
    lastNameChange: { type: Date, default: null },

    // ✅ سجل حذف الصور (من الأدمن)
    photoRemovals: [{
        photoUrl: { type: String },
        reason: { type: String },
        removedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        removedAt: { type: Date, default: Date.now }
    }]
}, {
    timestamps: true // يضيف createdAt و updatedAt تلقائياً
});

// تشفير كلمة المرور قبل الحفظ
userSchema.pre('save', async function() {
    // إذا لم تتغير كلمة المرور، تخطى
    if (!this.isModified('password')) {
        return;
    }

    // لا تشفر كلمة المرور إذا كانت فارغة (للتسجيل عبر Google/Apple)
    if (!this.password) {
        return;
    }

    // تشفير كلمة المرور
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
});

// دالة للتحقق من كلمة المرور
userSchema.methods.comparePassword = async function(candidatePassword) {
    try {
        return await bcrypt.compare(candidatePassword, this.password);
    } catch (error) {
        throw new Error('خطأ في التحقق من كلمة المرور');
    }
};

// دالة لإرجاع بيانات المستخدم بدون كلمة المرور
userSchema.methods.toJSON = function() {
    const user = this.toObject();
    delete user.password;
    delete user.resetPasswordToken;
    delete user.resetPasswordExpire;
    return user;
};

// دالة لتوليد رمز إعادة تعيين كلمة المرور
userSchema.methods.generateResetToken = function() {
    // توليد رمز عشوائي مكون من 6 أرقام
    const resetToken = Math.floor(100000 + Math.random() * 900000).toString();

    // حفظ الرمز مشفر في قاعدة البيانات
    const crypto = require('crypto');
    this.resetPasswordToken = crypto
        .createHash('sha256')
        .update(resetToken)
        .digest('hex');

    // تعيين صلاحية الرمز لمدة 10 دقائق
    this.resetPasswordExpire = Date.now() + 10 * 60 * 1000;

    return resetToken;
};

// Indexes للبحث السريع
userSchema.index({ name: 'text' });
userSchema.index({ gender: 1, country: 1 });
userSchema.index({ isOnline: -1, lastLogin: -1 });
userSchema.index({ email: 1 }, { unique: true });
userSchema.index({ location: '2dsphere' });
userSchema.index({ isPremium: 1 });
userSchema.index({ 'verification.status': 1 });

const User = mongoose.model('User', userSchema);

module.exports = User;
