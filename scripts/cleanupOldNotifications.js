/**
 * Cron Job: تنظيف الإشعارات القديمة
 * يعمل يومياً في 03:00 صباحاً
 *
 * القواعد:
 *  - Personal/Social المقروءة > 30 يوم → حذف
 *  - Admin (للوحة التحكم) > 90 يوم → حذف
 *  - الإشعارات الحرجة (official_warning) لا تُحذف أبداً
 */

const mongoose = require('mongoose');
require('dotenv').config();
const connectDB = require('../config/database');

const KEEP_FOREVER_TYPES = ['official_warning', 'account_suspended', 'account_unsuspended'];
const PERSONAL_RETENTION_DAYS = 30;
const ADMIN_RETENTION_DAYS = 90;

async function cleanupOldNotifications() {
    await connectDB();
    const Notification = require('../models/Notification');

    const now = new Date();
    const personalCutoff = new Date(Date.now() - PERSONAL_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const adminCutoff = new Date(Date.now() - ADMIN_RETENTION_DAYS * 24 * 60 * 60 * 1000);

    console.log(`[${now.toISOString()}] 🧹 بدء تنظيف الإشعارات القديمة...`);

    let totalDeleted = 0;

    try {
        // 1. الإشعارات الشخصية/الاجتماعية المقروءة > 30 يوم
        const personalResult = await Notification.deleteMany({
            adminOnly: { $ne: true },
            type: { $nin: KEEP_FOREVER_TYPES },
            createdAt: { $lt: personalCutoff },
            // فقط المقروءة (للحفاظ على غير المقروءة حتى لو قديمة)
            'readBy.0': { $exists: true }
        });
        console.log(`  ✅ Personal/Social (مقروءة، >${PERSONAL_RETENTION_DAYS} يوم): ${personalResult.deletedCount}`);
        totalDeleted += personalResult.deletedCount;

        // 2. الإشعارات الإدارية > 90 يوم
        const adminResult = await Notification.deleteMany({
            adminOnly: true,
            createdAt: { $lt: adminCutoff }
        });
        console.log(`  ✅ Admin (>${ADMIN_RETENTION_DAYS} يوم): ${adminResult.deletedCount}`);
        totalDeleted += adminResult.deletedCount;

        // 3. تنظيف غير المقروءة الجداً قديمة (90 يوم) — الأقل أولوية
        const ancientResult = await Notification.deleteMany({
            type: { $nin: KEEP_FOREVER_TYPES },
            createdAt: { $lt: adminCutoff }
        });
        console.log(`  ✅ Ancient (>${ADMIN_RETENTION_DAYS} يوم، غير حرجة): ${ancientResult.deletedCount}`);
        totalDeleted += ancientResult.deletedCount;

        console.log(`[${new Date().toISOString()}] 🎉 تم حذف ${totalDeleted} إشعار قديم`);
    } catch (error) {
        console.error(`[${new Date().toISOString()}] ❌ خطأ في التنظيف:`, error.message);
        process.exit(1);
    }

    process.exit(0);
}

cleanupOldNotifications();
