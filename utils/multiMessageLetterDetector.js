/**
 * Multi-Message Letter Detector — Anti-Evasion للحسابات الخارجية
 *
 * يكشف محاولات تقسيم اسم الحساب الخارجي على عدة رسائل قصيرة:
 *   رسالة 1: "س"
 *   رسالة 2: "ن"
 *   رسالة 3: "ا"
 *   رسالة 4: "ب"
 * → combined = "سناب" → snap ✅
 *
 * الخوارزمية:
 *   1. كل رسالة 1-3 أحرف من حروف عربي/لاتيني فقط → eligible
 *   2. stop-words شائعة (لا/نعم/هلا/...) لا تُضاف للـ buffer
 *   3. buffer per (user, conversation) — TTL 60s
 *   4. عند fragments ≥ 3 أو combined.length ≥ 4 → multi-pass detection
 *   5. passes: raw / aggressiveNormalize / ar→lat translit / lat→ar translit
 *   6. تطبيق detectExternalPromotion على كل pass — أول match يفوز
 *
 * Retroactive blocking:
 *   - عند الكشف، الرسائل السابقة في الـ buffer تُحجَب لاحقاً
 *   - violations += 2 (عقوبة مضاعفة لأن التحايل متعمد)
 *
 * Anti-false-positives:
 *   - فقط رسائل قصيرة (1-3 chars)
 *   - حروف عربي/لاتيني فقط (لا أرقام، لا رموز)
 *   - stop-words list
 *   - minimum 3 fragments أو combined.length ≥ 4
 *   - regex المحدد للأسماء الفعلية (snap/insta/...) يحمي من FP
 */

const { detectExternalPromotion, aggressiveNormalize } = require('./externalPromotionDetector');
const redisClient = require('./redisClient');

// إعدادات
const TTL_SECONDS = 60;                   // 60 ثانية (Redis EX يعمل بالثواني)
const MAX_FRAGMENT_LENGTH = 3;            // 1-3 أحرف فقط
const MIN_FRAGMENTS = 3;                  // الحد الأدنى للفحص
const MIN_COMBINED_LENGTH = 4;            // أو combined.length ≥ 4
const MAX_BUFFER_PER_KEY = 12;            // حماية من spam
const REDIS_KEY_PREFIX = 'mml:';          // multi-message-letter

// ⚠️ النظام كان in-memory Map → غير صالح في PM2 cluster mode (4 instances)
// التحويل إلى Redis يضمن مشاركة الـ buffer بين كل الـ instances

// Stop-words list (لا تُضاف للـ buffer لكن لا تمسحه)
const STOP_WORDS_AR = new Set([
    'لا', 'نعم', 'هاي', 'هلا', 'اوك', 'أوك', 'تمام', 'بس', 'ما', 'إن', 'ان',
    'هي', 'هو', 'أو', 'او', 'يا', 'آه', 'اه', 'نع', 'ها', 'تم', 'شو', 'مين',
    'وش', 'وين', 'كم', 'كل', 'في', 'من', 'عن', 'على', 'إلى', 'الى', 'مع'
]);
const STOP_WORDS_EN = new Set([
    'ok', 'no', 'yes', 'hi', 'hey', 'lol', 'omg', 'btw', 'idk', 'wtf', 'tbh',
    'imo', 'ily', 'lmao', 'thx', 'ty', 'np', 'nm', 'sup', 'yup', 'nah', 'yo'
]);

// Phonetic mapping: عربي → لاتيني
const AR_TO_LAT = {
    'ا': 'a', 'أ': 'a', 'إ': 'a', 'آ': 'a',
    'ب': 'b',
    'ت': 't', 'ة': 'h',
    'ث': 'th',
    'ج': 'j',
    'ح': 'h',
    'خ': 'kh',
    'د': 'd',
    'ذ': 'th',
    'ر': 'r',
    'ز': 'z',
    'س': 's',
    'ش': 'sh',
    'ص': 's',
    'ض': 'd',
    'ط': 't',
    'ظ': 'z',
    'ع': '',
    'غ': 'gh',
    'ف': 'f',
    'ق': 'q',
    'ك': 'k',
    'ل': 'l',
    'م': 'm',
    'ن': 'n',
    'ه': 'h',
    'و': 'w',
    'ي': 'y', 'ى': 'y', 'ئ': 'y'
};

// Phonetic mapping: لاتيني → عربي (most common)
const LAT_TO_AR = {
    'a': 'ا', 'b': 'ب', 'c': 'ك', 'd': 'د', 'e': 'ي',
    'f': 'ف', 'g': 'ج', 'h': 'ه', 'i': 'ي', 'j': 'ج',
    'k': 'ك', 'l': 'ل', 'm': 'م', 'n': 'ن', 'o': 'و',
    'p': 'ب', 'q': 'ق', 'r': 'ر', 's': 'س', 't': 'ت',
    'u': 'و', 'v': 'ف', 'w': 'و', 'x': 'كس', 'y': 'ي', 'z': 'ز'
};

/**
 * هل الرسالة eligible للـ buffer؟
 */
function isEligible(content) {
    if (!content || typeof content !== 'string') return false;
    const trimmed = content.trim();
    if (trimmed.length === 0 || trimmed.length > MAX_FRAGMENT_LENGTH) return false;
    // فقط حروف عربية/لاتينية (لا أرقام، لا رموز)
    if (!/^[؀-ۿa-zA-Z]+$/.test(trimmed)) return false;
    return true;
}

/**
 * هل الكلمة stop-word شائعة؟
 */
function isStopWord(text) {
    const lower = text.toLowerCase();
    return STOP_WORDS_AR.has(lower) || STOP_WORDS_EN.has(lower);
}

/**
 * Transliterate: عربي → لاتيني
 */
