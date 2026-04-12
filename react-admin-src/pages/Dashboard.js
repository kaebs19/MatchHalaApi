import React, { useState, useEffect } from 'react';
import { getDashboardStats, getConversationsStats, getReportsStats, getSwipesStats, getMatchesStats } from '../services/api';
import { useToast } from '../components/Toast';
import LoadingSpinner from '../components/LoadingSpinner';
import StatCard from '../components/StatCard';
import { formatDateLong } from '../utils/formatters';
import config, { getImageUrl, getDefaultAvatar } from '../config';
import './Dashboard.css';

function Dashboard({ user, onPageChange }) {
    const [stats, setStats] = useState({
        totalUsers: 0,
        activeUsers: 0,
        newUsers: 0,
        recentLogins: 0
    });
    const [conversationStats, setConversationStats] = useState({
        totalConversations: 0,
        activeConversations: 0,
        totalMessages: 0,
        privateConversations: 0,
        groupConversations: 0
    });
    const [reportsStats, setReportsStats] = useState({
        total: 0,
        pending: 0,
        reviewed: 0,
        resolved: 0
    });
    const [swipesStats, setSwipesStats] = useState({
        totalSwipes: 0,
        totalLikes: 0,
        totalDislikes: 0,
        totalSuperlikes: 0,
        swipesLast7Days: 0,
        likeRate: 0
    });
    const [matchesStatsData, setMatchesStatsData] = useState({
        totalMatches: 0,
        activeMatches: 0,
        unmatchedCount: 0,
        matchesLast7Days: 0,
        matchRate: 0
    });
    const [premiumStats, setPremiumStats] = useState({
        total: 0,
        active: 0,
        expired: 0,
        byPlan: { weekly: 0, monthly: 0, quarterly: 0 },
        estimatedMonthlyRevenue: 0
    });
    const [superLikeStats, setSuperLikeStats] = useState({
        total: 0,
        last7Days: 0
    });
    const [stealthStats, setStealthStats] = useState({ activeUsers: 0 });
    const [latestUsers, setLatestUsers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
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
        fetchDashboardData();
    }, []);


    const fetchDashboardData = async () => {
        try {
            setLoading(true);

            // جلب إحصائيات المستخدمين + الإحصائيات المتقدمة
            const userStatsResponse = await getDashboardStats();
            if (userStatsResponse.success) {
                setStats(userStatsResponse.data.stats);
                setLatestUsers(userStatsResponse.data.latestUsers);
                if (userStatsResponse.data.premium) setPremiumStats(userStatsResponse.data.premium);
                if (userStatsResponse.data.superLikes) setSuperLikeStats(userStatsResponse.data.superLikes);
                if (userStatsResponse.data.stealthMode) setStealthStats(userStatsResponse.data.stealthMode);
                if (userStatsResponse.data.conversations) {
                    setConversationStats(prev => ({
                        ...prev,
                        totalConversations: userStatsResponse.data.conversations.total || prev.totalConversations,
                        activeConversations: userStatsResponse.data.conversations.active || prev.activeConversations,
                        totalMessages: userStatsResponse.data.conversations.totalMessages || prev.totalMessages
                    }));
                }
            }

            // جلب إحصائيات المحادثات
            try {
                const convStatsResponse = await getConversationsStats();
                if (convStatsResponse.success) {
                    setConversationStats(convStatsResponse.data);
                }
            } catch (convErr) {
                console.log('تخطي إحصائيات المحادثات');
            }

            // جلب إحصائيات البلاغات
            try {
                const reportsResponse = await getReportsStats();
                if (reportsResponse.success) {
                    setReportsStats(reportsResponse.data);
                }
            } catch (reportsErr) {
                console.log('تخطي إحصائيات البلاغات');
            }

            // جلب إحصائيات Swipes
            try {
                const swipesResponse = await getSwipesStats();
                if (swipesResponse.success) {
                    setSwipesStats(swipesResponse.data);
                }
            } catch (swipesErr) {
                console.log('تخطي إحصائيات Swipes');
            }

            // جلب إحصائيات Matches
            try {
                const matchesResponse = await getMatchesStats();
                if (matchesResponse.success) {
                    setMatchesStatsData(matchesResponse.data);
                }
            } catch (matchesErr) {
                console.log('تخطي إحصائيات Matches');
            }
        } catch (err) {
            console.error('خطأ في جلب البيانات:', err);
            setError('فشل تحميل البيانات');
            setStats({
                totalUsers: 5,
                activeUsers: 4,
                newUsers: 2,
                recentLogins: 1
            });
        } finally {
            setLoading(false);
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
                showToast('تم إرسال الإشعار بنجاح ✅', 'success');
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

    const isAdmin = user?.role === 'admin';

    return (
        <div className="dashboard-content">
            {error && <div className="error-banner">{error}</div>}

            {/* الإجراءات السريعة */}
            {isAdmin && (
                <div className="quick-actions-section">
                    <h3 className="section-title">⚡ إجراءات سريعة</h3>
                    <div className="quick-actions-grid">
                        <button className="quick-action-btn users" onClick={() => onPageChange && onPageChange('users')}>
                            <span className="action-icon">👥</span>
                            <span className="action-text">إدارة المستخدمين</span>
                        </button>
                        <button className="quick-action-btn conversations" onClick={() => onPageChange && onPageChange('conversations')}>
                            <span className="action-icon">💬</span>
                            <span className="action-text">المحادثات</span>
                        </button>
                        <button className="quick-action-btn swipes" onClick={() => onPageChange && onPageChange('swipes')}>
                            <span className="action-icon">👆</span>
                            <span className="action-text">Swipes</span>
                        </button>
                        <button className="quick-action-btn matches" onClick={() => onPageChange && onPageChange('matches')}>
                            <span className="action-icon">💕</span>
                            <span className="action-text">التطابقات</span>
                        </button>
                        <button className="quick-action-btn reports" onClick={() => onPageChange && onPageChange('reports')}>
                            <span className="action-icon">⚠️</span>
                            <span className="action-text">البلاغات</span>
                            {reportsStats.pending > 0 && <span className="action-badge">{reportsStats.pending}</span>}
                        </button>
                        <button className="quick-action-btn settings" onClick={() => onPageChange && onPageChange('settings')}>
                            <span className="action-icon">⚙️</span>
                            <span className="action-text">الإعدادات</span>
                        </button>
                        <button className="quick-action-btn notification" onClick={() => setShowNotificationModal(true)}>
                            <span className="action-icon">📢</span>
                            <span className="action-text">إرسال إشعار</span>
                        </button>
                    </div>
                </div>
            )}

            {/* الإحصائيات */}
            {loading ? (
                <LoadingSpinner text="جاري تحميل الإحصائيات..." />
            ) : (
                <>
                    {/* ===== القسم 1: نظرة عامة ===== */}
                    <div className="stats-section">
                        <h3 className="section-title">📊 نظرة عامة</h3>
                        <div className="stats-grid">
                            <StatCard icon="👥" value={stats.totalUsers} label="إجمالي المستخدمين" color="purple" onClick={() => onPageChange && onPageChange('users')} />
                            <StatCard icon="✅" value={stats.activeUsers} label="مستخدمين نشطين" color="blue" onClick={() => onPageChange && onPageChange('users')} />
                            <StatCard icon="👆" value={swipesStats.totalSwipes} label="إجمالي Swipes" color="cyan" onClick={() => onPageChange && onPageChange('swipes')} />
                            <StatCard icon="💕" value={matchesStatsData.totalMatches} label="إجمالي التطابقات" color="pink" onClick={() => onPageChange && onPageChange('matches')} />
                        </div>
                    </div>

                    {/* ===== القسم 2: المستخدمين والنشاط ===== */}
                    {isAdmin && (
                        <div className="stats-section">
                            <h3 className="section-title">👥 المستخدمين والنشاط</h3>
                            <div className="stats-grid">
                                <StatCard icon="🆕" value={stats.newUsers} label="مستخدمين جدد (7 أيام)" color="green" onClick={() => onPageChange && onPageChange('users')} />
                                <StatCard icon="🟢" value={stats.recentLogins} label="دخول مؤخراً (24 ساعة)" color="orange" onClick={() => onPageChange && onPageChange('users')} />
                                <StatCard icon="👑" value={premiumStats.active} label="مشتركين مميزين نشطين" color="gold" onClick={() => onPageChange && onPageChange('premium-users')} />
                                <StatCard icon="⚡" value={superLikeStats.total} label="Super Likes" color="violet" onClick={() => onPageChange && onPageChange('super-likes')} />
                            </div>
                        </div>
                    )}

                    {/* ===== القسم 3: Swipes & Matches ===== */}
                    {isAdmin && (
                        <div className="stats-section">
                            <h3 className="section-title">💕 Swipes والتطابقات</h3>
                            <div className="stats-grid">
                                <StatCard icon="❤️" value={swipesStats.totalLikes} label="إعجابات" color="pink" onClick={() => onPageChange && onPageChange('swipes')} />
                                <StatCard icon="✖️" value={swipesStats.totalDislikes} label="تمريرات" color="gray" onClick={() => onPageChange && onPageChange('swipes')} />
                                <StatCard icon="✅" value={matchesStatsData.activeMatches} label="تطابقات نشطة" color="green" onClick={() => onPageChange && onPageChange('matches')} />
                                <StatCard icon="📊" value={`${matchesStatsData.matchRate || 0}%`} label="نسبة التطابق" color="deep-purple" onClick={() => onPageChange && onPageChange('matches')} />
                            </div>
                        </div>
                    )}

                    {/* ===== القسم 4: الإشراف والبلاغات ===== */}
                    {isAdmin && (
                        <div className="stats-section">
                            <h3 className="section-title">🛡️ الإشراف والبلاغات</h3>
                            <div className="stats-grid">
                                <StatCard icon="⏳" value={reportsStats.pending || 0} label="بلاغات معلقة" color="yellow" onClick={() => onPageChange && onPageChange('reports')} />
                                <StatCard icon="✅" value={reportsStats.resolved || 0} label="بلاغات تم حلها" color="light-green" onClick={() => onPageChange && onPageChange('reports')} />
                            </div>
                        </div>
                    )}

                    {/* ===== القسم 5: التوزيع البياني ===== */}
                    {isAdmin && swipesStats.totalSwipes > 0 && (
                        <div className="charts-section">
                            <h3 className="section-title">📊 التوزيع البياني</h3>
                            <div className="charts-grid">
                                {/* Progress Bars */}
                                <div className="chart-card">
                                    <h4>توزيع المستخدمين</h4>
                                    <div className="progress-bars">
                                        <div className="progress-item">
                                            <div className="progress-label">
                                                <span>مستخدمين نشطين</span>
                                                <span>{stats.activeUsers}</span>
                                            </div>
                                            <div className="progress-bar">
                                                <div
                                                    className="progress-fill blue"
                                                    style={{width: `${(stats.activeUsers / stats.totalUsers * 100) || 0}%`}}
                                                ></div>
                                            </div>
                                        </div>
                                        <div className="progress-item">
                                            <div className="progress-label">
                                                <span>مستخدمين جدد</span>
                                                <span>{stats.newUsers}</span>
                                            </div>
                                            <div className="progress-bar">
                                                <div
                                                    className="progress-fill green"
                                                    style={{width: `${(stats.newUsers / stats.totalUsers * 100) || 0}%`}}
                                                ></div>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* Pie Chart - Swipes */}
                                <div className="chart-card">
                                    <h4>توزيع Swipes</h4>
                                    <div className="pie-chart-container">
                                        <div className="pie-chart" style={{
                                            background: `conic-gradient(
                                                #e91e63 0deg ${(swipesStats.totalLikes / swipesStats.totalSwipes * 360) || 0}deg,
                                                #7c3aed ${(swipesStats.totalLikes / swipesStats.totalSwipes * 360) || 0}deg ${((swipesStats.totalLikes + swipesStats.totalSuperlikes) / swipesStats.totalSwipes * 360) || 0}deg,
                                                #9e9e9e ${((swipesStats.totalLikes + swipesStats.totalSuperlikes) / swipesStats.totalSwipes * 360) || 0}deg 360deg
                                            )`
                                        }}>
                                            <div className="pie-center">
                                                <span>{swipesStats.totalSwipes}</span>
                                                <small>swipe</small>
                                            </div>
                                        </div>
                                        <div className="pie-legend">
                                            <div className="legend-item">
                                                <span className="legend-color" style={{background: '#e91e63'}}></span>
                                                <span>إعجاب ({swipesStats.totalLikes})</span>
                                            </div>
                                            <div className="legend-item">
                                                <span className="legend-color" style={{background: '#7c3aed'}}></span>
                                                <span>Super Like ({swipesStats.totalSuperlikes})</span>
                                            </div>
                                            <div className="legend-item">
                                                <span className="legend-color" style={{background: '#9e9e9e'}}></span>
                                                <span>تمرير ({swipesStats.totalDislikes})</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </>
            )}

            {/* أحدث المستخدمين */}
            {latestUsers.length > 0 && (
                <div className="latest-users-section">
                    <h3>أحدث المستخدمين 📋</h3>
                    <div className="users-list">
                        {latestUsers.map((latestUser, index) => (
                            <div key={latestUser._id || index} className="user-item">
                                <img
                                    src={latestUser.profileImage ? getImageUrl(latestUser.profileImage) : getDefaultAvatar(latestUser.name)}
                                    alt={latestUser.name}
                                    className="user-avatar"
                                    onError={(e) => {
                                        e.target.onerror = null;
                                        e.target.src = getDefaultAvatar(latestUser.name);
                                    }}
                                />
                                <div className="user-details">
                                    <h4>{latestUser.name}</h4>
                                    <p>{latestUser.email}</p>
                                    <span className="user-date">
                                        {formatDateLong(latestUser.createdAt)}
                                    </span>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

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

export default Dashboard;
