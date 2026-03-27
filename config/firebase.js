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
        const message = {
            token,
            notification: { title: notification.title, body: notification.body },
            data: { ...data, click_action: 'FLUTTER_NOTIFICATION_CLICK' },
            apns: {
                headers: {
                    'apns-priority': '10',
                    'apns-collapse-id': collapseId
                },
                payload: {
                    aps: {
                        badge: data.badge ? parseInt(data.badge) : 1,
                        sound: 'default',
                        'content-available': 1,
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
                    'apns-collapse-id': collapseId
                },
                payload: {
                    aps: {
                        badge: 1,
                        sound: 'default',
                        'content-available': 1,
                        'mutable-content': 1,
                        'thread-id': collapseId
                    }
                }
            },
            android: { priority: 'high', notification: { sound: 'default', channelId: 'matchhala_channel' } },
            tokens
        };
        const response = await messaging.sendEachForMulticast(message);
        return { success: true, successCount: response.successCount, failureCount: response.failureCount };
    } catch (error) {
        return { success: false, error: error.message };
    }
};

module.exports = { admin, messaging, sendToDevice, sendToMultipleDevices };
