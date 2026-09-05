// خريطة الصفحات الموحّدة — مصدر واحد للعنوان والأيقونة والمسار والقائمة الجانبية.
// كانت العناوين سلسلة `&&` يدوية في MainLayout والقائمة مصفوفة منفصلة في Sidebar،
// فأي صفحة جديدة تُنسى في أحدهما (sensitive-content كانت بلا عنوان).

export const PAGES = {
    dashboard: { title: 'لوحة التحكم', icon: '📊', nav: true, adminOnly: false },
    users: { title: 'إدارة المستخدمين', icon: '👥', nav: true, adminOnly: true },
    'premium-users': { title: 'المشتركون', icon: '💎', parent: 'users', adminOnly: true },
    conversations: { title: 'المحادثات', icon: '💬', nav: true, adminOnly: true },
    reports: { title: 'البلاغات', icon: '⚠️', nav: true, adminOnly: true, badge: 'reports' },
    appeals: { title: 'المراجعات', icon: '📋', nav: true, adminOnly: true, badge: 'appeals' },
    newcomers: { title: 'الحسابات الجديدة', icon: '🆕', nav: true, adminOnly: true, badge: 'newcomers' },
    'banned-devices': { title: 'الأجهزة المحظورة', icon: '📵', nav: true, adminOnly: true },
    'permanent-bans': { title: 'الحسابات المحظورة دائماً', icon: '⛔', nav: true, adminOnly: true },
    analytics: { title: 'التحليلات', icon: '🔍', nav: true, adminOnly: true },
    stats: { title: 'الإحصائيات', icon: '📈', nav: true, adminOnly: true },
    'banned-words': { title: 'الكلمات المحظورة', icon: '🚫', nav: true, adminOnly: true },
    'sensitive-content': { title: 'المحتوى الحساس', icon: '🔞', nav: true, adminOnly: true },
    settings: { title: 'الإعدادات', icon: '⚙️', nav: true, adminOnly: true },

    // صفحات خارج القائمة الجانبية
    profile: { title: 'الملف الشخصي', icon: '👤', adminOnly: false },
    notifications: { title: 'الإشعارات', icon: '🔔', adminOnly: false },
    'verification-requests': { title: 'طلبات التوثيق', icon: '✅', adminOnly: true },
    'super-likes': { title: 'Super Likes', icon: '⚡', adminOnly: true },
    swipes: { title: 'Swipes', icon: '👆', adminOnly: true },
    matches: { title: 'التطابقات', icon: '💕', adminOnly: true },
    maintenance: { title: 'وضع الصيانة', icon: '🔧', adminOnly: true },

    // صفحات تفصيلية — تأخذ معرّفاً في الرابط
    'user-detail': { title: 'تفاصيل المستخدم', icon: '👤', param: 'user', parent: 'users', adminOnly: true },
    'report-conversation': { title: 'رسائل المحادثة', icon: '💬', param: 'conversation', parent: 'conversations', adminOnly: true }
};

export const DEFAULT_PAGE = 'dashboard';

export const getPage = (id) => PAGES[id] || PAGES[DEFAULT_PAGE];

export const pageTitle = (id) => {
    const p = getPage(id);
    return `${p.icon} ${p.title}`;
};

export const navItems = (isAdmin) =>
    Object.entries(PAGES)
        .filter(([, p]) => p.nav && (isAdmin || !p.adminOnly))
        .map(([id, p]) => ({ id, ...p }));
