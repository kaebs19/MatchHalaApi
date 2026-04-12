// HalaChat Dashboard - Database Seeder
// ملف لإضافة بيانات تجريبية لقاعدة البيانات

const mongoose = require('mongoose');
require('dotenv').config();
const User = require('./models/User');
const connectDB = require('./config/database');

// بيانات المستخدمين التجريبية
const users = [
    {
        name: 'Admin HalaChat',
        email: 'admin@halachat.com',
        password: 'admin123',
        role: 'admin',
        isActive: true
    },
    {
        name: 'محمد أحمد',
        email: 'mohammed@halachat.com',
        password: '123456',
        role: 'user',
        isActive: true
    },
    {
        name: 'فاطمة علي',
        email: 'fatima@halachat.com',
        password: '123456',
        role: 'user',
        isActive: true
    },
    {
        name: 'خالد سعيد',
        email: 'khaled@halachat.com',
        password: '123456',
        role: 'user',
        isActive: true
    },
    {
        name: 'نورة حسن',
        email: 'noura@halachat.com',
        password: '123456',
        role: 'user',
        isActive: false
    }
];

// دالة لإضافة البيانات
const importData = async () => {
    try {
        await connectDB();
        
        // حذف البيانات القديمة
        await User.deleteMany();
        console.log('🗑️  تم حذف البيانات القديمة');

        // إضافة البيانات الجديدة
        await User.create(users);
        console.log('✅ تم إضافة البيانات التجريبية بنجاح');
        console.log('\n📧 بيانات تسجيل الدخول:');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('Admin:');
        console.log('  البريد: admin@halachat.com');
        console.log('  الرقم: admin123');
        console.log('\nUser:');
        console.log('  البريد: mohammed@halachat.com');
        console.log('  الرقم: 123456');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

        process.exit(0);
    } catch (error) {
        console.error('❌ خطأ:', error);
        process.exit(1);
    }
};

// دالة لحذف البيانات
const destroyData = async () => {
    try {
        await connectDB();
        
        await User.deleteMany();
        console.log('🗑️  تم حذف جميع البيانات');

        process.exit(0);
    } catch (error) {
        console.error('❌ خطأ:', error);
        process.exit(1);
    }
};

// التحقق من الأمر المطلوب
if (process.argv[2] === '-d') {
    destroyData();
} else {
    importData();
}
