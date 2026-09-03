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
function hasLocalSocket(id) {
    try {
        const room = global.io?.of('/')?.adapter?.rooms?.get(`user:${id}`);
        return Boolean(room && room.size > 0);
    } catch (_) {
        return false;
    }
}

/**
 * هل للمستخدم سوكِت متصل على أي عملية؟
 * @param {string|object} userId
 * @returns {Promise<boolean>}
 */
async function isUserSocketConnected(userId) {
    const id = String(userId);

    if (!global.io) {
        return Boolean(global.connectedUsers && global.connectedUsers.has(id));
    }

    // ① محلي — صفر شبكة، ويختصر الفحص كلياً حين يكون السوكِت هنا
    if (hasLocalSocket(id)) return true;

    // ② عبر العمليات — محدود بمهلة
    try {
        const pending = global.io.in(`user:${id}`).fetchSockets();
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
