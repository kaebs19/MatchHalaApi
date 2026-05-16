// MatchHala - Warning Templates
// قوالب التنبيهات الرسمية السبعة (المستخدمة في لوحة التحكم)
// يُستخدم لتوحيد الصياغة + إرسال سريع
// ✅ الصياغة تلقائية/محايدة — لا يوجد ذكر مباشر للإدارة

const TEMPLATES = {
    photo_violation: {
        key: 'photo_violation',
        label: 'صورة مخالفة',
        icon: '🖼️',
        severity: 'warning',
        title: 'تنبيه: صورة غير مناسبة',
        body: 'اكتشف نظام الحماية التلقائي أن الصورة المرفوعة في حسابك قد تخالف سياسة الاستخدام. يُرجى تغيير الصورة فوراً لتجنّب اتخاذ إجراء تلقائي على الحساب.',
        isBlocking: true
    },

    name_violation: {
        key: 'name_violation',
        label: 'اسم مخالف',
        icon: '📝',
        severity: 'warning',
        title: 'تنبيه: اسم غير مناسب',
        body: 'رصد نظام الحماية وجود اسم مخالف لسياسة المجتمع في حسابك. يُرجى تغييره خلال 24 ساعة، وإلا سيُعدَّل تلقائياً بواسطة النظام.',
        isBlocking: true
    },

    inappropriate_content: {
        key: 'inappropriate_content',
        label: 'محتوى غير لائق',
        icon: '🚫',
        severity: 'warning',
        title: 'تنبيه: محتوى غير لائق',
        body: 'اكتشفت أنظمتنا تلقائياً وجود محتوى غير لائق في حسابك. نذكّرك بأن هذا التطبيق للتعارف المحترم، والاستمرار قد يؤدي إلى تقييد الحساب تلقائياً.',
        isBlocking: true
    },

    disruptive_behavior: {
        key: 'disruptive_behavior',
        label: 'سلوك مزعج',
        icon: '⚠️',
        severity: 'warning',
        title: 'تنبيه: نشاط غير طبيعي',
        body: 'رصد النظام نشاطاً غير طبيعي من حسابك (رسائل مكررة، إلحاح متكرر، أو بلاغات متعددة). يُرجى مراعاة آداب التعامل لتجنّب تقييد تلقائي للحساب.',
        isBlocking: true
    },

    bio_violation: {
        key: 'bio_violation',
        label: 'نبذة مخالفة',
        icon: '📋',
        severity: 'warning',
        title: 'تنبيه: نبذة غير مناسبة',
        body: 'اكتشف نظام الحماية أن النبذة التعريفية في حسابك تخالف سياسة الاستخدام. يُرجى تعديلها، وإلا ستُحذف تلقائياً من النظام.',
        isBlocking: true
    },

    external_accounts: {
        key: 'external_accounts',
        label: 'حسابات خارجية',
        icon: '🔗',
        severity: 'warning',
        title: 'تنبيه: نشر/طلب حسابات تواصل خارجية',
        body: 'رصد نظام الحماية التلقائي محاولات نشر أو طلب حسابات تواصل خارجية (سناب، انستا، واتساب، تيليجرام، أرقام تواصل، إلخ) من حسابك. سياسة المنصة تمنع ذلك صراحةً، وتكرار المحاولة سيُقيّد حسابك تلقائياً ثم يحظره نهائياً — رسائلك أمانة، حافظ على التواصل داخل التطبيق.',
        isBlocking: true
    },

    final_warning: {
        key: 'final_warning',
        label: 'تحذير أخير',
        icon: '🔴',
        severity: 'critical',
        title: '⛔ تحذير أخير قبل الإيقاف',
        body: 'هذا آخر تحذير لك قبل إيقاف الحساب تلقائياً. أي مخالفة إضافية ستؤدي لحظر الحساب والجهاز بشكل دائم بواسطة أنظمة الحماية.',
        isBlocking: true
    },

    custom: {
        key: 'custom',
        label: 'رسالة مخصصة',
        icon: '✉️',
        severity: 'info',
        title: '',
        body: '',
        isBlocking: true
    }
};

/**
 * الحصول على قالب بالمفتاح
 */
function getTemplate(key) {
    return TEMPLATES[key] || null;
}

/**
 * قائمة كل القوالب (للعرض في لوحة التحكم)
 */
function getAllTemplates() {
    return Object.values(TEMPLATES);
}

module.exports = {
    TEMPLATES,
    getTemplate,
    getAllTemplates
};
