// MatchHala - Warning Templates
// قوالب التنبيهات الرسمية السبعة (المستخدمة في لوحة التحكم)
// يُستخدم لتوحيد الصياغة + إرسال سريع من الأدمن

const TEMPLATES = {
    photo_violation: {
        key: 'photo_violation',
        label: 'صورة مخالفة',
        icon: '🖼️',
        severity: 'warning',
        title: 'تنبيه: صورة غير مقبولة',
        body: 'الصورة المرفوعة في حسابك مخالفة لسياسة الاستخدام. يرجى تغيير الصورة فوراً، وإلا سيتم اتخاذ إجراء إداري تلقائي.',
        isBlocking: true
    },

    name_violation: {
        key: 'name_violation',
        label: 'اسم مخالف',
        icon: '📝',
        severity: 'warning',
        title: 'تنبيه: اسم غير مقبول',
        body: 'الاسم المستخدم في حسابك مخالف لسياسة المجتمع. يرجى تغييره إلى اسم مناسب خلال 24 ساعة، وإلا سيتم تعديله تلقائياً.',
        isBlocking: true
    },

    inappropriate_content: {
        key: 'inappropriate_content',
        label: 'محتوى غير لائق',
        icon: '🚫',
        severity: 'warning',
        title: 'تنبيه: محتوى غير لائق',
        body: 'تم رصد محتوى غير لائق في حسابك. نذكّرك بأن هذا التطبيق للتعارف المحترم فقط. الاستمرار سيؤدي لتقييد حسابك.',
        isBlocking: true
    },

    disruptive_behavior: {
        key: 'disruptive_behavior',
        label: 'سلوك مزعج',
        icon: '⚠️',
        severity: 'warning',
        title: 'تنبيه: سلوك مزعج',
        body: 'وردتنا بلاغات عن سلوك مزعج من حسابك (رسائل مكررة، إلحاح، إزعاج). يرجى احترام الآخرين، وإلا سنضطر لتقييد حسابك.',
        isBlocking: true
    },

    bio_violation: {
        key: 'bio_violation',
        label: 'نبذة مخالفة',
        icon: '📋',
        severity: 'warning',
        title: 'تنبيه: نبذة غير مقبولة',
        body: 'النبذة التعريفية في حسابك مخالفة لسياسة الاستخدام. يرجى تعديلها إلى نص مناسب، وإلا سيتم حذفها تلقائياً.',
        isBlocking: true
    },

    final_warning: {
        key: 'final_warning',
        label: 'تحذير أخير',
        icon: '🔴',
        severity: 'critical',
        title: '⛔ تحذير أخير قبل الإيقاف',
        body: 'هذا آخر تحذير لك قبل إيقاف حسابك نهائياً. أي مخالفة إضافية ستؤدي لحظر حسابك وجهازك بشكل دائم.',
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
 * @param {string} key
 * @returns {object|null}
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
