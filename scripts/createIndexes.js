#!/usr/bin/env node
// =============================================
// إنشاء Indexes لتحسين أداء الاستعلامات
// الاستخدام: node scripts/createIndexes.js
// =============================================

const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const connectDB = require('../config/database');

async function createIndexes() {
    await connectDB();
    const db = mongoose.connection.db;

    console.log('🔧 إنشاء Indexes...\n');

    // ─── Users ───
    // موجود: { name: 'text' }, { gender:1, country:1 }, { isOnline:-1, lastLogin:-1 },
    //         { email:1 unique }, { location: '2dsphere' }, { isPremium:1 }, { verification.status:1 }
    // مفقود:
    await db.collection('users').createIndex({ isActive: 1, gender: 1 });
    await db.collection('users').createIndex({ deviceToken: 1 }, { sparse: true });
    await db.collection('users').createIndex({ fcmToken: 1 }, { sparse: true });
    await db.collection('users').createIndex({ 'bannedWords.isBanned': 1 });
    console.log('✅ Users indexes');

    // ─── Conversations ───
    // موجود: { participants:1 }, { createdAt:-1 }, { isActive:1 }
    // مفقود:
    await db.collection('conversations').createIndex({ updatedAt: -1 });
    await db.collection('conversations').createIndex({ participants: 1, status: 1, isActive: 1 });
    await db.collection('conversations').createIndex({ participants: 1, updatedAt: -1 });
    console.log('✅ Conversations indexes');

    // ─── Messages ───
    // موجود: { conversation:1, createdAt:-1 }, { sender:1 }, { isDeleted:1 }
    // مفقود:
    await db.collection('messages').createIndex({ conversation: 1, 'readBy.user': 1 });
    await db.collection('messages').createIndex({ conversation: 1, sender: 1, 'readBy.user': 1 });
    console.log('✅ Messages indexes');

    // ─── Notifications ───
    // موجود: { sender:1, createdAt:-1 }, { recipients:1, status:1 }, { targetUsers:1 }, { type:1 }
    // مفقود:
    await db.collection('notifications').createIndex({ targetUsers: 1, createdAt: -1 });
    await db.collection('notifications').createIndex({ targetUsers: 1, 'readBy.user': 1 });
    await db.collection('notifications').createIndex({ isActive: 1, createdAt: -1 });
    console.log('✅ Notifications indexes');

    // ─── Swipes ───
    // موجود: { swiper:1, swiped:1 unique }, { swiped:1, type:1 }, { createdAt:-1 }
    // مفقود:
    await db.collection('swipes').createIndex({ swiper: 1, createdAt: -1 });
    await db.collection('swipes').createIndex({ swiper: 1, type: 1 });
    console.log('✅ Swipes indexes');

    // ─── Matches ───
    // موجود: { users:1 }, { users:1, isActive:1 }, { createdAt:-1 }
    // مفقود:
    await db.collection('matches').createIndex({ users: 1, isActive: 1, updatedAt: -1 });
    await db.collection('matches').createIndex({ users: 1, createdAt: -1 });
    console.log('✅ Matches indexes');

    // ─── عرض كل الـ Indexes ───
    console.log('\n📊 ملخص الـ Indexes:');
    const collections = ['users', 'conversations', 'messages', 'notifications', 'swipes', 'matches'];
    for (const c of collections) {
        try {
            const indexes = await db.collection(c).indexes();
            console.log(`  ${c}: ${indexes.length} indexes`);
        } catch (e) {
            console.log(`  ${c}: not found`);
        }
    }

    console.log('\n🎉 تم إنشاء كل الـ Indexes بنجاح');
    process.exit(0);
}

createIndexes().catch(err => {
    console.error('❌ خطأ:', err);
    process.exit(1);
});
