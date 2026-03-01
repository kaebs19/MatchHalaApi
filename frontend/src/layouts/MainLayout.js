import React, { useState, useEffect } from 'react';
import Sidebar from '../components/Sidebar';
import Dashboard from '../pages/Dashboard';
import UsersManagement from '../pages/UsersManagement';
import Conversations from '../pages/Conversations';
import ChatRoomsManagement from '../pages/ChatRoomsManagement';
import UserDetail from '../pages/UserDetail';
import ReportsManagement from '../pages/ReportsManagement';
import ConversationMessages from '../pages/ConversationMessages';
import Stats from '../pages/Stats';
import Settings from '../pages/Settings';
import Profile from '../pages/Profile';
import Notifications from '../pages/Notifications';
import BannedWords from '../pages/BannedWords';
import VerificationRequests from '../pages/VerificationRequests';
import SuperLikes from '../pages/SuperLikes';
import { getReportsStats, getNotifications } from '../services/api';
import { useToast } from '../components/Toast';
import config from '../config';
import './MainLayout.css';

function MainLayout({ onLogout, user: initialUser }) {
    const [currentPage, setCurrentPage] = useState('dashboard');
    const [selectedUserId, setSelectedUserId] = useState(null);
    const [previousPage, setPreviousPage] = useState('users');
    const [viewingConversationFromReport, setViewingConversationFromReport] = useState(null);
    const [pendingReportsCount, setPendingReportsCount] = useState(0);
    const [unreadNotifications, setUnreadNotifications] = useState(0);
    const [user, setUser] = useState(initialUser);
    const [showNotificationModal, setShowNotificationModal] = useState(false);
    const [notificationData, setNotificationData] = useState({
        title: '',
        body: '',
        type: 'general',
        recipients: 'all'
    });
    const [sending, setSending] = useState(false);
    const { showToast } = useToast();

    useEffect(() => {
        // Fetch reports stats every minute if admin
        if (user?.role === 'admin') {
            fetchReportsCount();
            fetchNotificationsCount();
            const interval = setInterval(() => {
                fetchReportsCount();
                fetchNotificationsCount();
            }, 60000); // Update every minute
            return () => clearInterval(interval);
        }
    }, [user]);

    const fetchReportsCount = async () => {
        try {
            const response = await getReportsStats();
            if (response.success) {
                setPendingReportsCount(response.data.pending || 0);
            }
        } catch (error) {
            console.error('خطأ في جلب عدد البلاغات:', error);
        }
    };

    const fetchNotificationsCount = async () => {
        try {
            const response = await getNotifications({ unreadOnly: true, limit: 1 });
            if (response.success) {
                setUnreadNotifications(response.data.unreadCount || 0);
            }
        } catch (error) {
            console.error('خطأ في جلب عدد الإشعارات:', error);
        }
    };

    const handleSendNotification = async (e) => {
        e.preventDefault();

        if (!notificationData.title || !notificationData.body) {
            showToast('العنوان والمحتوى مطلوبان', 'error');
            return;
        }

        try {
            setSending(true);
            const token = localStorage.getItem('token');

            const response = await fetch(`${config.API_URL}/notifications/send`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(notificationData)
            });

            const data = await response.json();

            if (data.success) {
                showToast('تم إرسال الإشعار بنجاح', 'success');
                setShowNotificationModal(false);
                setNotificationData({
                    title: '',
                    body: '',
                    type: 'general',
                    recipients: 'all'
                });
            } else {
                showToast(data.message || 'فشل إرسال الإشعار', 'error');
            }
        } catch (error) {
            console.error('خطأ في إرسال الإشعار:', error);
            showToast('فشل إرسال الإشعار', 'error');
        } finally {
            setSending(false);
        }
    };

    const handleUserUpdate = (updatedUser) => {
        setUser(updatedUser);
        localStorage.setItem('user', JSON.stringify(updatedUser));
    };

    const handleViewUserDetail = (userId) => {
        setSelectedUserId(userId);
        setPreviousPage(currentPage);
        setCurrentPage('user-detail');
    };

    const handleBackFromUserDetail = () => {
        setSelectedUserId(null);
        setCurrentPage(previousPage);
    };

    const handleViewConversation = (conversationId) => {
        setViewingConversationFromReport(conversationId);
        setCurrentPage('report-conversation');
    };

    const handleBackFromReportConversation = () => {
        setViewingConversationFromReport(null);
        setCurrentPage('reports');
    };

    const renderPage = () => {
        switch (currentPage) {
            case 'dashboard':
                return <Dashboard user={user} onPageChange={setCurrentPage} />;
            case 'users':
                return <UsersManagement onViewDetail={handleViewUserDetail} initialTab="users" />;
            case 'premium-users':
                return <UsersManagement onViewDetail={handleViewUserDetail} initialTab="premium" />;
            case 'conversations':
                return <Conversations />;
            case 'chat-rooms':
                return <ChatRoomsManagement initialTab="rooms" />;
            case 'categories':
                return <ChatRoomsManagement initialTab="categories" />;
            case 'reports':
                return <ReportsManagement initialTab="reports" onViewUserDetail={handleViewUserDetail} onViewConversation={handleViewConversation} />;
            case 'flagged-messages':
                return <ReportsManagement initialTab="flagged" onViewUserDetail={handleViewUserDetail} onViewConversation={handleViewConversation} />;
            case 'report-conversation':
                return <ConversationMessages conversationId={viewingConversationFromReport} onBack={handleBackFromReportConversation} onViewUser={handleViewUserDetail} />;
            case 'stats':
                return <Stats />;
            case 'settings':
                return <Settings />;
            case 'profile':
                return <Profile user={user} onUserUpdate={handleUserUpdate} />;
            case 'notifications':
                return <Notifications onNotificationRead={fetchNotificationsCount} />;
            case 'banned-words':
                return <BannedWords />;
            case 'verification-requests':
                return <VerificationRequests />;
            case 'super-likes':
                return <SuperLikes />;
            case 'user-detail':
                return <UserDetail userId={selectedUserId} onBack={handleBackFromUserDetail} />;
            default:
                return <Dashboard user={user} onPageChange={setCurrentPage} />;
        }
    };

    return (
        <div className="main-layout">
            <Sidebar
                currentPage={currentPage}
                onPageChange={setCurrentPage}
                user={user}
                onProfileClick={() => setCurrentPage('profile')}
            />
            
            <div className="main-content">
                <header className="top-header">
                    <h1>
                        {currentPage === 'dashboard' && '📊 لوحة التحكم'}
                        {(currentPage === 'users' || currentPage === 'premium-users') && '👥 إدارة المستخدمين'}
                        {currentPage === 'conversations' && '💬 المحادثات'}
                        {(currentPage === 'chat-rooms' || currentPage === 'categories') && '🏠 غرف المحادثة'}
                        {(currentPage === 'reports' || currentPage === 'flagged-messages') && '⚠️ البلاغات والمخالفات'}
                        {currentPage === 'stats' && '📈 الإحصائيات'}
                        {currentPage === 'settings' && '⚙️ الإعدادات'}
                        {currentPage === 'profile' && '👤 الملف الشخصي'}
                        {currentPage === 'notifications' && '🔔 الإشعارات'}
                        {currentPage === 'banned-words' && '🚫 الكلمات المحظورة'}
                        {currentPage === 'verification-requests' && '✅ طلبات التوثيق'}
                        {currentPage === 'super-likes' && '⚡ Super Likes'}
                        {currentPage === 'user-detail' && '👤 تفاصيل المستخدم'}
                        {currentPage === 'report-conversation' && '💬 رسائل المحادثة'}
                    </h1>
                    <div className="header-actions">
                        {/* زر إرسال إشعار */}
                        {user?.role === 'admin' && (
                            <button
                                className="header-icon-btn send-notification-btn"
                                onClick={() => setShowNotificationModal(true)}
                                title="إرسال إشعار"
                            >
                                <span className="notification-icon">📢</span>
                            </button>
                        )}

                        {/* زر الإشعارات */}
                        <button
                            className="header-icon-btn notifications-btn"
                            onClick={() => setCurrentPage('notifications')}
                            title="الإشعارات"
                        >
                            <span className="notification-icon">🔔</span>
                            {unreadNotifications > 0 && (
                                <span className="notification-badge">{unreadNotifications}</span>
                            )}
                        </button>

                        {/* زر البلاغات المعلقة */}
                        {user?.role === 'admin' && pendingReportsCount > 0 && (
                            <button
                                className="header-icon-btn reports-notification-btn"
                                onClick={() => setCurrentPage('reports')}
                                title={`${pendingReportsCount} بلاغات في انتظار المراجعة`}
                            >
                                <span className="notification-icon">⚠️</span>
                                <span className="notification-badge warning">{pendingReportsCount}</span>
                            </button>
                        )}

                        <button onClick={onLogout} className="logout-btn">
                            تسجيل الخروج 🚪
                        </button>
                    </div>
                </header>

                <div className="page-content">
                    {renderPage()}
                </div>
            </div>

            {/* Notification Modal */}
            {showNotificationModal && (
                <div className="modal-overlay" onClick={() => setShowNotificationModal(false)}>
                    <div className="notification-modal" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3>📢 إرسال إشعار جديد</h3>
                            <button
                                className="close-modal-btn"
                                onClick={() => setShowNotificationModal(false)}
                            >
                                ✕
                            </button>
                        </div>

                        <form onSubmit={handleSendNotification} className="notification-form">
                            <div className="form-group">
                                <label>العنوان *</label>
                                <input
                                    type="text"
                                    value={notificationData.title}
                                    onChange={(e) => setNotificationData({
                                        ...notificationData,
                                        title: e.target.value
                                    })}
                                    placeholder="عنوان الإشعار"
                                    maxLength={100}
                                    required
                                />
                            </div>

                            <div className="form-group">
                                <label>المحتوى *</label>
                                <textarea
                                    value={notificationData.body}
                                    onChange={(e) => setNotificationData({
                                        ...notificationData,
                                        body: e.target.value
                                    })}
                                    placeholder="محتوى الإشعار"
                                    maxLength={500}
                                    rows={4}
                                    required
                                />
                            </div>

                            <div className="form-row">
                                <div className="form-group">
                                    <label>نوع الإشعار</label>
                                    <select
                                        value={notificationData.type}
                                        onChange={(e) => setNotificationData({
                                            ...notificationData,
                                            type: e.target.value
                                        })}
                                    >
                                        <option value="general">عام</option>
                                        <option value="message">رسالة</option>
                                        <option value="announcement">إعلان</option>
                                        <option value="report">بلاغ</option>
                                        <option value="system">نظام</option>
                                    </select>
                                </div>

                                <div className="form-group">
                                    <label>المستقبلون</label>
                                    <select
                                        value={notificationData.recipients}
                                        onChange={(e) => setNotificationData({
                                            ...notificationData,
                                            recipients: e.target.value
                                        })}
                                    >
                                        <option value="all">جميع المستخدمين</option>
                                        <option value="specific">مستخدمون محددون</option>
                                    </select>
                                </div>
                            </div>

                            <div className="modal-actions">
                                <button
                                    type="button"
                                    className="cancel-btn"
                                    onClick={() => setShowNotificationModal(false)}
                                    disabled={sending}
                                >
                                    إلغاء
                                </button>
                                <button
                                    type="submit"
                                    className="submit-btn"
                                    disabled={sending}
                                >
                                    {sending ? 'جاري الإرسال...' : 'إرسال الإشعار'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}

export default MainLayout;
