import React, { createContext, useContext, useState, useCallback } from 'react';
import './Toast.css';

// Context للـ Toast
const ToastContext = createContext();

// Hook لاستخدام Toast في أي مكان
export const useToast = () => {
    const context = useContext(ToastContext);
    if (!context) {
        throw new Error('useToast must be used within ToastProvider');
    }
    return context;
};

// Provider Component
export const ToastProvider = ({ children }) => {
    const [toasts, setToasts] = useState([]);

    // إضافة toast جديد
    const showToast = useCallback((message, type = 'info', duration = 5000) => {
        const id = Date.now();
        const newToast = {
            id,
            message,
            type, // success, error, warning, info
            duration
        };

        setToasts(prev => [...prev, newToast]);

        // إزالة تلقائية بعد المدة المحددة
        if (duration > 0) {
            setTimeout(() => {
                removeToast(id);
            }, duration);
        }

        return id;
    }, []);

    // إزالة toast
    const removeToast = useCallback((id) => {
        setToasts(prev => prev.filter(toast => toast.id !== id));
    }, []);

    // دوال مساعدة
    const success = useCallback((message, duration) => {
        return showToast(message, 'success', duration);
    }, [showToast]);

    const error = useCallback((message, duration) => {
        return showToast(message, 'error', duration);
    }, [showToast]);

    const warning = useCallback((message, duration) => {
        return showToast(message, 'warning', duration);
    }, [showToast]);

    const info = useCallback((message, duration) => {
        return showToast(message, 'info', duration);
    }, [showToast]);

    return (
        <ToastContext.Provider value={{ showToast, success, error, warning, info, removeToast }}>
            {children}
            <ToastContainer toasts={toasts} onRemove={removeToast} />
        </ToastContext.Provider>
    );
};

// مكون عرض الـ Toasts
const ToastContainer = ({ toasts, onRemove }) => {
    return (
        <div className="toast-container">
            {toasts.map(toast => (
                <Toast key={toast.id} toast={toast} onRemove={onRemove} />
            ))}
        </div>
    );
};

// مكون Toast واحد
const Toast = ({ toast, onRemove }) => {
    const getIcon = (type) => {
        switch (type) {
            case 'success':
                return '✓';
            case 'error':
                return '✕';
            case 'warning':
                return '⚠';
            case 'info':
            default:
                return 'ℹ';
        }
    };

    return (
        <div className={`toast toast-${toast.type}`}>
            <div className="toast-icon">
                {getIcon(toast.type)}
            </div>
            <div className="toast-message">
                {toast.message}
            </div>
            <button
                className="toast-close"
                onClick={() => onRemove(toast.id)}
                aria-label="إغلاق"
            >
                ×
            </button>
        </div>
    );
};

export default ToastProvider;
