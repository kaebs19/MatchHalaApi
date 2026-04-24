// MatchHala — Streak Helper
// منطق تحديث streak الأيام المتواصلة لفتح التطبيق
//
// القواعد:
// - أول مرة (lastActiveDate == null)               → current = 1
// - نفس اليوم (UTC)                                 → بدون تغيير
// - اليوم التالي بالضبط                              → current += 1
// - فجوة أكبر من يوم واحد                           → current = 1 (reset)
// - تحديث longest كذلك إذا current تجاوزها

/**
 * تطبيع تاريخ على بداية اليوم بـ UTC (00:00:00.000)
 * @param {Date} date
 * @returns {Date}
 */
function startOfDayUTC(date) {
    const d = new Date(date);
    d.setUTCHours(0, 0, 0, 0);
    return d;
}

/**
 * عدد الأيام بين تاريخين (UTC) كأعداد صحيحة موجبة
 */
function daysBetweenUTC(a, b) {
    const ms = startOfDayUTC(b).getTime() - startOfDayUTC(a).getTime();
    return Math.round(ms / (1000 * 60 * 60 * 24));
}

/**
 * يحدّث streak المستخدم بناءً على وقت "الآن".
 * يحفظ التحديث في DB لو فيه تغيير ويرجع حالة جديدة.
 *
 * @param {object} user — Mongoose user doc (يجب أن يكون قابل للحفظ)
 * @returns {Promise<{current:number, longest:number, lastActiveDate:Date, increased:boolean, reset:boolean}>}
 */
async function updateUserStreak(user) {
    if (!user) return null;

    const now = new Date();
    const today = startOfDayUTC(now);

    // قراءة القيم الحالية مع defaults آمنة
    const current = user.streak?.current || 0;
    const longest = user.streak?.longest || 0;
    const lastActive = user.streak?.lastActiveDate
        ? startOfDayUTC(user.streak.lastActiveDate)
        : null;

    let newCurrent = current;
    let increased = false;
    let reset = false;

    if (!lastActive) {
        // أول مرة على الإطلاق
        newCurrent = 1;
        increased = true;
    } else {
        const gap = daysBetweenUTC(lastActive, today);
        if (gap === 0) {
            // نفس اليوم — بدون تغيير
            return {
                current,
                longest,
                lastActiveDate: lastActive,
                increased: false,
                reset: false
            };
        } else if (gap === 1) {
            // اليوم التالي مباشرة — زيادة
            newCurrent = current + 1;
            increased = true;
        } else {
            // فجوة أكثر من يوم — reset
            newCurrent = 1;
            reset = true;
        }
    }

    const newLongest = Math.max(longest, newCurrent);

    // تحديث ذرّي بدون validation كاملة على باقي حقول الـ user
    await user.constructor.updateOne(
        { _id: user._id },
        {
            $set: {
                'streak.current': newCurrent,
                'streak.longest': newLongest,
                'streak.lastActiveDate': today
            }
        }
    );

    // تحديث الـ in-memory user
    if (!user.streak) user.streak = {};
    user.streak.current = newCurrent;
    user.streak.longest = newLongest;
    user.streak.lastActiveDate = today;

    return {
        current: newCurrent,
        longest: newLongest,
        lastActiveDate: today,
        increased,
        reset
    };
}

/**
 * قراءة streak مع منطق "في خطر" — هل ستنكسر إذا لم يفتح التطبيق اليوم؟
 * @param {object} user
 * @returns {{current:number, longest:number, atRisk:boolean, isToday:boolean}}
 */
function readStreakStatus(user) {
    const current = user?.streak?.current || 0;
    const longest = user?.streak?.longest || 0;
    const lastActive = user?.streak?.lastActiveDate
        ? startOfDayUTC(user.streak.lastActiveDate)
        : null;

    if (!lastActive) {
        return { current: 0, longest, atRisk: false, isToday: false };
    }

    const today = startOfDayUTC(new Date());
    const gap = daysBetweenUTC(lastActive, today);

    return {
        current: gap > 1 ? 0 : current,  // عرض 0 إذا انكسر فعلياً
        longest,
        atRisk: gap === 1,                // أمس → اليوم لم يُسجَّل بعد
        isToday: gap === 0
    };
}

module.exports = {
    updateUserStreak,
    readStreakStatus
};
