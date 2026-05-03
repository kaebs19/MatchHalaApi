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
    // Arabic — يستوعب كل suffix عربي (سناب، سنابي، سنابات، سنابك...)
    { regex: /سناب[؀-ۿ]*/g, category: 'snap' },
    // URL
    { regex: /(?:https?:\/\/)?(?:www\.)?snapchat\.com\/[^\s,]*/gi, category: 'snap_url' },
    { regex: /(?:https?:\/\/)?snap(?:chat)?\.app\.link\/[^\s,]*/gi, category: 'snap_url' },

    // ─── Instagram ───
    { regex: /\binstagram\b/gi, category: 'instagram' },
    { regex: /\binsta(?:gram)?\w*\b/gi, category: 'instagram' },
    { regex: /\bigtv\b/gi, category: 'instagram' },
    // Arabic — يستوعب suffix عربي كامل (انستا، انستجرام، انستقرام، انستي...)
    { regex: /[إا]نست[؀-ۿ]*/g, category: 'instagram' },
    // URL
    { regex: /(?:https?:\/\/)?(?:www\.)?instagram\.com\/[^\s,]*/gi, category: 'instagram_url' },
    { regex: /(?:https?:\/\/)?(?:www\.)?ig\.me\/[^\s,]*/gi, category: 'instagram_url' },

    // ─── منصات أخرى شائعة في الـ funnel ───
    { regex: /\btelegram\b/gi, category: 'telegram' },
    { regex: /\btiktok\b/gi, category: 'tiktok' },
    { regex: /تلي[جغ]رام[؀-ۿ]*/g, category: 'telegram' },
    { regex: /تيك\s*توك[؀-ۿ]*/g, category: 'tiktok' },
    { regex: /(?:https?:\/\/)?t\.me\/[^\s,]*/gi, category: 'telegram_url' },
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

module.exports = { detectExternalPromotion };
