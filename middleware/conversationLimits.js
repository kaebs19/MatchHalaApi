const Conversation = require('../models/Conversation');

/**
 * Middleware: حد المحادثات اليومية
 * - مستخدم جديد (أول 24 ساعة): 50 محادثة
 * - مستخدم عادي: 100 محادثة
 * - Premium: بدون حد
 */
async function conversationLimitMiddleware(req, res, next) {
    try {
        const user = req.user;

        // تجاوز الحد بعد مشاهدة إعلان
        if (req.body?.adRewarded === true) {
            return next();
        }

        // Premium بدون حد
        if (user.isPremium && user.premiumExpiresAt > new Date()) {
            return next();
        }

        // حساب بداية اليوم
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);

        // عدد المحادثات اللي بدأها اليوم (هو المرسل الأول)
        const todayCount = await Conversation.countDocuments({
            participants: user._id,
            creator: user._id,
            createdAt: { "$gte": todayStart }
        });

        // هل المستخدم جديد؟ (أول 24 ساعة من التسجيل)
        const accountAge = Date.now() - new Date(user.createdAt).getTime();
        const isNewUser = accountAge < 24 * 60 * 60 * 1000; // 24 ساعة

        const limit = isNewUser ? 50 : 100;

        if (todayCount >= limit) {
            return res.status(429).json({
                success: false,
                message: isNewUser
                    ? 'وصلت للحد اليومي للمحادثات الجديدة (50 محادثة لليوم الأول). حاول بكرة!'
                    : 'وصلت للحد اليومي للمحادثات الجديدة (100 محادثة). حاول بكرة!',
                code: 'DAILY_CONVERSATION_LIMIT',
                data: {
                    limit: limit,
                    used: todayCount,
                    isNewUser: isNewUser,
                    resetsAt: new Date(todayStart.getTime() + 24 * 60 * 60 * 1000).toISOString()
                }
            });
        }

        // أضف المعلومات للـ request عشان يقدر الـ route يستخدمها
        req.conversationLimit = {
            limit: limit,
            used: todayCount,
            remaining: limit - todayCount,
            isNewUser: isNewUser
        };

        next();
    } catch (error) {
        console.error('خطأ في فحص حد المحادثات:', error.message);
        // في حالة خطأ، لا تمنع المستخدم
        next();
    }
}

module.exports = { conversationLimitMiddleware };
