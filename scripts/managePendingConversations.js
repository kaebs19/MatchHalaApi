/**
 * Cron Job: إدارة المحادثات المعلقة
 * - تذكير بعد 24 ساعة
 * - تذكير ثاني بعد 3 أيام
 * - انتهاء صلاحية بعد 7 أيام
 * - حذف بعد 14 يوم (للسجل الإداري)
 */

const mongoose = require("mongoose");
require("dotenv").config({ path: require("path").join(__dirname, "../.env") });
const connectDB = require("../config/database");

async function managePendingConversations() {
    await connectDB();
    const Conversation = require("../models/Conversation");
    const Notification = require("../models/Notification");
    const User = require("../models/User");

    const now = new Date();
    const h24ago = new Date(now - 24 * 60 * 60 * 1000);
    const d3ago = new Date(now - 3 * 24 * 60 * 60 * 1000);
    const d7ago = new Date(now - 7 * 24 * 60 * 60 * 1000);
    const d14ago = new Date(now - 14 * 24 * 60 * 60 * 1000);

    let reminded = 0, expired = 0, deleted = 0;

    // === 1. تذكير أول بعد 24 ساعة (إذا < 7 أيام) ===
    const needReminder = await Conversation.find({
        status: "pending",
        createdAt: { $lte: h24ago, $gt: d7ago },
        reminderSent: { $ne: true }
    }).populate("participants", "name deviceToken").populate("creator", "name");

    for (const conv of needReminder) {
        try {
            const receiver = conv.participants.find(
                p => p._id.toString() !== conv.creator.toString()
            );
            const sender = conv.participants.find(
                p => p._id.toString() === conv.creator.toString()
            );

            if (receiver) {
                const pushService = require("../services/pushNotificationService");
                await pushService.sendNotificationToUser(receiver._id, {
                    title: "لديك طلب محادثة بانتظارك",
                    body: (sender ? sender.name : "شخص ما") + " يريد محادثتك! اقبل الطلب قبل انتهاء صلاحيته."
                }, { type: "conversation_reminder", conversationId: conv._id.toString() });
            }

            conv.reminderSent = true;
            await conv.save();
            reminded++;
        } catch (e) {
            console.error("Reminder error:", e.message);
        }
    }

    // === 2. انتهاء صلاحية بعد 7 أيام ===
    const toExpire = await Conversation.find({
        status: "pending",
        createdAt: { $lte: d7ago, $gt: d14ago }
    }).populate("participants", "name deviceToken").populate("creator", "name");

    for (const conv of toExpire) {
        try {
            conv.status = "expired";
            await conv.save();

            // إشعار المُرسل
            const sender = conv.participants.find(
                p => p._id.toString() === conv.creator.toString()
            );
            const receiver = conv.participants.find(
                p => p._id.toString() !== conv.creator.toString()
            );

            if (sender) {
                const pushService = require("../services/pushNotificationService");
                await pushService.sendNotificationToUser(sender._id, {
                    title: "انتهت صلاحية طلب المحادثة",
                    body: "لم يتم الرد على طلبك لـ " + (receiver ? receiver.name : "مستخدم") + ". يمكنك إرسال طلب جديد."
                }, { type: "conversation_expired", conversationId: conv._id.toString() });
            }

            expired++;
        } catch (e) {
            console.error("Expire error:", e.message);
        }
    }

    // === 3. حذف بعد 14 يوم (للسجل الإداري) ===
    const toDelete = await Conversation.find({
        status: { $in: ["expired", "rejected"] },
        createdAt: { $lte: d14ago }
    });

    if (toDelete.length > 0) {
        const Message = require("../models/Message");
        const convIds = toDelete.map(c => c._id);
        await Message.deleteMany({ conversation: { $in: convIds } });
        await Conversation.deleteMany({ _id: { $in: convIds } });
        deleted = toDelete.length;
    }

    console.log("Pending conversations: reminded=" + reminded + " expired=" + expired + " deleted=" + deleted);
    process.exit(0);
}

managePendingConversations().catch(err => {
    console.error("Cron error:", err);
    process.exit(1);
});
