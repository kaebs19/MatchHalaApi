import React from 'react';
import { getImageUrl, getDefaultAvatar } from '../config';
import './Sidebar.css';

function Sidebar({ currentPage, onPageChange, user, onProfileClick }) {
    const menuItems = [
        {
            id: 'dashboard',
            name: 'لوحة التحكم',
            icon: '📊',
            adminOnly: false
        },
        {
            id: 'users',
            name: 'إدارة المستخدمين',
            icon: '👥',
            adminOnly: true
        },
        {
            id: 'conversations',
            name: 'المحادثات',
            icon: '💬',
            adminOnly: true
        },
        {
            id: 'swipes',
            name: 'Swipes',
            icon: '👆',
            adminOnly: true
        },
        {
            id: 'matches',
            name: 'التطابقات',
            icon: '💕',
            adminOnly: true
        },
        {
            id: 'reports',
            name: 'البلاغات',
            icon: '⚠️',
            adminOnly: true
        },
        {
            id: 'super-likes',
            name: 'Super Likes',
            icon: '⚡',
            adminOnly: true
        },
        {
            id: 'verification-requests',
            name: 'طلبات التوثيق',
            icon: '✅',
            adminOnly: true
        },
        {
            id: 'stats',
            name: 'الإحصائيات',
            icon: '📈',
            adminOnly: true
        },
        {
            id: 'banned-words',
            name: 'الكلمات المحظورة',
            icon: '🚫',
            adminOnly: true
        },
        {
            id: 'settings',
            name: 'الإعدادات',
            icon: '⚙️',
            adminOnly: true
        }
    ];

    const isAdmin = user?.role === 'admin';

    // تمييز العنصر الصحيح حتى عند التنقل من Dashboard بمعرّف قديم
    const isActive = (itemId) => {
        if (currentPage === itemId) return true;
        if (itemId === 'users' && currentPage === 'premium-users') return true;
        return false;
    };

    return (
        <div className="sidebar">
            <div className="sidebar-header" onClick={() => onPageChange('dashboard')} style={{ cursor: 'pointer' }}>
                <img src="/favicon.svg" alt="ماتش هلا" className="sidebar-logo" />
                <h2>ماتش هلا</h2>
                <p>لوحة التحكم</p>
            </div>

            <nav className="sidebar-nav">
                {menuItems.map((item) => {
                    // إخفاء العناصر المخصصة للأدمن من المستخدمين العاديين
                    if (item.adminOnly && !isAdmin) {
                        return null;
                    }

                    return (
                        <button
                            key={item.id}
                            className={`nav-item ${isActive(item.id) ? 'active' : ''} ${item.disabled ? 'disabled' : ''}`}
                            onClick={() => !item.disabled && onPageChange(item.id)}
                            disabled={item.disabled}
                        >
                            <span className="nav-icon">{item.icon}</span>
                            <span className="nav-name">{item.name}</span>
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
