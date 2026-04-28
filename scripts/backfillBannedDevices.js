/**
 * Backfill Script: تسجيل الأجهزة المحظورة للحسابات الموقوفة الموجودة
 *
 * المشكلة:
 * - مستخدمون موقوفون قديمًا لم تُسجَّل أجهزتهم في BannedDevice
 * - النتيجة: يقدرون يعملون حسابات جديدة على نفس الجهاز ويتجاوزون الحظر
 *
 * هذا السكربت يمر على كل مستخدم موقوف/معطّل، ويُنشئ/يُحدّث سجل في BannedDevice:
 * 1. لو عنده deviceFingerprint أو keychainToken → upsert بالبصمة (ban فعلي)
 * 2. لو ما عنده بصمة → upsert pending (سيُربط عند تسجيل الدخول التالي)
 *
 * يُشغَّل مرة واحدة فقط:
 *   node scripts/backfillBannedDevices.js
 *   node scripts/backfillBannedDevices.js --dry-run    (للمعاينة فقط)
 */

const mongoose = require('mongoose');
require('dotenv').config();
const connectDB = require('../config/database');

const DRY_RUN = process.argv.includes('--dry-run');

async function backfill() {
    await connectDB();
    const User = require('../models/User');
    const BannedDevice = require('../models/BannedDevice');

    // ⚠️ فقط المستخدمين بعقوبات دائمة:
    // - تعليق دائم (suspension.suspendedUntil = null + isSuspended = true)
    // - تعطيل حساب يدوي (isActive = false)
    // bannedWords مؤقت 24h → لا backfill (يُعالَج في login لو سحب)
    // suspension مؤقت → ينتهي تلقائيًا، لا backfill
    const suspendedUsers = await User.find({
        $or: [
            {
                'suspension.isSuspended': true,
                'suspension.suspendedUntil': null
            },
            { isActive: false }
        ]
    }).select('+deviceFingerprint +keychainToken +deviceDetails name email isActive suspension bannedWords').lean();

    console.log(`📊 وجدت ${suspendedUsers.length} مستخدم موقوف/معطّل`);

    let stats = {
        total: suspendedUsers.length,
        withFingerprint: 0,
        pendingOnly: 0,
        alreadyBanned: 0,
        created: 0,
        updated: 0,
        errors: 0
    };

    for (const u of suspendedUsers) {
        try {
            const hasFingerprint = !!(u.deviceFingerprint || u.keychainToken);
            if (hasFingerprint) stats.withFingerprint++;
            else stats.pendingOnly++;

            // هل فيه سجل سابق؟
            const matchConditions = [{ originalUserId: u._id }];
            if (u.deviceFingerprint) matchConditions.push({ deviceFingerprint: u.deviceFingerprint });
            if (u.keychainToken) matchConditions.push({ keychainToken: u.keychainToken });

            const existing = await BannedDevice.findOne({ $or: matchConditions });
            if (existing && existing.isActive && (existing.deviceFingerprint || existing.keychainToken)) {
                stats.alreadyBanned++;
                continue;
            }

            // تحديد السبب
            let reason = 'manual';
            let reasonDetails = 'backfill';
            if (u.bannedWords?.isBanned) {
                reason = 'violation';
                reasonDetails = `backfill: ${u.bannedWords.banReason || 'banned_words'}`;
            } else if (u.suspension?.isSuspended) {
                reason = 'manual';
                reasonDetails = `backfill: ${u.suspension.reason || 'suspended'}`;
            } else if (u.isActive === false) {
                reason = 'manual';
                reasonDetails = 'backfill: inactive_account';
            }

            const setFields = {
                originalUserId: u._id,
                deviceInfo: u.deviceDetails || {},
                reason,
                reasonDetails,
                bannedBy: 'auto',
                isActive: true,
                pendingFingerprint: !hasFingerprint
            };
            if (u.deviceFingerprint) setFields.deviceFingerprint = u.deviceFingerprint;
            if (u.keychainToken) setFields.keychainToken = u.keychainToken;

            if (DRY_RUN) {
                console.log(`  [DRY] ${u.name} (${u.email}) — fp:${u.deviceFingerprint?.slice(0, 8) || 'none'} — pending:${!hasFingerprint}`);
                continue;
            }

            // نفحص الوجود قبل الـ upsert لمعرفة إن كان جديدًا أم محدّثًا
            const wasExisting = !!existing;
            await BannedDevice.findOneAndUpdate(
                { $or: matchConditions },
                { $set: setFields },
                { upsert: true }
            );
            if (wasExisting) stats.updated++;
            else stats.created++;
        } catch (e) {
            stats.errors++;
            console.error(`❌ خطأ على ${u.email}: ${e.message}`);
        }
    }

    console.log('\n═══════════════════════════════════════');
    console.log(`📊 النتائج ${DRY_RUN ? '(DRY RUN — لا تغييرات)' : ''}:`);
    console.log(`   إجمالي الموقوفين:      ${stats.total}`);
    console.log(`   لديهم fingerprint:    ${stats.withFingerprint}`);
    console.log(`   pending فقط:          ${stats.pendingOnly}`);
    console.log(`   ─────────────────────────`);
    console.log(`   ✅ سجلات جديدة:        ${stats.created}`);
    console.log(`   🔄 سجلات محدّثة:       ${stats.updated}`);
    console.log(`   ⏭️  بالفعل محظورة:     ${stats.alreadyBanned}`);
    console.log(`   ❌ أخطاء:             ${stats.errors}`);
    console.log('═══════════════════════════════════════\n');

    process.exit(0);
}

backfill().catch(err => {
    console.error('Fatal:', err);
    process.exit(1);
});
