/**
 * External Promotion Detector
 *
 * يكشف محاولات تحويل المستخدمين خارج التطبيق (Snapchat, Instagram, إلخ)
 * — مشكلة شائعة في تطبيقات المواعدة:
 *   1. خسارة engagement (المستخدمون يهربون لمنصات أخرى)
 *   2. خسارة Premium conversions
 *   3. ضعف moderation (المحتالون يستهدفون الضحايا خارج التطبيق)
 *
 * الاستخدام:
 *   const { detected, redacted, patterns } = detectExternalPromotion(text);
 *
 * عند التطابق:
 *   - bio: يُستبدَل بنجوم + إشعار للمستخدم
 *   - message: يُستبدَل بنجوم + violation counter يزداد
 */

// ═══════════════════════════════════════════════════════════════
// Regex Patterns
// ═══════════════════════════════════════════════════════════════
// نمتص الكلمات الـ standalone + variations + URLs
// نتجنّب false positives الواضحة (مثل "snap" داخل كلمة "snapshot")
// ═══════════════════════════════════════════════════════════════

const PATTERNS = [
    // ─── Snapchat ───
    { regex: /\bsnap(?:chat|s)?\b/gi, category: 'snap' },
    { regex: /سناب[؀-ۿ]*/g, category: 'snap' },
    { regex: /(?:https?:\/\/)?(?:www\.)?snapchat\.com\/[^\s,]*/gi, category: 'snap_url' },
    { regex: /(?:https?:\/\/)?snap(?:chat)?\.app\.link\/[^\s,]*/gi, category: 'snap_url' },

    // ─── Instagram ───
    { regex: /\binstagram\b/gi, category: 'instagram' },
    { regex: /\binsta(?:gram)?\w*\b/gi, category: 'instagram' },
    { regex: /\bigtv\b/gi, category: 'instagram' },
    { regex: /[إا]نست[؀-ۿ]*/g, category: 'instagram' },
    { regex: /(?:https?:\/\/)?(?:www\.)?instagram\.com\/[^\s,]*/gi, category: 'instagram_url' },
    { regex: /(?:https?:\/\/)?(?:www\.)?ig\.me\/[^\s,]*/gi, category: 'instagram_url' },

    // ─── Telegram ───
    { regex: /\btelegram\b/gi, category: 'telegram' },
    { regex: /تلي[جغ]رام[؀-ۿ]*/g, category: 'telegram' },
    { regex: /(?:https?:\/\/)?t\.me\/[^\s,]*/gi, category: 'telegram_url' },

    // ─── TikTok ───
    { regex: /\btiktok\b/gi, category: 'tiktok' },
    { regex: /تيك\s*توك[؀-ۿ]*/g, category: 'tiktok' },

    // ─── WhatsApp (الأكثر استخداماً للـ funnel-out) ───
    { regex: /\bwhats?app\b/gi, category: 'whatsapp' },
    { regex: /\bwhats?ap\b/gi, category: 'whatsapp' },
    { regex: /واتس[\s]?[اآ]?ب?[؀-ۿ]*/g, category: 'whatsapp' },
    { regex: /(?:https?:\/\/)?(?:wa\.me|api\.whatsapp\.com|chat\.whatsapp\.com)\/[^\s,]*/gi, category: 'whatsapp_url' },

    // ─── Zinji (تطبيق مشاركة أرقام شائع في السعودية والخليج) ───
    { regex: /\bzin[jq]i\b/gi, category: 'zinji' },
    { regex: /\bzen[jq]i\b/gi, category: 'zinji' },
    { regex: /زن[جق]ي[؀-ۿ]*/g, category: 'zinji' },

    // ─── Discord (صاعد بين الشباب) ───
    { regex: /\bdiscord\b/gi, category: 'discord' },
    { regex: /ديسكورد[؀-ۿ]*/g, category: 'discord' },
    { regex: /(?:https?:\/\/)?(?:www\.)?discord\.gg\/[^\s,]*/gi, category: 'discord_url' },

    // ─── Kik / Tellonym / X (Twitter) ───
    { regex: /\bkik\b/gi, category: 'kik' },
    { regex: /\btwitter\b/gi, category: 'twitter' },
    { regex: /تويتر[؀-ۿ]*/g, category: 'twitter' },

    // ─── Email addresses ───
    { regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, category: 'email' },

    // ─── Phone numbers (متعددة الصيغ) ───
    // International مع +
    { regex: /\+\d{1,3}[\s-]?\d{2,4}[\s-]?\d{2,4}[\s-]?\d{2,4}/g, category: 'phone' },
    // Saudi mobile (05xxxxxxxx) + variations
    { regex: /\b05\d{8}\b/g, category: 'phone' },
    { regex: /\b9665\d{8}\b/g, category: 'phone' },
    // Phone with spaces/dashes (8+ digits with separators) — يكشف "050 123 4567"
    { regex: /\b\d{2,4}[\s-]\d{2,4}[\s-]\d{2,4}(?:[\s-]\d{2,4})?\b/g, category: 'phone' },
    // Long sequence of 10+ digits (international without +)
    { regex: /\b\d{10,15}\b/g, category: 'phone' },
    // Arabic-Indic digits (٠١٢٣٤٥٦٧٨٩) — 8+ متتالية أو مع spaces
    { regex: /[٠-٩]{8,}/g, category: 'phone' },
    { regex: /[٠-٩]{2,4}[\s-][٠-٩]{2,4}[\s-][٠-٩]{2,4}(?:[\s-][٠-٩]{2,4})?/g, category: 'phone' },
];

