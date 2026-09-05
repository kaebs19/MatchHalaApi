/**
 * Revert: إلغاء حظر الأجهزة الذي تبِع تعليقَ الحساب لا قرارَ أدمن صريحاً
 *
 * السياق (٥ سبتمبر ٢٠٢٦): بُنيت آلية «التعليق الدائم يحظر الجهاز» على قراءة
 * معكوسة لشكوى المالك، وشُغّل backfill على ١٣١٩ حساباً. القاعدة الصحيحة:
 * التعليق يعلّق الحساب فقط، وحظر الجهاز لا يقع إلا بزرّ «حظر الجهاز».
 *
 * يُلغي (isActive: false) أربع فئات:
 *  A. سجلات viaSuspension: true (أُنشئت لحظة التعليق منذ f2197b2)
 *  B. سجلات backfill (reasonDetails تبدأ بـ "backfill:")
 *  C. السجلات التلقائية القديمة التي كان يزرعها مسار الدخول
 *     (bannedBy: auto + "auto-recorded on suspended login") — أصل شكوى «البعض فقط»
 *  D. سجلات أدمن كان قد فكّها ثم أعاد الـ backfill تفعيلها: bannedBy admin،
 *     أُنشئت قبل نافذة الـ backfill وعُدّلت داخلها (01:38–01:47 UTC)
 *
 * لا يلمس: الحظر اليدوي الصريح، ولا spam_system.
 *
 * الاستخدام (على الخادم):
 *   bash -ic 'cd /var/www/MatchHalaApi && node scripts/revertSuspensionDeviceBans.js --dry-run'
 *   bash -ic 'cd /var/www/MatchHalaApi && node scripts/revertSuspensionDeviceBans.js'
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const connectDB = require('../config/database');

const DRY_RUN = process.argv.includes('--dry-run');
const BACKFILL_START = new Date('2026-09-05T01:38:00Z');
const BACKFILL_END = new Date('2026-09-05T01:47:00Z');

async function run() {
    await connectDB();
    const BannedDevice = require('../models/BannedDevice');

    const categories = {
        A_viaSuspension: { isActive: true, viaSuspension: true },
        B_backfill: { isActive: true, reasonDetails: /^backfill:/ },
        C_loginAutoRecord: { isActive: true, bannedBy: 'auto', reasonDetails: /^auto-recorded on suspended login/ },
        D_adminReactivatedByBackfill: {
            isActive: true, bannedBy: 'admin',
            createdAt: { $lt: BACKFILL_START },
            updatedAt: { $gte: BACKFILL_START, $lte: BACKFILL_END }
        }
    };

    const ids = new Set();
    for (const [name, filter] of Object.entries(categories)) {
        const docs = await BannedDevice.find(filter).select('_id originalUserId reasonDetails').lean();
        docs.forEach(d => ids.add(String(d._id)));
        console.log(`📊 ${name}: ${docs.length}`);
        if (DRY_RUN) docs.slice(0, 3).forEach(d => console.log(`      · ${d._id} — ${d.reasonDetails || ''}`));
    }
    console.log(`📊 إجمالي السجلات المستهدَفة (بلا تكرار): ${ids.size}`);

    if (DRY_RUN) {
        console.log('🔍 dry-run — لم يُكتب شيء.');
        process.exit(0);
    }

    const result = await BannedDevice.updateMany(
        { _id: { $in: [...ids] } },
        { $set: { isActive: false } }
    );
    console.log(`✅ أُلغي: ${result.modifiedCount}`);
    process.exit(0);
}

run().catch(err => { console.error('❌', err); process.exit(1); });
