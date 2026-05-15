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
    { regex: /\bsnap[._\-]chat\b/gi, category: 'snap' },                 // snap_chat، snap-chat، snap.chat
    { regex: /\bsanp\b/gi, category: 'snap' },                           // typo شائع
    { regex: /سناب[؀-ۿ]*/g, category: 'snap' },
    // اسم شعبي للـ Snapchat (الشعار أصفر) — مربوط بـ "البرنامج/التطبيق" لتجنب false positives
    { regex: /(?:البرنامج|التطبيق|تطبيق|برنامج)\s+ال[أإاآ]صفر/g, category: 'snap' },
    { regex: /(?:https?:\/\/)?(?:www\.)?snapchat\.com\/[^\s,]*/gi, category: 'snap_url' },
    { regex: /(?:https?:\/\/)?snap(?:chat)?\.app\.link\/[^\s,]*/gi, category: 'snap_url' },

    // ─── Instagram ───
    { regex: /\binstagram\b/gi, category: 'instagram' },
    { regex: /\binsta(?:gram)?\w*\b/gi, category: 'instagram' },
    { regex: /\binst[ae]?gr[ae]?m\b/gi, category: 'instagram' },         // typos: instgrm, instagrm, instgram
    { regex: /\bigtv\b/gi, category: 'instagram' },
    // lookbehind: ليس قبل حرف عربي (يحمي "استأنست"، "استانستو"، "استئناس" من false positive)
    // ✅ يشمل كل أشكال الهمزة في البداية: أ/إ/ا/آ
    { regex: /(?<![؀-ۿ])[أإاآ]نست[؀-ۿ]*/g, category: 'instagram' },
    { regex: /(?:https?:\/\/)?(?:www\.)?instagram\.com\/[^\s,]*/gi, category: 'instagram_url' },
    { regex: /(?:https?:\/\/)?(?:www\.)?ig\.me\/[^\s,]*/gi, category: 'instagram_url' },

    // ─── Telegram ───
    { regex: /\btel[ei]?gr[ae]?m\b/gi, category: 'telegram' },           // telegram, telgram, telegrm, teligram
    // عربي شامل: تلجرام، تليجرام، تليغرام، تلقرام، تلكرام، تيليجرام
    { regex: /ت[يى]?ل[يى]?[جغقك]رام[؀-ۿ]*/g, category: 'telegram' },
    { regex: /(?:https?:\/\/)?t\.me\/[^\s,]*/gi, category: 'telegram_url' },

    // ─── TikTok ───
    { regex: /\bti[ck]\s*to[ck]\b/gi, category: 'tiktok' },              // tiktok, tictoc, tic toc
    { regex: /\btikok\b/gi, category: 'tiktok' },                        // typo
    { regex: /ت[يى]?ك\s*[_\-]?\s*توك[؀-ۿ]*/g, category: 'tiktok' },        // تيك توك، تك توك، تيك_توك

    // ─── WhatsApp (الأكثر استخداماً للـ funnel-out) ───
    { regex: /\bwhats?app\b/gi, category: 'whatsapp' },
    { regex: /\bwhats?ap\b/gi, category: 'whatsapp' },
    { regex: /\bwhts?app?\b/gi, category: 'whatsapp' },                  // whtsapp, whtsap typos
    // واتس/واتساب — يجب ألا يتبعها حرف عربي (يحمي "تسبحين/تسوينها/تسويق" من false positive)
    // ملاحظة: \b لا يعمل مع العربية في JS regex، نستخدم lookahead بدلاً منه
    // lookbehind: ليس قبل "و" حرف عربي (يحمي من aggressive merging مثل "شنو تسوي" → "شنوتسوي")
    { regex: /(?<![؀-ۿ])و[أإاآ]?تس(?:[\s]?[أإاآ]?ب(?![؀-ۿ])|(?![؀-ۿ]))/g, category: 'whatsapp' },
    // ✅ "الواتس" / "الواتساب" — استثناء صريح للـ "ال" التعريف (lookbehind يمنعها)
    { regex: /(?<![؀-ۿ])الو[أإاآ]?تس(?:[\s]?[أإاآ]?ب(?![؀-ۿ])|(?![؀-ۿ]))/g, category: 'whatsapp' },
    { regex: /(?:https?:\/\/)?(?:wa\.me|api\.whatsapp\.com|chat\.whatsapp\.com)\/[^\s,]*/gi, category: 'whatsapp_url' },

    // ─── Zinji (تطبيق مشاركة أرقام شائع في السعودية والخليج) ───
    // يغطي: zinji, zenji, zanji, zonji + variations عربية: زنجي، زانجي، زآنجي
    { regex: /\bz[aeio]n[jq]i\b/gi, category: 'zinji' },
    { regex: /ز[أإاآ]*ن[جق]ي[؀-ۿ]*/g, category: 'zinji' },
    // روابط Zinji بكل الـ TLDs (com, app, me, net, io)
    { regex: /(?:https?:\/\/)?(?:www\.)?z[aeio]n[jq]i\.[a-z]{2,4}\/?[^\s,]*/gi, category: 'zinji_url' },

    // ─── Discord (صاعد بين الشباب) ───
    { regex: /\bd[i]?sc[o]?rd?\b/gi, category: 'discord' },              // discord, dscord, discrd, dscrd, discor
    { regex: /د[يى]?سكور[د]?[؀-ۿ]*/g, category: 'discord' },               // ديسكورد، دسكورد، دسكور
    { regex: /(?:https?:\/\/)?(?:www\.)?discord\.gg\/[^\s,]*/gi, category: 'discord_url' },

    // ─── Kik / Tellonym / X (Twitter) ───
    { regex: /\bkik\b/gi, category: 'kik' },
    { regex: /\btw[ei]+t+e?r\b/gi, category: 'twitter' },                // twitter, twiter, tweeter, twitr
    { regex: /تويتر[؀-ۿ]*/g, category: 'twitter' },
    // X (Twitter الجديد) — domain فقط، تجنب false positives لكلمات تحتوي x
    { regex: /(?:https?:\/\/)?(?:www\.)?x\.com\/[^\s,]*/gi, category: 'twitter_url' },
    { regex: /(?:https?:\/\/)?(?:www\.)?twitter\.com\/[^\s,]*/gi, category: 'twitter_url' },

    // ─── Email addresses ───
    { regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, category: 'email' },

    // ─── Phone numbers + Zinji IDs (6+ متتالية لكشف معرفات قصيرة) ───
    // International مع +
    { regex: /\+\d{1,3}[\s-]?\d{2,4}[\s-]?\d{2,4}[\s-]?\d{2,4}/g, category: 'phone' },
    // Saudi mobile (05xxxxxxxx) + variations
    { regex: /\b05\d{8}\b/g, category: 'phone' },
    { regex: /\b9665\d{8}\b/g, category: 'phone' },
    // مع separators — مستثناة التواريخ (YYYY-MM-DD, DD-MM-YYYY, YYYY.MM.DD)
    { regex: /\b(?!(?:19|20)\d{2}[\-\/\.]\d{1,2}[\-\/\.]\d{1,2}\b)(?!\d{1,2}[\-\/\.]\d{1,2}[\-\/\.](?:19|20)\d{2}\b)\d{2,4}[\s\-]\d{2,4}[\s\-]\d{2,4}(?:[\s\-]\d{2,4})?\b/g, category: 'phone' },
    // ✅ 6+ digits متتالية (يكشف Zinji IDs مثل 7421886321)
    { regex: /\b\d{6,15}\b/g, category: 'phone' },
    // Arabic-Indic digits (٠١٢٣٤٥٦٧٨٩) — 6+ متتالية أو مع spaces
    { regex: /[٠-٩]{6,}/g, category: 'phone' },
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
    // Strip diacritics — Latin (U+0300-036F) + Arabic (U+064B-065F + U+0670)
    t = t.replace(/[̀-ͯ]/g, '');
    t = t.replace(/[ً-ٰٟ]/g, '');
    // Strip zero-width + invisible separators + soft hyphen (U+00AD)
    t = t.replace(/­/g, '');
    t = t.replace(/[​-‏‪-‮⁠-⁯﻿]/g, '');
    // Strip Arabic tatweel
    t = t.replace(/ـ/g, '');
    // ✅ توحيد الألف العربية: أ، إ، آ، ٱ → ا (يحمي ضد التحايل بالهمزات)
    t = t.replace(/[أإآٱ]/g, 'ا');
    // ✅ توحيد التاء المربوطة → هـ (يساعد على المطابقة الـ phonetic)
    // ملاحظة: لا نوحّد ي/ى لأنها قد تغيّر معاني صحيحة
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
    // ✅ تحويل الإيموجيات إلى مسافات (تكتيك التخفّي s🔥n🔥a🔥p)
    // نطاقات: Misc Symbols, Dingbats, Emoji ranges, Symbols & Pictographs
    t = t.replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{1F300}-\u{1F9FF}]/gu, ' ');
    t = t.replace(/(.)\1+/g, '$1');   // collapse ALL repeats to 1
    // Strip separators BETWEEN letters فقط (Latin + Arabic) — لا تأثير على الأرقام
    // مثلاً: s.n.a.p → snap، ا ن س ت ا → انستا، سن//اب → سناب (لكن 050-123 يبقى لأنه أرقام)
    // ✅ separators المدعومة: space . _ - / (يشمل // وَ /// كحالات تخفّي شائعة)
    const letterPair = /([a-z؀-ۿ])[\s._\-\/]+([a-z؀-ۿ])/g;
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
    { regex: /\bz[\s._\-]+[ieao][\s._\-]+n[\s._\-]+[jq][\s._\-]+i\b/gi, category: 'zinji' },
    // Arabic spaced — س ن ا ب / ا ن س ت ا (يدعم separators: مسافة / . _ - / //)
    // ✅ يدعم كل أشكال الهمزة [أإاآ] في البداية والنهاية
    { regex: /س[\s._\-\/]+ن[\s._\-\/]+[أإاآ][\s._\-\/]+ب/g, category: 'snap' },
    { regex: /[أإاآ][\s._\-\/]+ن[\s._\-\/]+س[\s._\-\/]+ت[\s._\-\/]+[أإاآ]/g, category: 'instagram' },
    { regex: /و[\s._\-\/]+[أإاآ][\s._\-\/]+ت[\s._\-\/]+س/g, category: 'whatsapp' },
    { regex: /ز[\s._\-\/]*[أإاآ]?[\s._\-\/]+ن[\s._\-\/]+[جق][\s._\-\/]+ي/g, category: 'zinji' },
    // Leet speak — drop \b ليلتقط !nsta و 5nap في بداية النص
    { regex: /5n[a4]p/gi, category: 'snap' },
    { regex: /[1!]nst[a4]/gi, category: 'instagram' },
];

