#!/usr/bin/env node

/**
 * HalaChat - سكربت تنظيف الرسائل القديمة
 * يحذف الرسائل الأقدم من 3 أشهر من قاعدة البيانات
 *
 * الاستخدام:
 *   node cleanupOldMessages.js              # تشغيل عادي (حذف رسائل أقدم من 3 أشهر)
 *   node cleanupOldMessages.js --dry-run    # معاينة فقط بدون حذف
 *   node cleanupOldMessages.js --months 6   # حذف رسائل أقدم من 6 أشهر
 *   node cleanupOldMessages.js --rooms-only # حذف رسائل الغرف فقط
 *   node cleanupOldMessages.js --private-only # حذف المحادثات الخاصة فقط
 */

require('dotenv').config();
const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');

// ==================== الإعدادات ====================

const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const roomsOnly = args.includes('--rooms-only');
const privateOnly = args.includes('--private-only');

// عدد الأشهر (افتراضي 3)
let months = 3;
const monthsIndex = args.indexOf('--months');
if (monthsIndex !== -1 && args[monthsIndex + 1]) {
    months = parseInt(args[monthsIndex + 1]);
    if (isNaN(months) || months < 1) {
        console.error('❌ قيمة الأشهر غير صالحة. يجب أن تكون رقم أكبر من 0');
        process.exit(1);
    }
}

// ==================== النماذج ====================

const messageSchema = new mongoose.Schema({
    chatType: { type: String, enum: ['conversation', 'room'] },
    conversation: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation' },
    room: { type: mongoose.Schema.Types.ObjectId, ref: 'ChatRoom' },
    sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    content: { type: String, default: '' },
    mediaUrl: { type: String, default: '' },
    type: { type: String, enum: ['text', 'image', 'file', 'audio', 'video'], default: 'text' },
    status: { type: String, default: 'sent' },
    readBy: [{ user: { type: mongoose.Schema.Types.ObjectId }, readAt: Date }],
    isDeleted: { type: Boolean, default: false },
    deletedAt: Date,
    metadata: { fileUrl: String, fileName: String, fileSize: Number, mimeType: String }
}, { timestamps: true });

const chatRoomSchema = new mongoose.Schema({
    name: String,
    messageCount: { type: Number, default: 0 },
    lastMessage: { type: mongoose.Schema.Types.ObjectId, ref: 'Message' }
}, { timestamps: true });

const conversationSchema = new mongoose.Schema({
    title: String,
    type: String,
    metadata: {
        totalMessages: { type: Number, default: 0 }
    },
    lastMessage: { type: mongoose.Schema.Types.ObjectId, ref: 'Message' }
}, { timestamps: true });

const Message = mongoose.model('Message', messageSchema);
const ChatRoom = mongoose.model('ChatRoom', chatRoomSchema);
const Conversation = mongoose.model('Conversation', conversationSchema);

// ==================== دوال مساعدة ====================

const formatNumber = (num) => num.toLocaleString('en-US');
const formatSize = (bytes) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

const log = (msg) => console.log(msg);
const separator = () => log('─'.repeat(60));

// حذف ملفات الوسائط المرتبطة بالرسائل
const deleteMediaFiles = async (messages) => {
    let deletedFiles = 0;
    let failedFiles = 0;
    let freedSpace = 0;

    for (const msg of messages) {
        if (msg.mediaUrl) {
            try {
                // استخراج المسار النسبي من الرابط
                let filePath = msg.mediaUrl;

                // إزالة domain إن وجد
                if (filePath.includes('/uploads/')) {
                    filePath = filePath.substring(filePath.indexOf('/uploads/'));
                }

                const fullPath = path.join(__dirname, '..', filePath);

                if (fs.existsSync(fullPath)) {
                    const stats = fs.statSync(fullPath);
                    freedSpace += stats.size;

                    if (!isDryRun) {
                        fs.unlinkSync(fullPath);
                    }
                    deletedFiles++;
                }
            } catch (err) {
                failedFiles++;
            }
        }
    }

    return { deletedFiles, failedFiles, freedSpace };
};

// ==================== العملية الرئيسية ====================

