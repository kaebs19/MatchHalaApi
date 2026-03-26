// HalaChat Dashboard - Multer Configuration
// إعدادات رفع الملفات

const multer = require('multer');
const path = require('path');
const fs = require('fs');

// التأكد من وجود مجلد الرفع
const uploadDir = path.join(__dirname, '..', 'uploads', 'profile-images');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// إعدادات التخزين
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        // إنشاء اسم فريد للملف
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname);
        cb(null, 'profile-' + uniqueSuffix + ext);
    }
});

// فلتر أنواع الملفات
const fileFilter = (req, file, cb) => {
    // قبول الصور فقط
    const allowedTypes = /jpeg|jpg|png|gif|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);

    if (extname && mimetype) {
        return cb(null, true);
    } else {
        cb(new Error('نوع الملف غير مدعوم. يرجى رفع صورة فقط (JPEG, PNG, GIF, WEBP)'));
    }
};

// إعدادات multer
const upload = multer({
    storage: storage,
    limits: {
        fileSize: 2 * 1024 * 1024 // حد أقصى 2MB
    },
    fileFilter: fileFilter
});

// معالجة الصورة بأحجام متعددة بعد رفعها
const { processImageMiddleware } = require('../utils/imageProcessor');

// تصدير upload + middleware المعالجة
module.exports = upload;
module.exports.processProfileImage = processImageMiddleware({ prefix: 'profile' });
module.exports.processMessageImage = processImageMiddleware({ prefix: 'msg' });
