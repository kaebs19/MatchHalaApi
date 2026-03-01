// Browser Notifications Service
// خدمة إشعارات المتصفح

class NotificationService {
    constructor() {
        this.permission = Notification.permission;
    }

    // طلب إذن الإشعارات
    async requestPermission() {
        if (!('Notification' in window)) {
            console.warn('⚠️ المتصفح لا يدعم الإشعارات');
            return false;
        }

        if (this.permission === 'granted') {
            console.log('✅ الإشعارات مفعّلة بالفعل');
            return true;
        }

        if (this.permission !== 'denied') {
            const permission = await Notification.requestPermission();
            this.permission = permission;

            if (permission === 'granted') {
                console.log('✅ تم منح إذن الإشعارات');
                return true;
            }
        }

        console.warn('❌ تم رفض إذن الإشعارات');
        return false;
    }

    // إرسال إشعار
    showNotification(title, options = {}) {
        if (this.permission !== 'granted') {
            console.warn('⚠️ لا يوجد إذن للإشعارات');
            return null;
        }

        const defaultOptions = {
            icon: '/logo192.png',
            badge: '/logo192.png',
            vibrate: [200, 100, 200],
            tag: 'halachat-message',
            requireInteraction: false,
            ...options
        };

        try {
            const notification = new Notification(title, defaultOptions);

            // إغلاق الإشعار تلقائياً بعد 5 ثوانٍ
            setTimeout(() => {
                notification.close();
            }, 5000);

            return notification;
        } catch (error) {
            console.error('❌ خطأ في إنشاء الإشعار:', error);
            return null;
        }
    }

    // إشعار رسالة جديدة
    notifyNewMessage(senderName, messageContent, conversationTitle) {
        const title = `💬 ${senderName}`;
        const body = messageContent.length > 50
            ? messageContent.substring(0, 50) + '...'
            : messageContent;

        return this.showNotification(title, {
            body: body,
            tag: 'new-message',
            data: {
                type: 'message',
                conversationTitle
            }
        });
    }

    // إشعار مستخدم يكتب
    notifyTyping(senderName, conversationTitle) {
        const title = `⌨️ ${senderName}`;
        const body = 'يكتب الآن...';

        return this.showNotification(title, {
            body: body,
            tag: 'typing-notification',
            silent: true,
            data: {
                type: 'typing',
                conversationTitle
            }
        });
    }

    // التحقق من دعم الإشعارات
    isSupported() {
        return 'Notification' in window;
    }

    // التحقق من حالة الإذن
    hasPermission() {
        return this.permission === 'granted';
    }
}

// إنشاء instance واحد (Singleton)
const notificationService = new NotificationService();

export default notificationService;
