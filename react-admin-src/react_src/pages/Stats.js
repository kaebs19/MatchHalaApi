import React, { useState, useEffect } from 'react';
import { getDashboardStats, getConversationsStats } from '../services/api';
import LoadingSpinner from '../components/LoadingSpinner';
import StatCard from '../components/StatCard';
import './Stats.css';

function Stats() {
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
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetchStats();
    }, []);

    const fetchStats = async () => {
        try {
            setLoading(true);

            const userStatsResponse = await getDashboardStats();
            if (userStatsResponse.success) {
                setStats(userStatsResponse.data.stats);
            }

            const convStatsResponse = await getConversationsStats();
            if (convStatsResponse.success) {
                setConversationStats(convStatsResponse.data);
            }
        } catch (err) {
            console.error('خطأ في جلب الإحصائيات:', err);
        } finally {
            setLoading(false);
        }
    };

    if (loading) {
        return <LoadingSpinner text="جاري تحميل الإحصائيات..." />;
    }

    return (
        <div className="stats-page">
            <div className="stats-header">
                <h2>📈 الإحصائيات التفصيلية</h2>
                <p>نظرة شاملة على أداء التطبيق</p>
            </div>

            {/* User Statistics */}
            <section className="stats-section">
                <h3 className="section-title">👥 إحصائيات المستخدمين</h3>
                <div className="stats-grid">
                    <StatCard icon="👥" value={stats.totalUsers} label="إجمالي المستخدمين" color="purple" />
                    <StatCard icon="✅" value={stats.activeUsers} label="مستخدمين نشطين" color="blue" />
                    <StatCard icon="🆕" value={stats.newUsers} label="مستخدمين جدد (7 أيام)" color="green" />
                    <StatCard icon="🟢" value={stats.recentLogins} label="دخول مؤخراً (24 ساعة)" color="orange" />
                </div>

                {/* Progress Bars */}
                <div className="progress-section">
                    <h4>نسبة النشاط</h4>
                    <div className="progress-item">
                        <div className="progress-label">
                            <span>مستخدمين نشطين</span>
                            <span>{stats.activeUsers} / {stats.totalUsers}</span>
                        </div>
                        <div className="progress-bar">
                            <div
                                className="progress-fill blue"
                                style={{width: `${(stats.activeUsers / stats.totalUsers * 100) || 0}%`}}
                            ></div>
                        </div>
                        <div className="progress-percentage">
                            {((stats.activeUsers / stats.totalUsers * 100) || 0).toFixed(1)}%
                        </div>
                    </div>

                    <div className="progress-item">
                        <div className="progress-label">
                            <span>مستخدمين جدد</span>
                            <span>{stats.newUsers} / {stats.totalUsers}</span>
                        </div>
                        <div className="progress-bar">
                            <div
                                className="progress-fill green"
                                style={{width: `${(stats.newUsers / stats.totalUsers * 100) || 0}%`}}
                            ></div>
                        </div>
                        <div className="progress-percentage">
                            {((stats.newUsers / stats.totalUsers * 100) || 0).toFixed(1)}%
                        </div>
                    </div>
                </div>
            </section>

            {/* Conversation Statistics */}
            <section className="stats-section">
                <h3 className="section-title">💬 إحصائيات المحادثات</h3>
                <div className="stats-grid">
                    <StatCard icon="💬" value={conversationStats.totalConversations} label="إجمالي المحادثات" color="cyan" />
                    <StatCard icon="✨" value={conversationStats.activeConversations} label="محادثات نشطة" color="teal" />
                    <StatCard icon="📨" value={conversationStats.totalMessages} label="إجمالي الرسائل" color="pink" />
                    <StatCard icon="👤" value={conversationStats.privateConversations} label="محادثات خاصة" color="indigo" />
                    <StatCard icon="👥" value={conversationStats.groupConversations} label="محادثات جماعية" color="amber" />
                </div>

                {/* Pie Chart */}
                <div className="chart-section">
                    <h4>توزيع المحادثات</h4>
                    <div className="pie-chart-wrapper">
                        <div className="pie-chart" style={{
                            background: `conic-gradient(
                                #6366f1 0deg ${(conversationStats.privateConversations / conversationStats.totalConversations * 360) || 0}deg,
                                #f59e0b ${(conversationStats.privateConversations / conversationStats.totalConversations * 360) || 0}deg 360deg
                            )`
                        }}>
                            <div className="pie-center">
                                <span>{conversationStats.totalConversations}</span>
                                <small>محادثة</small>
                            </div>
                        </div>
                        <div className="pie-legend">
                            <div className="legend-item">
                                <span className="legend-color indigo"></span>
                                <span>محادثات خاصة</span>
                                <span className="legend-value">{conversationStats.privateConversations}</span>
                            </div>
                            <div className="legend-item">
                                <span className="legend-color amber"></span>
                                <span>محادثات جماعية</span>
                                <span className="legend-value">{conversationStats.groupConversations}</span>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Messages Stats */}
                <div className="messages-stat">
                    <h4>معدل الرسائل</h4>
                    <div className="stat-box">
                        <div className="stat-box-icon">📊</div>
                        <div className="stat-box-content">
                            <h3>
                                {conversationStats.totalConversations > 0
                                    ? (conversationStats.totalMessages / conversationStats.totalConversations).toFixed(1)
                                    : 0}
                            </h3>
                            <p>رسالة لكل محادثة</p>
                        </div>
                    </div>
                </div>
            </section>
        </div>
    );
}

export default Stats;
