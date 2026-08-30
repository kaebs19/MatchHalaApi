import React from 'react';
import { getImageUrl, getDefaultAvatar } from '../config';
import { navItems } from '../config/pages';
import './Sidebar.css';

function Sidebar({ currentPage, onPageChange, user, onProfileClick, badges = {}, isOpen = false, onClose }) {
    const isAdmin = user?.role === 'admin';
    const menuItems = navItems(isAdmin);

    // تمييز العنصر الصحيح حتى عند التنقل من Dashboard بمعرّف قديم
    const isActive = (itemId) => {
        if (currentPage === itemId) return true;
        if (itemId === 'users' && currentPage === 'premium-users') return true;
        return false;
    };

    return (
        <div className={`sidebar ${isOpen ? 'open' : ''}`}>
            <button className="sidebar-close-btn" onClick={onClose} aria-label="إغلاق القائمة">✕</button>
            <div className="sidebar-header" onClick={() => onPageChange('dashboard')} style={{ cursor: 'pointer' }}>
                <img src={`${process.env.PUBLIC_URL}/app-logo-v2.png`} alt="ماتش هلا" className="sidebar-logo" />
                <h2>ماتش هلا</h2>
                <p>لوحة التحكم</p>
            </div>

            <nav className="sidebar-nav">
                {menuItems.map((item) => {
                    const badgeCount = badges[item.badge || item.id] || 0;
                    return (
                        <button
                            key={item.id}
                            className={`nav-item ${isActive(item.id) ? 'active' : ''} ${item.disabled ? 'disabled' : ''}`}
                            onClick={() => !item.disabled && onPageChange(item.id)}
                            disabled={item.disabled}
                        >
                            <span className="nav-icon">{item.icon}</span>
                            <span className="nav-name">{item.title}</span>
                            {badgeCount > 0 && (
                                <span className="nav-badge">{badgeCount > 99 ? '99+' : badgeCount}</span>
                            )}
                            {item.disabled && <span className="coming-soon">قريباً</span>}
                        </button>
                    );
                })}
            </nav>

            <div className="sidebar-footer">
                <div className="user-info" onClick={onProfileClick} style={{ cursor: 'pointer' }} title="عرض الملف الشخصي">
                    <img
                        src={user?.profileImage ? getImageUrl(user.profileImage) : getDefaultAvatar(user?.name)}
                        alt={user?.name || 'User'}
                        className="user-avatar user-avatar-img"
                        onError={(e) => {
                            e.target.onerror = null;
                            e.target.src = getDefaultAvatar(user?.name);
                        }}
                    />
                    <div className="user-details">
                        <p className="user-name">{user?.name || 'Admin'}</p>
                        <p className="user-role">
                            {isAdmin ? 'مدير' : 'مستخدم'}
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default Sidebar;
