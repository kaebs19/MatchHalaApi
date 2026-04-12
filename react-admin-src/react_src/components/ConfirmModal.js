import React from 'react';

/**
 * Reusable confirmation modal
 * Replaces window.confirm and custom delete modals across pages
 *
 * @param {boolean} isOpen - Whether modal is visible
 * @param {Function} onClose - Close handler
 * @param {Function} onConfirm - Confirm handler
 * @param {string} title - Modal title
 * @param {string} message - Confirmation message
 * @param {string} confirmText - Confirm button text (default: "تأكيد")
 * @param {string} cancelText - Cancel button text (default: "إلغاء")
 * @param {string} variant - "danger" | "warning" | "info" (default: "danger")
 * @param {boolean} loading - Whether confirm action is in progress
 * @param {React.ReactNode} children - Optional extra content in modal body
 */
function ConfirmModal({
    isOpen,
    onClose,
    onConfirm,
    title = 'تأكيد',
    message = 'هل أنت متأكد؟',
    confirmText = 'تأكيد',
    cancelText = 'إلغاء',
    variant = 'danger',
    loading = false,
    children
}) {
    if (!isOpen) return null;

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div
                className="modal-content modal-content--sm"
                onClick={e => e.stopPropagation()}
                style={{ padding: '30px' }}
            >
                <h3 style={{ margin: '0 0 10px 0', fontSize: '22px', color: '#333', textAlign: 'center' }}>
                    {title}
                </h3>
                <p style={{ color: '#666', fontSize: '14px', margin: '0 0 25px 0', textAlign: 'center' }}>
                    {message}
                </p>
                {children}
                <div className="modal-actions" style={{ marginTop: children ? '20px' : '0' }}>
                    <button
                        className="btn-cancel"
                        onClick={onClose}
                        disabled={loading}
                    >
                        {cancelText}
                    </button>
                    <button
                        className={variant === 'danger' ? 'btn-confirm-delete' : 'btn-submit'}
                        onClick={onConfirm}
                        disabled={loading}
                        style={variant === 'danger' ? {
                            flex: 1, padding: '12px 24px', border: 'none',
                            borderRadius: '10px', fontSize: '16px', fontWeight: 600,
                            cursor: 'pointer', transition: 'all 0.3s',
                            background: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
                            color: 'white'
                        } : undefined}
                    >
                        {loading ? '...' : confirmText}
                    </button>
                </div>
            </div>
        </div>
    );
}

export default ConfirmModal;
