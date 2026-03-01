// HalaChat Dashboard - Database Configuration
// ملف الاتصال بقاعدة البيانات MongoDB

const mongoose = require('mongoose');

const connectDB = async () => {
    try {
        const conn = await mongoose.connect(process.env.MONGODB_URI, {
            // إعدادات الاتصال (غير مطلوبة في الإصدارات الحديثة لكن تبقى للتوافق)
        });

        console.log(`✅ MongoDB متصل: ${conn.connection.host}`);
        console.log(`📁 قاعدة البيانات: ${conn.connection.name}`);
        
    } catch (error) {
        console.error(`❌ خطأ في الاتصال بقاعدة البيانات: ${error.message}`);
        process.exit(1); // إيقاف التطبيق إذا فشل الاتصال
    }
};

module.exports = connectDB;
