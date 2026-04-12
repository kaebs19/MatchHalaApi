import React, { useState, useEffect, useCallback } from 'react';
import { getNotifications, markNotificationAsRead, markAllNotificationsAsRead, deleteNotification } from '../services/api';
import { useToast } from '../components/Toast';
import './Notifications.css';

function Notifications({ onNotificationRead }) {
    const { showToast } = useToast();
    const [notifications, setNotifications] = useState([]);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState('all'); // all, unread, read
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [stats, setStats] = useState({ total: 0, unread: 0 });

    const fetchNotifications = useCallback(async () => {
        setLoading(true);
        try {
            const params = { page, limit: 20 };
            if (filter === 'unread') params.unreadOnly = true;

            const response = await getNotifications(params);
            if (response.success) {
                setNotifications(response.data.notifications);
                setTotalPages(response.data.pagination?.pages || 1);
                setStats({
                    total: response.data.pagination?.total || 0,
                    unread: response.data.unreadCount || 0
                });
            }
        } catch (error) {
            showToast('فشل في جلب الإشعارات', 'error');
        } finally {
            setLoading(false);
        }
    }, [filter, page, showToast]);

    useEffect(() => {
        fetchNotifications();
    }, [fetchNotifications]);

    const handleMarkAsRead = async (notificationId) => {
        try {
            const response = await markNotificationAsRead(notificationId);
            if (response.success) {
                setNotifications(prev =>
                    prev.map(n => n._id === notificationId ? { ...n, isRead: true } : n)
                );
                setStats(prev => ({ ...prev, unread: Math.max(0, prev.unread - 1) }));
                if (onNotificationRead) onNotificationRead();
            }
        } catch (error) {
            showToast('فشل في تحديث الإشعار', 'error');
        }
    };

    const handleMarkAllAsRead = async () => {
        try {
            const response = await markAllNotificationsAsRead();
            if (response.success) {
                setNotifications(prev => prev.map(n => ({ ...n, isRead: true })));
                setStats(prev => ({ ...prev, unread: 0 }));
                showToast('تم تحديث جميع الإشعارات كمقروءة', 'success');
                if (onNotificationRead) onNotificationRead();
            }
        } catch (error) {
            showToast('فشل في تحديث الإشعارات', 'error');
        }
    };

    const handleDelete = async (notificationId) => {
        try {
            const response = await deleteNotification(notificationId);
            if (response.success) {
                setNotifications(prev => prev.filter(n => n._id !== notificationId));
                showToast('تم حذف الإشعار', 'success');
                if (onNotificationRead) onNotificationRead();
            }
        } catch (error) {
            showToast('فشل في حذف الإشعار', 'error');
        }
    };

    const getNotificationIcon = (type) => {
        const icons = {
            'message': '💬',
            'report': '⚠️',
            'user': '👤',
            'system': '⚙️',
            'alert': '🚨',
            'success': '✅',
            'info': '📢',
            'warning': '⚠️',
            'general': '📣',
            'announcement': '📢'
        };
        return icons[type] || '🔔';
    };

    const getNotificationTypeClass = (type) => {
        const classes = {
            'message': 'type-message',
            'report': 'type-report',
            'user': 'type-user',
            'system': 'type-system',
            'alert': 'type-alert',
            'success': 'type-success',
            'general': 'type-general',
            'announcement': 'type-announcement',
            'warning': 'type-warning'
        };
        return classes[type] || 'type-default';
    };

    const formatTime = (date) => {
        const now = new Date();
        const notifDate = new Date(date);
        const diffInSeconds = Math.floor((now - notifDate) / 1000);

        if (diffInSeconds < 60) return 'الآن';
        if (diffInSeconds < 3600) return `منذ ${Math.floor(diffInSeconds / 60)} دقيقة`;
        if (diffInSeconds < 86400) return `منذ ${Math.floor(diffInSeconds / 3600)} ساعة`;
        if (diffInSeconds < 604800) return `منذ ${Math.floor(diffInSeconds / 86400)} يوم`;
        return notifDate.toLocaleDateString('ar-SA');
    };

    return (
        <div className="notifications-page">
            {/* Header */}
            <div className="notifications-header">
                <div className="notifications-stats">
                    <span className="stat-item">
                        <span className="stat-label">الإجمالي:</span>
                        <span className="stat-value">{stats.total}</span>
                    </span>
                    <span className="stat-item unread">
                        <span className="stat-label">غير مقروء:</span>
                        <span className="stat-value">{stats.unread}</span>
                    </span>
                </div>
                <div className="notifications-actions">
                    {stats.unread > 0 && (
                        <button className="mark-all-btn" onClick={handleMarkAllAsRead}>
                            تحديد الكل كمقروء
                        </button>
                    )}
                </div>
            </div>

            {/* Filters */}
            <div className="notifications-filters">
                <button
                    className={`filter-btn ${filter === 'all' ? 'active' : ''}`}
                    onClick={() => { setFilter('all'); setPage(1); }}
                >
                    الكل
                </button>
                <button
                    className={`filter-btn ${filter === 'unread' ? 'active' : ''}`}
                    onClick={() => { setFilter('unread'); setPage(1); }}
                >
                    غير مقروء
                </button>
            </div>

            {/* Notifications List */}
            <div className="notifications-list">
                {loading ? (
                    <div className="loading-state">
                        <div className="loading-spinner"></div>
                        <p>جاري تحميل الإشعارات...</p>
                    </div>
                ) : notifications.length === 0 ? (
                    <div className="empty-state">
                        <span className="empty-icon">🔔</span>
                        <h3>لا توجد إشعارات</h3>
                        <p>{filter === 'unread' ? 'لا توجد إشعارات غير مقروءة' : 'ستظهر إشعاراتك هنا'}</p>
                    </div>
                ) : (
                    notifications.map((notification) => (
                        <div
                            key={notification._id}
                            className={`notification-item ${!notification.isRead ? 'unread' : ''} ${getNotificationTypeClass(notification.type)}`}
                        >
                            <div className={`notification-icon ${getNotificationTypeClass(notification.type)}`}>
                                {getNotificationIcon(notification.type)}
                            </div>
                            <div className="notification-content">
                                <div className="notification-header-row">
                                    <h4 className="notification-title">{notification.title}</h4>
                                    {notification.type && (
                                        <span className={`notification-type-badge ${getNotificationTypeClass(notification.type)}`}>
                                            {notification.type === 'message' && 'رسالة'}
                                            {notification.type === 'report' && 'بلاغ'}
                                            {notification.type === 'system' && 'نظام'}
                                            {notification.type === 'general' && 'عام'}
                                            {notification.type === 'announcement' && 'إعلان'}
                                            {notification.type === 'alert' && 'تنبيه'}
                                            {notification.type === 'warning' && 'تحذير'}
                                            {notification.type === 'success' && 'نجاح'}
                                        </span>
                                    )}
                                </div>
                                <p className="notification-message">{notification.body || notification.message}</p>
                                <span className="notification-time">{formatTime(notification.createdAt)}</span>
                            </div>
                            <div className="notification-actions">
                                {!notification.isRead && (
                                    <button
                                        className="action-btn read-btn"
                                        onClick={() => handleMarkAsRead(notification._id)}
                                        title="تحديد كمقروء"
                                    >
                                        ✓
                                    </button>
                                )}
                                <button
                                    className="action-btn delete-btn"
                                    onClick={() => handleDelete(notification._id)}
                                    title="حذف"
                                >
                                    ×
                                </button>
                            </div>
                        </div>
                    ))
                )}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
                <div className="pagination">
                    <button
                        onClick={() => setPage(p => Math.max(1, p - 1))}
                        disabled={page === 1}
                        className="page-btn"
                    >
                        السابق
                    </button>
                    <span className="page-info">
                        صفحة {page} من {totalPages}
                    </span>
                    <button
                        onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                        disabled={page === totalPages}
                        className="page-btn"
                    >
                        التالي
                    </button>
                </div>
            )}
        </div>
    );
}

export default Notifications;
