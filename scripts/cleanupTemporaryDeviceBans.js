/**
 * Cleanup: إزالة سجلات BannedDevice الخاطئة (الناتجة عن عقوبات مؤقتة)
 *
 * المشكلة:
 * - سجلات BannedDevice أُنشئت من backfill/auto-record لمستخدمين عقوبتهم مؤقتة
 *   (bannedWords 24h أو suspension محدد المدة)
 * - النتيجة: الجهاز محظور **دائمًا** رغم أن الحساب طبيعي / عقوبته انتهت
 *
 * هذا السكربت يفحص كل BannedDevice (bannedBy: auto أو spam_system) ويُلغيها
 * إذا المستخدم الأصلي أصبح:
 * - isActive: true (الحساب نشط)
 * - suspension.isSuspended: false (لا تعليق)
 * - أو suspension مؤقت (suspendedUntil != null) — الجهاز ما يحتاج ban دائم
 *
 * يُحافظ على:
 * - الحظر اليدوي (bannedBy: 'admin')
 * - الحظر الدائم (suspension level 5 + suspendedUntil = null)
 * - حسابات معطّلة فعليًا (isActive: false)
 *
 * الاستخدام:
 *   node scripts/cleanupTemporaryDeviceBans.js --dry-run
 *   node scripts/cleanupTemporaryDeviceBans.js
 */

require('dotenv').config();
const connectDB = require('../config/database');

const DRY_RUN = process.argv.includes('--dry-run');

async function cleanup() {
    await connectDB();
    const BannedDevice = require('../models/BannedDevice');
    const User = require('../models/User');

    // كل أجهزة محظورة تلقائيًا (auto أو spam_system) — لا نلمس admin
    const autoBanned = await BannedDevice.find({
        isActive: true,
        bannedBy: { $in: ['auto', 'spam_system'] }
    }).populate('originalUserId', 'isActive suspension bannedWords name email').lean();

    console.log(`📊 إجمالي الأجهزة المحظورة تلقائيًا: ${autoBanned.length}`);

    let stats = {
        total: autoBanned.length,
        kept: 0,
        unbanned: 0,
        orphaned: 0
    };

    const idsToUnban = [];

    for (const bd of autoBanned) {
        const user = bd.originalUserId;

        if (!user) {
            // مستخدم محذوف — احتفظ بالحظر (أمان)
            stats.orphaned++;
            stats.kept++;
            continue;
        }

        // ✅ هل العقوبة الحالية للمستخدم دائمة؟
        const isPermanentSuspension =
            user.suspension?.isSuspended === true &&
            !user.suspension.suspendedUntil; // null = دائم

        const isInactiveByAdmin = user.isActive === false;

        const isPermanent = isPermanentSuspension || isInactiveByAdmin;

        if (isPermanent) {
            // العقوبة دائمة → الحظر صحيح، احتفظ به
            stats.kept++;
        } else {
            // العقوبة مؤقتة أو منتهية → ألغِ حظر الجهاز
            idsToUnban.push(bd._id);
            stats.unbanned++;

            if (DRY_RUN) {
                const reason = user.suspension?.isSuspended
                    ? `suspension حتى ${user.suspension.suspendedUntil}`
                    : user.bannedWords?.isBanned
                        ? 'bannedWords مؤقت'
                        : 'الحساب طبيعي';
                console.log(`  [DRY] ${user.name} (${user.email}) — السبب: ${reason}`);
            }
        }
    }

    if (!DRY_RUN && idsToUnban.length > 0) {
        const result = await BannedDevice.updateMany(
            { _id: { $in: idsToUnban } },
            { $set: { isActive: false } }
        );
        console.log(`\n✅ تم إلغاء حظر ${result.modifiedCount} جهاز`);
    }

    console.log('\n═══════════════════════════════════════');
    console.log(`📊 النتائج ${DRY_RUN ? '(DRY RUN — لا تغييرات)' : ''}:`);
    console.log(`   الإجمالي:                ${stats.total}`);
    console.log(`   ✅ احتُفظ بالحظر (دائم):  ${stats.kept}`);
    console.log(`   🔓 أُلغي الحظر (مؤقت):   ${stats.unbanned}`);
    console.log(`   👻 يتيم (مستخدم محذوف):  ${stats.orphaned}`);
    console.log('═══════════════════════════════════════\n');

    process.exit(0);
}

cleanup().catch(err => {
    console.error('Fatal:', err);
    process.exit(1);
});
