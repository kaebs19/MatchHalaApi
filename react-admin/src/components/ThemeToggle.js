import React, { useEffect, useState } from 'react';
import './ThemeToggle.css';

const STORAGE_KEY = 'admin-theme';

// three-state: نظام / فاتح / داكن — الافتراضي يتبع نظام التشغيل.
const ORDER = ['system', 'light', 'dark'];
const LABEL = { system: '🖥️ تلقائي', light: '☀️ فاتح', dark: '🌙 داكن' };

export const applyTheme = (theme) => {
    const root = document.documentElement;
    if (theme === 'system') {
        root.removeAttribute('data-theme');
    } else {
        root.setAttribute('data-theme', theme);
    }
};

export const readTheme = () => localStorage.getItem(STORAGE_KEY) || 'system';

function ThemeToggle() {
    const [theme, setTheme] = useState(readTheme);

    useEffect(() => {
        applyTheme(theme);
        localStorage.setItem(STORAGE_KEY, theme);
    }, [theme]);

    const next = () => setTheme(ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length]);

    return (
        <button
            className="header-icon-btn theme-toggle-btn"
            onClick={next}
            title={`المظهر: ${LABEL[theme]} — اضغط للتبديل`}
            aria-label="تبديل المظهر"
        >
            <span className="theme-icon">{LABEL[theme].split(' ')[0]}</span>
        </button>
    );
}

export default ThemeToggle;
