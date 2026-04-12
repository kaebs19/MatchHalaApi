/**
 * Shared date formatting and utility functions
 */

/**
 * Format date in Arabic - short month (no time)
 * Used in: Dashboard, ConversationMessages, Conversations, PremiumUsers, Users
 */
export const formatDate = (dateString) => {
    if (!dateString) return '-';
    const date = new Date(dateString);
    return date.toLocaleDateString('ar-SA', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
    });
};

/**
 * Format date with time in Arabic
 * Used in: FlaggedMessages, SuperLikes, VerificationRequests
 */
export const formatDateTime = (dateString) => {
    if (!dateString) return '-';
    const date = new Date(dateString);
    return date.toLocaleDateString('ar-SA', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
};

/**
 * Format date in Arabic - long month (no time)
 * Used in: Dashboard
 */
export const formatDateLong = (dateString) => {
    if (!dateString) return '-';
    const date = new Date(dateString);
    return date.toLocaleDateString('ar-SA', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });
};

/**
 * Get relative time in Arabic (e.g., "ينتهي خلال 5 أيام")
 * Used in: PremiumUsers
 */
export const getRelativeTime = (dateString) => {
    if (!dateString) return '';
    const now = new Date();
    const date = new Date(dateString);
    const diffMs = date - now;
    const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays < 0) {
        const absDays = Math.abs(diffDays);
        if (absDays === 0) return 'انتهى اليوم';
        if (absDays === 1) return 'انتهى أمس';
        if (absDays < 30) return `انتهى منذ ${absDays} يوم`;
        const months = Math.floor(absDays / 30);
        return `انتهى منذ ${months} شهر`;
    } else {
        if (diffDays === 0) return 'ينتهي اليوم';
        if (diffDays === 1) return 'ينتهي غداً';
        if (diffDays < 30) return `ينتهي خلال ${diffDays} يوم`;
        const months = Math.floor(diffDays / 30);
        return `ينتهي خلال ${months} شهر`;
    }
};

/**
 * Format date for datetime-local input
 * Used in: PremiumUsers edit modal
 */
/**
 * Format date in Arabic - long month with time
 * Used in: UserDetail, ConversationDetail
 */
export const formatDateTimeLong = (dateString) => {
    if (!dateString) return '-';
    const date = new Date(dateString);
    return date.toLocaleDateString('ar-SA', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
};

/**
 * Format date for datetime-local input
 * Used in: PremiumUsers edit modal
 */
export const formatDateTimeLocal = (dateString) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    const pad = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};
