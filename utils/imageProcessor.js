// Image Processor - معالجة الصور بأحجام متعددة
const sharp = require('sharp');
const path = require('path');
const fs = require('fs').promises;

const UPLOAD_BASE = path.join(__dirname, '..', 'uploads');

// التأكد من وجود المجلدات
const ensureDirs = async () => {
    const dirs = ['thumb', 'medium', 'original'];
    for (const dir of dirs) {
        const dirPath = path.join(UPLOAD_BASE, dir);
        await fs.mkdir(dirPath, { recursive: true });
    }
};

// تهيئة المجلدات عند التشغيل
ensureDirs().catch(err => console.error('خطأ في إنشاء مجلدات الصور:', err));

/**
 * معالجة صورة واحدة وإنشاء 3 نسخ
 * @param {string} inputPath - مسار الصورة الأصلية
 * @param {object} options - خيارات إضافية
 * @returns {{ thumbnail: string, medium: string, original: string }}
 */
const processImage = async (inputPath, options = {}) => {
    const {
        prefix = 'img',
        keepOriginalFile = false
    } = options;

    try {
        await ensureDirs();

        const uniqueName = `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}.webp`;

        // قراءة الصورة الأصلية مرة واحدة
        const inputBuffer = await fs.readFile(inputPath);
        const metadata = await sharp(inputBuffer).metadata();

        // تخطي GIF (لا يدعم sharp الحركة)
        if (metadata.format === 'gif') {
            const fallbackPath = `/uploads/profile-images/${path.basename(inputPath)}`;
            return {
                thumbnail: fallbackPath,
                medium: fallbackPath,
                original: fallbackPath
            };
        }

        // 1. Thumbnail: 150x150, جودة 70%
        const thumbPath = path.join(UPLOAD_BASE, 'thumb', uniqueName);
        await sharp(inputBuffer)
            .resize(150, 150, { fit: 'cover', position: 'center' })
            .webp({ quality: 70 })
            .toFile(thumbPath);

        // 2. Medium: 400x400, جودة 80%
        const mediumPath = path.join(UPLOAD_BASE, 'medium', uniqueName);
        await sharp(inputBuffer)
            .resize(400, 400, { fit: 'inside', withoutEnlargement: true })
            .webp({ quality: 80 })
            .toFile(mediumPath);

        // 3. Original: أقصى عرض 1200px, جودة 85%
        const originalPath = path.join(UPLOAD_BASE, 'original', uniqueName);
        await sharp(inputBuffer)
            .resize(1200, 1200, { fit: 'inside', withoutEnlargement: true })
            .webp({ quality: 85 })
            .toFile(originalPath);

        // حذف الملف المؤقت الأصلي (الذي رفعه multer)
        if (!keepOriginalFile) {
            try {
                await fs.unlink(inputPath);
            } catch (e) {
                // تجاهل خطأ الحذف
            }
        }

        const result = {
            thumbnail: `/uploads/thumb/${uniqueName}`,
            medium: `/uploads/medium/${uniqueName}`,
            original: `/uploads/original/${uniqueName}`
        };

        console.log(`📸 تمت معالجة الصورة: ${uniqueName} (${metadata.width}x${metadata.height})`);
        return result;

    } catch (error) {
        console.error('❌ خطأ في معالجة الصورة:', error);
        // في حالة الفشل، احتفظ بالصورة الأصلية
        const fallbackPath = `/uploads/profile-images/${path.basename(inputPath)}`;
        return {
            thumbnail: fallbackPath,
            medium: fallbackPath,
            original: fallbackPath
        };
    }
};

/**
 * Middleware لمعالجة الصورة بعد رفعها عبر multer
 * يُضيف req.processedImage بالمسارات الثلاثة
 */
const processImageMiddleware = (options = {}) => {
    return async (req, res, next) => {
        if (!req.file) return next();
        if (!req.file.mimetype.startsWith('image/')) return next();

        try {
            req.processedImage = await processImage(req.file.path, {
                prefix: options.prefix || 'profile',
                keepOriginalFile: false
            });
        } catch (error) {
            console.error('خطأ في middleware معالجة الصور:', error);
            // تابع حتى لو فشلت المعالجة
        }
        next();
    };
};

module.exports = { processImage, processImageMiddleware };
