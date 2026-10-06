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

    // ⚠️ عمر الطلب هو `requestedAt` لا `createdAt`: استئناف محادثة مُغلقة
    //    يُعيدها إلى pending ويحدّث `requestedAt` وحده، فدعوة أُرسلت اليوم
    //    على وثيقة عمرها شهر كانت تُصنَّف «منتهية» في أول تشغيل وتختفي من
    //    عند المستلم بلا أثر. الاحتياط لوثائق ما قبل الحقل: `createdAt`.
    const requestAge = (range) => ({
        $or: [
            { requestedAt: Object.assign({ $ne: null }, range) },
            { requestedAt: null, createdAt: range }
        ]
    });

    // === 1. تذكير أول بعد 24 ساعة (إذا < 7 أيام) ===
    // ⚠️ creator مُعبّأ (populate) — قارن بـ `creator._id` لا `creator.toString()`:
    //    الأخير نصّ الوثيقة كاملة فلا يطابق أي معرّف، فكان «المستلم» أول مشارك
    //    (غالباً المرسل نفسه) و«المرسل» مجهولاً («شخص ما») — 99.9% من التذكيرات
    //    ذهبت لمرسل الطلب، حتى 864 تذكيراً لمستخدم واحد في ثلاثة أيام.
    const needReminder = await Conversation.find({
        status: "pending",
        ...requestAge({ $lte: h24ago, $gt: d7ago }),
        reminderSent: { $ne: true }
    }).select("participants creator").populate("participants", "_id").populate("creator", "name").lean();

    // تذكير واحد لكل مستلم في كل تشغيل مهما كثرت طلباته المعلّقة
    const byReceiver = new Map();
    const settledIds = [];
    for (const conv of needReminder) {
        settledIds.push(conv._id);
        // منشئ حُذف حسابه ← لا تذكير (كان يرمي خطأً ويُعاد في كل تشغيل)
        if (!conv.creator) continue;
        const creatorId = String(conv.creator._id);
        const receiver = (conv.participants || []).find(p => p && String(p._id) !== creatorId);
        if (!receiver) continue;
        const key = String(receiver._id);
        if (!byReceiver.has(key)) byReceiver.set(key, []);
        byReceiver.get(key).push({ id: String(conv._id), senderId: creatorId, senderName: conv.creator.name });
    }

    const pushService = require("../services/pushNotificationService");
    for (const [receiverId, requests] of byReceiver) {
        try {
            const single = requests.length === 1;
            await pushService.sendNotificationToUser(receiverId, {
                title: single ? "لديك طلب محادثة بانتظارك" : "لديك " + requests.length + " طلبات محادثة بانتظارك",
                body: single
                    ? (requests[0].senderName || "شخص ما") + " يريد محادثتك! اقبل الطلب قبل انتهاء صلاحيته."
                    : "اقبل الطلبات قبل انتهاء صلاحيتها."
            }, single
                ? { type: "conversation_reminder", conversationId: requests[0].id,
                    senderId: requests[0].senderId, senderName: requests[0].senderName }
                // بلا senderId يصير المرسل المستلمَ نفسه، فيفتح الضغط بروفايله —
                // conversationId لأحد الطلبات يُبقي الضغط في المحادثات
                : { type: "conversation_reminder", conversationId: requests[0].id });
            reminded++;
        } catch (e) {
            console.error("Reminder error:", e.message);
        }
    }

    // timestamps:false — العلَم لا يغيّر ترتيب المحادثة في القوائم
    if (settledIds.length > 0) {
        await Conversation.updateMany(
            { _id: { $in: settledIds } },
            { $set: { reminderSent: true } },
            { timestamps: false }
        );
    }

    // === 2. انتهاء صلاحية بعد 7 أيام ===
    // save() يحدّث updatedAt عمداً — فتصل المحادثة للتطبيق في removedIds.
    // ⚠️ لا إشعار للمرسل: كان معطّلاً فعلياً بنفس خلل creator.toString()، وتفعيله
    //    لكل طلب يُغرق من يرسل طلبات كثيرة (المئات في التشغيل الواحد).
    const toExpire = await Conversation.find({
        status: "pending",
        ...requestAge({ $lte: d7ago, $gt: d14ago })
    });

    for (const conv of toExpire) {
        try {
            conv.status = "expired";
            await conv.save();
            expired++;
        } catch (e) {
            console.error("Expire error:", e.message);
        }
    }

    // === 3. حذف بعد 14 يوم (للسجل الإداري) ===
    const toDelete = await Conversation.find({
        status: { $in: ["expired", "rejected"] },
        // ⚠️ updatedAt لا createdAt: محادثة قديمة استُؤنفت ثم رُفضت اليوم كانت
        //    تُحذف مع رسائلها في أول تشغيل
        updatedAt: { $lte: d14ago }
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
