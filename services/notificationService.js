// Notification Service - خدمة الإشعارات
// يدعم APNs (Apple Push Notifications) و Firebase Cloud Messaging

const fs = require('fs');
const path = require('path');
const apn = require('@parse/node-apn');
const apnsConfig = require('../config/apns-config');

// محاولة تحميل Firebase Admin (اختياري)
let firebaseAdmin = null;
try {
    firebaseAdmin = require('firebase-admin');
} catch (e) {
    console.log('⚠️ Firebase Admin غير مثبت - npm install firebase-admin');
}

class NotificationService {
    constructor() {
        this.apnsProvider = null;
        this.firebaseInitialized = false;
        this.initialized = false;
    }

    // تهيئة Firebase Admin
    async initializeFirebase() {
        if (!firebaseAdmin) {
            console.log('⚠️ Firebase Admin غير متوفر');
            return false;
        }

        try {
            const serviceAccountPath = path.join(__dirname, '../config/serviceAccount.json');

            if (!fs.existsSync(serviceAccountPath)) {
                console.warn('⚠️ ملف serviceAccount.json غير موجود');
                console.warn('   المسار المتوقع:', serviceAccountPath);
                return false;
            }

            // التحقق من عدم تهيئة Firebase مسبقاً
            if (!firebaseAdmin.apps.length) {
                firebaseAdmin.initializeApp({
                    credential: firebaseAdmin.credential.cert(require(serviceAccountPath))
                });
            }

            this.firebaseInitialized = true;
            console.log('✅ تم تهيئة Firebase Admin بنجاح');
            return true;
        } catch (error) {
            console.error('❌ خطأ في تهيئة Firebase:', error.message);
            return false;
        }
    }

    // إرسال Push عبر Firebase
    async sendFirebasePush(deviceToken, title, body, data = {}) {
        if (!this.firebaseInitialized || !firebaseAdmin) {
            return { success: false, error: 'Firebase غير مُهيأ' };
        }

        try {
            const message = {
                token: deviceToken,
                notification: { title, body },
                data: Object.fromEntries(
                    Object.entries(data).map(([k, v]) => [k, String(v)])
                ),
                apns: {
                    payload: {
                        aps: { sound: 'default', badge: 1 }
                    }
                },
                android: {
                    priority: 'high',
                    notification: {
                        sound: 'default'
                    }
                }
            };

            const response = await firebaseAdmin.messaging().send(message);
            console.log('📱 Firebase Push sent:', response);
            return { success: true, messageId: response };

        } catch (error) {
            console.error('❌ Firebase Push failed:', error.message);

            // لو التوكن منتهي، احذفه
            if (error.code === 'messaging/registration-token-not-registered' ||
                error.code === 'messaging/invalid-registration-token') {
                const User = require('../models/User');
                await User.findOneAndUpdate(
                    { deviceToken },
                    { deviceToken: null }
                );
                console.log('🗑️ تم حذف Device Token المنتهي');
            }

            return { success: false, error: error.message };
        }
    }

    // تهيئة APNs Provider
    async initializeAPNs() {
        try {
            // التحقق من وجود ملف المفتاح
            const keyPath = apnsConfig.apns.keyPath;

            if (!fs.existsSync(keyPath)) {
                console.warn('⚠️ ملف مفتاح APNs غير موجود:', keyPath);
                console.warn('⚠️ الإشعارات ستعمل في الوضع التجريبي');
                return false;
            }

            // إنشاء APNs Provider
            this.apnsProvider = new apn.Provider({
                token: {
                    key: keyPath,
                    keyId: apnsConfig.apns.keyId,
                    teamId: apnsConfig.apns.teamId
                },
                production: apnsConfig.apns.production
            });

            this.initialized = true;

            console.log('✅ تم تهيئة APNs بنجاح');
            console.log(`   Key ID: ${apnsConfig.apns.keyId}`);
            console.log(`   Team ID: ${apnsConfig.apns.teamId}`);
            console.log(`   Bundle ID: ${apnsConfig.apns.bundleId}`);
            console.log(`   البيئة: ${apnsConfig.apns.production ? 'Production' : 'Development'}`);

            return true;
        } catch (error) {
            console.error('❌ خطأ في تهيئة APNs:', error.message);
            return false;
        }
    }