/**
 * كشف External Promotion في نص.
 * @param {string} text
 * @returns {{ detected: boolean, redacted: string, patterns: string[], categories: string[] }}
 */
function detectExternalPromotion(text) {
    if (!text || typeof text !== 'string') {
        return { detected: false, redacted: text, patterns: [], categories: [] };
    }

    let redacted = text;
    const matched = [];
    const categories = new Set();

    for (const { regex, category } of PATTERNS) {
        // reset lastIndex (regex stateful بسبب /g)
        regex.lastIndex = 0;
        const matches = text.match(regex);
        if (matches && matches.length > 0) {
            matched.push(...matches);
            categories.add(category.replace(/_url$/, ''));   // نوحّد snap/snap_url
            // استبدال بـ *** (نفس عدد الحروف يبدو غير منطقي للـ URLs الطويلة)
            redacted = redacted.replace(regex, '***');
        }
    }

    return {
        detected: matched.length > 0,
        redacted,
        patterns: matched,
        categories: Array.from(categories)
    };
}

// ═══════════════════════════════════════════════════════════════
// Violation Tracker — نظام تدريجي للمكررين
// ═══════════════════════════════════════════════════════════════

const SOFT_THRESHOLD = 5;     // 5 violations → bio + messaging مقفولان 24س
const HARD_THRESHOLD = 10;    // 10 violations → suspension 7 أيام
const DECAY_WINDOW_DAYS = 7;  // counter يتصفّر بعد 7 أيام بدون مخالفات
const LOCK_DURATION_HOURS = 24;
const SUSPENSION_DURATION_DAYS = 7;

/**
 * تسجيل violation للترويج الخارجي + تطبيق العقوبات التدريجية
 * @param {Object} user - mongoose User document (يجب أن يكون قابلاً للحفظ)
 * @returns {Object} { violations, lockApplied, suspended, message }
 */
async function recordExternalPromoViolation(user) {
    const now = new Date();
    if (!user.externalPromo) {
        user.externalPromo = { violations: 0, lastViolationAt: null, bioLockedUntil: null, suspendedAt: null };
    }

    // Decay: لو آخر violation > 7 أيام، صفّر العداد
    const decayCutoff = new Date(now.getTime() - DECAY_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    if (!user.externalPromo.lastViolationAt || user.externalPromo.lastViolationAt < decayCutoff) {
        user.externalPromo.violations = 0;
    }

    user.externalPromo.violations += 1;
    user.externalPromo.lastViolationAt = now;

    let lockApplied = false;
    let suspended = false;
    let message = null;

    // HARD threshold: suspension 7 أيام
    if (user.externalPromo.violations >= HARD_THRESHOLD) {
        const suspensionUntil = new Date(now.getTime() + SUSPENSION_DURATION_DAYS * 24 * 60 * 60 * 1000);
        user.suspension = user.suspension || {};
        user.suspension.isSuspended = true;
        user.suspension.suspendedAt = now;
        user.suspension.suspendedUntil = suspensionUntil;
        user.suspension.reason = 'external_promotion_repeat';
        user.suspension.adminMessage = 'تم تعليق الحساب بسبب محاولات متكررة لمشاركة حسابات خارجية';
        user.externalPromo.suspendedAt = now;
        suspended = true;
        message = 'تم تعليق حسابك 7 أيام بسبب محاولات متكررة لمشاركة حسابات خارجية';
    }
    // SOFT threshold: lock 24 ساعة
    else if (user.externalPromo.violations >= SOFT_THRESHOLD) {
        const lockUntil = new Date(now.getTime() + LOCK_DURATION_HOURS * 60 * 60 * 1000);
        user.externalPromo.bioLockedUntil = lockUntil;
        // Also use existing messagingRestricted flag for consistency with admin tools
        if (!user.restrictions) user.restrictions = {};
        user.restrictions.messagingRestricted = true;
        user.restrictions.messagingRestrictedUntil = lockUntil;
        user.restrictions.messagingRestrictedLevel = 'all';
        user.restrictions.restrictionReason = 'external_promotion';
        lockApplied = true;
        message = 'تم تقييد حسابك 24 ساعة بسبب محاولات متكررة لمشاركة حسابات خارجية';
    }

    await user.save();

    return {
        violations: user.externalPromo.violations,
        threshold: SOFT_THRESHOLD,
        lockApplied,
        suspended,
        message
    };
}

/**
 * فحص هل bio مقفول حالياً للمستخدم
 */
function isBioLocked(user) {
    const now = new Date();
    return !!(user.externalPromo?.bioLockedUntil && user.externalPromo.bioLockedUntil > now);
}

/**
 * فحص هل messaging مقيّد بسبب external promo (مشترك مع admin restrictions)
 */
function isMessagingLockedByPromo(user) {
    const now = new Date();
    return !!(
        user.restrictions?.messagingRestricted &&
        user.restrictions?.messagingRestrictedUntil > now &&
        user.restrictions?.restrictionReason === 'external_promotion'
    );
}

module.exports = {
    detectExternalPromotion,
    recordExternalPromoViolation,
    isBioLocked,
    isMessagingLockedByPromo,
    SOFT_THRESHOLD,
    HARD_THRESHOLD
};
