// Push Notification Service
// خدمة إرسال الإشعارات الفورية عبر Firebase Cloud Messaging

const {
    sendToDevice,
    sendToMultipleDevices,
    sendToTopic,
    subscribeToTopic,
    unsubscribeFromTopic
} = require('../config/firebase');
const User = require('../models/User');
const Notification = require('../models/Notification');

/**
 * إرسال إشعار لمستخدم واحد
 * @param {string} userId - معرف المستخدم
 * @param {object} notification - بيانات الإشعار
 * @param {object} data - بيانات إضافية للإشعار
 * @param {boolean} saveToDb - حفظ في قاعدة البيانات
 */
const sendNotificationToUser = async (userId, notification, data = {}, saveToDb = true) => {
    try {
        const user = await User.findById(userId);

        if (!user) {
            return { success: false, error: 'المستخدم غير موجود' };
        }

        // حفظ الإشعار في قاعدة البيانات
        if (saveToDb) {
            await Notification.create({
                title: notification.title,
                body: notification.body,
                type: data.type || 'general',
                recipients: 'specific',
                targetUsers: [userId],
                sender: data.senderId || data.fromUserId || userId,
                status: 'sent',
                sentAt: new Date(),
                sentCount: 1,
                data: data
            });
        }

        // إذا لم يكن لدى المستخدم FCM Token، نرجع نجاح (تم الحفظ فقط)
        if (!user.deviceToken) {
            console.log(`⚠️ المستخدم ${user.name} ليس لديه FCM Token`);
            return { success: true, saved: true, pushed: false };
        }

        // إرسال Push Notification
        const result = await sendToDevice(user.deviceToken, notification, {
            ...data,
            userId: userId.toString()
        });

        return { success: true, saved: true, pushed: result.success };
    } catch (error) {
        console.error('❌ خطأ في إرسال الإشعار للمستخدم:', error.message);
        return { success: false, error: error.message };
    }
};

/**
 * إرسال إشعار لعدة مستخدمين
 * @param {string[]} userIds - قائمة معرفات المستخدمين
 * @param {object} notification - بيانات الإشعار
 * @param {object} data - بيانات إضافية
 * @param {boolean} saveToDb - حفظ في قاعدة البيانات
 */
const sendNotificationToUsers = async (userIds, notification, data = {}, saveToDb = true) => {
    try {
        const users = await User.find({ _id: { $in: userIds } });

        if (users.length === 0) {
            return { success: false, error: 'لم يتم العثور على مستخدمين' };
        }

        // حفظ الإشعارات في قاعدة البيانات
        if (saveToDb) {
            const notifications = users.map(user => ({
                user: user._id,
                title: notification.title,
                message: notification.body,
                type: data.type || 'general',
                data: data
            }));
            await Notification.insertMany(notifications);
        }

        // جمع FCM Tokens
        const tokens = users
            .filter(user => user.deviceToken)
            .map(user => user.deviceToken);

        if (tokens.length === 0) {
            console.log('⚠️ لا يوجد مستخدمين بـ FCM Token');
            return { success: true, saved: true, pushed: false, usersWithoutToken: users.length };
        }

        // إرسال Push Notifications
        const result = await sendToMultipleDevices(tokens, notification, data);

        // تحديث التوكنات الفاشلة (حذفها من المستخدمين)
        if (result.failedTokens && result.failedTokens.length > 0) {
            await User.updateMany(
                { deviceToken: { $in: result.failedTokens } },
                { $unset: { deviceToken: 1 } }
            );
            console.log(`🗑️ تم حذف ${result.failedTokens.length} توكنات غير صالحة`);
        }

        return {
            success: true,
            saved: true,
            pushed: result.success,
            successCount: result.successCount,
            failureCount: result.failureCount
        };
    } catch (error) {
        console.error('❌ خطأ في إرسال الإشعارات للمستخدمين:', error.message);
        return { success: false, error: error.message };
    }
};

/**
 * إرسال إشعار لجميع المستخدمين (Broadcast)
 * @param {object} notification - بيانات الإشعار
 * @param {object} data - بيانات إضافية
 * @param {object} filter - تصفية المستخدمين (اختياري)
 */
const broadcastNotification = async (notification, data = {}, filter = {}) => {
    try {
        // البحث عن المستخدمين النشطين
        const users = await User.find({
            isActive: true,
            deviceToken: { $exists: true, $ne: null },
            ...filter
        }).select('_id deviceToken name');

        if (users.length === 0) {
            return { success: false, error: 'لا يوجد مستخدمين للإرسال' };
        }

        // حفظ الإشعارات في قاعدة البيانات
        const notifications = users.map(user => ({
            user: user._id,
            title: notification.title,
            message: notification.body,
            type: data.type || 'broadcast',
            data: data
        }));
        await Notification.insertMany(notifications);

        // إرسال على دفعات (500 توكن في كل مرة)
        const batchSize = 500;
        const tokens = users.map(user => user.deviceToken);
        let totalSuccess = 0;
        let totalFailure = 0;
        const allFailedTokens = [];

        for (let i = 0; i < tokens.length; i += batchSize) {
            const batch = tokens.slice(i, i + batchSize);
            const result = await sendToMultipleDevices(batch, notification, data);

            if (result.success) {
                totalSuccess += result.successCount;
                totalFailure += result.failureCount;
                if (result.failedTokens) {
                    allFailedTokens.push(...result.failedTokens);
                }
            }
        }

        // تنظيف التوكنات الفاشلة
        if (allFailedTokens.length > 0) {
            await User.updateMany(
                { deviceToken: { $in: allFailedTokens } },
                { $unset: { deviceToken: 1 } }
            );
        }

        console.log(`📢 Broadcast: نجاح ${totalSuccess}، فشل ${totalFailure} من ${tokens.length}`);

        return {
            success: true,
            totalUsers: users.length,
            successCount: totalSuccess,
            failureCount: totalFailure
        };
    } catch (error) {
        console.error('❌ خطأ في البث العام:', error.message);
        return { success: false, error: error.message };
    }
};

