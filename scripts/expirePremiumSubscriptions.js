/**
 * Cron Job: إلغاء الاشتراكات المنتهية تلقائياً
 * يعمل كل ساعة — يفحص premiumExpiresAt ويلغي isPremium
 */

const mongoose = require("mongoose");
require("dotenv").config();
const connectDB = require("../config/database");

async function expirePremiumSubscriptions() {
    await connectDB();
    const User = require("../models/User");
    const Notification = require("../models/Notification");

    const now = new Date();

    // البحث عن المستخدمين اللي اشتراكهم انتهى
    const expiredUsers = await User.find({
        isPremium: true,
        premiumExpiresAt: { $lt: now, $ne: null }
    }).select("name email isPremium premiumPlan premiumExpiresAt");

    if (expiredUsers.length === 0) {
        console.log(`[${now.toISOString()}] ✅ لا توجد اشتراكات منتهية`);
        process.exit(0);
        return;
    }

    console.log(`[${now.toISOString()}] 🔄 وجدت ${expiredUsers.length} اشتراك منتهي`);

    for (const user of expiredUsers) {
        try {
            // إلغاء Premium وكل الميزات المرتبطة
            await User.findByIdAndUpdate(user._id, {
                isPremium: false,
                premiumPlan: null,
                premiumExpiresAt: null,
                stealthMode: false,
                // إلغاء ميزات Premium
                'privacySettings.invisibleRead': false,
                'privacySettings.stealthMode': false,
                'privacySettings.premiumOnlyRequests': false,
                // إعادة لون الاسم للافتراضي
                customNameColor: null,
            });

            // إشعار المستخدم بانتهاء الاشتراك
            await Notification.create({
                title: 'انتهى اشتراكك المميز',
                body: 'اشتراكك في Premium انتهى. جدّد الآن للاستمتاع بالميزات المميزة!',
                type: 'system',
                recipients: 'specific',
                targetUsers: [user._id],
                data: {
                    type: 'premium_expired',
                    previousPlan: user.premiumPlan,
                    expiredAt: user.premiumExpiresAt?.toISOString()
                },
                status: 'sent',
                sentAt: new Date()
            });

            console.log(`  ❌ ${user.name} (${user.email}) — اشتراك ${user.premiumPlan || 'unknown'} انتهى في ${user.premiumExpiresAt?.toISOString()}`);
        } catch (err) {
            console.error(`  ⚠️ خطأ في إلغاء اشتراك ${user.name}:`, err.message);
        }
    }

    console.log(`[${now.toISOString()}] ✅ تم إلغاء ${expiredUsers.length} اشتراك منتهي`);
    process.exit(0);
}

expirePremiumSubscriptions().catch(err => {
    console.error('خطأ في سكريبت إلغاء الاشتراكات:', err);
    process.exit(1);
});
