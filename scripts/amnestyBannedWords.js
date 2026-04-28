/**
 * Amnesty: عفو شامل عن كل المستخدمين المحظورين بسبب الكلمات
 *
 * يفعل:
 * 1. إلغاء الحظر النشط (bannedWords.isBanned = true) لجميع المستخدمين
 * 2. تصفير المخالفات (violations = 0) لكل المستخدمين الذين عندهم > 0
 * 3. إرسال إشعار + socket للمحظورين فقط
 *
 * تُشغَّل مرة واحدة. لا تُسجَّل في cron.
 *
 * الاستخدام:
 *   node scripts/amnestyBannedWords.js --dry-run
 *   node scripts/amnestyBannedWords.js
 */

require("dotenv").config();
const connectDB = require("../config/database");

const DRY_RUN = process.argv.includes("--dry-run");

async function amnesty() {
    await connectDB();
    const User = require("../models/User");
    const Notification = require("../models/Notification");

    // 1. المحظورون حاليًا (للإشعار + socket)
    const bannedNow = await User.find({
        "bannedWords.isBanned": true
    }).select("name email").lean();

    // 2. كل من عنده violations > 0 (للتصفير الشامل)
    const violationsCount = await User.countDocuments({
        "bannedWords.violations": { $gt: 0 }
    });

    console.log(`📊 الوضع الحالي:`);
    console.log(`   المحظورون نشطين: ${bannedNow.length}`);
    console.log(`   عندهم violations > 0: ${violationsCount}`);

    if (DRY_RUN) {
        console.log("\n[DRY RUN] لن يُنفَّذ أي تغيير");
        process.exit(0);
        return;
    }

    // 3. تصفير شامل + إلغاء حظر
    const result = await User.updateMany(
        {
            $or: [
                { "bannedWords.isBanned": true },
                { "bannedWords.violations": { $gt: 0 } }
            ]
        },
        {
            $set: {
                "bannedWords.isBanned": false,
                "bannedWords.bannedAt": null,
                "bannedWords.banReason": null,
                "bannedWords.violations": 0,
                "bannedWords.lastViolationDate": null,
                isActive: true
            }
        }
    );

    console.log(`\n✅ تم تحديث ${result.modifiedCount} مستخدم`);

    // 4. إشعارات + Socket events للمحظورين فقط
    let notified = 0;
    for (const user of bannedNow) {
        try {
            await Notification.create({
                sender: "69a5e02e1716a974d8db6ee2",
                title: "تم رفع الحظر عن حسابك",
                body: "تم رفع الحظر بشكل استثنائي. يُرجى الالتزام بقواعد الاستخدام لتجنّب الحظر مستقبلًا.",
                type: "system",
                recipients: "specific",
                targetUsers: [user._id],
                status: "sent",
                sentAt: new Date()
            });

            if (global.io) {
                global.io.to("user:" + user._id).emit("account-unsuspended");
            }
            notified++;
        } catch (err) {
            console.error(`  Error notifying ${user.email}:`, err.message);
        }
    }

    console.log(`📨 إشعارات أُرسلت: ${notified}/${bannedNow.length}`);
    console.log("\n═══════════════════════════════════════");
    console.log("Done. عفو شامل تم تطبيقه.");
    console.log("═══════════════════════════════════════");
    process.exit(0);
}

amnesty().catch(err => {
    console.error("Fatal:", err);
    process.exit(1);
});