// ═══════════════════════════════════════════════════════════════
// ID Label Patterns — كشف اسم المستخدم بدون ذكر المنصة
// ═══════════════════════════════════════════════════════════════
// يتطلب username "مميز" (يحتوي digit/separator أو @)
// لا يطابق الأسماء العادية مثل "اسمي عمر" أو "my name is John"
//
// Username pattern: alternative — أي واحد من:
//   - @ + 4-30 chars
//   - يحتوي . _ - (multi-segment مثل ahmed.kw)
//   - يحتوي رقم (مثل omar1990)
const USERNAME_TOKEN = '(?:@[A-Za-z0-9_][A-Za-z0-9._-]{2,29}|[A-Za-z0-9]+[._-][A-Za-z0-9._-]+|[A-Za-z]+\\d+\\w*|\\d+[A-Za-z]+\\w*)';

const ID_LABEL_PATTERNS = [
    // English labels: id|username|user_name|handle|nick(name)|account + connectors
    // connectors: : = is (is بين الـ label والـ username — "my handle is omar.k")
    new RegExp(`\\b(?:id|username|user[\\s_]?name|handle|nick(?:name)?|account)\\s*(?:[:=]|\\s+is)\\s*${USERNAME_TOKEN}\\b`, 'gi'),
    // Arabic labels + connectors: اسمي|حسابي|يوزري|معرفي|ايديي + (هو|=|:)
    new RegExp(`(?:اسمي|حسابي|يوزري|يوزرنيمي|يوزر|معرفي|ايديي|ايدي)\\s*(?:[:=،]|\\s+هو|\\s+هي|\\s)\\s*${USERNAME_TOKEN}\\b`, 'g'),
    // Imperatives: اضفني|تابعني|ابحثني|ضيفني|اضافتي
    new RegExp(`(?:اضفني|تابعني|ابحثني|ضيفني|اضافتي|اضيفك)\\s*[:،]?\\s*${USERNAME_TOKEN}\\b`, 'g'),
    new RegExp(`ابحث\\s*عن\\s*${USERNAME_TOKEN}\\b`, 'g'),
    // Standalone @username — في بداية الكلمة فقط (يتجنب emails)
    new RegExp(`(?:^|[\\s,،.!])@([A-Za-z][A-Za-z0-9._-]{3,29})\\b`, 'g'),
];

