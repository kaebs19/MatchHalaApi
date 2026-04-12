#!/usr/bin/env node
// =============================================
// Migration Script: معالجة الصور القديمة بأحجام متعددة
// يمر على كل المستخدمين الذين لديهم profileImage
// وينشئ نسخ thumbnail و medium و original
// =============================================
// الاستخدام: node scripts/migrateImages.js [--dry-run]

require('dotenv').config();
const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');
const connectDB = require('../config/database');
const User = require('../models/User');
const { processImage } = require('../utils/imageProcessor');

const isDryRun = process.argv.includes('--dry-run');

const migrate = async () => {
    try {
        await connectDB();
        console.log('✅ متصل بقاعدة البيانات');

        // جلب المستخدمين الذين لديهم صورة بروفايل ولم تتم معالجتهم بعد
        const users = await User.find({
            profileImage: { $ne: null, $exists: true },
            $or: [
                { photos: { $exists: false } },
                { photos: { $size: 0 } }
            ]
        }).select('name profileImage photos');

        console.log(`\n📊 عدد المستخدمين الذين يحتاجون معالجة: ${users.length}`);

        if (isDryRun) {
            console.log('\n🔍 وضع المعاينة (dry-run) - لن يتم تعديل أي شيء');
            for (const user of users) {
                console.log(`  - ${user.name}: ${user.profileImage}`);
            }
            console.log('\n✅ انتهت المعاينة');
            process.exit(0);
        }

        let successCount = 0;
        let skipCount = 0;
        let errorCount = 0;

        for (let i = 0; i < users.length; i++) {
            const user = users[i];
            const progress = `[${i + 1}/${users.length}]`;

            try {
                // تحقق من وجود الصورة على القرص
                const imagePath = path.join(__dirname, '..', user.profileImage);

                if (!fs.existsSync(imagePath)) {
                    console.log(`${progress} ⏭️  ${user.name} - الصورة غير موجودة: ${user.profileImage}`);
                    skipCount++;
                    continue;
                }

                // معالجة الصورة (مع الاحتفاظ بالأصلية)
                const result = await processImage(imagePath, {
                    prefix: 'profile',
                    keepOriginalFile: true // لا تحذف الصورة الأصلية
                });

                // تحديث المستخدم
                user.photos = [{
                    original: result.original,
                    medium: result.medium,
                    thumbnail: result.thumbnail,
                    order: 0
                }];
                await user.save();

                successCount++;
                console.log(`${progress} ✅ ${user.name} - تم المعالجة`);

            } catch (err) {
                errorCount++;
                console.error(`${progress} ❌ ${user.name} - خطأ: ${err.message}`);
            }
        }

        console.log('\n📊 ملخص المعالجة:');
        console.log(`  ✅ نجاح: ${successCount}`);
        console.log(`  ⏭️  تخطي: ${skipCount}`);
        console.log(`  ❌ أخطاء: ${errorCount}`);
        console.log(`  📂 الإجمالي: ${users.length}`);

        process.exit(0);

    } catch (error) {
        console.error('❌ خطأ في المعالجة:', error);
        process.exit(1);
    }
};

migrate();
