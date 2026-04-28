/**
 * Cleanup: إلغاء حظر الأجهزة الناتجة عن backfill خاطئ بسبب bannedWords
 *
 * السياق:
 * - في موجة backfill سابقة، تم إنشاء BannedDevice لكل مستخدم عنده
 *   bannedWords.isBanned = true (5 مخالفات كلمات)
 * - bannedWords مؤقت 24 ساعة → الجهاز ما يجب أن يكون محظور دائمًا
 * - النتيجة: 452 جهاز محظور خطأ بسبب "backfill: حظر تلقائي - 5 مخالفات كلمات محظورة"
 *
 * هذا السكربت يُلغي حظر هذه الأجهزة فقط (لا يلمس أي حظر آخر).
 *
 * الاستخدام:
 *   node scripts/unbanBackfillBannedWords.js --dry-run
 *   node scripts/unbanBackfillBannedWords.js
 */

require("dotenv").config();
const connectDB = require("../config/database");

const DRY_RUN = process.argv.includes("--dry-run");

async function unbanBackfill() {
    await connectDB();
    const BannedDevice = require("../models/BannedDevice");

    const filter = {
        isActive: true,
        reasonDetails: /backfill.*كلمات محظورة/
    };

    const total = await BannedDevice.countDocuments(filter);
    console.log(`📊 الأجهزة المُطابقة: ${total}`);

    if (total === 0) {
        console.log("لا أجهزة لإلغاء حظرها.");
        process.exit(0);
        return;
    }

    if (DRY_RUN) {
        console.log("\n[DRY RUN] لن يُنفَّذ أي تغيير");
        const samples = await BannedDevice.find(filter)
            .limit(3)
            .populate("originalUserId", "name email")
            .lean();
        console.log("\nعينات:");
        for (const s of samples) {
            const u = s.originalUserId || {};
            console.log(`  - ${u.name || "?"} (${u.email || s._id}) — ${s.reasonDetails}`);
        }
        process.exit(0);
        return;
    }

    const result = await BannedDevice.updateMany(filter, {
        $set: { isActive: false }
    });

    console.log(`\n✅ أُلغي حظر ${result.modifiedCount} جهاز`);
    console.log("═══════════════════════════════════════");
    console.log("Done.");
    console.log("═══════════════════════════════════════");
    process.exit(0);
}

unbanBackfill().catch(err => {
    console.error("Fatal:", err);
    process.exit(1);
});
