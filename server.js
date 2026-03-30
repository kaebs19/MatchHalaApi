// HalaChat Dashboard - Backend Server
// ملف السيرفر الرئيسي

const express = require('express');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression'); // gzip compression
const rateLimit = require('express-rate-limit');
const mongoSanitize = require('express-mongo-sanitize');
const hpp = require('hpp');
const jwt = require('jsonwebtoken');
require('dotenv').config();
const connectDB = require('./config/database');
const { errorHandler, notFound } = require('./middleware/errorHandler');
const User = require('./models/User');
const Conversation = require('./models/Conversation');
const Message = require('./models/Message');

// الاتصال بقاعدة البيانات
connectDB();

// Helper: تحويل المسار النسبي إلى URL كامل
const getFullUrl = (imgPath) => {
    if (!imgPath) return null;
    if (imgPath.startsWith('http')) return imgPath;
    const baseUrl = process.env.BASE_URL || 'https://matchhala.chathala.com';
    return `${baseUrl}${imgPath}`;
};

// إنشاء التطبيق
const app = express();

// Trust proxy for Nginx reverse proxy (fixes rate-limiter X-Forwarded-For issue)
app.set('trust proxy', 1);

const server = http.createServer(app);

// إعداد Socket.IO
const io = new Server(server, {
    pingInterval: 25000,
    pingTimeout: 20000,
    cors: {
        origin: process.env.FRONTEND_URL || 'http://localhost:3000',
        credentials: true
    }
});

// Socket.IO Authentication Middleware
io.use(async (socket, next) => {
    try {
        const token = socket.handshake.auth.token;

        if (!token) {
            return next(new Error('Authentication error: No token provided'));
        }

        // التحقق من Token
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        // جلب بيانات المستخدم
        const user = await User.findById(decoded.id).select('-password');

        if (!user) {
            return next(new Error('Authentication error: User not found'));
        }

        if (!user.isActive) {
            return next(new Error('Authentication error: User is not active'));
        }

        // إضافة بيانات المستخدم إلى socket
        socket.userId = user._id.toString();
        socket.user = user;

        console.log(`✅ مستخدم معتمد: ${user.name} (${user.email})`);
        next();
    } catch (error) {
        console.error('❌ خطأ في التحقق من Socket.IO:', error.message);
        next(new Error('Authentication error: Invalid token'));
    }
});

// تخزين اتصالات Socket.IO
global.io = io;
global.connectedUsers = new Map();

// الإعدادات الأساسية
const PORT = process.env.PORT || 5000;

// ✅ Request Timeout — حماية من الطلبات المعلقة (30 ثانية)
app.use((req, res, next) => {
    req.setTimeout(30000, () => {
        if (!res.headersSent) {
            res.status(408).json({
                success: false,
                message: 'انتهت مهلة الطلب — حاول مرة أخرى'
            });
        }
    });
    next();
});

// Security Middlewares
// 1. Helmet - حماية HTTP headers
app.use(helmet());

// 2. Compression - ضغط gzip للردود
app.use(compression({
    level: 6, // مستوى الضغط (1-9)
    threshold: 1024, // ضغط الردود أكبر من 1KB فقط
    filter: (req, res) => {
        // لا تضغط إذا كان الطلب يحتوي على no-compression header
        if (req.headers['x-no-compression']) {
            return false;
        }
        return compression.filter(req, res);
    }
}));

// 3. CORS - السماح بالطلبات من Frontend فقط
app.use(cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true
}));

// 4. Rate Limiting - منع الهجمات بالطلبات المتكررة
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 دقيقة
    max: parseInt(process.env.RATE_LIMIT_MAX) || 2000,
    message: {
        success: false,
        message: 'عدد كبير من المحاولات. يرجى المحاولة بعد 15 دقيقة'
    },
    standardHeaders: true,
    legacyHeaders: false,
});
app.use('/api/', limiter);

