#!/usr/bin/env node
// =============================================
// مزامنة deviceToken → fcmToken لجميع المستخدمين
// الاستخدام: node scripts/syncTokens.js
// =============================================

const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const connectDB = require('../config/database');

async function syncTokens() {
    await connectDB();
    const db = mongoose.connection.db;

    console.log('🔄 مزامنة deviceToken → fcmToken...\n');

    // 1. نسخ deviceToken → fcmToken (حيث deviceToken موجود و fcmToken فارغ أو مختلف)
    const result1 = await db.collection('users').updateMany(
        {
            deviceToken: { $exists: true, $ne: null, $ne: '' },
            $or: [
                { fcmToken: { $exists: false } },
                { fcmToken: null },
                { fcmToken: '' }
            ]
        },
        [{ $set: { fcmToken: '$deviceToken' } }]
    );
    console.log(`✅ نسخ deviceToken → fcmToken: ${result1.modifiedCount} مستخدم`);

    // 2. نسخ fcmToken → deviceToken (حيث fcmToken موجود و deviceToken فارغ)
    const result2 = await db.collection('users').updateMany(
        {
            fcmToken: { $exists: true, $ne: null, $ne: '' },
            $or: [
                { deviceToken: { $exists: false } },
                { deviceToken: null },
                { deviceToken: '' }
            ]
        },
        [{ $set: { deviceToken: '$fcmToken' } }]
    );
    console.log(`✅ نسخ fcmToken → deviceToken: ${result2.modifiedCount} مستخدم`);

    // 3. مزامنة deviceToken → fcmToken حيث كلاهما موجود لكن مختلف (الأولوية لـ deviceToken)
    const result3 = await db.collection('users').updateMany(
        {
            deviceToken: { $exists: true, $ne: null, $ne: '' },
            fcmToken: { $exists: true, $ne: null, $ne: '' },
            $expr: { $ne: ['$deviceToken', '$fcmToken'] }
        },
        [{ $set: { fcmToken: '$deviceToken' } }]
    );
    console.log(`✅ مزامنة (deviceToken ≠ fcmToken): ${result3.modifiedCount} مستخدم`);

    // 4. إحصائيات
    const total = await db.collection('users').countDocuments();
    const withToken = await db.collection('users').countDocuments({
        deviceToken: { $exists: true, $ne: null, $ne: '' }
    });
    const withBoth = await db.collection('users').countDocuments({
        deviceToken: { $exists: true, $ne: null, $ne: '' },
        fcmToken: { $exists: true, $ne: null, $ne: '' }
    });

    console.log(`\n📊 الإحصائيات:`);
    console.log(`   إجمالي المستخدمين: ${total}`);
    console.log(`   لديهم deviceToken: ${withToken}`);
    console.log(`   لديهم كلا الحقلين: ${withBoth}`);

    console.log('\n🎉 تمت المزامنة بنجاح');
    process.exit(0);
}

syncTokens().catch(err => {
    console.error('❌ خطأ:', err);
    process.exit(1);
});
