// سكربت اختبار Push Notifications
const mongoose = require('mongoose');
require('dotenv').config();

async function testPush() {
    try {
        await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/halachat');
        console.log('✅ متصل بقاعدة البيانات');

        const { sendToDevice } = require('../config/firebase');
        const User = require('../models/User');

        // جلب المستخدم من argument أو أول مستخدم لديه token
        const targetEmail = process.argv[2];
        let user;

        if (targetEmail) {
            user = await User.findOne({ email: targetEmail });
        } else {
            user = await User.findOne({ deviceToken: { $ne: null } });
        }

        if (!user) {
            console.log('❌ لا يوجد مستخدم لديه Device Token');
            process.exit(1);
        }

        console.log('\n📱 إرسال إشعار تجريبي لـ:', user.name);
        console.log('Email:', user.email);
        console.log('Token:', user.deviceToken.substring(0, 50) + '...');

        const result = await sendToDevice(
            user.deviceToken,
            {
                title: '🧪 اختبار Push',
                body: 'هذا إشعار تجريبي من السيرفر - ' + new Date().toLocaleTimeString('ar-SA')
            },
            {
                type: 'test',
                timestamp: Date.now().toString()
            }
        );

        console.log('\n=== النتيجة ===');
        console.log(JSON.stringify(result, null, 2));

        if (result.success) {
            console.log('\n✅ تم إرسال الإشعار بنجاح!');
        } else {
            console.log('\n❌ فشل إرسال الإشعار:', result.error);
        }

        process.exit(0);
    } catch (err) {
        console.error('❌ خطأ:', err.message);
        process.exit(1);
    }
}

testPush();
