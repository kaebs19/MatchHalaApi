// Socket.IO Service - Real-time Communication
import { io } from 'socket.io-client';
import config from '../config';

const SOCKET_URL = config.SOCKET_URL;

class SocketService {
    constructor() {
        this.socket = null;
        this.connected = false;
    }

    // الاتصال بالسيرفر
    connect(token) {
        if (this.socket && this.connected) {
            console.log('✅ Socket.IO متصل بالفعل');
            return;
        }

        this.socket = io(SOCKET_URL, {
            auth: {
                token: token || localStorage.getItem('token')
            },
            transports: ['websocket', 'polling']
        });

        this.socket.on('connect', () => {
            this.connected = true;
            console.log('✅ Socket.IO متصل بنجاح');
        });

        this.socket.on('disconnect', () => {
            this.connected = false;
            console.log('❌ Socket.IO انقطع الاتصال');
        });

        this.socket.on('connect_error', (error) => {
            console.error('❌ خطأ في اتصال Socket.IO:', error);
        });
    }

    // قطع الاتصال
    disconnect() {
        if (this.socket) {
            this.socket.disconnect();
            this.socket = null;
            this.connected = false;
            console.log('👋 تم قطع اتصال Socket.IO');
        }
    }

    // الانضمام لمحادثة
    joinConversation(conversationId) {
        if (this.socket && this.connected) {
            this.socket.emit('join-conversation', conversationId);
            console.log(`📥 انضممت للمحادثة: ${conversationId}`);
        }
    }

    // مغادرة محادثة
    leaveConversation(conversationId) {
        if (this.socket && this.connected) {
            this.socket.emit('leave-conversation', conversationId);
            console.log(`📤 غادرت المحادثة: ${conversationId}`);
        }
    }

    // الاستماع لرسالة جديدة
    onNewMessage(callback) {
        if (this.socket) {
            this.socket.on('new-message', callback);
        }
    }

    // إزالة الاستماع لرسالة جديدة
    offNewMessage() {
        if (this.socket) {
            this.socket.off('new-message');
        }
    }

    // إرسال حدث "يكتب الآن"
    emitTyping(conversationId, userName) {
        if (this.socket && this.connected) {
            this.socket.emit('typing', { conversationId, userName });
        }
    }

    // إرسال حدث "توقف عن الكتابة"
    emitStopTyping(conversationId) {
        if (this.socket && this.connected) {
            this.socket.emit('stop-typing', { conversationId });
        }
    }

    // الاستماع لحدث "يكتب الآن"
    onTyping(callback) {
        if (this.socket) {
            this.socket.on('user-typing', callback);
        }
    }

    // إزالة الاستماع لحدث "يكتب الآن"
    offTyping() {
        if (this.socket) {
            this.socket.off('user-typing');
        }
    }

    // الاستماع لعدد المستخدمين المتصلين
    onUsersOnline(callback) {
        if (this.socket) {
            this.socket.on('users-online', callback);
        }
    }

    // إزالة الاستماع لعدد المستخدمين
    offUsersOnline() {
        if (this.socket) {
            this.socket.off('users-online');
        }
    }

    // الاستماع لتنبيهات الكلمات المحظورة
    onBannedWordAlert(callback) {
        if (this.socket) {
            this.socket.on('banned-word-alert', callback);
        }
    }

    // إزالة الاستماع لتنبيهات الكلمات المحظورة
    offBannedWordAlert() {
        if (this.socket) {
            this.socket.off('banned-word-alert');
        }
    }

    // التحقق من حالة الاتصال
    isConnected() {
        return this.connected;
    }

    // الحصول على Socket instance
    getSocket() {
        return this.socket;
    }
}

// إنشاء instance واحد فقط (Singleton)
const socketService = new SocketService();

export default socketService;
