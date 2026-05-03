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

// ═══════════════════════════════════════════════════════════════
// Anti-evasion: Normalization + Patterns مع separators
// ═══════════════════════════════════════════════════════════════

/**
 * تطبيع النص قبل الفحص — يكسر محاولات التخفّي:
 * 1. Lowercase
 * 2. NFKC normalization — يحوّل math bold/circled/fullwidth إلى ASCII عادي
 *    (مثلاً 𝓼𝓷𝓪𝓹 → snap)
 * 3. حذف diacritics (snáp → snap)
 * 4. حذف zero-width chars (U+200B-200F، U+FEFF...)
 * 5. حذف Arabic tatweel (ـ) — سـنـاب → سناب
 * 6. Collapse repeated chars 3+ → 2 (snaaaap → snaap)
 * 7. تحويل Arabic-Indic digits → Latin (٠٥٠ → 050) — للـ phone patterns
 */
function normalizeForDetection(text) {
    if (!text) return '';
    // NFKD يفصل الـ compatibility (math bold → ASCII) + diacritics (á → a + ̀)
    let t = text.normalize('NFKD').toLowerCase();
    // Strip diacritics (combining marks)
    t = t.replace(/[̀-ͯ]/g, '');
    // Strip zero-width + invisible separators
    t = t.replace(/[​-‏‪-‮⁠-⁯﻿]/g, '');
    // Strip Arabic tatweel
    t = t.replace(/ـ/g, '');
    // Arabic-Indic → Latin digits
    t = t.replace(/[٠-٩]/g, d => String.fromCharCode(d.charCodeAt(0) - 0x0660 + 0x30));
    t = t.replace(/[۰-۹]/g, d => String.fromCharCode(d.charCodeAt(0) - 0x06F0 + 0x30));
    return t;
}

/**
 * Normalize أكثر عدوانية للـ pass 2 (anti-evasion):
 * - يطبّق normalizeForDetection
 * - يحذف ALL repeated chars (snaaaap → snap)
 * - يحذف الـ separators بين الحروف (s.n.a.p → snap)
 * يُستخدم فقط لكشف التخفّي — أعلى false positive من النسخة العادية.
 */
function aggressiveNormalize(text) {
    let t = normalizeForDetection(text);
    t = t.replace(/(.)\1+/g, '$1');   // collapse ALL repeats to 1
    // Strip separators BETWEEN letters فقط (Latin + Arabic) — لا تأثير على الأرقام
    // مثلاً: s.n.a.p → snap، ا ن س ت ا → انستا (لكن 050-123 يبقى لأنه أرقام)
    const letterPair = /([a-z؀-ۿ])[\s._\-]+([a-z؀-ۿ])/g;
    t = t.replace(letterPair, '$1$2');
    // كرّر لمعالجة sequences طويلة (s_n_a_p يحتاج passes متعددة)
    t = t.replace(letterPair, '$1$2');
    t = t.replace(letterPair, '$1$2');
    return t;
}

/**
 * Patterns إضافية للتخفّي بـ separators بين الحروف.
 * مثلاً: s.n.a.p / s n a p / s_n_a_p / سـ ن ا ب
 * نطبّقها على الـ normalized text فقط.
 */
const EVASION_PATTERNS = [
    // s.n.a.p / s n a p / s-n-a-p
    { regex: /\bs[\s._\-]+n[\s._\-]+a[\s._\-]+p\b/gi, category: 'snap' },
    { regex: /\bi[\s._\-]+n[\s._\-]+s[\s._\-]+t[\s._\-]+a\b/gi, category: 'instagram' },
    { regex: /\bw[\s._\-]+h[\s._\-]+a[\s._\-]+t[\s._\-]+s\b/gi, category: 'whatsapp' },
    { regex: /\bz[\s._\-]+[ie][\s._\-]+n[\s._\-]+[jq][\s._\-]+i\b/gi, category: 'zinji' },
    // Arabic spaced — س ن ا ب / ا ن س ت ا
    { regex: /س[\s._\-]+ن[\s._\-]+ا[\s._\-]+ب/g, category: 'snap' },
    { regex: /[إا][\s._\-]+ن[\s._\-]+س[\s._\-]+ت[\s._\-]+[اآ]/g, category: 'instagram' },
    { regex: /و[\s._\-]+ا[\s._\-]+ت[\s._\-]+س/g, category: 'whatsapp' },
    { regex: /ز[\s._\-]+ن[\s._\-]+[جق][\s._\-]+ي/g, category: 'zinji' },
    // Leet speak — drop \b ليلتقط !nsta و 5nap في بداية النص
    { regex: /5n[a4]p/gi, category: 'snap' },
    { regex: /[1!]nst[a4]/gi, category: 'instagram' },
];

/**
 * كشف External Promotion في نص (مع normalization + anti-evasion).
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

    // Pass 1: مطابقة على النص الأصلي (الأنماط القياسية)
    for (const { regex, category } of PATTERNS) {
        regex.lastIndex = 0;
        const matches = text.match(regex);
        if (matches && matches.length > 0) {
            matched.push(...matches);
            categories.add(category.replace(/_url$/, ''));
            redacted = redacted.replace(regex, '***');
        }
    }

    // Pass 2: مطابقة على النص الـ aggressive normalized (يكسر التخفّي بـ separators/repeats)
    const aggressive = aggressiveNormalize(text);
    if (aggressive !== text.toLowerCase()) {
        for (const { regex, category } of PATTERNS) {
            regex.lastIndex = 0;
            if (regex.test(aggressive)) {
                if (!categories.has(category.replace(/_url$/, ''))) {
                    matched.push(`[evasion:${category}]`);
                    categories.add(category.replace(/_url$/, ''));
                    redacted = '***';   // النص كامل مشبوه — استبدله
                }
            }
        }
    }

    // Pass 3: أنماط التخفّي بـ separators (على النص الأصلي)
    for (const { regex, category } of EVASION_PATTERNS) {
        regex.lastIndex = 0;
        const matches = text.match(regex);
        if (matches && matches.length > 0) {
            matched.push(...matches);
            categories.add(category.replace(/_url$/, ''));
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
 * @param {Object} [logContext] - { source: 'bio'|'message'|'name', categories, patterns, conversationId }
 *                                لتسجيل تفاصيل الـ analytics — اختياري
 * @returns {Object} { violations, lockApplied, suspended, message }
 */
async function recordExternalPromoViolation(user, logContext = null) {
    // ─── Analytics log (fire-and-forget) ───
    if (logContext && logContext.source && logContext.categories?.length) {
        try {
            const ExternalPromoLog = require('../models/ExternalPromoLog');
            ExternalPromoLog.create({
                user: user._id,
                source: logContext.source,
                categories: logContext.categories,
                matchedPatterns: logContext.patterns || [],
                conversationId: logContext.conversationId || null
            }).catch(err => {
                if (process.env.NODE_ENV !== 'production') {
                    console.error('⚠️ ExternalPromoLog create failed:', err.message);
                }
            });
        } catch (err) {
            // فشل اختياري — لا يمنع العقوبة
        }
    }

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
