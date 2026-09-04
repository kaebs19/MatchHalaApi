const Conversation = require('../models/Conversation');

// 🛡️ سقف الطلبات المعلّقة غير المُجابة في آنٍ واحد.
// الحدّ اليومي وحده لا يمنع التراكم: مُرسِل واحد كان يكدّس مئات الطلبات
// بلا ردّ ويواصل الإرسال، فيغرق صناديق المستلمين (٦٠٢ مستخدماً كانوا
// يحملون ٧٤٪ من كل الطلبات المعلّقة). نظير `MAX_PENDING_SENT` في الأصدقاء.
const MAX_OUTSTANDING_FREE = 30;
const MAX_OUTSTANDING_PREMIUM = 60;

/**
 * Middleware: حد المحادثات اليومية
 * - مستخدم جديد (أول 24 ساعة): 50 محادثة
 * - مستخدم عادي: 100 محادثة
 * - Premium: بدون حد يومي
 * + سقف معلّق متزامن للجميع (لا يتجاوزه إعلان ولا اشتراك)
 */
async function conversationLimitMiddleware(req, res, next) {
    try {
        const user = req.user;
        const isPremium = !!(user.isPremium && user.premiumExpiresAt > new Date());

        // ⚠️ المسار نفسه يخدم ثلاث نوايا: طلب جديد، واستئناف محادثة مُغلقة،
        //    و«افتح المحادثة القائمة» (زرّ المراسلة في البروفايل وشاشة الدردشة
        //    ينادونه جميعاً). الحدود تخصّ الأولى وحدها — لكنها كانت تُفحص قبل
        //    أن يعرف المعالِج أن محادثة قائمة أصلاً، فوجد المحجوب نفسه ممنوعاً
        //    من فتح محادثات مع أشخاص قبلوه من قبل، بلا أي طلب معلّق جديد
        //    يُنشأ. لا حدّ حيث لا إنشاء.
        const targetUserId = req.body?.targetUserId;
        if (targetUserId) {
            const existing = await Conversation.findOne({
                type: 'private',
                participants: { $all: [user._id, targetUserId] }
            }).select('status isActive').lean();

            const isEnded = existing && (
                existing.status === 'cancelled'
                || existing.status === 'rejected'
                || existing.isActive === false
            );

            // محادثة قائمة وغير منتهية → المعالِج سيعيدها كما هي بلا إنشاء
            if (existing && !isEnded) {
                return next();
            }
        }

        // ⚠️ السقف المتزامن يسبق كل تجاوز — لا الإعلان ولا Premium يرفعه،
        //    لأنه ليس حدّ استهلاك بل حماية لصناديق الطرف الآخر.
        //
        // ⚠️⚠️ نافذة ٤٨ ساعة لا الرصيد الكلّي — والسبب خطأ تسلسل يجب ألّا
        //    يتكرّر: نُشر السقف على الخادم فوراً لكل المستخدمين، بينما زرّ
        //    «إلغاء الطلب» الذي تطلبه رسالة الحجب لم يُرفع بعد في تطبيق
        //    v10.2. فوجد ١٠٥٧ مُرسِلاً أنفسهم محجوبين بلا وسيلة للامتثال.
        //    النافذة تُبقي الكبح على الإرسال المتدفّق (٣٠ طلباً في يومين
        //    تعني ١٥/يوم) وتُسقط عقوبة الرصيد المتراكم — وهو ينتهي وحده
        //    خلال سبعة أيام عبر managePendingConversations.
        //    بعد وصول v10.2 لأغلب المستخدمين يُعاد النظر في العودة للرصيد
        //    الكلّي، لأن الإلغاء سيصير متاحاً فعلاً.
        const OUTSTANDING_WINDOW_MS = 48 * 60 * 60 * 1000;
        const outstandingLimit = isPremium ? MAX_OUTSTANDING_PREMIUM : MAX_OUTSTANDING_FREE;
        // ⚠️ عمر الطلب هو `requestedAt` لا `createdAt`: استئناف محادثة مُغلقة
        //    يُعيد الوثيقة إلى pending ويحدّث `requestedAt` وحده، فطلبٌ أُرسل
        //    قبل دقيقة على وثيقة عمرها شهر كان يسقط من النافذة بلا حساب.
        //    الاحتياط لوثائق ما قبل الحقل: `requestedAt: null` → `createdAt`.
        const since = new Date(Date.now() - OUTSTANDING_WINDOW_MS);
        const outstanding = await Conversation.countDocuments({
            creator: user._id,
            status: 'pending',
            $or: [
                { requestedAt: { $ne: null, $gte: since } },
                { requestedAt: null, createdAt: { $gte: since } }
            ]
        });

        if (outstanding >= outstandingLimit) {
            return res.status(429).json({
                success: false,
                // ⚠️ لا تطلب من المستخدم فعلاً لا تملك واجهته تنفيذه.
                //    الصياغة تصف ما سيحدث تلقائياً بدل توجيهه إلى زرّ غير موجود.
                message: `أرسلت ${outstanding} طلباً خلال يومين ولم تُجَب بعد. امنحها وقتاً — تُفتح المساحة تلقائياً مع كل ردّ يصلك.`,
                code: 'OUTSTANDING_REQUESTS_LIMIT',
                data: { limit: outstandingLimit, outstanding, windowHours: 48 }
            });
        }

        // تجاوز الحد اليومي بعد مشاهدة إعلان
        if (req.body?.adRewarded === true) {
            return next();
        }

        // Premium بدون حد يومي
        if (isPremium) {
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