// Rate limit أكثر صرامة لتسجيل الدخول
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 دقيقة
    max: 20, // 20 محاولة (للتطوير - قلّلها في الإنتاج)
    message: {
        success: false,
        message: 'عدد كبير من محاولات تسجيل الدخول. حاول بعد 15 دقيقة'
    },
    skipSuccessfulRequests: true, // لا تحسب المحاولات الناجحة
    standardHeaders: true,
    legacyHeaders: false,
});
app.use('/api/auth/login', authLimiter);

// 4.1 ✅ Rate Limit لكل مستخدم (بالتوكن) — حماية من الاستخدام المفرط
const userLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // دقيقة واحدة
    max: 60,                  // 60 طلب / دقيقة لكل مستخدم (طلب كل ثانية)
    keyGenerator: (req) => {
        // استخدام التوكن كمفتاح بدل IP
        if (req.headers.authorization) {
            return req.headers.authorization;
        }
        return req.ip; // fallback للـ IP إذا بدون توكن
    },
    message: {
        success: false,
        message: 'طلبات كثيرة. حاول بعد دقيقة',
        code: 'USER_RATE_LIMITED'
    },
    standardHeaders: true,
    legacyHeaders: false,
    validate: { ipAddress: false },
});
app.use('/api/mobile', userLimiter);

// 4.2 ✅ حد إرسال الرسائل (أكثر صرامة)
const messageLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // دقيقة واحدة
    max: 30,                  // 30 رسالة / دقيقة (رسالة كل ثانيتين)
    keyGenerator: (req) => {
        if (req.headers.authorization) {
            return 'msg_' + req.headers.authorization;
        }
        return 'msg_' + req.ip;
    },
    message: {
        success: false,
        message: 'إرسال رسائل كثيرة. انتظر دقيقة',
        code: 'MESSAGE_RATE_LIMITED'
    },
    standardHeaders: true,
    legacyHeaders: false,
    validate: { ipAddress: false },
});
app.use('/api/mobile/messages/send', messageLimiter);
app.use('/api/v1/mobile/messages/send', messageLimiter);
app.use('/api/v2/mobile/messages/send', messageLimiter);
app.use('/api/v3/mobile/messages/send', messageLimiter);

// 4.3 ✅ حد Swipes (5 في الدقيقة للعادي)
const swipeLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // دقيقة
    max: 30,                  // 30 swipe / دقيقة
    keyGenerator: (req) => {
        if (req.headers.authorization) {
            return 'swipe_' + req.headers.authorization;
        }
        return 'swipe_' + req.ip;
    },
    message: {
        success: false,
        message: 'سوايبات كثيرة. انتظر دقيقة',
        code: 'SWIPE_RATE_LIMITED'
    },
    standardHeaders: true,
    legacyHeaders: false,
    validate: { ipAddress: false },
});
app.use('/api/swipes', swipeLimiter);

// 5. Body parser
app.use(express.json({ limit: '10mb' })); // تحديد حجم الطلبات
app.use(express.urlencoded({ extended: true }));

// 6. Data Sanitization - حماية من NoSQL Injection
app.use(mongoSanitize());

// 7. Prevent Parameter Pollution
app.use(hpp());

// 8. Static Files - تقديم الملفات المرفوعة
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Route تجريبي للتأكد من عمل السيرفر
app.get('/', (req, res) => {
    res.json({
        message: 'مرحباً بك في HalaChat Dashboard API',
        status: 'working',
        version: '2.0'
    });
});

// Route للتحقق من حالة API
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'success',
        message: 'السيرفر يعمل بنجاح ✅',
        database: 'connected'
    });
});

// ✅ Version Check Middleware — فحص إصدار التطبيق قبل كل الـ routes
const { versionCheck } = require('./middleware/versionCheck');
const { apiVersion } = require('./middleware/apiVersion');

