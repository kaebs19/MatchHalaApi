/**
 * Restore: إعادة تفعيل حظر الأجهزة اليدوي الذي ألغاه revertSuspensionDeviceBans بالخطأ
 *
 * الفئة D في سكربت العكس استهدفت «سجلات أدمن عُدّلت داخل نافذة الـ backfill»
 * ظنّاً أنها سجلات كان الأدمن قد فكّها ثم أعاد الـ backfill تفعيلها (~86).
 * لكن $set يُحدّث updatedAt حتى لو لم تتغيّر القيمة، فشملت الفئة أيضاً ~215
 * سجلاً يدوياً كان نشطاً أصلاً ولمسه الـ backfill فقط. النتيجة: 301 حظر
 * جهاز يدوي صريح أُلغي، ولا أثر في البيانات يفرّق الـ 86 عن الـ 215.
 *
 * القرار: إعادة الـ 301 كلها — الحظر اليدوي الصريح يبقى، والـ 86 التي كان
 * الأدمن قد فكّها تُراجَع يداً من قائمة يطبعها هذا السكربت.
 *
 *   bash -ic 'cd /var/www/MatchHalaApi && node scripts/restoreAdminDeviceBans.js --dry-run'
 *   bash -ic 'cd /var/www/MatchHalaApi && node scripts/restoreAdminDeviceBans.js'
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const connectDB = require('../config/database');

const DRY_RUN = process.argv.includes('--dry-run');
const BACKFILL_START = new Date('2026-09-05T01:38:00Z');
const REVERT_START = new Date('2026-09-05T02:10:00Z');

async function run() {
    await connectDB();
    const BannedDevice = require('../models/BannedDevice');
    require('../models/User'); // populate يحتاج النموذج مسجَّلاً

    const filter = {
        isActive: false,
        bannedBy: 'admin',
        createdAt: { $lt: BACKFILL_START },
        updatedAt: { $gte: REVERT_START }
    };
    const docs = await BannedDevice.find(filter)
        .populate('originalUserId', 'name email')
        .select('originalUserId reasonDetails createdAt')
        .lean();

    console.log(`📊 سجلات أدمن ألغاها العكس: ${docs.length}`);
    console.log('   (راجع هذه القائمة: من كنتَ قد فككتَ جهازه عن قصد يُفكّ يداً من اللوحة)');
    docs.forEach(d => console.log(`   - ${d.originalUserId?.name || '?'} <${d.originalUserId?.email || '?'}> — ${d.reasonDetails || ''} — ${d.createdAt.toISOString().slice(0, 10)}`));

    if (DRY_RUN) { console.log('🔍 dry-run — لم يُكتب شيء.'); process.exit(0); }

    const r = await BannedDevice.updateMany(filter, { $set: { isActive: true } });
    console.log(`✅ أُعيد تفعيل: ${r.modifiedCount}`);
    process.exit(0);
}

run().catch(err => { console.error('❌', err); process.exit(1); });
