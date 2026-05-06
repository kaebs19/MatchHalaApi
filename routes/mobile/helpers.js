// Mobile Routes - Shared Helpers & Configs
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Helper: تحويل المسار النسبي إلى URL كامل
const getFullUrl = (filePath) => {
    if (!filePath) return null;
    if (filePath.startsWith('http')) return filePath;
    const baseUrl = process.env.BASE_URL || 'https://matchhala.chathala.com';
    return `${baseUrl}${filePath}`;
};

// Helper: جلب أفضل صورة متاحة للمستخدم (photos أولاً، ثم profileImage)
const getBestUserImage = (user) => {
    if (user.photos && user.photos.length > 0) {
        const photo = user.photos.sort((a, b) => (a.order || 0) - (b.order || 0))[0];
        return photo.thumbnail || photo.medium || photo.original || user.profileImage;
    }
    return user.profileImage || null;
};

// Helper: جلب صورة المستخدم بالحجم المناسب
// size: 'thumbnail' | 'medium' | 'original'
const getUserImage = (user, size = 'original') => {
    // profileImage هو المصدر الأساسي دائماً
    if (user.profileImage) {
        return getFullUrl(user.profileImage);
    }
    // fallback: أول صورة في photos
    if (user.photos && user.photos.length > 0) {
        const mainPhoto = user.photos.find(p => p.order === 0) || user.photos[0];
        if (mainPhoto && mainPhoto[size]) {
            return getFullUrl(mainPhoto[size]);
        }
    }
    return null;
};

// Helper: هل المستخدم محظور بشكل كامل؟
// (للإخفاء من البحث/الاستكشاف/إظهار الاسم/الصورة عبر التطبيق)
const isUserFullyBanned = (user) => {
    if (!user) return false;
    if (user.isActive === false) return true;
    if (user.bannedWords?.isBanned) return true;
    // تعليق دائم (level 5)
    if (user.suspension?.isSuspended && user.suspension?.level >= 5) return true;
    return false;
};

// Helper: قناع بيانات المستخدم المحظور — يحافظ على _id لكن يخفي الاسم/الصورة
// يستخدم في الـ list endpoints ورسائل المحادثات لإظهار "مستخدم موقوف"
const maskBannedUser = (user) => {
    if (!user) return user;
    // lean objects أو mongoose documents
    const userObj = user.toObject ? user.toObject() : { ...user };
    if (!isUserFullyBanned(userObj)) return userObj;

    userObj.name = 'مستخدم موقوف';
    userObj.profileImage = null;
    userObj.photos = [];
    userObj.bio = '';
    userObj.isSuspendedAccount = true; // flag للتطبيق لعرض أيقونة
    userObj.isOnline = false;
    userObj.isPremium = false;
    if (userObj.verification) userObj.verification = { isVerified: false };
    return userObj;
};

// إعداد multer لرفع صور الرسائل
const messagesUploadDir = path.join(__dirname, '..', '..', 'uploads', 'messages');
if (!fs.existsSync(messagesUploadDir)) {
    fs.mkdirSync(messagesUploadDir, { recursive: true });
}

const messageStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, messagesUploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueName = `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}${path.extname(file.originalname)}`;
        cb(null, uniqueName);
    }
});

const uploadMessageImage = multer({
    storage: messageStorage,
    limits: { fileSize: 1 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowedTypes = /jpeg|jpg|png|gif|webp/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);
        if (extname && mimetype) {
            cb(null, true);
        } else {
            cb(new Error('فقط الصور مسموحة (JPEG, PNG, GIF, WEBP)'));
        }
    }
});

// إعداد multer لرفع الرسائل الصوتية
const audioUploadDir = path.join(__dirname, '..', '..', 'uploads', 'audio');
if (!fs.existsSync(audioUploadDir)) {
    fs.mkdirSync(audioUploadDir, { recursive: true });
}

const audioStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, audioUploadDir);
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname) || '.m4a';
        const uniqueName = `voice-${Date.now()}-${Math.random().toString(36).substr(2, 9)}${ext}`;
        cb(null, uniqueName);
    }
});

const uploadMessageAudio = multer({
    storage: audioStorage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB كحد أقصى
    fileFilter: (req, file, cb) => {
        const allowedMimes = /audio\/(m4a|mp4|mpeg|aac|x-m4a|wav|webm)/;
        if (allowedMimes.test(file.mimetype) || /\.(m4a|mp3|wav|aac)$/i.test(file.originalname)) {
            cb(null, true);
        } else {
            cb(new Error('فقط ملفات الصوت مسموحة'));
        }
    }
});

// إعداد multer لرفع صور التوثيق (Verification Selfies)
const verificationsUploadDir = path.join(__dirname, '..', '..', 'uploads', 'verifications');
if (!fs.existsSync(verificationsUploadDir)) {
    fs.mkdirSync(verificationsUploadDir, { recursive: true });
}

const verificationStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, verificationsUploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueName = `verify-${Date.now()}-${Math.random().toString(36).substr(2, 9)}${path.extname(file.originalname)}`;
        cb(null, uniqueName);
    }
});

const uploadVerificationSelfie = multer({
    storage: verificationStorage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowedTypes = /jpeg|jpg|png/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);
        if (extname && mimetype) {
            cb(null, true);
        } else {
            cb(new Error('فقط الصور مسموحة (JPEG, PNG)'));
        }
    }
});

// ✅ Phase 3: إعداد multer لرفع لقطات شاشة البلاغات
const reportsUploadDir = path.join(__dirname, '..', '..', 'uploads', 'reports');
if (!fs.existsSync(reportsUploadDir)) {
    fs.mkdirSync(reportsUploadDir, { recursive: true });
}

const reportStorage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, reportsUploadDir),
    filename: (req, file, cb) => {
        const uniqueName = `report-${Date.now()}-${Math.random().toString(36).substr(2, 9)}${path.extname(file.originalname)}`;
        cb(null, uniqueName);
    }
});

const uploadReportScreenshot = multer({
    storage: reportStorage,
    limits: { fileSize: 2 * 1024 * 1024 },   // 2MB max
    fileFilter: (req, file, cb) => {
        const allowedTypes = /jpeg|jpg|png|webp/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);
        if (extname && mimetype) cb(null, true);
        else cb(new Error('فقط الصور مسموحة (JPEG, PNG, WEBP)'));
    }
});

module.exports = {
    getFullUrl,
    getBestUserImage,
    getUserImage,
    isUserFullyBanned,
    maskBannedUser,
    uploadMessageImage,
    uploadMessageAudio,
    uploadVerificationSelfie,
    uploadReportScreenshot
};
