/**
 * Cron Job: فك التعليقات المنتهية تلقائياً
 * يعمل كل ساعة
 */

const mongoose = require("mongoose");
require("dotenv").config();
const connectDB = require("../config/database");

async function liftExpiredSuspensions() {
    await connectDB();
    const User = require("../models/User");
    const Notification = require("../models/Notification");

    const now = new Date();

    const expiredUsers = await User.find({
        "suspension.isSuspended": true,
        "suspension.suspendedUntil": { $lt: now, $ne: null }
    }).select("name email suspension");

    if (expiredUsers.length === 0) {
        console.log("No expired suspensions");
        process.exit(0);
        return;
    }

    console.log("Lifting " + expiredUsers.length + " expired suspensions...");

    let lifted = 0;
    for (const user of expiredUsers) {
        try {
            await User.findByIdAndUpdate(user._id, {
                "suspension.isSuspended": false,
                "suspension.suspendedUntil": null,
                "suspension.reason": null,
                isActive: true
            });

            await Notification.create({ sender: "69a5e02e1716a974d8db6ee2",
                title: "تم رفع التعليق عن حسابك",
                body: "انتهت مدة التعليق. مرحبا بك مجددا في هلا!",
                type: "system",
                recipients: "specific",
                targetUsers: [user._id],
                status: "sent",
                sentAt: new Date()
            });

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

liftExpiredSuspensions().catch(err => {
    console.error("Cron error:", err);
    process.exit(1);
});
