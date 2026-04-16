const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccount.json');

let firebaseApp;

try {
    if (!admin.apps.length) {
        firebaseApp = admin.initializeApp({
            credential: admin.credential.cert(serviceAccount),
            projectId: serviceAccount.project_id
        });
        console.log('✅ Firebase Admin SDK تم تهيئته بنجاح');
    } else {
        firebaseApp = admin.app();
        console.log('✅ Firebase Admin SDK موجود مسبقاً');
    }
} catch (error) {
    console.error('❌ خطأ في تهيئة Firebase:', error.message);
}

const messaging = admin.messaging();

const sendToDevice = async (token, notification, data = {}) => {
    try {
        const collapseId = data.conversationId || data.type || 'general';
        // ⚠️ إزالة content-available:1 من regular notifications
        // لأنها تحوّلها إلى silent push ولا يظهر banner.
        // نبقي mutable-content:1 لتفعيل Notification Service Extension.
        const message = {
            token,
            notification: { title: notification.title, body: notification.body },
            data: { ...data, click_action: 'FLUTTER_NOTIFICATION_CLICK' },
            apns: {
                headers: {
                    'apns-priority': '10',
                    'apns-collapse-id': collapseId,
                    'apns-push-type': 'alert'
                },
                payload: {
                    aps: {
                        alert: { title: notification.title, body: notification.body },
                        badge: data.badge ? parseInt(data.badge) : 1,
                        sound: 'default',
                        'mutable-content': 1,
                        'thread-id': collapseId
                    },
                    // تمرير senderImage مباشرة في APNs payload للـ Notification Service Extension
                    senderImage: data.senderImage || ''
                },
                fcm_options: data.senderImage ? { image: data.senderImage } : undefined
            },
            android: { priority: 'high', notification: { sound: 'default', channelId: 'matchhala_channel' } }
        };
        const response = await messaging.send(message);
        return { success: true, messageId: response };
    } catch (error) {
        // تنظيف التوكن الفاسد
        if (error.code === 'messaging/registration-token-not-registered' ||
            error.code === 'messaging/invalid-registration-token') {
            try {
                const User = require('../models/User');
                await User.updateMany(
                    { $or: [{ deviceToken: token }, { fcmToken: token }] },
                    { $unset: { deviceToken: 1, fcmToken: 1 } }
                );
                console.log('🗑️ تم حذف توكن فاسد:', token.substring(0, 20) + '...');
            } catch (cleanupErr) {
                console.error('خطأ في تنظيف التوكن:', cleanupErr.message);
            }
        }
        return { success: false, error: error.message };
    }
};

const sendToMultipleDevices = async (tokens, notification, data = {}) => {
    if (!tokens || tokens.length === 0) return { success: false, error: 'لا توجد أجهزة' };
    try {
        const collapseId = data.conversationId || data.type || 'general';
        const message = {
            notification: { title: notification.title, body: notification.body },
            data: { ...data, click_action: 'FLUTTER_NOTIFICATION_CLICK' },
            apns: {
                headers: {
                    'apns-priority': '10',
                    'apns-collapse-id': collapseId,
                    'apns-push-type': 'alert'
                },
                payload: {
                    aps: {
                        alert: { title: notification.title, body: notification.body },
                        badge: 1,
                        sound: 'default',
                        'mutable-content': 1,
                        'thread-id': collapseId
                    }
                }
            },
            android: { priority: 'high', notification: { sound: 'default', channelId: 'matchhala_channel' } },
            tokens
        };
        const response = await messaging.sendEachForMulticast(message);

        // جمع التوكنات الفاشلة لحذفها
        const failedTokens = [];
        if (response.responses) {
            response.responses.forEach((resp, idx) => {
                if (!resp.success && resp.error &&
                    (resp.error.code === 'messaging/registration-token-not-registered' ||
                     resp.error.code === 'messaging/invalid-registration-token')) {
                    failedTokens.push(tokens[idx]);
                }
            });
        }

        // تنظيف التوكنات الفاسدة من الداتابيس
        if (failedTokens.length > 0) {
            try {
                const User = require('../models/User');
                await User.updateMany(
                    { $or: [{ deviceToken: { $in: failedTokens } }, { fcmToken: { $in: failedTokens } }] },
                    { $unset: { deviceToken: 1, fcmToken: 1 } }
                );
                console.log(`🗑️ تم حذف ${failedTokens.length} توكن فاسد من batch`);
            } catch (cleanupErr) {
                console.error('خطأ في تنظيف التوكنات:', cleanupErr.message);
            }
        }

        return { success: true, successCount: response.successCount, failureCount: response.failureCount, failedTokens };
    } catch (error) {
        return { success: false, error: error.message };
    }
};

module.exports = { admin, messaging, sendToDevice, sendToMultipleDevices };