// فحص الإصدار على كل طلبات التطبيق (مع وبدون version prefix)
app.use('/api/mobile', versionCheck);
app.use('/api/v1/mobile', versionCheck);
app.use('/api/v2/mobile', versionCheck);
app.use('/api/v3/mobile', versionCheck);

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/stats', require('./routes/stats'));
app.use('/api/conversations', require('./routes/conversations'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/messages', require('./routes/messages'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/notifications', require('./routes/notifications'));

// ✅ Versioned Mobile API
// /api/mobile     → v1 (backward compatible — النسخ القديمة)
// /api/v1/mobile  → v1
// /api/v2/mobile  → v2 (يرث v1 + تعديلات)
// /api/v3/mobile  → v3 (يرث v2 + تعديلات)
const mobileVersions = require('./routes/mobile/index');
app.use('/api/mobile', apiVersion, mobileVersions.v1);
app.use('/api/v1/mobile', apiVersion, mobileVersions.v1);
app.use('/api/v2/mobile', apiVersion, mobileVersions.v2);
app.use('/api/v3/mobile', apiVersion, mobileVersions.v3);

app.use('/api/privacy', require('./routes/privacy'));
app.use('/api/verifications', require('./routes/verifications'));
app.use('/api/swipes', require('./routes/swipes'));
app.use('/api/matches', require('./routes/matches'));
app.use('/api/banned-words', require('./routes/bannedWords'));

// 9. React Admin Panel - لوحة التحكم
app.use('/admin', express.static(path.join(__dirname, 'react-admin/build')));
app.get('/admin/*', (req, res) => {
    res.sendFile(path.join(__dirname, 'react-admin/build', 'index.html'));
});

// Error Handlers - يجب أن تكون في النهاية
app.use(notFound); // 404 Handler
app.use(errorHandler); // Error Handler

// ═══════════════════════════════════════════════════════════════
// Helper: إبلاغ شركاء المحادثات فقط (بدل broadcast للجميع)
// ═══════════════════════════════════════════════════════════════
async function notifyConversationPartners(userId, event, data) {
    try {
        // جلب محادثات المستخدم النشطة فقط
        const conversations = await Conversation.find(
            { participants: userId, isActive: true },
            'participants'
        ).lean();

        // جمع الشركاء بدون تكرار
        const partnerIds = new Set();
        for (const conv of conversations) {
            for (const p of conv.participants) {
                const pid = p.toString();
                if (pid !== userId) partnerIds.add(pid);
            }
        }

        // إرسال فقط للشركاء المتصلين
        for (const partnerId of partnerIds) {
            io.to(`user:${partnerId}`).emit(event, data);
        }
    } catch (error) {
        console.error('خطأ في notifyConversationPartners:', error.message);
    }
}

// Socket.IO Connection Handler
io.on('connection', async (socket) => {
    console.log(`👤 متصل: ${socket.user.name} (${socket.id})`);

    // إضافة المستخدم إلى قائمة المتصلين
    connectedUsers.set(socket.userId, {
        socketId: socket.id,
        user: socket.user,
        connectedAt: new Date()
    });

    // تحديث حالة المستخدم: متصل
    await User.findByIdAndUpdate(socket.userId, {
        isOnline: true,
        lastLogin: new Date()
    });

    // ✅ إبلاغ شركاء المحادثات فقط (بدل broadcast للجميع)
    notifyConversationPartners(socket.userId, 'user:online', { userId: socket.userId });

    // انضم لغرفته الخاصة (للرسائل الخاصة)
    socket.join(`user:${socket.userId}`);

    // إرسال حالة الاتصال للمستخدم
    socket.emit('authenticated', {
        userId: socket.userId,
        userName: socket.user.name,
        email: socket.user.email,
        role: socket.user.role
    });

    // عند الانضمام لمحادثة معينة
    socket.on('join-conversation', async (conversationId) => {
        try {
            const conversation = await Conversation.findById(conversationId);
            if (!conversation) {
                return socket.emit('error', { message: 'المحادثة غير موجودة' });
            }

            const isMember = conversation.participants.some(
                p => p.toString() === socket.userId
            );
            const isAdmin = socket.user.role === 'admin';

            if (!isMember && !isAdmin) {
                return socket.emit('error', { message: 'ليس لديك صلاحية للدخول لهذه المحادثة' });
            }

            socket.join(`conversation-${conversationId}`);

            // إرسال عدد المتصلين
            const room = io.sockets.adapter.rooms.get(`conversation-${conversationId}`);
            const onlineCount = room ? room.size : 0;
            io.to(`conversation-${conversationId}`).emit('users-online', { count: onlineCount });
        } catch (error) {
            console.error('خطأ في join-conversation:', error.message);
            socket.emit('error', { message: 'حدث خطأ أثناء الانضمام للمحادثة' });
        }
    });

    // عند مغادرة محادثة
    socket.on('leave-conversation', (conversationId) => {
        socket.leave(`conversation-${conversationId}`);

        setTimeout(() => {
            const room = io.sockets.adapter.rooms.get(`conversation-${conversationId}`);
            const onlineCount = room ? room.size : 0;
            io.to(`conversation-${conversationId}`).emit('users-online', { count: onlineCount });
        }, 100);
    });

    // عند الكتابة
    socket.on('typing', ({ conversationId, userName }) => {
        socket.to(`conversation-${conversationId}`).emit('user-typing', {
            conversationId,
            userName,
            isTyping: true
        });
    });

    // عند التوقف عن الكتابة
    socket.on('stop-typing', ({ conversationId }) => {
        socket.to(`conversation-${conversationId}`).emit('user-typing', {
            conversationId,
            userName: null,
            isTyping: false
        });
    });

    // عند استلام الرسالة من الطرف الآخر (message-delivered)
    socket.on('message-delivered', async ({ messageId, conversationId }) => {
        try {
            if (!messageId) return;

            const result = await Message.updateOne(
                { _id: messageId, status: 'sent' },
                { $set: { status: 'delivered' } }
            );

            if (result.modifiedCount > 0) {
                socket.to(`conversation-${conversationId}`).emit('message-delivered', {
                    messageId,
                    conversationId
                });
            }
        } catch (error) {
            console.error('خطأ في message-delivered:', error.message);
        }
    });

    // عند قراءة الرسائل (mark-read)
    socket.on('mark-read', async ({ conversationId }) => {
        try {
            if (!conversationId) return;

            const result = await Message.updateMany(
                {
                    conversation: conversationId,
                    sender: { $ne: socket.userId },
                    'readBy.user': { $ne: socket.userId }
                },
                {
                    $addToSet: { readBy: { user: socket.userId, readAt: new Date() } },
                    $set: { status: 'read' }
                }
            );

            if (result.modifiedCount > 0) {
                socket.to(`conversation-${conversationId}`).emit('messages-read', {
                    conversationId,
                    readBy: socket.userId
                });
            }
        } catch (error) {
            console.error('خطأ في mark-read:', error.message);
        }
    });

    // عند قطع الاتصال
    socket.on('disconnect', async () => {
        console.log(`👋 غادر: ${socket.user.name}`);
        connectedUsers.delete(socket.userId);

        // تحديث حالة المستخدم: غير متصل
        await User.findByIdAndUpdate(socket.userId, {
            isOnline: false,
            lastLogin: new Date()
        });

        // ✅ إبلاغ شركاء المحادثات فقط (بدل broadcast للجميع)
        // ✅ حدث واحد فقط بدل حدثين (أزلنا user-disconnected المكرر)
        notifyConversationPartners(socket.userId, 'user:offline', { userId: socket.userId });
    });
});

// تشغيل السيرفر
server.listen(PORT, () => {
    console.log(`✅ السيرفر يعمل على المنفذ ${PORT}`);
    console.log(`🔗 http://localhost:${PORT}`);
    console.log(`📝 البيئة: ${process.env.NODE_ENV || 'development'}`);
    console.log(`🔌 Socket.IO جاهز للاتصال`);
});
