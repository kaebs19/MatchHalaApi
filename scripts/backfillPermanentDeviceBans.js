/**
 * Backfill: حظر أجهزة الموقوفين دائماً الذين لا سجل BannedDevice لهم
 *
 * السبب: حتى f2197b2 كان حظر الجهاز يُسجَّل فقط حين يحاول الموقوفُ الدخول
 * إلى حسابه الموقوف. من لم يجرّب (أو ذهب مباشرةً لإنشاء حساب جديد) بقي
 * جهازه مفتوحاً. القياس يوم ٥ سبتمبر ٢٠٢٦: ١٣١٩ من ٢١٨٥ موقوفاً دائماً.
 *
 * يمرّ على كل مستخدم suspension.isSuspended=true وsuspendedUntil=null ولا
 * سجل نشط له، ويستدعي banDeviceForUser — نفس الخدمة التي تعمل الآن لحظة
 * العقوبة، فلا منطق ثانٍ هنا. بلا بصمة → سجل pendingFingerprint يُربَط عند
 * أول دخول ببصمة.
 *
 * الاستخدام (على الخادم، من /var/www/MatchHalaApi):
 *   node scripts/backfillPermanentDeviceBans.js --dry-run
 *   node scripts/backfillPermanentDeviceBans.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const connectDB = require('../config/database');

const DRY_RUN = process.argv.includes('--dry-run');

async function run() {
    await connectDB();
    const User = require('../models/User');
    const BannedDevice = require('../models/BannedDevice');
    const { banDeviceForUser } = require('../services/deviceBanService');

    const permanent = await User.find({
        'suspension.isSuspended': true,
        'suspension.suspendedUntil': null
    }).select('_id name email suspension.reason +deviceFingerprint +keychainToken +vendorId').lean();

    const bannedIds = new Set(
        (await BannedDevice.find(
            { isActive: true, originalUserId: { $in: permanent.map(u => u._id) } },
            { originalUserId: 1 }
        ).lean()).map(b => String(b.originalUserId))
    );

    const missing = permanent.filter(u => !bannedIds.has(String(u._id)));
    const withFingerprint = missing.filter(u => u.deviceFingerprint || u.keychainToken || u.vendorId);

    console.log(`📊 موقوفون دائماً: ${permanent.length}`);
    console.log(`📊 بلا حظر جهاز: ${missing.length} (منهم ${withFingerprint.length} ببصمة، ${missing.length - withFingerprint.length} سيُسجَّلون pending)`);

    if (DRY_RUN) {
        console.log('🔍 dry-run — لم يُكتب شيء. أمثلة:');
        missing.slice(0, 10).forEach(u => console.log(`   - ${u.name} <${u.email}> — ${u.suspension?.reason || ''}`));
        process.exit(0);
    }

    let banned = 0, pending = 0, skipped = 0;
    for (const u of missing) {
        const r = await banDeviceForUser(u._id, {
            reason: 'violation',
            details: `backfill: ${u.suspension?.reason || 'تعليق دائم'}`,
            bannedBy: 'auto'
        });
        if (r.banned) { banned++; if (r.pending) pending++; }
        else { skipped++; console.log(`   ⚠️ تخطّي ${u.email}: ${r.skipped}`); }
    }

    console.log(`✅ حُظر: ${banned} (منها ${pending} pending) — تخطّي: ${skipped}`);
    process.exit(0);
}

run().catch(err => {
    console.error('❌', err);
    process.exit(1);
});
