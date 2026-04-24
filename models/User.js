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
    bioStatus: {
        status: { type: String, enum: ['active', 'normal', 'banned'], default: 'active' },
        originalBio: { type: String, default: null },
        reason: { type: String, default: null },
        bannedAt: { type: Date, default: null }
    },
    interests: [{
        type: String,
        trim: true
    }],
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

    // ✅ بصمة الجهاز (Anti-Abuse)
    deviceFingerprint: { type: String, default: null, select: false },
    keychainToken: { type: String, default: null, select: false },
    deviceDetails: { type: mongoose.Schema.Types.Mixed, default: null, select: false },
    // ✅ آخر تحديث للبصمة (لمعرفة إذا المستخدم على النسخة المحدّثة)
    lastFingerprintUpdate: { type: Date, default: null },

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
        },
        // ✅ عدم الإزعاج — ساعات هادئة
        doNotDisturb: {
            enabled: { type: Boolean, default: false },
            startHour: { type: Number, default: 23 },  // 11 PM
            startMinute: { type: Number, default: 0 },
            endHour: { type: Number, default: 7 },     // 7 AM
            endMinute: { type: Number, default: 0 }
        },
        // ✅ Premium: قراءة سرية — لا يخبر المرسل
        invisibleRead: { type: Boolean, default: false }
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
    // ✅ Premium: لون اسم مخصص (hex)
    customNameColor: { type: String, default: null },
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
    // ✅ إخفاء العمر (يظهر كـ ?? بدل الرقم)
    showAge: { type: Boolean, default: true },
    // ✅ إخفاء الدولة
    showCountry: { type: Boolean, default: true },
    // ✅ استقبال طلبات محادثة جديدة (false = إيقاف كل الطلبات الجديدة)
    acceptingRequests: { type: Boolean, default: true },
    // ✅ Premium-only requests (يقبل طلبات من المشتركين فقط)
    premiumOnlyRequests: { type: Boolean, default: false },

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

    // ✅ شارة VIP (X-style) — تُمنح من الأدمن يدوياً أو تلقائياً للمشتركين
    vipBadge: {
        grantedByAdmin: { type: Boolean, default: false }, // الأدمن منحها يدوياً (تبقى حتى بعد انتهاء الاشتراك)
        grantedByAdminAt: { type: Date, default: null },
        grantedByAdminId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
        note: { type: String, default: null }              // ملاحظة الأدمن (سبب المنح)
    },

    // Super Likes
    superLikes: {
        daily: { type: Number, default: 0 },
        lastReset: { type: Date, default: Date.now }
    },

    // مخالفات الكلمات المحظورة (يومياً — يُعاد العدّاد كل يوم)
    bannedWords: {
        violations: { type: Number, default: 0 },
        lastViolationDate: { type: Date, default: null },  // تاريخ آخر مخالفة (لإعادة العدّاد يومياً)
        isBanned: { type: Boolean, default: false },
        bannedAt: { type: Date, default: null },
        banReason: { type: String, default: null }
    },

    // ✅ تعليق العضوية (إيقاف مؤقت) — نظام تدريجي
    // المستويات: 0=لا تعليق, 1=24h, 2=48h, 3=3d, 4=7d, 5=دائم
    suspension: {
        isSuspended: { type: Boolean, default: false },
        suspendedAt: { type: Date, default: null },
        suspendedUntil: { type: Date, default: null },   // null = دائم
        reason: { type: String, default: null },
        suspendedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
        level: { type: Number, default: 0, min: 0, max: 5 },            // مستوى التعليق الحالي
        totalSuspensions: { type: Number, default: 0 },                  // عدد مرات التعليق الكلي
        history: [{
            level: { type: Number },
            reason: { type: String },
            suspendedAt: { type: Date },
            suspendedUntil: { type: Date },
            suspendedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
            source: { type: String, enum: ['admin', 'auto'], default: 'admin' }
        }]
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
    // ✅ سجل تواريخ تغيير الاسم في آخر 30 يوم (3 مرات كحد أقصى)
    nameChangeHistory: { type: [Date], default: [] },

    // ✅ سجل حذف الصور (من الأدمن)
    photoRemovals: [{
        photoUrl: { type: String },
        reason: { type: String },
        removedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        removedAt: { type: Date, default: Date.now }
    }],

    // ✅ صحة الإشعارات (تتبع نجاح/فشل push notifications)
    pushHealth: {
        lastSuccessAt: { type: Date, default: null },     // آخر push وصل بنجاح
        lastFailureAt: { type: Date, default: null },     // آخر فشل
        lastError: { type: String, default: null },       // سبب آخر فشل
        consecutiveFailures: { type: Number, default: 0 }, // عداد الفشل المتتالي
        totalSuccess: { type: Number, default: 0 },       // إجمالي النجاحات
        totalFailures: { type: Number, default: 0 },      // إجمالي الفشل
        noTokenSince: { type: Date, default: null },      // متى لاحظنا عدم وجود token
        notificationsDisabled: { type: Boolean, default: false } // علم إذا الإشعارات معطّلة فعلياً
    },

    // ✅ قيود الأدمن (منع تغيير الصورة/الاسم لفترة)
    restrictions: {
        photoBlocked: { type: Boolean, default: false },
        photoBlockedUntil: { type: Date, default: null },
        photoBlockedReason: { type: String, default: null },
        nameBlocked: { type: Boolean, default: false },
        nameBlockedUntil: { type: Date, default: null },
        nameBlockedReason: { type: String, default: null },
        // ✅ تقييد المراسلة (نظام تدريجي)
        messagingRestricted: { type: Boolean, default: false },
        messagingRestrictedUntil: { type: Date, default: null },
        messagingRestrictedLevel: { type: String, enum: ['new_only', 'all', null], default: null },
        restrictionReason: { type: String, default: null }
    },

    // ✅ نظام التحذيرات (قبل التعليق)
    warnings: {
        level: { type: Number, default: 0, min: 0, max: 2 },
        lastWarningAt: { type: Date, default: null },
        history: [{
            level: { type: Number },
            reason: { type: String },
            issuedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
            source: { type: String, enum: ['admin', 'auto'], default: 'admin' },
            at: { type: Date, default: Date.now }
        }]
    }
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
// ✅ email index handled automatically by 'unique: true' on field
userSchema.index({ location: '2dsphere' });
userSchema.index({ isPremium: 1 });
userSchema.index({ 'verification.status': 1 });
// ✅ indexes للـ discover/swipes (slow query optimization)
userSchema.index({ isActive: 1, 'privacySettings.profileVisibility': 1, lastLogin: -1 }, { name: 'discover_active_visibility_lastLogin' });
userSchema.index({ isActive: 1, lastLogin: -1, gender: 1 }, { name: 'discover_active_lastLogin_gender' });
userSchema.index({ createdAt: -1 });
userSchema.index({ 'suspension.isSuspended': 1, 'suspension.suspendedUntil': 1 });

const User = mongoose.model('User', userSchema);

module.exports = User;
