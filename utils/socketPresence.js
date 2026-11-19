// MatchHala — فحص حضور السوكِت عبر عمليات الـ cluster
//
// ⚠️ لماذا لا نكتفي بـ global.connectedUsers:
// إنها Map محلية داخل كل عملية PM2. مع 4 عمليات، الطلب قد يُعالَج على عملية
// بينما سوكِت المستلم على عملية أخرى → «يبدو offline» → يُرسل Push، وفي نفس
// الوقت يصله حدث السوكِت عبر Redis adapter → إشعار مكرّر.
//
// ⚠️ ولماذا نحدّ fetchSockets بمهلة:
// الفحص يُنادى داخل حلقة المستقبِلين **قبل** ردّ إرسال الرسالة. وadapter
// ينتظر ردّ كل العمليات بمهلة افتراضية 5 ثوانٍ — فعملية واحدة مشغولة كانت
// تضيف 5 ثوانٍ كاملة إلى زمن إرسال الرسالة أمام المستخدم.

const CROSS_NODE_TIMEOUT_MS = parseInt(process.env.SOCKET_PRESENCE_TIMEOUT_MS || '1200');

/**
 * فحص محلي فوري بلا شبكة.
 * الإيجاب قاطع (السوكِت على هذه العملية)، والسلب غير حاسم.
 */
function hasLocalSocket(id, prefix = 'fg') {
    try {
        const room = global.io?.of('/')?.adapter?.rooms?.get(`${prefix}:${id}`);
        return Boolean(room && room.size > 0);
    } catch (_) {
        return false;
    }
}

/**
 * هل التطبيق مفتوح أمام المستخدم الآن (سوكت في غرفة fg:<id>)؟ — يُستعمل لحجب الـ push عن المتصل.
 * ⚠️ لا user:<id>: سوكت التطبيق في الخلفية يبقى متصلاً حتى انقطاعه بالـ ping (~45ث)، والتطبيق مجمَّد —
 *    فكان يُحسب «متصلاً» ولا يصله إشعار ولا تنبيه. التطبيق يغادر fg عند الخلفية (server.js: app:state).
 * @param {string|object} userId
 * @returns {Promise<boolean>}
 */
async function isUserSocketConnected(userId, { anySocket = false } = {}) {
    const id = String(userId);
    // anySocket: أي سوكت ولو في الخلفية (حالة «متصل» للحضور) — الافتراضي: التطبيق في الواجهة (حجب الإشعارات)
    const prefix = anySocket ? 'user' : 'fg';

    if (!global.io) {
        return Boolean(global.connectedUsers && global.connectedUsers.has(id));
    }

    // ① محلي — صفر شبكة، ويختصر الفحص كلياً حين يكون السوكِت هنا
    if (hasLocalSocket(id, prefix)) return true;

    // ② عبر العمليات — محدود بمهلة
    try {
        const pending = global.io.in(`${prefix}:${id}`).fetchSockets();
        // امنع unhandled rejection إن رمى بعد انقضاء مهلتنا
        pending.catch(() => {});

        let timer;
        const sockets = await Promise.race([
            pending,
            new Promise((_, reject) => {
                timer = setTimeout(
                    () => reject(new Error(`تجاوز ${CROSS_NODE_TIMEOUT_MS}ms`)),
                    CROSS_NODE_TIMEOUT_MS
                );
            })
        ]).finally(() => clearTimeout(timer));

        return sockets.length > 0;
    } catch (e) {
        console.error('⚠️ فحص الحضور عبر العمليات تعذّر، الرجوع للخريطة المحلية:', e.message);
    }

    // ③ ارتداد: دقيق فقط في وضع العملية الواحدة
    return Boolean(global.connectedUsers && global.connectedUsers.has(id));
}

module.exports = { isUserSocketConnected, hasLocalSocket, CROSS_NODE_TIMEOUT_MS };
