import React, { useState, useEffect } from 'react';
import Sidebar from '../components/Sidebar';
import Dashboard from '../pages/Dashboard';
import UsersManagement from '../pages/UsersManagement';
import Conversations from '../pages/Conversations';
import Swipes from '../pages/Swipes';
import Matches from '../pages/Matches';
import UserDetail from '../pages/UserDetail';
import ReportsManagement from '../pages/ReportsManagement';
import ConversationMessages from '../pages/ConversationMessages';
import Stats from '../pages/Stats';
import Settings from '../pages/Settings';
import Profile from '../pages/Profile';
import Notifications from '../pages/Notifications';
import VerificationRequests from '../pages/VerificationRequests';
import SuperLikes from '../pages/SuperLikes';
import Analytics from '../pages/Analytics';
import BannedWords from '../pages/BannedWords';
import Appeals from '../pages/Appeals';
import BannedDevices from '../pages/BannedDevices';
import MaintenancePage from '../pages/MaintenancePage';
import { getReportsStats, getAppealsStats, getNotifications, searchUsers, sendUserNotification } from '../services/api';
import { useToast } from '../components/Toast';
import socketService from '../services/socket';
import config, { getImageUrl, getDefaultAvatar } from '../config';
import './MainLayout.css';

function MainLayout({ onLogout, user: initialUser }) {
    const [currentPage, setCurrentPage] = useState('dashboard');
    const [selectedUserId, setSelectedUserId] = useState(null);
    const [previousPage, setPreviousPage] = useState('users');
    const [viewingConversationFromReport, setViewingConversationFromReport] = useState(null);
    const [pendingReportsCount, setPendingReportsCount] = useState(0);
    const [appealsStats, setAppealsStats] = useState({ pending: 0, underReview: 0, awaitingReply: 0, total: 0 });
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

    // Global search state
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState([]);
    const [showSearchDropdown, setShowSearchDropdown] = useState(false);
    const [searchLoading, setSearchLoading] = useState(false);
    const searchRef = React.useRef(null);
    const searchTimerRef = React.useRef(null);

    // Smart notification modal state
    const [notifyTarget, setNotifyTarget] = useState('all');
    const [notifyUserId, setNotifyUserId] = useState('');
    const [notifyUserLabel, setNotifyUserLabel] = useState('');
    const [notifySearchQuery, setNotifySearchQuery] = useState('');
    const [notifySearchResults, setNotifySearchResults] = useState([]);
    const [notifySearchLoading, setNotifySearchLoading] = useState(false);
    const notifySearchTimerRef = React.useRef(null);

    useEffect(() => {
        // Fetch reports stats every minute if admin
        if (user?.role === 'admin') {
            fetchReportsCount();
            fetchAppealsCount();
            fetchNotificationsCount();
            const interval = setInterval(() => {
                fetchReportsCount();
                fetchAppealsCount();
                fetchNotificationsCount();
            }, 60000); // Update every minute
            return () => clearInterval(interval);
        }
    }, [user]);

    // ✅ Real-time socket listeners for admin appeals notifications
    useEffect(() => {
        if (user?.role !== 'admin') return;

        const token = localStorage.getItem('token');
        if (token) socketService.connect(token);

        const handleNewAppeal = (data) => {
            setAppealsStats(prev => ({
                ...prev,
                pending: prev.pending + 1,
                total: prev.total + 1
            }));
            showToast(`📩 استئناف جديد من ${data.userName || 'مستخدم'}`, 'info');
        };

        const handleAppealReply = (data) => {
            setAppealsStats(prev => ({
                ...prev,
                awaitingReply: prev.awaitingReply + 1
            }));
            showToast(`💬 رد جديد من ${data.userName || 'مستخدم'}: ${data.preview}`, 'info');
        };

        socketService.onNewAppeal(handleNewAppeal);
        socketService.onAppealUserReply(handleAppealReply);

        return () => {
            socketService.offNewAppeal(handleNewAppeal);
            socketService.offAppealUserReply(handleAppealReply);
        };
    }, [user, showToast]);

    // ✅ البحث عند Enter فقط — لا live search
    useEffect(() => {
        if (searchQuery.trim().length === 0) {
            setSearchResults([]);
            setShowSearchDropdown(false);
        }
    }, [searchQuery]);

    const executeSearch = async () => {
        const q = searchQuery.trim();
        if (q.length < 1) return;
        setSearchLoading(true);
        try {
            const res = await searchUsers(q);
            if (res.success) {
                setSearchResults(res.data?.users || res.data || []);
                setShowSearchDropdown(true);
            }
        } catch (err) {
            console.error('Search error:', err);
        } finally {
            setSearchLoading(false);
        }
    };

    // Click outside to close search dropdown
    useEffect(() => {
        const handleClickOutside = (e) => {
            if (searchRef.current && !searchRef.current.contains(e.target)) {
                setShowSearchDropdown(false);
            }
        };
        const handleEsc = (e) => {
            if (e.key === 'Escape') setShowSearchDropdown(false);
        };
        document.addEventListener('mousedown', handleClickOutside);
        document.addEventListener('keydown', handleEsc);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('keydown', handleEsc);
        };
    }, []);

    // Notify modal user search debounce
    useEffect(() => {
        if (notifySearchQuery.trim().length < 2) {
            setNotifySearchResults([]);
            return;
        }
        if (notifySearchTimerRef.current) clearTimeout(notifySearchTimerRef.current);
        notifySearchTimerRef.current = setTimeout(async () => {
            setNotifySearchLoading(true);
            try {
                const res = await searchUsers(notifySearchQuery.trim());
                if (res.success) {
                    setNotifySearchResults(res.data?.users || res.data || []);
                }
            } catch (err) {
                console.error('Notify search error:', err);
            } finally {
                setNotifySearchLoading(false);
            }
        }, 300);
        return () => { if (notifySearchTimerRef.current) clearTimeout(notifySearchTimerRef.current); };
    }, [notifySearchQuery]);

    const handleSearchResultClick = (userId) => {
        setShowSearchDropdown(false);
        setSearchQuery('');
        handleViewUserDetail(userId);
    };

    const handleSmartNotification = async (e) => {
        e.preventDefault();
        if (!notificationData.title || !notificationData.body) {
            showToast('العنوان والمحتوى مطلوبان', 'error');
            return;
        }
        if (notifyTarget === 'specific' && !notifyUserId) {
            showToast('اختر مستخدم أولاً', 'error');
            return;
        }
        try {
            setSending(true);
            if (notifyTarget === 'all') {
                // Send to all users using existing endpoint
                const token = localStorage.getItem('token');
                const response = await fetch(config.API_URL + '/notifications/send', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
                    body: JSON.stringify({ ...notificationData, recipients: 'all' })
                });
                const data = await response.json();
                if (data.success) {
                    showToast('تم إرسال الإشعار لجميع المستخدمين', 'success');
                } else {
                    showToast(data.message || 'فشل الإرسال', 'error');
                }
            } else {
                // Send to specific user
                const res = await sendUserNotification(
                    notificationData.title,
                    notificationData.body,
                    notifyUserId,
                    'id',
                    notificationData.type
                );
                if (res.success) {
                    showToast('تم إرسال الإشعار للمستخدم ' + notifyUserLabel, 'success');
                } else {
                    showToast(res.message || 'فشل الإرسال', 'error');
                }
            }
            setShowNotificationModal(false);
            setNotificationData({ title: '', body: '', type: 'general', recipients: 'all' });
            setNotifyTarget('all');
            setNotifyUserId('');
            setNotifyUserLabel('');
            setNotifySearchQuery('');
            setNotifySearchResults([]);
        } catch (error) {
            console.error('Notification error:', error);
            showToast('فشل إرسال الإشعار', 'error');
        } finally {
            setSending(false);
        }
    };

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

    const fetchAppealsCount = async () => {
        try {
            const response = await getAppealsStats();
            if (response.success) {
                setAppealsStats(response.data);
            }
        } catch (error) {
            console.error('خطأ في جلب عدد الاستئنافات:', error);
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
                return <Conversations onViewUserDetail={handleViewUserDetail} />;
            case 'swipes':
                return <Swipes />;
            case 'matches':
                return <Matches />;
            case 'reports':
                return <ReportsManagement initialTab="reports" onViewUserDetail={handleViewUserDetail} onViewConversation={handleViewConversation} />;
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
            case 'verification-requests':
                return <VerificationRequests />;
            case 'analytics':
                return <Analytics onViewUserDetail={handleViewUserDetail} />;
            case 'super-likes':
                return <SuperLikes />;
            case 'appeals':
                return <Appeals onViewUserDetail={handleViewUserDetail} />;
            case 'banned-devices':
                return <BannedDevices onViewUserDetail={handleViewUserDetail} />;
            case 'banned-words':
                return <BannedWords onViewUserDetail={handleViewUserDetail} onViewConversation={handleViewConversation} />;
            case 'maintenance':
                return <MaintenancePage />;
            case 'user-detail':
                return <UserDetail userId={selectedUserId} onBack={handleBackFromUserDetail} onNavigateToUser={handleViewUserDetail} />;
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
                badges={{
                    reports: pendingReportsCount,
                    appeals: appealsStats.total + appealsStats.awaitingReply
                }}
            />
            
            <div className="main-content">
                <header className="top-header">
                    <h1>
                        {currentPage === 'dashboard' && '📊 لوحة التحكم'}
                        {(currentPage === 'users' || currentPage === 'premium-users') && '👥 إدارة المستخدمين'}
                        {currentPage === 'conversations' && '💬 المحادثات'}
                        {currentPage === 'swipes' && '👆 Swipes'}
                        {currentPage === 'matches' && '💕 التطابقات'}
                        {currentPage === 'reports' && '⚠️ البلاغات'}
                        {currentPage === 'stats' && '📈 الإحصائيات'}
                        {currentPage === 'settings' && '⚙️ الإعدادات'}
                        {currentPage === 'profile' && '👤 الملف الشخصي'}
                        {currentPage === 'notifications' && '🔔 الإشعارات'}
                        {currentPage === 'verification-requests' && '✅ طلبات التوثيق'}
                        {currentPage === 'analytics' && '🔍 التحليلات'}
                        {currentPage === 'super-likes' && '⚡ Super Likes'}
                        {currentPage === 'user-detail' && '👤 تفاصيل المستخدم'}
                        {currentPage === 'report-conversation' && '💬 رسائل المحادثة'}
                        {currentPage === 'appeals' && '📋 الاستئنافات'}
                        {currentPage === 'banned-devices' && '📵 الأجهزة المحظورة'}
                        {currentPage === 'banned-words' && '🚫 الكلمات المحظورة'}
                        {currentPage === 'maintenance' && '🔧 وضع الصيانة'}
                    </h1>
                    <div className="header-actions">
                        {/* Global Search Bar */}
                        <div className="global-search-container" ref={searchRef}>
                            <div className="search-input-wrapper">
                                <span className="search-icon-inner">🔍</span>
                                <input
                                    type="text"
                                    className="search-input"
                                    placeholder="بحث عن مستخدم..."
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    onFocus={() => { if (searchResults.length > 0) setShowSearchDropdown(true); }}
                                    onKeyDown={(e) => { if (e.key === 'Enter') executeSearch(); }}
                                />
                                {searchLoading && <span className="search-spinner"></span>}
                                {searchQuery && (
                                    <button className="search-clear-btn" onClick={() => { setSearchQuery(''); setSearchResults([]); setShowSearchDropdown(false); }}>✕</button>
                                )}
                            </div>
                            {showSearchDropdown && searchResults.length > 0 && (
                                <div className="search-results-dropdown">
                                    {searchResults.slice(0, 10).map((u) => (
                                        <div
                                            key={u._id}
                                            className="search-result-item"
                                            onClick={() => handleSearchResultClick(u._id)}
                                        >
                                            <img
                                                src={u.profileImage ? getImageUrl(u.profileImage) : getDefaultAvatar(u.name)}
                                                alt=""
                                                className="search-result-avatar"
                                                onError={(e) => { e.target.src = getDefaultAvatar(u.name); }}
                                            />
                                            <div className="search-result-info">
                                                <span className="search-result-name">{u.name}</span>
                                                <span className="search-result-email">{u.email || u.halaId || ''}</span>
                                            </div>
                                            {u.isVerified && <span className="search-verified-badge">✓</span>}
                                        </div>
                                    ))}
                                </div>
                            )}
                            {showSearchDropdown && searchQuery.trim().length >= 2 && searchResults.length === 0 && !searchLoading && (
                                <div className="search-results-dropdown">
                                    <div className="search-no-results">لا توجد نتائج</div>
                                </div>
                            )}
                        </div>
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

                        {/* زر الاستئنافات (جديدة + ردود مستخدمين بلا قراءة) */}
                        {user?.role === 'admin' && (appealsStats.total > 0 || appealsStats.awaitingReply > 0) && (
                            <button
                                className="header-icon-btn appeals-notification-btn"
                                onClick={() => setCurrentPage('appeals')}
                                title={`${appealsStats.pending} جديدة · ${appealsStats.underReview} قيد المراجعة · ${appealsStats.awaitingReply} رد مستخدم بلا قراءة`}
                            >
                                <span className="notification-icon">📋</span>
                                <span className="notification-badge warning">
                                    {appealsStats.total + appealsStats.awaitingReply}
                                </span>
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

            {/* Smart Notification Modal */}
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

                        <form onSubmit={handleSmartNotification} className="notification-form">
                            <div className="form-group">
                                <label>الهدف</label>
                                <div className="notify-target-toggle">
                                    <button
                                        type="button"
                                        className={'notify-target-btn' + (notifyTarget === 'all' ? ' active' : '')}
                                        onClick={() => { setNotifyTarget('all'); setNotifyUserId(''); setNotifyUserLabel(''); }}
                                    >
                                        👥 جميع المستخدمين
                                    </button>
                                    <button
                                        type="button"
                                        className={'notify-target-btn' + (notifyTarget === 'specific' ? ' active' : '')}
                                        onClick={() => setNotifyTarget('specific')}
                                    >
                                        👤 مستخدم محدد
                                    </button>
                                </div>
                            </div>

                            {notifyTarget === 'specific' && (
                                <div className="form-group">
                                    <label>بحث عن المستخدم</label>
                                    {notifyUserId ? (
                                        <div className="notify-selected-user">
                                            <span>✅ {notifyUserLabel}</span>
                                            <button type="button" onClick={() => { setNotifyUserId(''); setNotifyUserLabel(''); setNotifySearchQuery(''); }}>✕</button>
                                        </div>
                                    ) : (
                                        <div className="notify-search-wrapper">
                                            <input
                                                type="text"
                                                placeholder="ابحث بالاسم أو الإيميل أو HalaID..."
                                                value={notifySearchQuery}
                                                onChange={(e) => setNotifySearchQuery(e.target.value)}
                                                className="search-input"
                                            />
                                            {notifySearchLoading && <span className="search-spinner"></span>}
                                            {notifySearchResults.length > 0 && (
                                                <div className="notify-search-results">
                                                    {notifySearchResults.slice(0, 6).map((u) => (
                                                        <div
                                                            key={u._id}
                                                            className="search-result-item"
                                                            onClick={() => {
                                                                setNotifyUserId(u._id);
                                                                setNotifyUserLabel(u.name + (u.email ? ' (' + u.email + ')' : ''));
                                                                setNotifySearchResults([]);
                                                                setNotifySearchQuery('');
                                                            }}
                                                        >
                                                            <img
                                                                src={u.profileImage ? getImageUrl(u.profileImage) : getDefaultAvatar(u.name)}
                                                                alt=""
                                                                className="search-result-avatar"
                                                                onError={(e) => { e.target.src = getDefaultAvatar(u.name); }}
                                                            />
                                                            <div className="search-result-info">
                                                                <span className="search-result-name">{u.name}</span>
                                                                <span className="search-result-email">{u.email || u.halaId || ''}</span>
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            )}

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
                                    <option value="announcement">إعلان</option>
                                    <option value="system">نظام</option>
                                    <option value="message">رسالة</option>
                                    <option value="report">بلاغ</option>
                                </select>
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
                                    {sending ? 'جاري الإرسال...' : (notifyTarget === 'all' ? '📢 إرسال للجميع' : '📤 إرسال للمستخدم')}
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
