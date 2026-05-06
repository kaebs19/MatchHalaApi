/**
 * Multi-Message Number Detector
 *
 * يكشف الأرقام المُقسَّمة على عدة رسائل (تكتيك التحايل على External Promo):
 *   رسالة 1: "124"
 *   رسالة 2: "134"
 *   رسالة 3: "876"
 * → combined = "124134876" (9 أرقام) → Zinji ID محتمل
 *
 * الخوارزمية:
 *   1. لكل رسالة "أرقام-غالباً" (>50% أرقام) من نفس المُرسِل في نفس المحادثة
 *   2. nzz buffer داخل window 10 دقائق
 *   3. concatenate الأرقام بالترتيب الزمني
 *   4. لو combined.length >= 9 → flag
 *
 * Anti-false-positives:
 *   - فقط رسائل "أرقام غالباً" (تتجاهل "أنا 25 سنة")
 *   - استثناء التواريخ (YYYY-MM-DD)
 *   - sliding window 10 دقائق فقط
 *   - reset بعد flag (تجنب double-trigger)
 */

const MIN_DIGITS = 9;
const TTL_MS = 10 * 60 * 1000;          // 10 دقائق
const MAX_BUFFER_PER_KEY = 12;
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // كل 5 دقائق تنظيف

// in-memory cache: Map<userId:convId, [{digits, ts, msgPreview}]>
const cache = new Map();

/**
 * تحويل الأرقام العربية-الهندية إلى لاتينية
 */
function normalizeArabicDigits(text) {
    return text
        .replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660))
        .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x06F0));
}

/**
 * هل الرسالة "أرقام غالباً"؟
 * نسبة الأرقام (لاتينية/عربية/فارسية) إلى الأحرف غير المسافة > 50%
 */
function isMostlyDigits(content) {
    // تطبيع الأرقام أولاً ليُحسب الـ Arabic-Indic كأرقام
    const normalized = normalizeArabicDigits(content);
    const cleaned = normalized.trim().replace(/\s/g, '');
    if (cleaned.length === 0) return false;
    const digitCount = (cleaned.match(/\d/g) || []).length;
    return digitCount / cleaned.length >= 0.5 && digitCount >= 2;
}

/**
 * هل الرسالة بمفردها تاريخ صريح؟ (YYYY-MM-DD، DD-MM-YYYY)
 */
function isStandaloneDate(content) {
    const trimmed = content.trim();
    return /^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/.test(trimmed)
        || /^\d{1,2}[-/]\d{1,2}[-/]\d{4}$/.test(trimmed);
}

/**
 * استخراج كل sequences الأرقام (2+ متتالية) من نص
 */
function extractDigitSequences(content) {
    const normalized = normalizeArabicDigits(content);
    return normalized.match(/\d{2,}/g) || [];
}

/**
 * فحص رسالة جديدة ضد buffer سابق
 *
 * @param {string} userId
 * @param {string} convId
 * @param {string} content
 * @returns {{detected: boolean, combinedDigits: string|null, bufferSize: number}}
 */
function checkMultiMessageNumbers(userId, convId, content) {
    if (!userId || !convId || !content) {
        return { detected: false, combinedDigits: null, bufferSize: 0 };
    }

    // 1. تجاهل الرسائل النصية (نحتاج مُرسِل "أرقام غالباً")
    if (!isMostlyDigits(content)) {
        return { detected: false, combinedDigits: null, bufferSize: 0 };
    }

    // 2. تجاهل التواريخ المنفردة
    if (isStandaloneDate(content)) {
        return { detected: false, combinedDigits: null, bufferSize: 0 };
    }

    const digits = extractDigitSequences(content).join('');
    if (digits.length < 2) {
        return { detected: false, combinedDigits: null, bufferSize: 0 };
    }

    const key = `${userId}:${convId}`;
    const now = Date.now();

    // 3. جلب buffer + تنظيف الـ stale entries
    const stale = cache.get(key) || [];
    const fresh = stale.filter(e => now - e.ts < TTL_MS);

    // 4. إضافة الـ digits الحالية
    fresh.push({ digits, ts: now });

    // trim
    while (fresh.length > MAX_BUFFER_PER_KEY) fresh.shift();

    // 5. concatenate بالترتيب الزمني
    const combinedDigits = fresh.map(e => e.digits).join('');

    // 6. فحص العتبة
    if (combinedDigits.length >= MIN_DIGITS && fresh.length >= 2) {
        // ✅ flag — reset buffer لتجنب double trigger من نفس المجموعة
        cache.delete(key);
        return {
            detected: true,
            combinedDigits,
            bufferSize: fresh.length
        };
    }

    // لم يصل العتبة بعد — احفظ الـ buffer
    cache.set(key, fresh);
    return {
        detected: false,
        combinedDigits: null,
        bufferSize: fresh.length
    };
}

/**
 * تنظيف دوري للـ entries المنتهية
 */
function cleanup() {
    const now = Date.now();
    let removed = 0;
    for (const [key, entries] of cache.entries()) {
        const fresh = entries.filter(e => now - e.ts < TTL_MS);
        if (fresh.length === 0) {
            cache.delete(key);
            removed++;
        } else if (fresh.length !== entries.length) {
            cache.set(key, fresh);
        }
    }
    return removed;
}

// تنظيف كل 5 دقائق (داخل العملية فقط — يعيد التهيئة عند restart)
const cleanupTimer = setInterval(cleanup, CLEANUP_INTERVAL_MS);
cleanupTimer.unref?.();   // لا يمنع process exit

/**
 * مسح buffer مستخدم محدد (للاستخدام بعد violation أو حظر)
 */
function clearUserBuffer(userId, convId = null) {
    if (convId) {
        cache.delete(`${userId}:${convId}`);
    } else {
        for (const key of cache.keys()) {
            if (key.startsWith(`${userId}:`)) cache.delete(key);
        }
    }
}

/**
 * إحصائيات للـ debugging/admin
 */
function getStats() {
    return {
        totalKeys: cache.size,
        totalEntries: Array.from(cache.values()).reduce((sum, arr) => sum + arr.length, 0)
    };
}

module.exports = {
    checkMultiMessageNumbers,
    clearUserBuffer,
    getStats,
    cleanup,
    // exported للـ unit tests
    _internal: {
        isMostlyDigits,
        isStandaloneDate,
        extractDigitSequences,
        normalizeArabicDigits,
        MIN_DIGITS,
        TTL_MS
    }
};
