import React from 'react';

/**
 * Shared badge helper functions
 * Return JSX with shared CSS classes from badges.css
 */

/**
 * Severity badge (high/medium/low)
 * Used in: FlaggedMessages
 */
export const getSeverityBadge = (severity) => {
    switch (severity) {
        case 'high':
            return <span className="severity-badge high">عالية</span>;
        case 'medium':
            return <span className="severity-badge medium">متوسطة</span>;
        case 'low':
            return <span className="severity-badge low">منخفضة</span>;
        case 'critical':
            return <span className="severity-badge critical">حرجة</span>;
        default:
            return <span className="severity-badge">-</span>;
    }
};

/**
 * Chat type badge (room/conversation)
 * Used in: FlaggedMessages
 */
export const getChatTypeBadge = (chatType) => {
    return chatType === 'room'
        ? <span className="type-badge room">غرفة</span>
        : <span className="type-badge conversation">محادثة</span>;
};

/**
 * Verification status badge
 * Used in: VerificationRequests
 */
export const getVerificationStatusBadge = (status) => {
    switch (status) {
        case 'pending':
            return <span className="badge badge-pending">قيد الانتظار</span>;
        case 'approved':
            return <span className="badge badge-approved">مقبول</span>;
        case 'rejected':
            return <span className="badge badge-rejected">مرفوض</span>;
        default:
            return <span className="badge">{status}</span>;
    }
};

/**
 * Conversation status badge
 * Used in: SuperLikes
 */
export const getConversationStatusBadge = (conversation) => {
    if (!conversation) return <span className="badge badge-none">لا يوجد محادثة</span>;
    switch (conversation.status) {
        case 'accepted':
            return <span className="badge badge-accepted">مقبولة</span>;
        case 'pending':
            return <span className="badge badge-pending">معلقة</span>;
        case 'rejected':
            return <span className="badge badge-rejected">مرفوضة</span>;
        default:
            return <span className="badge badge-none">{conversation.status}</span>;
    }
};

/**
 * User active status badge
 * Used in: Users
 */
export const getActiveStatusBadge = (isActive) => {
    return isActive ? (
        <span className="badge badge-success">نشط ✓</span>
    ) : (
        <span className="badge badge-danger">غير نشط</span>
    );
};

/**
 * Plan badge (weekly/monthly/quarterly)
 * Used in: PremiumUsers
 */
export const getPlanBadge = (plan) => {
    switch (plan) {
        case 'weekly':
            return <span className="badge-weekly">أسبوعي</span>;
        case 'monthly':
            return <span className="badge-monthly">شهري</span>;
        case 'quarterly':
            return <span className="badge-quarterly">ربع سنوي</span>;
        default:
            return <span className="badge badge-none">{plan}</span>;
    }
};
