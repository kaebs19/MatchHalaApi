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

module.exports = {
    getFullUrl,
    getBestUserImage,
    getUserImage,
    uploadMessageImage,
    uploadMessageAudio,
    uploadVerificationSelfie
};
