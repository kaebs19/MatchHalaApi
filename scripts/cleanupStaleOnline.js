/**
 * Cron Job: تنظيف isOnline=true الـ stale
 * يعمل كل 5 دقائق — يقلب isOnline=false لكل مستخدم
 * lastLogin أقدم من 15 دقيقة.
 *
 * المشكلة: middleware/auth.js يضع isOnline=true عند كل API call،
 * لكن isOnline=false يُضبط فقط عند socket disconnect نظيف.
 * لو المستخدم قتل التطبيق بدون disconnect → isOnline يبقى true
 * في DB لأيام، فيظهر للجميع كـ "نشط مؤخراً" بشكل مغلوط.
 *
 * الحل: كرون يصحّح الـ DB دورياً، يعتمد على lastLogin (أكثر دقة).
 */

const mongoose = require("mongoose");
require("dotenv").config();
const connectDB = require("../config/database");

async function cleanupStaleOnline() {
    await connectDB();
    const User = require("../models/User");

    const now = new Date();
    const cutoff = new Date(now.getTime() - 15 * 60 * 1000); // 15 دقيقة

    try {
        const result = await User.updateMany(
            {
                isOnline: true,
                $or: [
                    { lastLogin: { $lt: cutoff } },
                    { lastLogin: null }
                ]
            },
            { $set: { isOnline: false } }
        );

        if (result.modifiedCount > 0) {
            console.log(`[${now.toISOString()}] 🧹 صحّحت ${result.modifiedCount} مستخدم isOnline → false`);
        }
    } catch (error) {
        console.error(`[${now.toISOString()}] ❌ خطأ في cleanupStaleOnline:`, error.message);
    } finally {
        await mongoose.disconnect();
        process.exit(0);
    }
}

cleanupStaleOnline();