async function main() {
    log('');
    separator();
    log('🧹  HalaChat - سكربت تنظيف الرسائل القديمة');
    separator();

    if (isDryRun) {
        log('⚠️   وضع المعاينة (Dry Run) - لن يتم حذف أي شيء');
    }

    log(`📅  حذف الرسائل الأقدم من ${months} أشهر`);

    if (roomsOnly) log('🏠  الغرف فقط');
    else if (privateOnly) log('💬  المحادثات الخاصة فقط');
    else log('📋  جميع الرسائل (غرف + محادثات خاصة)');

    separator();

    // ==================== الاتصال بقاعدة البيانات ====================

    log('🔌  جاري الاتصال بقاعدة البيانات...');

    try {
        await mongoose.connect(process.env.MONGODB_URI);
        log(`✅  متصل: ${mongoose.connection.host} / ${mongoose.connection.name}`);
    } catch (error) {
        log(`❌  فشل الاتصال: ${error.message}`);
        process.exit(1);
    }

    separator();

    // ==================== حساب التاريخ ====================

    const cutoffDate = new Date();
    cutoffDate.setMonth(cutoffDate.getMonth() - months);
    log(`📆  تاريخ القطع: ${cutoffDate.toISOString().split('T')[0]}`);
    log(`    (سيتم حذف كل رسالة قبل هذا التاريخ)`);

    // ==================== إحصائيات قبل التنظيف ====================

    separator();
    log('📊  إحصائيات قبل التنظيف:');

    const totalMessages = await Message.countDocuments();
    const totalRoomMessages = await Message.countDocuments({ chatType: 'room' });
    const totalConvMessages = await Message.countDocuments({ chatType: 'conversation' });

    log(`    إجمالي الرسائل: ${formatNumber(totalMessages)}`);
    log(`    رسائل الغرف: ${formatNumber(totalRoomMessages)}`);
    log(`    رسائل المحادثات الخاصة: ${formatNumber(totalConvMessages)}`);

    // ==================== حساب الرسائل المستهدفة ====================

    separator();
    log('🔍  تحليل الرسائل المستهدفة للحذف...');

    let roomMessagesToDelete = 0;
    let convMessagesToDelete = 0;

    if (!privateOnly) {
        roomMessagesToDelete = await Message.countDocuments({
            chatType: 'room',
            createdAt: { $lt: cutoffDate }
        });
        log(`    رسائل الغرف القديمة: ${formatNumber(roomMessagesToDelete)}`);
    }

    if (!roomsOnly) {
        convMessagesToDelete = await Message.countDocuments({
            chatType: 'conversation',
            createdAt: { $lt: cutoffDate }
        });
        log(`    رسائل المحادثات الخاصة القديمة: ${formatNumber(convMessagesToDelete)}`);
    }

    const totalToDelete = roomMessagesToDelete + convMessagesToDelete;
    log(`    ─────────────────────────────`);
    log(`    المجموع للحذف: ${formatNumber(totalToDelete)}`);

    if (totalToDelete === 0) {
        log('');
        log('✅  لا توجد رسائل قديمة للحذف!');
        separator();
        await mongoose.disconnect();
        process.exit(0);
    }

    const percentage = ((totalToDelete / totalMessages) * 100).toFixed(1);
    log(`    النسبة: ${percentage}% من إجمالي الرسائل`);

    // ==================== تفصيل حسب النوع ====================

    separator();
    log('📎  تفصيل أنواع الرسائل المستهدفة:');

    const typeBreakdown = await Message.aggregate([
        {
            $match: {
                createdAt: { $lt: cutoffDate },
                ...(!privateOnly && !roomsOnly ? {} :
                    roomsOnly ? { chatType: 'room' } : { chatType: 'conversation' })
            }
        },
        {
            $group: {
                _id: '$type',
                count: { $sum: 1 }
            }
        },
        { $sort: { count: -1 } }
    ]);

    const typeEmojis = {
        'text': '📝',
        'image': '🖼️',
        'video': '🎥',
        'audio': '🎵',
        'file': '📁'
    };

    for (const item of typeBreakdown) {
        const emoji = typeEmojis[item._id] || '📄';
        log(`    ${emoji} ${item._id}: ${formatNumber(item.count)}`);
    }

    // عدد رسائل الوسائط
    const mediaCount = await Message.countDocuments({
        createdAt: { $lt: cutoffDate },
        mediaUrl: { $nin: ['', null] },
        ...(!privateOnly && !roomsOnly ? {} :
            roomsOnly ? { chatType: 'room' } : { chatType: 'conversation' })
    });

    if (mediaCount > 0) {
        log(`    ─────────────────────────────`);
        log(`    📦 رسائل بوسائط (صور/فيديو/ملفات): ${formatNumber(mediaCount)}`);
    }

    // ==================== الحذف ====================

    separator();

    if (isDryRun) {
        log('⚠️   وضع المعاينة - انتهى بدون حذف');
        log('    لتنفيذ الحذف الفعلي، شغّل بدون --dry-run');
        separator();
        await mongoose.disconnect();
        process.exit(0);
    }

    log('🗑️   جاري الحذف...');
    log('');

    let totalDeleted = 0;
    let totalMediaDeleted = 0;
    let totalSpaceFreed = 0;

    // ---- حذف رسائل الغرف ----
    if (!privateOnly && roomMessagesToDelete > 0) {
        log('  🏠 حذف رسائل الغرف القديمة...');

        // جلب رسائل الوسائط أولاً لحذف الملفات
        const roomMediaMessages = await Message.find({
            chatType: 'room',
            createdAt: { $lt: cutoffDate },
            mediaUrl: { $nin: ['', null] }
        }).select('mediaUrl').lean();

        if (roomMediaMessages.length > 0) {
            const mediaResult = await deleteMediaFiles(roomMediaMessages);
            totalMediaDeleted += mediaResult.deletedFiles;
            totalSpaceFreed += mediaResult.freedSpace;
            log(`     📦 ملفات وسائط محذوفة: ${mediaResult.deletedFiles} (${formatSize(mediaResult.freedSpace)})`);
        }

        // حذف الرسائل من قاعدة البيانات
        const roomResult = await Message.deleteMany({
            chatType: 'room',
            createdAt: { $lt: cutoffDate }
        });

        totalDeleted += roomResult.deletedCount;
        log(`     ✅ تم حذف ${formatNumber(roomResult.deletedCount)} رسالة من الغرف`);

        // تحديث عدادات الغرف
        const affectedRooms = await ChatRoom.find({});
        let updatedRooms = 0;
        for (const room of affectedRooms) {
            const newCount = await Message.countDocuments({
                chatType: 'room',
                room: room._id,
                isDeleted: { $ne: true }
            });
            const lastMsg = await Message.findOne({
                chatType: 'room',
                room: room._id,
                isDeleted: { $ne: true }
            }).sort({ createdAt: -1 });

            if (room.messageCount !== newCount ||
                (room.lastMessage && !lastMsg) ||
                (lastMsg && String(room.lastMessage) !== String(lastMsg._id))) {
                room.messageCount = newCount;
                room.lastMessage = lastMsg ? lastMsg._id : null;
                await room.save();
                updatedRooms++;
            }
        }
        log(`     🔄 تم تحديث ${updatedRooms} غرفة`);
    }

    log('');

    // ---- حذف رسائل المحادثات الخاصة ----
    if (!roomsOnly && convMessagesToDelete > 0) {
        log('  💬 حذف رسائل المحادثات الخاصة القديمة...');

        // جلب رسائل الوسائط أولاً
        const convMediaMessages = await Message.find({
            chatType: 'conversation',
            createdAt: { $lt: cutoffDate },
            mediaUrl: { $nin: ['', null] }
        }).select('mediaUrl').lean();

        if (convMediaMessages.length > 0) {
            const mediaResult = await deleteMediaFiles(convMediaMessages);
            totalMediaDeleted += mediaResult.deletedFiles;
            totalSpaceFreed += mediaResult.freedSpace;
            log(`     📦 ملفات وسائط محذوفة: ${mediaResult.deletedFiles} (${formatSize(mediaResult.freedSpace)})`);
        }

        // حذف الرسائل من قاعدة البيانات
        const convResult = await Message.deleteMany({
            chatType: 'conversation',
            createdAt: { $lt: cutoffDate }
        });

        totalDeleted += convResult.deletedCount;
        log(`     ✅ تم حذف ${formatNumber(convResult.deletedCount)} رسالة من المحادثات الخاصة`);

        // تحديث عدادات المحادثات
        const affectedConvs = await Conversation.find({});
        let updatedConvs = 0;
        for (const conv of affectedConvs) {
            const newCount = await Message.countDocuments({
                chatType: 'conversation',
                conversation: conv._id,
                isDeleted: { $ne: true }
            });
            const lastMsg = await Message.findOne({
                chatType: 'conversation',
                conversation: conv._id,
                isDeleted: { $ne: true }
            }).sort({ createdAt: -1 });

            const currentTotal = conv.metadata?.totalMessages || 0;
            if (currentTotal !== newCount ||
                (conv.lastMessage && !lastMsg) ||
                (lastMsg && String(conv.lastMessage) !== String(lastMsg._id))) {
                conv.metadata = conv.metadata || {};
                conv.metadata.totalMessages = newCount;
                conv.lastMessage = lastMsg ? lastMsg._id : null;
                await conv.save();
                updatedConvs++;
            }
        }
        log(`     🔄 تم تحديث ${updatedConvs} محادثة`);
    }

    // ==================== التقرير النهائي ====================

    separator();
    log('📊  التقرير النهائي:');
    separator();
    log(`    🗑️  رسائل محذوفة: ${formatNumber(totalDeleted)}`);
    log(`    📦  ملفات وسائط محذوفة: ${formatNumber(totalMediaDeleted)}`);
    log(`    💾  مساحة ملفات محررة: ${formatSize(totalSpaceFreed)}`);
    log('');

    const remainingMessages = await Message.countDocuments();
    log(`    📈  الرسائل المتبقية: ${formatNumber(remainingMessages)}`);
    log(`    📉  تم تقليص: ${formatNumber(totalMessages - remainingMessages)} رسالة (${percentage}%)`);

    separator();
    log('✅  تم التنظيف بنجاح!');
    log(`    التاريخ: ${new Date().toISOString()}`);
    separator();
    log('');

    await mongoose.disconnect();
    process.exit(0);
}

// ==================== تشغيل السكربت ====================

main().catch(async (error) => {
    console.error('❌  خطأ غير متوقع:', error.message);
    console.error(error.stack);
    try {
        await mongoose.disconnect();
    } catch (e) {}
    process.exit(1);
});
