/**
 * Cron Job: فك حظر الكلمات المحظورة المنتهي (24 ساعة) تلقائيًا
 * يعمل كل ساعة
 *
 * المنطق:
 * - bannedWords حظر مؤقت 24 ساعة (تكرار 5 كلمات محظورة)
 * - الـ /login فيه auto-lift، لكن لو المستخدم لم يحاول الدخول
 *   يبقى flagged رغم انتهاء المدة → إحصائيات admin مضللة + APIs أخرى
 *   تفحصه كـ محظور
 *
 * هذا السكربت يفك الحظر بشكل دوري حتى لو المستخدم غير نشط.
 */

const mongoose = require("mongoose");
require("dotenv").config();
const connectDB = require("../config/database");

async function liftExpiredBannedWords() {
    await connectDB();
    const User = require("../models/User");
    const Notification = require("../models/Notification");

    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000); // قبل 24 ساعة

    const expiredUsers = await User.find({
        "bannedWords.isBanned": true,
        "bannedWords.bannedAt": { $lt: cutoff }
    }).select("name email bannedWords");

    if (expiredUsers.length === 0) {
        console.log("No expired bannedWords to lift");
        process.exit(0);
        return;
    }

    console.log("Lifting " + expiredUsers.length + " expired bannedWords...");

    let lifted = 0;
    for (const user of expiredUsers) {
        try {
            await User.findByIdAndUpdate(user._id, {
                "bannedWords.isBanned": false,
                "bannedWords.bannedAt": null,
                "bannedWords.banReason": null,
                "bannedWords.violations": 0,
                "bannedWords.lastViolationDate": null,
                isActive: true
            });

            // إشعار المستخدم — اختياري لكن مفيد
            try {
                await Notification.create({
                    sender: "69a5e02e1716a974d8db6ee2",
                    title: "تم رفع الحظر عن حسابك",
                    body: "انتهت مدة حظر الكلمات المحظورة. يرجى الالتزام بقواعد الاستخدام.",
                    type: "system",
                    recipients: "specific",
                    targetUsers: [user._id],
                    status: "sent",
                    sentAt: new Date()
                });
            } catch (e) { /* fail-silent على الإشعار */ }

            // Socket: التطبيق يمسح شاشة الحظر فورًا
            if (global.io) {
                global.io.to("user:" + user._id).emit("account-unsuspended");
            }

            lifted++;
            console.log("  Lifted: " + user.name + " (" + user.email + ")");
        } catch (err) {
            console.error("  Error lifting " + user.name + ":", err.message);
        }
    }

    console.log("Done: " + lifted + "/" + expiredUsers.length + " lifted");
    process.exit(0);
}

liftExpiredBannedWords().catch(err => {
    console.error("Cron error:", err);
    process.exit(1);
});
