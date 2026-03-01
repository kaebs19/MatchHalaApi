import React, { useState } from 'react';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:5001';

/**
 * Reusable user avatar component with image fallback
 * Replaces 10+ avatar implementations across pages
 *
 * @param {Object} user - User object with name, profileImage, isPremium, verification
 * @param {string} size - Size class: 'xs' | 'sm' | 'md' | 'lg' (default: 'md')
 * @param {boolean} showBadges - Show premium/verified mini badges
 * @param {string} className - Additional class names
 */
function UserAvatar({ user, size = 'md', showBadges = false, className = '' }) {
    const [imgError, setImgError] = useState(false);

    const getImageUrl = (path) => {
        if (!path) return null;
        if (path.startsWith('http')) return path;
        return `${API_URL}${path}`;
    };

    const getInitial = (name) => {
        return name ? name.charAt(0).toUpperCase() : '?';
    };

    const imageUrl = getImageUrl(user?.profileImage);
    const hasImage = imageUrl && !imgError;

    return (
        <span style={{ position: 'relative', display: 'inline-flex' }}>
            {hasImage ? (
                <img
                    src={imageUrl}
                    alt={user?.name || ''}
                    className={`avatar avatar--${size} ${className}`}
                    onError={() => setImgError(true)}
                />
            ) : (
                <span className={`avatar avatar--${size} ${className}`}>
                    {getInitial(user?.name)}
                </span>
            )}
            {showBadges && user?.isPremium && (
                <span className="premium-badge" title="مميز">👑</span>
            )}
            {showBadges && user?.verification?.status === 'approved' && (
                <span className="verified-badge" title="موثق">✓</span>
            )}
        </span>
    );
}

export default UserAvatar;
