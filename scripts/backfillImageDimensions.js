// تعبئة أبعاد صور الرسائل القديمة — تُقرأ من الملفات على القرص مرة واحدة
// لتشمل ميزة «حجز مساحة الصورة» السجلّ كله لا الجديد فقط.
//
// التشغيل: node scripts/backfillImageDimensions.js
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const Message = require('../models/Message');

const UPLOADS_DIR = path.join(__dirname, '..', 'uploads', 'messages');

/// الرابط المخزّن كامل (https://.../uploads/messages/x.jpg) — نحتاج اسم الملف فقط
function localPathFor(mediaUrl) {
    if (!mediaUrl) return null;
    const filename = String(mediaUrl).split('/').pop().split('?')[0];
    if (!filename) return null;
    return path.join(UPLOADS_DIR, filename);
}

async function run() {
    await mongoose.connect(process.env.MONGODB_URI);

    const filter = {
        type: 'image',
        mediaUrl: { $nin: [null, ''] },
        $or: [
            { mediaWidth: null },
            { mediaWidth: { $exists: false } }
        ]
    };

    const total = await Message.countDocuments(filter);
    console.log(`صور بلا أبعاد: ${total}`);

    let updated = 0, missing = 0, failed = 0, processed = 0;
    const cursor = Message.find(filter).select('_id mediaUrl').lean().cursor();

    for await (const msg of cursor) {
        processed++;
        const filePath = localPathFor(msg.mediaUrl);

        // الملف قد يكون محذوفاً (صورة مؤقتة دُمِّرت أو تنظيف قديم) — لا شيء نقرأه
        if (!filePath || !fs.existsSync(filePath)) {
            missing++;
        } else {
            try {
                const meta = await sharp(filePath).metadata();
                if (meta?.width && meta?.height) {
                    // orientation 5..8 = مدوّرة 90°، الأبعاد المعروضة معكوسة
                    const rotated = meta.orientation >= 5 && meta.orientation <= 8;
                    await Message.updateOne({ _id: msg._id }, {
                        $set: {
                            mediaWidth: rotated ? meta.height : meta.width,
                            mediaHeight: rotated ? meta.width : meta.height
                        }
                    });
                    updated++;
                } else {
                    failed++;
                }
            } catch (err) {
                failed++;
            }
        }

        if (processed % 200 === 0) {
            console.log(`تمّت معالجة ${processed}/${total} — محدّثة: ${updated}`);
        }
    }

    console.log(`انتهى. محدّثة: ${updated} | ملفات مفقودة: ${missing} | فشل القراءة: ${failed}`);
    await mongoose.disconnect();
}

run().catch(err => {
    console.error('فشل السكربت:', err);
    process.exit(1);
});
