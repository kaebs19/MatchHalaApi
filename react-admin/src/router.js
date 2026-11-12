// راوتر صغير بالـ hash — بلا اعتمادية جديدة وبلا تعديل Nginx.
// اللوحة تُخدَّم من /admin ككل، فمسارات pushState كانت ستحتاج fallback
// على السيرفر؛ الـ hash يعمل كما هو: /admin#/users, /admin#/user/<id>?tab=related.

import { useState, useEffect } from 'react';
import { PAGES, DEFAULT_PAGE } from './config/pages';

// المقطع الأول في الرابط ← معرّف الصفحة. الصفحات التفصيلية تستخدم اسماً
// مختصراً (user/conversation) ليكون الرابط مقروءاً عند مشاركته.
const SEGMENT_TO_PAGE = Object.entries(PAGES).reduce((acc, [id, p]) => {
    acc[p.param || id] = id;
    return acc;
}, {});

// query صغيرة داخل الـ hash (?tab=…) — تبويب صفحة المستخدم يبقى في الرابط فيعود إليه الرجوع والتحديث
export const buildHash = (page, param, query) => {
    const meta = PAGES[page];
    if (!meta) return `#/${DEFAULT_PAGE}`;
    const segment = meta.param || page;
    const base = param ? `#/${segment}/${encodeURIComponent(param)}` : `#/${segment}`;
    const qs = query ? new URLSearchParams(Object.entries(query).filter(([, v]) => v != null && v !== '')).toString() : '';
    return qs ? `${base}?${qs}` : base;
};

export const parseHash = () => {
    const raw = window.location.hash.replace(/^#\/?/, '');
    if (!raw) return { page: DEFAULT_PAGE, param: null, query: {} };
    const [path, qs = ''] = raw.split('?');
    const [segment, rest] = path.split('/');
    const page = SEGMENT_TO_PAGE[segment];
    if (!page) return { page: DEFAULT_PAGE, param: null, query: {} };
    return {
        page,
        param: rest ? decodeURIComponent(rest) : null,
        query: Object.fromEntries(new URLSearchParams(qs))
    };
};

// ── موضع التمرير لكل رابط ──
// الانتقال للأمام يبدأ من الأعلى؛ الرجوع (زر المتصفح أو «رجوع») يعيد الموضع السابق — كانت العودة من
// صفحة مستخدم تفتح القائمة من أعلاها فيضيع مكان الأدمن.
const scrollPositions = new Map();
let forwardNav = false;

export const navigate = (page, param, query) => {
    const next = buildHash(page, param, query);
    if (window.location.hash === next) return;
    window.__adminNavDepth = (window.__adminNavDepth || 0) + 1;
    forwardNav = true;
    window.location.hash = next;
};

// تغيير الرابط بلا إدخال في السجلّ (تبديل تبويب) — لا يُطلق hashchange عمداً كي لا تُعاد الصفحة
export const replace = (page, param, query, { silent = false } = {}) => {
    const next = buildHash(page, param, query);
    window.history.replaceState(null, '', window.location.pathname + window.location.search + next);
    if (!silent) window.dispatchEvent(new HashChangeEvent('hashchange'));
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

const pathKey = (hash) => (hash || '').split('?')[0];

// يعيد موضع التمرير بعد أن تحمّل الصفحة بياناتها — يحاول حتى يصبح ارتفاعها كافياً (≤ 6 ثوانٍ؛
// قائمة المستخدمين بفلتر قد تتجاوز ثانيتين). أي تمرير/لمس من الأدمن يلغي المحاولة فلا نسحبه.
let cancelRestore = null;
const restoreScroll = (y) => {
    if (cancelRestore) cancelRestore();
    const started = Date.now();
    let stopped = false;
    const stop = () => {
        stopped = true;
        ['wheel', 'touchstart', 'keydown', 'mousedown'].forEach((ev) => window.removeEventListener(ev, stop));
        cancelRestore = null;
    };
    ['wheel', 'touchstart', 'keydown', 'mousedown'].forEach((ev) => window.addEventListener(ev, stop, { passive: true }));
    cancelRestore = stop;
    const attempt = () => {
        if (stopped) return;
        const maxY = document.documentElement.scrollHeight - window.innerHeight;
        window.scrollTo(0, Math.min(y, Math.max(0, maxY)));
        if (maxY >= y - 4 || Date.now() - started > 6000) { stop(); return; }
        requestAnimationFrame(attempt);
    };
    requestAnimationFrame(attempt);
};

// المصدر الوحيد للصفحة الحالية — الرابط نفسه، لا حالة موازية.
export const useRoute = () => {
    const [route, setRoute] = useState(parseHash);

    useEffect(() => {
        const onChange = (e) => {
            const oldPath = e && e.oldURL ? pathKey(new URL(e.oldURL).hash) : null;
            const newPath = pathKey(window.location.hash);
            // تبديل query وحده (التبويب) لا يُعدّ تنقّلاً — لا تمرير
            if (oldPath && oldPath !== newPath) {
                scrollPositions.set(oldPath, window.scrollY);
                if (forwardNav) {
                    if (cancelRestore) cancelRestore();
                    window.scrollTo(0, 0);
                } else if (scrollPositions.has(newPath)) {
                    restoreScroll(scrollPositions.get(newPath));
                } else {
                    window.scrollTo(0, 0);
                }
            }
            forwardNav = false;
            setRoute(parseHash());
        };
        window.addEventListener('hashchange', onChange);
        // فتح /admin بلا hash: ثبّت الافتراضي في الرابط ليعمل التحديث والرجوع
        if (!window.location.hash) replace(DEFAULT_PAGE);
        return () => window.removeEventListener('hashchange', onChange);
    }, []);

    return route;
};
