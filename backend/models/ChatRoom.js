// نموذج غرف المحادثة - Chat Room Model
const mongoose = require('mongoose');

const chatRoomSchema = new mongoose.Schema({
    // اسم الغرفة
    name: {
        type: String,
        required: [true, 'اسم الغرفة مطلوب'],
        trim: true,
        maxlength: [100, 'اسم الغرفة يجب أن يكون أقل من 100 حرف']
    },

    // صورة الغرفة (URL)
    image: {
        type: String,
        default: 'https://via.placeholder.com/150?text=ChatRoom'
    },

    // الوصف
    description: {
        type: String,
        trim: true,
        maxlength: [500, 'الوصف يجب أن يكون أقل من 500 حرف'],
        default: ''
    },

    // التصنيف
    category: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Category'
    },

    // الوسوم (Tags) للبحث
    tags: [{
        type: String,
        trim: true,
        maxlength: [20, 'الوسم يجب أن يكون أقل من 20 حرف']
    }],

    // صلاحية الوصول
    accessType: {
        type: String,
        enum: ['public', 'private'], // public: يمكن لأي مستخدم، private: دعوة فقط
        default: 'public'
    },

    // الأعضاء (إذا كانت خاصة)
    members: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }],

    // المسؤولون عن الغرفة
    admins: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }],

    // المشرفون (Moderators) - صلاحيات أقل من Admins
    moderators: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }],

    // السعة القصوى للأعضاء
    capacity: {
        type: Number,
        default: 1000,
        min: [2, 'السعة يجب أن تكون على الأقل 2'],
        max: [10000, 'السعة القصوى 10000']
    },

    // عدد الأعضاء الحالي
    memberCount: {
        type: Number,
        default: 0
    },

    // عدد الرسائل
    messageCount: {
        type: Number,
        default: 0
    },

    // آخر رسالة
    lastMessage: {
        content: String,
        sender: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User'
        },
        sentAt: Date
    },

    // حالة الغرفة
    isActive: {
        type: Boolean,
        default: true
    },

    // مقفلة (لا يمكن إرسال رسائل)
    isLocked: {
        type: Boolean,
        default: false
    },

    // قواعد الغرفة
    rules: [{
        type: String,
        trim: true,
        maxlength: [200, 'القاعدة يجب أن تكون أقل من 200 حرف']
    }],

    // الرسائل المثبتة
    pinnedMessages: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Message'
    }],

    // الإعلان المثبت (من الأدمن)
    pinnedMessage: {
        content: { type: String, default: '' },
        createdAt: { type: Date },
        createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
    },

    // إعدادات الغرفة
    settings: {
        allowImages: { type: Boolean, default: true },
        allowVideos: { type: Boolean, default: true },
        allowFiles: { type: Boolean, default: true },
        allowLinks: { type: Boolean, default: true },
        maxMessageLength: { type: Number, default: 1000 },
        slowMode: { type: Number, default: 0 }, // عدد الثواني بين الرسائل
        requireApproval: { type: Boolean, default: false }, // يتطلب موافقة للانضمام
        autoModeration: { type: Boolean, default: false }, // فلترة تلقائية للمحتوى
        muteDuration: { type: Number, default: 3600 } // مدة كتم المستخدمين بالثواني (افتراضي: ساعة)
    },

    // إحصائيات متقدمة
    analytics: {
        peakMemberCount: { type: Number, default: 0 },
        totalMessagesToday: { type: Number, default: 0 },
        lastResetDate: { type: Date, default: Date.now }
    },

    // إنشئت بواسطة
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },

    // التواريخ
    createdAt: {
        type: Date,
        default: Date.now
    },
    updatedAt: {
        type: Date,
        default: Date.now
    }
}, {
    timestamps: true
});

