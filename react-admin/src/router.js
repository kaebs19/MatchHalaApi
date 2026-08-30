// راوتر صغير بالـ hash — بلا اعتمادية جديدة وبلا تعديل Nginx.
// اللوحة تُخدَّم من /admin ككل، فمسارات pushState كانت ستحتاج fallback
// على السيرفر؛ الـ hash يعمل كما هو: /admin#/users, /admin#/user/<id>.

import { useState, useEffect } from 'react';
import { PAGES, DEFAULT_PAGE } from './config/pages';

// المقطع الأول في الرابط ← معرّف الصفحة. الصفحات التفصيلية تستخدم اسماً
// مختصراً (user/conversation) ليكون الرابط مقروءاً عند مشاركته.
const SEGMENT_TO_PAGE = Object.entries(PAGES).reduce((acc, [id, p]) => {
    acc[p.param || id] = id;
    return acc;
}, {});

export const buildHash = (page, param) => {
    const meta = PAGES[page];
    if (!meta) return `#/${DEFAULT_PAGE}`;
    const segment = meta.param || page;
    return param ? `#/${segment}/${encodeURIComponent(param)}` : `#/${segment}`;
};

export const parseHash = () => {
    const raw = window.location.hash.replace(/^#\/?/, '');
    if (!raw) return { page: DEFAULT_PAGE, param: null };
    const [segment, rest] = raw.split('/');
    const page = SEGMENT_TO_PAGE[segment];
    if (!page) return { page: DEFAULT_PAGE, param: null };
    return { page, param: rest ? decodeURIComponent(rest) : null };
};

export const navigate = (page, param) => {
    const next = buildHash(page, param);
    if (window.location.hash === next) return;
    window.__adminNavDepth = (window.__adminNavDepth || 0) + 1;
    window.location.hash = next;
};

export const replace = (page, param) => {
    const next = buildHash(page, param);
    window.history.replaceState(null, '', window.location.pathname + window.location.search + next);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
};

export const goBack = (fallbackPage) => {
    // الرجوع للخلف يصحّ فقط إذا وصل الأدمن للصفحة من داخل اللوحة؛
    // من رابط مباشر يخرجه history.back() من التطبيق كلياً.
    if (window.__adminNavDepth > 0) {
        window.__adminNavDepth -= 1;
        window.history.back();
    } else {
        navigate(fallbackPage || DEFAULT_PAGE);
    }
};

// المصدر الوحيد للصفحة الحالية — الرابط نفسه، لا حالة موازية.
export const useRoute = () => {
    const [route, setRoute] = useState(parseHash);

    useEffect(() => {
        const onChange = () => setRoute(parseHash());
        window.addEventListener('hashchange', onChange);
        // فتح /admin بلا hash: ثبّت الافتراضي في الرابط ليعمل التحديث والرجوع
        if (!window.location.hash) replace(DEFAULT_PAGE);
        return () => window.removeEventListener('hashchange', onChange);
    }, []);

    return route;
};
