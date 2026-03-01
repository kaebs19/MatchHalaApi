// Firebase Admin SDK Configuration
// تكوين Firebase للإشعارات الفورية (Push Notifications)

const admin = require('firebase-admin');
const path = require('path');

// تحميل ملف بيانات الاعتماد
const serviceAccount = require('./serviceAccount.json');

// تهيئة Firebase Admin
let firebaseApp;

try {
    firebaseApp = admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId: serviceAccount.project_id
    });
    console.log('✅ Firebase Admin SDK تم تهيئته بنجاح');
} catch (error) {
    console.error('❌ خطأ في تهيئة Firebase:', error.message);
}

// الحصول على خدمة المراسلة
const messaging = admin.messaging();

/**
 * إرسال إشعار لجهاز واحد
 * @param {string} token - FCM Token للجهاز
 * @param {object} notification - عنوان ونص الإشعار
 * @param {object} data - بيانات إضافية
 */
const sendToDevice = async (token, notification, data = {}) => {
    try {
        const message = {
            token,
            notification: {
                title: notification.title,
                body: notification.body
            },
            data: {
                ...data,
                click_action: 'FLUTTER_NOTIFICATION_CLICK'
            },
            apns: {
                headers: {
                    'apns-priority': '10'
                },
                payload: {
                    aps: {
                        badge: data.badge ? parseInt(data.badge) : 1,
                        sound: 'default',
                        'content-available': 1
                    }
                }
            },
            android: {
                priority: 'high',
                notification: {
                    sound: 'default',
                    channelId: 'halachat_channel'
                }
            }
        };

        const response = await messaging.send(message);
        console.log('✅ تم إرسال الإشعار بنجاح:', response);
        return { success: true, messageId: response };
    } catch (error) {
        console.error('❌ خطأ في إرسال الإشعار:', error.message);
        return { success: false, error: error.message };
    }
};

/**
 * إرسال إشعار لعدة أجهزة
 * @param {string[]} tokens - قائمة FCM Tokens
 * @param {object} notification - عنوان ونص الإشعار
 * @param {object} data - بيانات إضافية
 */
const sendToMultipleDevices = async (tokens, notification, data = {}) => {
    if (!tokens || tokens.length === 0) {
        return { success: false, error: 'لا توجد أجهزة للإرسال' };
    }

    try {
        const message = {
            notification: {
                title: notification.title,
                body: notification.body
            },
            data: {
                ...data,
                click_action: 'FLUTTER_NOTIFICATION_CLICK'
            },
            apns: {
                headers: {
                    'apns-priority': '10'
                },
                payload: {
                    aps: {
                        badge: data.badge ? parseInt(data.badge) : 1,
                        sound: 'default',
                        'content-available': 1
                    }
                }
            },
            android: {
                priority: 'high',
                notification: {
                    sound: 'default',
                    channelId: 'halachat_channel'
                }
            },
            tokens
        };

        const response = await messaging.sendEachForMulticast(message);

        console.log(`✅ تم إرسال ${response.successCount} إشعار من أصل ${tokens.length}`);

        // تتبع التوكنات الفاشلة لحذفها لاحقاً
        const failedTokens = [];
        response.responses.forEach((resp, idx) => {
            if (!resp.success) {
                failedTokens.push(tokens[idx]);
                console.error(`❌ فشل إرسال للتوكن ${idx}:`, resp.error?.message);
            }
        });

        return {
            success: true,
            successCount: response.successCount,
            failureCount: response.failureCount,
            failedTokens
        };
    } catch (error) {
        console.error('❌ خطأ في إرسال الإشعارات المتعددة:', error.message);
        return { success: false, error: error.message };
    }
};

/**
 * إرسال إشعار لموضوع (Topic)
 * @param {string} topic - اسم الموضوع
 * @param {object} notification - عنوان ونص الإشعار
 * @param {object} data - بيانات إضافية
 */
const sendToTopic = async (topic, notification, data = {}) => {
    try {
        const message = {
            topic,
            notification: {
                title: notification.title,
                body: notification.body
            },
            data: {
                ...data,
                click_action: 'FLUTTER_NOTIFICATION_CLICK'
            },
            apns: {
                payload: {
                    aps: {
                        sound: 'default'
                    }
                }
            },
            android: {
                priority: 'high',
                notification: {
                    sound: 'default',
                    channelId: 'halachat_channel'
                }
            }
        };

        const response = await messaging.send(message);
        console.log(`✅ تم إرسال الإشعار للموضوع ${topic}:`, response);
        return { success: true, messageId: response };
    } catch (error) {
        console.error('❌ خطأ في إرسال الإشعار للموضوع:', error.message);
        return { success: false, error: error.message };
    }
};

/**
 * اشتراك مستخدم في موضوع
 * @param {string} token - FCM Token
 * @param {string} topic - اسم الموضوع
 */
const subscribeToTopic = async (token, topic) => {
    try {
        const response = await messaging.subscribeToTopic(token, topic);
        console.log(`✅ تم الاشتراك في الموضوع ${topic}`);
        return { success: true, response };
    } catch (error) {
        console.error('❌ خطأ في الاشتراك بالموضوع:', error.message);
        return { success: false, error: error.message };
    }
};

/**
 * إلغاء اشتراك مستخدم من موضوع
 * @param {string} token - FCM Token
 * @param {string} topic - اسم الموضوع
 */
const unsubscribeFromTopic = async (token, topic) => {
    try {
        const response = await messaging.unsubscribeFromTopic(token, topic);
        console.log(`✅ تم إلغاء الاشتراك من الموضوع ${topic}`);
        return { success: true, response };
    } catch (error) {
        console.error('❌ خطأ في إلغاء الاشتراك من الموضوع:', error.message);
        return { success: false, error: error.message };
    }
};

module.exports = {
    admin,
    messaging,
    sendToDevice,
    sendToMultipleDevices,
    sendToTopic,
    subscribeToTopic,
    unsubscribeFromTopic
};
