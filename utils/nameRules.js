// قواعد اسم العرض — تسمح بالزخرفة والإيموجي (طلب المالك ٢٠ نوفمبر ٢٠٢٦)
//
// كانت القاعدة /^[؀-ۿa-zA-Z\s]+$/ ترفض أي إيموجي أو زخرفة أو رقم برسالة مبهمة «خطأ في البيانات المُدخلة»
// (37 رفضاً لتعديل الملف في يوم واحد). الآن: أي حروف ورموز وإيموجي، مع حدود تمنع الإساءة:
//   - 2 إلى 30 «حرفاً مرئياً» (grapheme) — الإيموجي المركّب يُعدّ واحداً
//   - حرف واحد على الأقل (لا اسم من رموز فقط)
//   - لا محارف تحكّم/تنسيق مخفية (إلا الواصل والفاصل الصفريين ومحدّد الإيموجي — يحتاجها الإيموجي والفارسية)
//   - لا «زالغو» (علامات تشكيل متراكبة فوق الحدّ) ولا 5 أرقام متتالية (أرقام هواتف)
// ⚠️ الزخرفة (𝓢𝓷𝓪𝓹، ｓｎａｐ) قد تتهرّب من فلاتر الكلمات والترويج — فحصها على normalizeForChecks أيضاً.

const MIN_GRAPHEMES = 2;
const MAX_GRAPHEMES = 30;
const MAX_COMBINING = 10;

const segmenter = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter('ar', { granularity: 'grapheme' }) : null;
const graphemeCount = (s) => (segmenter ? [...segmenter.segment(s)].length : [...s].length);

// محارف التحكم والتنسيق (\p{C}) ممنوعة إلا: ZWNJ U+200C، ZWJ U+200D، VS16 U+FE0F، ووسوم الأعلام U+E0020–E007F
const HIDDEN_RE = /(?![‌‍️\u{E0020}-\u{E007F}])\p{C}/u;

/** نسخة للفحص: تفكّ الزخرفة الشائعة (NFKC يحوّل 𝓢 و ｓ و ① إلى أصلها) وتزيل الرموز والتشكيل والمسافات الزائدة */
function normalizeForChecks(name) {
    return String(name || '')
        .normalize('NFKC')
        .replace(/[\p{M}ـ]/gu, '')            // تشكيل وتطويل
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')         // رموز وإيموجي ← مسافة
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

/** يُرجع null إن كان الاسم مقبولاً، وإلا رسالة الخطأ */
function nameProblem(raw) {
    const name = String(raw || '').trim();
    if (!name) return 'الاسم مطلوب';
    if (HIDDEN_RE.test(name)) return 'الاسم يحتوي على محارف مخفية غير مسموحة';
    const n = graphemeCount(name);
    if (n < MIN_GRAPHEMES) return `الاسم قصير جداً — ${MIN_GRAPHEMES} أحرف على الأقل`;
    if (n > MAX_GRAPHEMES) return `الاسم طويل — ${MAX_GRAPHEMES} حرفاً كحد أقصى (الإيموجي يُعدّ حرفاً)`;
    if (!/\p{L}/u.test(name.normalize('NFKC'))) return 'الاسم يجب أن يحتوي على حرف واحد على الأقل';
    if ((name.match(/\p{M}/gu) || []).length > MAX_COMBINING) return 'الاسم يحتوي على علامات متراكبة كثيرة';
    if (/\p{Nd}{5,}/u.test(name.normalize('NFKC').replace(/\s/g, ''))) return 'لا يُسمح بأرقام طويلة في الاسم';
    return null;
}

module.exports = { nameProblem, normalizeForChecks, MIN_GRAPHEMES, MAX_GRAPHEMES };