    // إرسال إشعار عبر APNs
    async sendAPNsNotification(deviceToken, notification) {
        try {
            if (!this.initialized || !this.apnsProvider) {
                console.log('⚠️ APNs غير مُهيأ، استخدام وضع التجربة');
                return this.mockSendNotification(deviceToken, notification);
            }

            // إنشاء الإشعار
            const apnNotification = new apn.Notification();

            apnNotification.alert = {
                title: notification.title,
                body: notification.body
            };
            apnNotification.topic = apnsConfig.apns.bundleId;
            apnNotification.badge = notification.badge || 1;
            apnNotification.sound = notification.sound || 'default';
            apnNotification.payload = notification.data || {};
            apnNotification.priority = notification.priority === 'high' ? 10 : 5;
            apnNotification.pushType = 'alert';

            // إرسال الإشعار
            const result = await this.apnsProvider.send(apnNotification, deviceToken);

            if (result.failed.length > 0) {
                const failedDevice = result.failed[0];
                console.error('❌ فشل إرسال الإشعار:', failedDevice.response?.reason || 'Unknown error');

                // إذا كان الخطأ BadDeviceToken، يمكن حذف التوكن من قاعدة البيانات
                if (failedDevice.response?.reason === 'BadDeviceToken') {
                    console.log('⚠️ Device Token غير صالح، يجب حذفه');
                }

                return {
                    success: false,
                    error: failedDevice.response?.reason || 'Failed to send notification'
                };
            }

            console.log('✅ تم إرسال الإشعار بنجاح');
            return { success: true, sent: result.sent.length };

        } catch (error) {
            console.error('❌ خطأ في إرسال إشعار APNs:', error.message);
            return { success: false, error: error.message };
        }
    }

    // إرسال تجريبي (للاختبار)
    async mockSendNotification(deviceToken, notification) {
        console.log('📱 إرسال إشعار تجريبي...');
        console.log(`   العنوان: ${notification.title}`);
        console.log(`   المحتوى: ${notification.body}`);
        console.log(`   Device Token: ${deviceToken ? deviceToken.substring(0, 20) + '...' : 'N/A'}`);
        console.log(`   النوع: ${notification.type}`);

        // محاكاة تأخير الشبكة
        await new Promise(resolve => setTimeout(resolve, 100));

        return {
            success: true,
            sent: 1,
            mode: 'mock',
            message: 'تم إرسال الإشعار في الوضع التجريبي'
        };
    }

    // إرسال إشعار لمستخدم واحد
    async sendToUser(user, notification) {
        try {
            // التحقق من وجود device token للمستخدم
            const deviceToken = user.deviceToken || null;

            if (!deviceToken) {
                console.log(`⚠️ المستخدم ${user.name} ليس لديه device token`);
                return { success: false, reason: 'no_device_token' };
            }

            // إرسال عبر APNs
            const result = await this.sendAPNsNotification(deviceToken, notification);

            return result;
        } catch (error) {
            console.error(`❌ فشل إرسال إشعار للمستخدم ${user.name}:`, error.message);
            return { success: false, error: error.message };
        }
    }

    // إرسال إشعار لعدة مستخدمين
    async sendToMultipleUsers(users, notification) {
        const results = {
            total: users.length,
            sent: 0,
            failed: 0,
            details: []
        };

        for (const user of users) {
            const result = await this.sendToUser(user, notification);

            if (result.success) {
                results.sent++;
            } else {
                results.failed++;
            }

            results.details.push({
                userId: user._id,
                userName: user.name,
                success: result.success,
                reason: result.reason || result.error
            });
        }

        return results;
    }

    // إرسال إشعار لجميع المستخدمين
    async sendToAllUsers(notification) {
        try {
            const User = require('../models/User');

            // جلب جميع المستخدمين النشطين مع device token
            const users = await User.find({
                isActive: true,
                deviceToken: { $exists: true, $ne: null, $ne: '' }
            }).select('_id name email deviceToken');

            console.log(`📢 إرسال إشعار لـ ${users.length} مستخدم...`);

            const results = await this.sendToMultipleUsers(users, notification);

            console.log(`✅ تم إرسال ${results.sent} إشعار بنجاح`);
            console.log(`❌ فشل إرسال ${results.failed} إشعار`);

            return results;
        } catch (error) {
            console.error('❌ خطأ في إرسال الإشعارات:', error.message);
            throw error;
        }
    }

    // إنشاء إشعار من نموذج
    createNotificationPayload(data) {
        return {
            title: data.title || 'HalaChat',
            body: data.body || '',
            type: data.type || 'general',
            badge: data.badge || 1,
            sound: data.sound || 'default',
            priority: data.priority || 'normal',
            data: data.data || {}
        };
    }

    // إغلاق الاتصال (عند إيقاف السيرفر)
    shutdown() {
        if (this.apnsProvider) {
            this.apnsProvider.shutdown();
            console.log('🔌 تم إغلاق اتصال APNs');
        }
    }

    // إرسال Push (يختار تلقائياً بين Firebase و APNs)
    async sendPush(deviceToken, title, body, data = {}) {
        // محاولة Firebase أولاً
        if (this.firebaseInitialized) {
            return this.sendFirebasePush(deviceToken, title, body, data);
        }

        // ثم APNs
        if (this.initialized) {
            const notification = this.createNotificationPayload({
                title,
                body,
                data,
                type: data.type || 'general'
            });
            return this.sendAPNsNotification(deviceToken, notification);
        }

        // وضع تجريبي
        return this.mockSendNotification(deviceToken, { title, body, data });
    }
}

// Singleton instance
const notificationService = new NotificationService();

// تهيئة عند بدء التشغيل
(async () => {
    await notificationService.initializeFirebase();
    await notificationService.initializeAPNs();
})().catch(console.error);

module.exports = notificationService;
