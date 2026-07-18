/**
 * Cron Job: حذف طلبات الصداقة المعلقة القديمة (أقدم من 30 يوماً بدون رد)
 * يعمل يومياً — يمنع تراكم الطلبات القديمة ويحرر حد الـ pending للمرسل
 */

const mongoose = require("mongoose");
require("dotenv").config();
const connectDB = require("../config/database");

const EXPIRY_DAYS = 30;

async function expireOldFriendRequests() {
    await connectDB();
    const Friendship = require("../models/Friendship");

    const cutoff = new Date(Date.now() - EXPIRY_DAYS * 24 * 60 * 60 * 1000);

    const result = await Friendship.deleteMany({
        status: "pending",
        createdAt: { $lt: cutoff }
    });

    console.log(`[${new Date().toISOString()}] Expired ${result.deletedCount} friend request(s) older than ${EXPIRY_DAYS} days`);
    process.exit(0);
}

expireOldFriendRequests().catch(err => {
    console.error("expireOldFriendRequests error:", err);
    process.exit(1);
});
