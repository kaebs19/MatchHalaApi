// HalaChat Dashboard - Conversations Seeder
// ملف لإضافة محادثات ورسائل تجريبية

const mongoose = require('mongoose');
require('dotenv').config();
const User = require('./models/User');
const Conversation = require('./models/Conversation');
const Message = require('./models/Message');
const connectDB = require('./config/database');

// دالة لإضافة البيانات التجريبية
const seedConversations = async () => {
    try {
        await connectDB();

        // الحصول على المستخدمين الموجودين
        const users = await User.find().limit(5);

        if (users.length < 2) {
            console.log('❌ يجب أن يكون هناك مستخدمين على الأقل في قاعدة البيانات');
            console.log('قم بتشغيل: npm run seed');
            process.exit(1);
        }

        // حذف البيانات القديمة
        await Message.deleteMany();
        await Conversation.deleteMany();
        console.log('🗑️  تم حذف المحادثات القديمة');

        // إنشاء محادثات تجريبية
        const conversations = [];

        // محادثة 1: بين أول مستخدمين
        const conv1 = await Conversation.create({
            title: 'محادثة تجريبية 1',
            type: 'private',
            participants: [users[0]._id, users[1]._id],
            isActive: true
        });
        conversations.push(conv1);

        // رسائل المحادثة 1
        const msg1_1 = await Message.create({
            conversation: conv1._id,
            sender: users[0]._id,
            content: 'مرحباً! كيف حالك؟',
            type: 'text',
            status: 'read'
        });

        const msg1_2 = await Message.create({
            conversation: conv1._id,
            sender: users[1]._id,
            content: 'الحمد لله بخير، وأنت؟',
            type: 'text',
            status: 'read'
        });

        const msg1_3 = await Message.create({
            conversation: conv1._id,
            sender: users[0]._id,
            content: 'بخير والحمد لله، ما الأخبار؟',
            type: 'text',
            status: 'delivered'
        });

        // تحديث آخر رسالة
        conv1.lastMessage = msg1_3._id;
        conv1.metadata.totalMessages = 3;
        await conv1.save();

        if (users.length >= 3) {
            // محادثة 2: محادثة جماعية
            const conv2 = await Conversation.create({
                title: 'مجموعة المطورين',
                type: 'group',
                participants: [users[0]._id, users[1]._id, users[2]._id],
                isActive: true
            });
            conversations.push(conv2);

            // رسائل المحادثة 2
            const msg2_1 = await Message.create({
                conversation: conv2._id,
                sender: users[0]._id,
                content: 'مرحباً بالجميع في المجموعة!',
                type: 'text',
                status: 'read'
            });

            const msg2_2 = await Message.create({
                conversation: conv2._id,
                sender: users[1]._id,
                content: 'أهلاً وسهلاً 👋',
                type: 'text',
                status: 'read'
            });

            const msg2_3 = await Message.create({
                conversation: conv2._id,
                sender: users[2]._id,
                content: 'سعيد بالانضمام للمجموعة',
                type: 'text',
                status: 'read'
            });

            const msg2_4 = await Message.create({
                conversation: conv2._id,
                sender: users[0]._id,
                content: 'لنبدأ بمناقشة المشروع الجديد',
                type: 'text',
                status: 'delivered'
            });

            conv2.lastMessage = msg2_4._id;
            conv2.metadata.totalMessages = 4;
            await conv2.save();
        }

        if (users.length >= 4) {
            // محادثة 3: محادثة أخرى
            const conv3 = await Conversation.create({
                title: 'محادثة تجريبية 3',
                type: 'private',
                participants: [users[2]._id, users[3]._id],
                isActive: false  // محادثة موقوفة
            });
            conversations.push(conv3);

            const msg3_1 = await Message.create({
                conversation: conv3._id,
                sender: users[2]._id,
                content: 'هذه محادثة قديمة',
                type: 'text',
                status: 'read'
            });

            conv3.lastMessage = msg3_1._id;
            conv3.metadata.totalMessages = 1;
            await conv3.save();
        }

        console.log('✅ تم إضافة المحادثات التجريبية بنجاح');
        console.log(`\n📊 الإحصائيات:`);
        console.log(`   - عدد المحادثات: ${conversations.length}`);
        console.log(`   - عدد الرسائل: ${await Message.countDocuments()}`);
        console.log('\n🎉 يمكنك الآن رؤية المحادثات في لوحة التحكم\n');

        process.exit(0);
    } catch (error) {
        console.error('❌ خطأ:', error);
        process.exit(1);
    }
};

// تشغيل الدالة
seedConversations();
