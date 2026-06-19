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

/**
 * Mapping من notification type → APNs category identifier
 * هذه الـ categories معرّفة في PushNotificationManager.swift وتُفعّل
 * Action Buttons (Rich Notifications) من شاشة القفل
 *
 * يجب أن تطابق identifiers في iOS exactly.
 */
const APNS_CATEGORY_MAP = {
    // 💬 رسالة → Quick Reply + Mark as Read
    'message': 'MESSAGE_CATEGORY',
    'new_message': 'MESSAGE_CATEGORY',

    // 📩 طلب محادثة → Accept / Reject
    'conversation_request': 'REQUEST_CATEGORY',

    // 💖 مطابقة جديدة → Say Hi
    'new_match': 'MATCH_CATEGORY',
    'match': 'MATCH_CATEGORY',

    // 🛡️ تنبيه رسمي → I Understand (acknowledge من شاشة القفل)
    'official_warning': 'WARNING_CATEGORY'
};

/**
 * تنقية بيانات الـ data payload لـ FCM
 * FCM يتطلب أن **كل القيم strings** — Boolean/Number/Array/Object/null/undefined ترفض الرسالة بـ:
 * "data must only contain string values"
 *
 * @param {object} data - البيانات الخام
 * @returns {object} - بيانات نقية بـ string values فقط
 */
function sanitizeFCMData(data) {
    if (!data || typeof data !== 'object') return {};
    const out = {};
    for (const [key, value] of Object.entries(data)) {
        // تخطي null/undefined/empty
        if (value === null || value === undefined) continue;
        // تخطي function/symbol
        const t = typeof value;
        if (t === 'function' || t === 'symbol') continue;
        // كائنات/مصفوفات → JSON.stringify
        if (t === 'object') {
            try {
                out[key] = JSON.stringify(value);
            } catch (e) { /* skip */ }
            continue;
        }
        // string/number/boolean → toString
        out[key] = String(value);
    }
    return out;
}

const sendToDevice = async (token, notification, data = {}) => {
    try {
        const collapseId = data.conversationId || data.type || 'general';
        const hasImage = Boolean(data.senderImage && String(data.senderImage).trim());

        // ✅ تنقية data — كل القيم تُحوَّل لـ strings (متطلب FCM)
        const sanitizedData = sanitizeFCMData({
            ...data,
            click_action: 'FLUTTER_NOTIFICATION_CLICK'
        });

        // ⚠️ إزالة content-available:1 من regular notifications (تحوّلها silent)
        // mutable-content:1 يُفعَّل فقط لو فيه صورة (تجنّب timeout في Notification Service Extension)
        const apsPayload = {
            alert: { title: notification.title, body: notification.body },
            badge: data.badge ? parseInt(data.badge) : 1,
            sound: 'default',
            'thread-id': collapseId
        };
        if (hasImage) {
            apsPayload['mutable-content'] = 1;
        }

        // ✅ Rich Notifications — تفعيل Action Buttons حسب نوع الإشعار
        const apnsCategory = APNS_CATEGORY_MAP[data.type];
        if (apnsCategory) {
            apsPayload.category = apnsCategory;
        }

        const apnsPayload = { aps: apsPayload };
        if (hasImage) {
            apnsPayload.senderImage = data.senderImage;
        }

        const message = {
            token,
            notification: { title: notification.title, body: notification.body },
            data: sanitizedData,
            apns: {
                headers: {
                    'apns-priority': '10',
                    'apns-collapse-id': collapseId,
                    'apns-push-type': 'alert'
                },
                payload: apnsPayload,
                ...(hasImage ? { fcm_options: { image: data.senderImage } } : {})
            },
            android: { priority: 'high', notification: { sound: 'default', channelId: 'matchhala_channel' } },
            // ✅ رابط اختياري — يُفتح عند الضغط على الإشعار (Web). التطبيق الأصلي يقرأ data.link
            ...(data.link ? { webpush: { fcm_options: { link: String(data.link) } } } : {})
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
        const sanitizedData = sanitizeFCMData({
            ...data,
            click_action: 'FLUTTER_NOTIFICATION_CLICK'
        });

        // ✅ Rich Notifications — Action Buttons حسب type
        const apnsCategory = APNS_CATEGORY_MAP[data.type];
        const apsPayload = {
            alert: { title: notification.title, body: notification.body },
            badge: 1,
            sound: 'default',
            'thread-id': collapseId
        };
        if (apnsCategory) apsPayload.category = apnsCategory;

        const message = {
            notification: { title: notification.title, body: notification.body },
            data: sanitizedData,
            apns: {
                headers: {
                    'apns-priority': '10',
                    'apns-collapse-id': collapseId,
                    'apns-push-type': 'alert'
                },
                payload: { aps: apsPayload }
            },
            android: { priority: 'high', notification: { sound: 'default', channelId: 'matchhala_channel' } },
            // ✅ رابط اختياري — يُفتح عند الضغط على الإشعار (Web). التطبيق الأصلي يقرأ data.link
            ...(data.link ? { webpush: { fcm_options: { link: String(data.link) } } } : {}),
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

module.exports = { admin, messaging, sendToDevice, sendToMultipleDevices, sanitizeFCMData };
