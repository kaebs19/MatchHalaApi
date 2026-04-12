// HalaChat Dashboard - Database Configuration
// ملف الاتصال بقاعدة البيانات MongoDB

const mongoose = require('mongoose');

const connectDB = async () => {
    try {
        const conn = await mongoose.connect(process.env.MONGODB_URI, {
            // ✅ Connection Pool — عدد الاتصالات المتزامنة
            maxPoolSize: 50,          // أقصى عدد اتصالات (الافتراضي 10 — قليل جداً!)
            minPoolSize: 10,          // أقل عدد اتصالات جاهزة دائماً

            // ✅ Timeouts — حماية من التعليق
            serverSelectionTimeoutMS: 5000,   // 5 ثوانٍ للبحث عن السيرفر
            socketTimeoutMS: 45000,           // 45 ثانية timeout لكل عملية
            connectTimeoutMS: 10000,          // 10 ثوانٍ للاتصال الأول

            // ✅ إعادة المحاولة تلقائياً
            retryWrites: true,
            retryReads: true,

            // ✅ تنظيف الاتصالات الخاملة
            maxIdleTimeMS: 60000,     // إغلاق الاتصال الخامل بعد 60 ثانية
        });

        console.log(`✅ MongoDB متصل: ${conn.connection.host}`);
        console.log(`📁 قاعدة البيانات: ${conn.connection.name}`);
        console.log(`🔗 Pool: min=${10}, max=${50}`);

        // ✅ مراقبة حالة الاتصال
        mongoose.connection.on('error', (err) => {
            console.error('❌ MongoDB connection error:', err.message);
        });

        mongoose.connection.on('disconnected', () => {
            console.warn('⚠️ MongoDB disconnected — سيعيد المحاولة تلقائياً');
        });

        mongoose.connection.on('reconnected', () => {
            console.log('✅ MongoDB reconnected');
        });

    } catch (error) {
        console.error(`❌ خطأ في الاتصال بقاعدة البيانات: ${error.message}`);
        process.exit(1); // إيقاف التطبيق إذا فشل الاتصال
    }
};

module.exports = connectDB;
