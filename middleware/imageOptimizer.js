// Image Optimizer Middleware - تحسين الصور عند الرفع
const sharp = require('sharp');
const path = require('path');
const fs = require('fs').promises;

/**
 * Middleware لتحسين الصور بعد رفعها
 * يقوم بضغط الصور وتغيير حجمها
 */
const optimizeImage = (options = {}) => {
    const {
        maxWidth = 1200,      // الحد الأقصى للعرض
        maxHeight = 1200,     // الحد الأقصى للارتفاع
        quality = 80,         // جودة الضغط (1-100)
        format = 'auto',      // تنسيق الإخراج (auto, jpeg, png, webp)
        thumbnail = false,    // إنشاء صورة مصغرة
        thumbnailWidth = 150, // عرض الصورة المصغرة
        thumbnailHeight = 150 // ارتفاع الصورة المصغرة
    } = options;

    return async (req, res, next) => {
        // إذا لم يكن هناك ملف، تابع
        if (!req.file && !req.files) {
            return next();
        }

        try {
            const files = req.file ? [req.file] : (req.files || []);

            for (const file of files) {
                // التحقق من أن الملف صورة
                if (!file.mimetype.startsWith('image/')) {
                    continue;
                }

                // تجاهل ملفات GIF (لأن sharp لا يدعم الحركة)
                if (file.mimetype === 'image/gif') {
                    continue;
                }

                const filePath = file.path;
                const fileExt = path.extname(file.originalname).toLowerCase();
                const fileDir = path.dirname(filePath);
                const fileBasename = path.basename(filePath, path.extname(filePath));

                // قراءة الصورة
                let image = sharp(filePath);
                const metadata = await image.metadata();

                // تحديد ما إذا كانت الصورة بحاجة لتغيير الحجم
                let needsResize = false;
                if (metadata.width > maxWidth || metadata.height > maxHeight) {
                    needsResize = true;
                }

                // تحديد التنسيق
                let outputFormat = format;
                if (format === 'auto') {
                    // استخدم التنسيق الأصلي أو jpeg إذا كان غير مدعوم
                    if (['jpeg', 'jpg', 'png', 'webp'].includes(fileExt.replace('.', ''))) {
                        outputFormat = fileExt.replace('.', '').replace('jpg', 'jpeg');
                    } else {
                        outputFormat = 'jpeg';
                    }
                }

                // تطبيق التحسينات
                if (needsResize) {
                    image = image.resize(maxWidth, maxHeight, {
                        fit: 'inside',
                        withoutEnlargement: true
                    });
                }

                // ضغط حسب التنسيق
                switch (outputFormat) {
                    case 'jpeg':
                    case 'jpg':
                        image = image.jpeg({ quality, progressive: true });
                        break;
                    case 'png':
                        image = image.png({ quality, compressionLevel: 9 });
                        break;
                    case 'webp':
                        image = image.webp({ quality });
                        break;
                    default:
                        image = image.jpeg({ quality, progressive: true });
                }

                // حفظ الصورة المحسنة
                const tempPath = `${filePath}.optimized`;
                await image.toFile(tempPath);

                // استبدال الملف الأصلي بالمحسن
                await fs.unlink(filePath);
                await fs.rename(tempPath, filePath);

                // إنشاء صورة مصغرة إذا مطلوب
                if (thumbnail) {
                    const thumbnailPath = path.join(fileDir, `${fileBasename}_thumb${path.extname(filePath)}`);

                    await sharp(filePath)
                        .resize(thumbnailWidth, thumbnailHeight, {
                            fit: 'cover',
                            position: 'center'
                        })
                        .toFile(thumbnailPath);

                    // إضافة مسار الصورة المصغرة للملف
                    file.thumbnailPath = thumbnailPath;
                    file.thumbnailFilename = path.basename(thumbnailPath);
                }

                // تحديث حجم الملف
                const stats = await fs.stat(filePath);
                file.size = stats.size;
                file.optimized = true;

                console.log(`📸 تم تحسين الصورة: ${file.originalname} (${metadata.width}x${metadata.height} -> optimized)`);
            }

            next();
        } catch (error) {
            console.error('❌ خطأ في تحسين الصورة:', error);
            // في حالة الخطأ، تابع بدون تحسين
            next();
        }
    };
};

/**
 * تحسين صورة موجودة
 * @param {string} imagePath - مسار الصورة
 * @param {object} options - خيارات التحسين
 */
const optimizeExistingImage = async (imagePath, options = {}) => {
    const {
        maxWidth = 1200,
        maxHeight = 1200,
        quality = 80
    } = options;

    try {
        const image = sharp(imagePath);
        const metadata = await image.metadata();

        // تجاهل GIF
        if (metadata.format === 'gif') {
            return { optimized: false, reason: 'GIF not supported' };
        }

        let pipeline = image;

        // تغيير الحجم إذا لزم الأمر
        if (metadata.width > maxWidth || metadata.height > maxHeight) {
            pipeline = pipeline.resize(maxWidth, maxHeight, {
                fit: 'inside',
                withoutEnlargement: true
            });
        }

        // ضغط الصورة
        switch (metadata.format) {
            case 'jpeg':
                pipeline = pipeline.jpeg({ quality, progressive: true });
                break;
            case 'png':
                pipeline = pipeline.png({ quality, compressionLevel: 9 });
                break;
            case 'webp':
                pipeline = pipeline.webp({ quality });
                break;
            default:
                pipeline = pipeline.jpeg({ quality, progressive: true });
        }

        const tempPath = `${imagePath}.optimized`;
        await pipeline.toFile(tempPath);
        await fs.unlink(imagePath);
        await fs.rename(tempPath, imagePath);

        const stats = await fs.stat(imagePath);

        return {
            optimized: true,
            originalSize: metadata.size,
            newSize: stats.size,
            dimensions: { width: metadata.width, height: metadata.height }
        };
    } catch (error) {
        console.error('خطأ في تحسين الصورة:', error);
        return { optimized: false, error: error.message };
    }
};

/**
 * إنشاء صورة مصغرة
 * @param {string} imagePath - مسار الصورة الأصلية
 * @param {number} width - عرض الصورة المصغرة
 * @param {number} height - ارتفاع الصورة المصغرة
 */
const createThumbnail = async (imagePath, width = 150, height = 150) => {
    try {
        const fileDir = path.dirname(imagePath);
        const fileBasename = path.basename(imagePath, path.extname(imagePath));
        const thumbnailPath = path.join(fileDir, `${fileBasename}_thumb${path.extname(imagePath)}`);

        await sharp(imagePath)
            .resize(width, height, {
                fit: 'cover',
                position: 'center'
            })
            .toFile(thumbnailPath);

        return thumbnailPath;
    } catch (error) {
        console.error('خطأ في إنشاء الصورة المصغرة:', error);
        return null;
    }
};

module.exports = {
    optimizeImage,
    optimizeExistingImage,
    createThumbnail
};
