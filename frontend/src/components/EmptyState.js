import React from 'react';
import './EmptyState.css';

function EmptyState({
    icon = '📭',
    title = 'لا توجد بيانات',
    message = 'لم يتم العثور على أي عناصر',
    action,
    actionText = 'إضافة جديد'
}) {
    return (
        <div className="empty-state">
            <div className="empty-icon">{icon}</div>
            <h3 className="empty-title">{title}</h3>
            <p className="empty-message">{message}</p>
            {action && (
                <button onClick={action} className="empty-action-btn">
                    {actionText}
                </button>
            )}
        </div>
    );
}

export default EmptyState;