/**
 * Tail Censoring: يكتم اسم المستخدم بعد ذكر المنصة
 *   "snap: ahmed_19" → "***  ***"
 *   "تلجرام @omar.kw" → "***  ***"
 *
 * يتطلب username pattern مميز (digits/separators) — لا يكتم كلمات إنجليزية بريئة.
 * مثل "snap is great" لا يُكتم.
 */
function censorPlatformTails(originalText, redacted) {
    let result = redacted;
    // username patterns: @handle، أو يحتوي . _ - أو يحتوي أرقام
    const tailRegex = /^([\s:@>←→=|,،\-]{1,5})((?:@[A-Za-z0-9_][A-Za-z0-9._-]{2,29})|(?:[A-Za-z0-9]+[._-][A-Za-z0-9._-]+)|(?:[A-Za-z]+\d+\w*)|(?:\d+[A-Za-z]+\w*))/;

    for (const { regex, category } of PATTERNS) {
        // skip URL patterns (تشمل الـ URL كاملاً)، و phone/email (لها معالجة خاصة)
        if (category.endsWith('_url') || category === 'phone' || category === 'email') continue;
        regex.lastIndex = 0;
        let m;
        while ((m = regex.exec(originalText)) !== null) {
            const end = m.index + m[0].length;
            const tail = originalText.slice(end, end + 80);
            const tailMatch = tail.match(tailRegex);
            if (tailMatch) {
                const fullSegment = tailMatch[0];   // separator + username
                if (result.includes(fullSegment)) {
                    result = result.replace(fullSegment, ' ***');
                }
            }
        }
    }
    return result;
}

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

    // Pass 2a: Light normalize — يكشف Unicode tricks مع المحافظة على المسافات
    // (math bold، fullwidth، diacritics، hamza، Arabic-Indic digits)
    // مهم: يحافظ على \b بين الكلمات — يكشف "ｓｎａｐ ahmed.kw"
    const lightNorm = normalizeForDetection(text);
    if (lightNorm !== text.toLowerCase()) {
        for (const { regex, category } of PATTERNS) {
            if (category === 'phone' || category === 'email') continue;
            regex.lastIndex = 0;
            if (regex.test(lightNorm)) {
                if (!categories.has(category.replace(/_url$/, ''))) {
                    matched.push(`[unicode:${category}]`);
                    categories.add(category.replace(/_url$/, ''));
                    redacted = '***';   // unicode trickery → نص كامل مشبوه
                }
            }
        }
    }

    // Pass 2b: Aggressive normalized (يكسر التخفّي بـ separators/repeats/emojis)
    // ⚠️ نستثني phone/email — aggressive يحذف separators ويحوّل التواريخ/الإيميلات إلى digits/text متتالية
    const aggressive = aggressiveNormalize(text);
    if (aggressive !== text.toLowerCase()) {
        for (const { regex, category } of PATTERNS) {
            if (category === 'phone' || category === 'email') continue;
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

    // Pass 4: Tail censoring — يكتم اسم المستخدم بعد المنصة (snap: ahmed_19 → *** ***)
    // فقط لو في detected match وما تم استبدال النص كاملاً (Pass 2 aggressive)
    if (matched.length > 0 && redacted !== '***') {
        redacted = censorPlatformTails(text, redacted);
    }

    // Pass 5: ID Labels — يكشف اسم المستخدم بدون ذكر منصة
    // مثل: "id: omar1990" / "اسمي ahmed.kw" / "اضفني @user_19" / "@omar.k"
    for (const regex of ID_LABEL_PATTERNS) {
        regex.lastIndex = 0;
        const matches = text.match(regex);
        if (matches && matches.length > 0) {
            matched.push(...matches.map(m => `[id-share]${m}`));
            categories.add('id_share');
            for (const m of matches) {
                redacted = redacted.replace(m, '***');
            }
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

const SOFT_THRESHOLD = 5;     // 5 violations → تقييد تدريجي
const HARD_THRESHOLD = 10;    // 10 violations في دورة واحدة → suspension 7 أيام (نادر)
const DECAY_WINDOW_DAYS = 7;  // counter violations يتصفّر بعد 7 أيام بدون مخالفات
const LOCK_DECAY_DAYS = 90;   // lockCount يتصفّر بعد 90 يوم من حسن السلوك
const SUSPENSION_DURATION_DAYS = 7;

/**
 * ✅ نظام التصعيد التدريجي: مدة التقييد حسب عدد التقييدات السابقة
 *    أول مرة (lockCount=1)  → 24h
 *    ثاني مرة (lockCount=2) → 48h
 *    ثالث مرة (lockCount=3) → 72h
 *    رابع مرة+ (lockCount≥4) → تعليق 7 أيام
 */
function calculateLockHours(lockCount) {
    if (lockCount <= 0) return 24;
    if (lockCount >= 4) return SUSPENSION_DURATION_DAYS * 24; // 7 أيام
    return lockCount * 24; // 24, 48, 72
}

/**
 * صياغة نص المدة بالعربية (24 ساعة / يومان / 3 أيام / أسبوع)
 */
function formatDurationArabic(hours) {
    if (hours < 48) return '24 ساعة';
    if (hours === 48) return 'يومين (48 ساعة)';
    if (hours === 72) return '3 أيام (72 ساعة)';
    if (hours >= 24 * 7) return 'أسبوع كامل';
    const days = Math.round(hours / 24);
    return `${days} أيام`;
}

/**
 * تسجيل violation للترويج الخارجي + تطبيق العقوبات التدريجية
 * @param {Object} user - mongoose User document (يجب أن يكون قابلاً للحفظ)
 * @param {Object} [logContext] - { source: 'bio'|'message'|'name', categories, patterns, conversationId }
 *                                لتسجيل تفاصيل الـ analytics — اختياري
 * @returns {Object} { violations, lockApplied, suspended, message }
 */
async function recordExternalPromoViolation(user, logContext = null) {
    // ─── Analytics log + Violation record (fire-and-forget) ───
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
        } catch (err) {/* غير حرج */}

        // ✅ سجل Violation رسمي (يظهر في admin → User → سجل المخالفات)
        // مع الدليل (النص الأصلي + المنصات المكتشفة)
        try {
            const Violation = require('../models/Violation');
            const evidenceKind =
                logContext.source === 'message' ? 'message' :
                logContext.source === 'bio'     ? 'bio' :
                logContext.source === 'name'    ? 'name' : 'text';

            const reasonText = `نشر/طلب حسابات خارجية: ${logContext.categories.join(', ')}`;

            Violation.create({
                user: user._id,
                type: 'external_promo',
                reason: reasonText,
                action: 'warning',
                source: 'external_promo_filter',
                evidence: {
                    kind: evidenceKind,
                    text: logContext.originalText || (logContext.patterns || []).join(' · '),
                    messageId: logContext.messageId || null,
                    conversationId: logContext.conversationId || null,
                    metadata: {
                        categories: logContext.categories,
                        matchedPatterns: logContext.patterns,
                        violationCount: (user.externalPromo?.violations || 0) + 1
                    }
                }
            }).catch(err => {
                if (process.env.NODE_ENV !== 'production') {
                    console.error('⚠️ Violation create failed:', err.message);
                }
            });
        } catch (err) {/* غير حرج */}
    }

    const now = new Date();
    if (!user.externalPromo) {
        user.externalPromo = {
            violations: 0, lastViolationAt: null,
            bioLockedUntil: null, suspendedAt: null,
            lockCount: 0, lastLockAt: null
        };
    }
    // backfill للحقول الجديدة لو المستخدم قديم
    if (typeof user.externalPromo.lockCount !== 'number') user.externalPromo.lockCount = 0;

    // ─── Decay violations: لو آخر violation > 7 أيام، صفّر العداد ───
    const decayCutoff = new Date(now.getTime() - DECAY_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    if (!user.externalPromo.lastViolationAt || user.externalPromo.lastViolationAt < decayCutoff) {
        user.externalPromo.violations = 0;
    }

    // ─── Decay lockCount: 90 يوم بدون أي تقييد → ارجع للبداية ───
    if (user.externalPromo.lastLockAt) {
        const lockDecayCutoff = new Date(now.getTime() - LOCK_DECAY_DAYS * 24 * 60 * 60 * 1000);
        if (user.externalPromo.lastLockAt < lockDecayCutoff) {
            user.externalPromo.lockCount = 0;
        }
    }

    user.externalPromo.violations += 1;
    user.externalPromo.lastViolationAt = now;

    let lockApplied = false;
    let suspended = false;
    let message = null;
    let durationHours = 0;

    // HARD threshold (نفس الدورة 10 مخالفات): suspension طارئ 7 أيام
    if (user.externalPromo.violations >= HARD_THRESHOLD) {
        const suspensionUntil = new Date(now.getTime() + SUSPENSION_DURATION_DAYS * 24 * 60 * 60 * 1000);
        user.suspension = user.suspension || {};
        user.suspension.isSuspended = true;
        user.suspension.suspendedAt = now;
        user.suspension.suspendedUntil = suspensionUntil;
        user.suspension.reason = 'external_promotion_repeat';
        user.suspension.adminMessage = 'تم تعليق الحساب بسبب نشر حسابات خارجية';
        user.externalPromo.suspendedAt = now;
        // كاش العدّاد لكنه يبقى في صفّ التصعيد التالي
        user.externalPromo.lockCount += 1;
        user.externalPromo.lastLockAt = now;
        user.externalPromo.violations = 0;  // reset للدورة التالية
        suspended = true;
        durationHours = SUSPENSION_DURATION_DAYS * 24;
        message = `تم تعليق حسابك أسبوعاً بسبب التكرار في نشر حسابات خارجية. الالتزام بسياسة المنصة يحمي حسابك من الحظر الدائم.`;
    }
    // SOFT threshold: lock تدريجي حسب lockCount
    else if (user.externalPromo.violations >= SOFT_THRESHOLD) {
        user.externalPromo.lockCount += 1;
        const newLockCount = user.externalPromo.lockCount;
        durationHours = calculateLockHours(newLockCount);

        // التقييد الرابع فأكثر → suspension بدلاً من lock
        if (durationHours >= SUSPENSION_DURATION_DAYS * 24) {
            const suspensionUntil = new Date(now.getTime() + durationHours * 60 * 60 * 1000);
            user.suspension = user.suspension || {};
            user.suspension.isSuspended = true;
            user.suspension.suspendedAt = now;
            user.suspension.suspendedUntil = suspensionUntil;
            user.suspension.reason = 'external_promotion_repeat';
            user.suspension.adminMessage = `تم تعليق الحساب (تقييد رقم ${newLockCount}) بسبب تكرار نشر حسابات خارجية`;
            user.externalPromo.suspendedAt = now;
            suspended = true;
            message = `تم تعليق حسابك ${formatDurationArabic(durationHours)} — هذا التقييد رقم ${newLockCount}. الالتزام بسياسة المنصة يحمي حسابك من الحظر الدائم.`;
        } else {
            // lock عادي 24/48/72 ساعة
            const lockUntil = new Date(now.getTime() + durationHours * 60 * 60 * 1000);
            user.externalPromo.bioLockedUntil = lockUntil;
            if (!user.restrictions) user.restrictions = {};
            user.restrictions.messagingRestricted = true;
            user.restrictions.messagingRestrictedUntil = lockUntil;
            user.restrictions.messagingRestrictedLevel = 'all';
            user.restrictions.restrictionReason = 'external_promotion';
            lockApplied = true;
            message = `تم تقييد حسابك ${formatDurationArabic(durationHours)} بسبب تكرار نشر حسابات خارجية — هذا التقييد رقم ${newLockCount}. الالتزام بسياسة المنصة يحمي حسابك من الحظر الدائم.`;
        }

        user.externalPromo.lastLockAt = now;
        user.externalPromo.violations = 0;  // reset للدورة التالية
    }
    // قبل الوصول للعتبة: تحذير وقائي
    else {
        message = 'تم التعرف تلقائياً على مشاركة حساب خارجي. سياسة المنصة تمنع نشر أو طلب الحسابات والأرقام، وتكرار ذلك يقيّد حسابك تلقائياً — رسائلك أمانة، حافظ على التواصل داخل التطبيق.';
    }

    await user.save();

    return {
        violations: user.externalPromo.violations,
        threshold: SOFT_THRESHOLD,
        lockCount: user.externalPromo.lockCount,
        durationHours,
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