/**
 * إرسال إشعار رسالة جديدة
 * @param {string} recipientId - معرف المستلم
 * @param {string} senderName - اسم المرسل
 * @param {string} messagePreview - معاينة الرسالة
 * @param {string} conversationId - معرف المحادثة
 */
const sendNewMessageNotification = async (recipientId, senderName, messagePreview, conversationId, senderImage = null, senderId = null) => {
    try {
        // التحقق من كتم المحادثة
        const user = await User.findById(recipientId);
        if (!user) {
            return { success: false, error: 'المستخدم غير موجود' };
        }

        // فحص قائمة المحادثات المكتومة
        const mutedConv = user.mutedConversations?.find(
            m => m.conversationId && m.conversationId.toString() === conversationId.toString()
        );

        if (mutedConv) {
            // تحقق إذا انتهت مدة الكتم
            if (mutedConv.mutedUntil && new Date() > new Date(mutedConv.mutedUntil)) {
                // انتهت مدة الكتم - أزل من القائمة
                await User.findByIdAndUpdate(recipientId, {
                    $pull: { mutedConversations: { conversationId: conversationId } }
                });
                console.log(`🔔 انتهت مدة كتم المحادثة ${conversationId} للمستخدم ${user.name}`);
            } else {
                // لا تزال مكتومة - لا ترسل إشعار
                console.log(`🔇 المحادثة ${conversationId} مكتومة للمستخدم ${user.name}`);
                return { success: true, skipped: true, reason: 'muted' };
            }
        }

        const notification = {
            title: senderName,
            body: messagePreview.length > 100 ? messagePreview.substring(0, 100) + '...' : messagePreview
        };

        // تحويل صورة المرسل لـ URL كامل
        let fullSenderImage = senderImage || '';
        if (fullSenderImage && !fullSenderImage.startsWith('http')) {
            const baseUrl = process.env.BASE_URL || 'https://matchhala.chathala.com';
            fullSenderImage = `${baseUrl}${fullSenderImage}`;
        }

        const data = {
            type: 'message',
            conversationId: conversationId.toString(),
            senderName,
            senderImage: fullSenderImage,
            senderId: senderId ? senderId.toString() : '',
            threadId: conversationId.toString()
        };

        return sendNotificationToUser(recipientId, notification, data, true);
    } catch (error) {
        console.error('❌ خطأ في إرسال إشعار الرسالة:', error.message);
        return { success: false, error: error.message };
    }
};

/**
 * إرسال إشعار متابعة جديدة
 * @param {string} userId - المستخدم الذي تمت متابعته
 * @param {string} followerName - اسم المتابع
 * @param {string} followerId - معرف المتابع
 */
const sendNewFollowerNotification = async (userId, followerName, followerId) => {
    const notification = {
        title: 'متابع جديد',
        body: `${followerName} بدأ بمتابعتك`
    };

    const data = {
        type: 'new_follower',
        followerId: followerId.toString(),
        followerName
    };

    return sendNotificationToUser(userId, notification, data, true);
};

/**
 * إرسال إشعار إعجاب
 * @param {string} userId - صاحب المنشور
 * @param {string} likerName - اسم المعجب
 * @param {string} postId - معرف المنشور
 */
const sendLikeNotification = async (userId, likerName, postId) => {
    const notification = {
        title: 'إعجاب جديد',
        body: `${likerName} أعجب بمنشورك`
    };

    const data = {
        type: 'like',
        postId: postId.toString(),
        likerName
    };

    return sendNotificationToUser(userId, notification, data, true);
};

/**
 * إرسال إشعار تعليق
 * @param {string} userId - صاحب المنشور
 * @param {string} commenterName - اسم المعلق
 * @param {string} postId - معرف المنشور
 * @param {string} commentPreview - معاينة التعليق
 */
const sendCommentNotification = async (userId, commenterName, postId, commentPreview) => {
    const notification = {
        title: `تعليق من ${commenterName}`,
        body: commentPreview.length > 100 ? commentPreview.substring(0, 100) + '...' : commentPreview
    };

    const data = {
        type: 'comment',
        postId: postId.toString(),
        commenterName
    };

    return sendNotificationToUser(userId, notification, data, true);
};

/**
 * إدارة اشتراكات المواضيع
 */
const manageTopicSubscription = async (userId, topic, subscribe = true) => {
    try {
        const user = await User.findById(userId);

        if (!user || !user.deviceToken) {
            return { success: false, error: 'المستخدم ليس لديه FCM Token' };
        }

        if (subscribe) {
            return await subscribeToTopic(user.deviceToken, topic);
        } else {
            return await unsubscribeFromTopic(user.deviceToken, topic);
        }
    } catch (error) {
        console.error('❌ خطأ في إدارة اشتراك الموضوع:', error.message);
        return { success: false, error: error.message };
    }
};

module.exports = {
    sendNotificationToUser,
    sendNotificationToUsers,
    broadcastNotification,
    sendNewMessageNotification,
    sendNewFollowerNotification,
    sendLikeNotification,
    sendCommentNotification,
    manageTopicSubscription,
    sendToTopic
};
