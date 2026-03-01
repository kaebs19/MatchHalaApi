import React from 'react';

/**
 * Reusable stat card component
 * Replaces: stat-card, fm-stat-card, sl-stat-card, premium-stat-card, stat-box patterns
 *
 * @param {string} icon - Emoji icon
 * @param {string|number} value - The stat value
 * @param {string} label - Description label
 * @param {string} color - Color class (purple, blue, green, orange, cyan, pink, yellow, deep-purple, light-green, gold, violet, red, danger)
 * @param {Function} onClick - Optional click handler
 * @param {string} className - Additional class names
 * @param {React.ReactNode} children - Optional extra content (e.g., plan breakdown)
 */
function StatCard({ icon, value, label, color = 'purple', onClick, className = '', children }) {
    return (
        <div
            className={`stat-card ${color} ${onClick ? 'clickable' : ''} ${className}`}
            onClick={onClick}
        >
            <div className="stat-icon">
                <span>{icon}</span>
            </div>
            <div className="stat-info">
                <h3>{value}</h3>
                <p>{label}</p>
                {children}
            </div>
        </div>
    );
}

export default StatCard;
