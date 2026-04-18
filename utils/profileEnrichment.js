// utils/profileEnrichment.js
// ✅ حساب حقول الملف الشخصي المشتقّة (برج، رتبة، عيد ميلاد)

/**
 * حساب البرج من تاريخ الميلاد
 * @param {Date|string} birthDate
 * @returns {{ key: string, labelAr: string, labelEn: string, emoji: string } | null}
 */
function getZodiacSign(birthDate) {
    if (!birthDate) return null;
    const d = new Date(birthDate);
    if (isNaN(d.getTime())) return null;

    const month = d.getMonth() + 1; // 1-12
    const day = d.getDate();

    const signs = [
        { key: 'capricorn',   labelAr: 'الجدي',   labelEn: 'Capricorn',   emoji: '♑️', from: [12, 22], to: [1, 19] },
        { key: 'aquarius',    labelAr: 'الدلو',   labelEn: 'Aquarius',    emoji: '♒️', from: [1, 20],  to: [2, 18] },
        { key: 'pisces',      labelAr: 'الحوت',   labelEn: 'Pisces',      emoji: '♓️', from: [2, 19],  to: [3, 20] },
        { key: 'aries',       labelAr: 'الحمل',   labelEn: 'Aries',       emoji: '♈️', from: [3, 21],  to: [4, 19] },
        { key: 'taurus',      labelAr: 'الثور',   labelEn: 'Taurus',      emoji: '♉️', from: [4, 20],  to: [5, 20] },
        { key: 'gemini',      labelAr: 'الجوزاء', labelEn: 'Gemini',      emoji: '♊️', from: [5, 21],  to: [6, 20] },
        { key: 'cancer',      labelAr: 'السرطان', labelEn: 'Cancer',      emoji: '♋️', from: [6, 21],  to: [7, 22] },
        { key: 'leo',         labelAr: 'الأسد',   labelEn: 'Leo',         emoji: '♌️', from: [7, 23],  to: [8, 22] },
        { key: 'virgo',       labelAr: 'العذراء', labelEn: 'Virgo',       emoji: '♍️', from: [8, 23],  to: [9, 22] },
        { key: 'libra',       labelAr: 'الميزان', labelEn: 'Libra',       emoji: '♎️', from: [9, 23],  to: [10, 22] },
        { key: 'scorpio',     labelAr: 'العقرب',  labelEn: 'Scorpio',     emoji: '♏️', from: [10, 23], to: [11, 21] },
        { key: 'sagittarius', labelAr: 'القوس',   labelEn: 'Sagittarius', emoji: '♐️', from: [11, 22], to: [12, 21] }
    ];

    for (const s of signs) {
        const [fm, fd] = s.from;
        const [tm, td] = s.to;
        // يغطي الحالة المعتادة + الجدي الذي يعبر نهاية السنة
        if (fm === tm) {
            if (month === fm && day >= fd && day <= td) return s;
        } else if (fm < tm) {
            if ((month === fm && day >= fd) || (month === tm && day <= td)) return s;
        } else {
            // fm=12, tm=1 (الجدي)
            if ((month === fm && day >= fd) || (month === tm && day <= td)) return s;
        }
    }
    return null;
}

/**
 * هل اليوم = عيد ميلاد المستخدم (مطابقة يوم + شهر فقط، بدون سنة)
 */
function isBirthdayToday(birthDate) {
    if (!birthDate) return false;
    const b = new Date(birthDate);
    if (isNaN(b.getTime())) return false;
    const now = new Date();
    return b.getDate() === now.getDate() && b.getMonth() === now.getMonth();
}

/**
 * حساب رتبة المستخدم بناء على الأقدمية + النشاط + الاشتراك
 * يرجع { key, labelAr, labelEn, emoji }
 *
 * منطق الترتيب (من الأقوى للأضعف):
 * 1. مميز: isPremium
 * 2. نشط: آخر دخول خلال 3 أيام + (محادثات >= 10 أو likes >= 30)
 * 3. متفاعل: (محادثات >= 3 أو likes >= 10)
 * 4. جديد: الانضمام خلال 14 يوم
 * 5. عضو: غير ذلك (افتراضي)
 */
function computeUserRank(user) {
    if (!user) return { key: 'member', labelAr: 'عضو', labelEn: 'Member', emoji: '👤' };

    const now = Date.now();
    const createdAt = user.createdAt ? new Date(user.createdAt).getTime() : now;
    const daysSinceJoin = Math.floor((now - createdAt) / (1000 * 60 * 60 * 24));

    const lastLogin = user.lastLogin ? new Date(user.lastLogin).getTime() : 0;
    const daysSinceLogin = lastLogin ? Math.floor((now - lastLogin) / (1000 * 60 * 60 * 24)) : 999;

    const conversationsCount = user.stats?.conversationsStarted || user.conversationsCount || 0;
    const likesSent = user.stats?.likesSent || user.likesSent || 0;

    if (user.isPremium) {
        return { key: 'premium', labelAr: 'مستخدم مميز', labelEn: 'Premium Member', emoji: '👑' };
    }

    if (daysSinceLogin <= 3 && (conversationsCount >= 10 || likesSent >= 30)) {
        return { key: 'active', labelAr: 'مستخدم نشط', labelEn: 'Active Member', emoji: '⚡' };
    }

    if (conversationsCount >= 3 || likesSent >= 10) {
        return { key: 'engaged', labelAr: 'مستخدم متفاعل', labelEn: 'Engaged Member', emoji: '💬' };
    }

    if (daysSinceJoin <= 14) {
        return { key: 'new', labelAr: 'مستخدم جديد', labelEn: 'New Member', emoji: '🆕' };
    }

    return { key: 'member', labelAr: 'عضو', labelEn: 'Member', emoji: '👤' };
}

/**
 * هل المستخدم يمتلك شارة VIP — إما من الأدمن أو من الاشتراك الفعّال
 */
function hasVipBadge(user) {
    if (!user) return false;
    // منحها الأدمن يدوياً → تبقى حتى لو انتهى الاشتراك
    if (user.vipBadge?.grantedByAdmin) return true;
    // مشترك فعّال (لم ينتهِ)
    if (user.isPremium && user.premiumExpiresAt) {
        const now = new Date();
        if (new Date(user.premiumExpiresAt) > now) return true;
    } else if (user.isPremium && !user.premiumExpiresAt) {
        // مشترك بدون تاريخ انتهاء (دائم)
        return true;
    }
    return false;
}

function getVipBadgeSource(user) {
    if (!user) return null;
    if (user.vipBadge?.grantedByAdmin) return 'admin';
    if (user.isPremium) return 'premium';
    return null;
}

/**
 * يُضيف الحقول المحسوبة إلى كائن مستخدم (lean أو document)
 */
function enrichProfile(user) {
    if (!user) return user;
    const zodiac = getZodiacSign(user.birthDate);
    const rank = computeUserRank(user);
    const birthday = isBirthdayToday(user.birthDate);

    return {
        ...user,
        zodiacSign: zodiac,
        userRank: rank,
        isBirthdayToday: birthday,
        joinDate: user.createdAt || null,
        hasVipBadge: hasVipBadge(user),
        vipBadgeSource: getVipBadgeSource(user)
    };
}

module.exports = {
    getZodiacSign,
    isBirthdayToday,
    computeUserRank,
    hasVipBadge,
    getVipBadgeSource,
    enrichProfile
};