// Indexes للبحث السريع
chatRoomSchema.index({ name: 1 });
chatRoomSchema.index({ accessType: 1, isActive: 1 });
chatRoomSchema.index({ createdBy: 1 });
chatRoomSchema.index({ members: 1 });
chatRoomSchema.index({ category: 1 });
chatRoomSchema.index({ tags: 1 });
chatRoomSchema.index({ name: 'text', description: 'text' }); // Text search
chatRoomSchema.index({ memberCount: -1 }); // للترتيب حسب الشعبية
chatRoomSchema.index({ 'lastMessage.sentAt': -1 }); // للترتيب حسب النشاط
chatRoomSchema.index({ createdAt: -1 });

// دالة للتحقق إذا كان المستخدم عضواً
chatRoomSchema.methods.isMember = function(userId) {
    if (this.accessType === 'public') return true;
    return this.members.some(memberId => memberId.toString() === userId.toString());
};

// دالة للتحقق إذا كان المستخدم مسؤولاً
chatRoomSchema.methods.isAdmin = function(userId) {
    return this.admins.some(adminId => adminId.toString() === userId.toString());
};

// دالة للتحقق إذا كان المستخدم مشرفاً
chatRoomSchema.methods.isModerator = function(userId) {
    return this.moderators.some(modId => modId.toString() === userId.toString());
};

// دالة للتحقق من الصلاحيات الكاملة (Admin أو Moderator)
chatRoomSchema.methods.hasModeratorAccess = function(userId) {
    return this.isAdmin(userId) || this.isModerator(userId);
};

// دالة للتحقق من السعة
chatRoomSchema.methods.isFull = function() {
    return this.memberCount >= this.capacity;
};

// دالة لإضافة عضو
chatRoomSchema.methods.addMember = async function(userId) {
    if (this.isFull()) {
        throw new Error('الغرفة ممتلئة');
    }
    if (!this.members.includes(userId)) {
        this.members.push(userId);
        this.memberCount = this.members.length;

        // تحديث أعلى عدد أعضاء
        if (this.memberCount > this.analytics.peakMemberCount) {
            this.analytics.peakMemberCount = this.memberCount;
        }

        await this.save();
    }
};

// دالة لإزالة عضو
chatRoomSchema.methods.removeMember = async function(userId) {
    this.members = this.members.filter(id => id.toString() !== userId.toString());
    this.memberCount = this.members.length;
    await this.save();
};

// دالة لتحديث آخر رسالة
chatRoomSchema.methods.updateLastMessage = async function(message) {
    this.lastMessage = {
        content: message.content,
        sender: message.sender,
        sentAt: message.createdAt || new Date()
    };
    this.messageCount++;
    this.analytics.totalMessagesToday++;
    this.updatedAt = new Date();
    await this.save();
};

// دالة لإعادة تعيين إحصائيات اليوم
chatRoomSchema.methods.resetDailyStats = async function() {
    const now = new Date();
    const lastReset = this.analytics.lastResetDate;

    // إعادة تعيين إذا مر يوم كامل
    if (now.getDate() !== lastReset.getDate()) {
        this.analytics.totalMessagesToday = 0;
        this.analytics.lastResetDate = now;
        await this.save();
    }
};

// دالة لإضافة/إزالة رسالة مثبتة
chatRoomSchema.methods.togglePinnedMessage = async function(messageId) {
    const index = this.pinnedMessages.indexOf(messageId);
    if (index > -1) {
        this.pinnedMessages.splice(index, 1);
    } else {
        if (this.pinnedMessages.length >= 5) {
            throw new Error('لا يمكن تثبيت أكثر من 5 رسائل');
        }
        this.pinnedMessages.push(messageId);
    }
    await this.save();
};

// Middleware للتحقق قبل الحفظ
chatRoomSchema.pre('save', function() {
    // التأكد من أن عدد الوسوم لا يتجاوز 10
    if (this.tags && this.tags.length > 10) {
        this.tags = this.tags.slice(0, 10);
    }

    // التأكد من أن عدد القواعد لا يتجاوز 20
    if (this.rules && this.rules.length > 20) {
        this.rules = this.rules.slice(0, 20);
    }
});

module.exports = mongoose.model('ChatRoom', chatRoomSchema);