function translitArToLat(text) {
    let result = '';
    for (const ch of text) {
        result += AR_TO_LAT[ch] !== undefined ? AR_TO_LAT[ch] : ch;
    }
    return result;
}

/**
 * Transliterate: لاتيني → عربي
 */
function translitLatToAr(text) {
    let result = '';
    for (const ch of text.toLowerCase()) {
        result += LAT_TO_AR[ch] !== undefined ? LAT_TO_AR[ch] : ch;
    }
    return result;
}

/**
 * Multi-pass detection على الـ combined string
 */
function multiPassDetect(combined) {
    if (!combined || combined.length < MIN_COMBINED_LENGTH) {
        return { detected: false };
    }

    const passes = [
        { label: 'raw', text: combined },
        { label: 'normalized', text: aggressiveNormalize(combined) },
        { label: 'ar2lat', text: translitArToLat(combined) },
        { label: 'lat2ar', text: translitLatToAr(combined) }
    ];

    for (const p of passes) {
        if (!p.text || p.text.length < MIN_COMBINED_LENGTH) continue;
        const result = detectExternalPromotion(p.text);
        if (result.detected) {
            return {
                detected: true,
                pass: p.label,
                processedText: p.text,
                categories: result.categories,
                patterns: result.patterns
            };
        }
    }

    return { detected: false };
}

/**
 * فحص multi-message letter evasion
 *
 * @param {string} userId
 * @param {string} conversationId
 * @param {string} content - نص الرسالة
 * @param {string} messageId - id الرسالة بعد الإنشاء (لإمكانية حجبها لاحقاً)
 * @returns {Object} {
 *   detected: boolean,
 *   combinedWord?: string,
 *   pass?: string,
 *   categories?: string[],
 *   patterns?: string[],
 *   bufferedMessageIds?: string[],   // للـ retroactive blocking
 *   tactic: 'split_letters'
 * }
 */
async function checkMultiMessageLetters(userId, conversationId, content, messageId = null) {
    const result = { detected: false, tactic: 'split_letters' };

    if (!isEligible(content)) return result;

    const trimmed = content.trim();

    // stop-word → لا تُضاف لكن لا تمسح الـ buffer
    if (isStopWord(trimmed)) return result;

    const key = `${REDIS_KEY_PREFIX}${userId}:${conversationId}`;

    // جلب الـ buffer من Redis
    let buf = await redisClient.getJSON(key);
    if (!buf) {
        buf = { fragments: [], messageIds: [], startedAt: Date.now() };
    }

    // أضف الـ fragment
    buf.fragments.push(trimmed);
    if (messageId) buf.messageIds.push(messageId);

    // حماية من spam — احتفظ بآخر MAX_BUFFER_PER_KEY فقط
    if (buf.fragments.length > MAX_BUFFER_PER_KEY) {
        buf.fragments.shift();
        if (buf.messageIds.length > MAX_BUFFER_PER_KEY) buf.messageIds.shift();
    }

    // احفظ الـ buffer في Redis مع TTL
    await redisClient.setJSON(key, buf, TTL_SECONDS);

    // شرط التفعيل
    const combined = buf.fragments.join('');
    const shouldCheck = buf.fragments.length >= MIN_FRAGMENTS || combined.length >= MIN_COMBINED_LENGTH;
    if (!shouldCheck) return result;

    // Sliding window: اختبر nano-windows
    const candidates = [];
    candidates.push(combined);
    for (let take = Math.min(buf.fragments.length, 6); take >= MIN_FRAGMENTS; take--) {
        const sub = buf.fragments.slice(-take).join('');
        if (sub !== combined) candidates.push(sub);
    }

    for (const candidate of candidates) {
        const detection = multiPassDetect(candidate);
        if (detection.detected) {
            // حدد أي fragments شاركت في المخالفة (للـ retroactive blocking)
            const matchedCount = countFragmentsForString(buf.fragments, candidate);
            const matchedIds = buf.messageIds.slice(-matchedCount);

            // مسح الـ buffer لتجنب double-trigger
            await redisClient.del(key);

            return {
                detected: true,
                tactic: 'split_letters',
                combinedWord: candidate,
                pass: detection.pass,
                processedText: detection.processedText,
                categories: detection.categories,
                patterns: detection.patterns,
                bufferedMessageIds: matchedIds,
                fragmentCount: matchedCount
            };
        }
    }

    return result;
}

/**
 * احسب كم fragment تكوّن منه candidate (من نهاية الـ buffer)
 */
function countFragmentsForString(fragments, target) {
    let count = 0;
    let acc = '';
    for (let i = fragments.length - 1; i >= 0; i--) {
        acc = fragments[i] + acc;
        count++;
        if (acc === target) return count;
        if (acc.length > target.length) break;
    }
    return fragments.length; // fallback: كل الـ buffer
}

/**
 * مسح الـ buffer (للاختبارات أو إعادة الضبط)
 * Redis يتولى الـ TTL تلقائياً — لا حاجة لـ interval cleanup
 */
async function clearLetterBuffer(userId, conversationId) {
    await redisClient.del(`${REDIS_KEY_PREFIX}${userId}:${conversationId}`);
}

/**
 * عرض الـ stats (للأدمن أو التشخيص)
 */
function getStats() {
    return {
        backend: 'redis',
        ttlSeconds: TTL_SECONDS,
        minFragments: MIN_FRAGMENTS,
        minCombinedLength: MIN_COMBINED_LENGTH
    };
}

module.exports = {
    checkMultiMessageLetters,
    clearLetterBuffer,
    getStats,
    // exposed للاختبار
    _internal: {
        isEligible,
        isStopWord,
        translitArToLat,
        translitLatToAr,
        multiPassDetect
    }
};
