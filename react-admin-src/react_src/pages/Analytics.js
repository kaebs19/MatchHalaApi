import React, { useState, useEffect } from 'react';
import { getAnalytics } from '../services/api';
import { useToast } from '../components/Toast';
import LoadingSpinner from '../components/LoadingSpinner';
import { getImageUrl, getDefaultAvatar } from '../config';
import { formatDateTimeLong } from '../utils/formatters';
import './Analytics.css';

function Analytics({ onViewUserDetail }) {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [activeSection, setActiveSection] = useState('overview');
    const { showToast } = useToast();

    useEffect(() => {
        fetchAnalytics();
    }, []);

    const fetchAnalytics = async () => {
        try {
            setLoading(true);
            const response = await getAnalytics();
            if (response.success) {
                setData(response.data);
            }
        } catch (error) {
            showToast('فشل تحميل التحليلات', 'error');
        } finally {
            setLoading(false);
        }
    };

    const formatDate = (date) => {
        if (!date) return '-';
        return formatDateTimeLong(date);
    };

    const getTimeSince = (date) => {
        if (!date) return 'غير معروف';
        const mins = Math.floor((new Date() - new Date(date)) / 60000);
        if (mins < 1) return 'الآن';
        if (mins < 60) return `${mins} دقيقة`;
        const hours = Math.floor(mins / 60);
        if (hours < 24) return `${hours} ساعة`;
        const days = Math.floor(hours / 24);
        return `${days} يوم`;
    };

    const getAgeLabel = (id) => {
        if (id === 18) return '18-24';
        if (id === 25) return '25-29';
        if (id === 30) return '30-34';
        if (id === 35) return '35-39';
        if (id === 40) return '40-49';
        if (id === 50) return '50+';
        return 'أخرى';
    };

    const getGenderLabel = (id) => {
        if (id === 'male') return 'ذكور';
        if (id === 'female') return 'إناث';
        return 'غير محدد';
    };

    const getAuthLabel = (id) => {
        if (id === 'google') return 'Google';
        if (id === 'apple') return 'Apple';
        if (id === 'app') return 'تطبيق';
        return id || 'غير محدد';
    };

    if (loading) return <LoadingSpinner text="جاري تحميل التحليلات..." />;
    if (!data) return <div className="analytics-error">فشل في تحميل البيانات</div>;

    return (
        <div className="analytics-page">
            {/* Navigation Tabs */}
            <div className="analytics-tabs">
                {[
                    { id: 'overview', label: 'نظرة عامة', icon: '📊' },
                    { id: 'top-users', label: 'الأكثر نشاطاً', icon: '🏆' },
                    { id: 'demographics', label: 'التركيبة', icon: '👥' },
                    { id: 'growth', label: 'النمو', icon: '📈' },
                    { id: 'locations', label: 'المواقع', icon: '🌍' }
                ].map(tab => (
                    <button
                        key={tab.id}
                        className={`analytics-tab ${activeSection === tab.id ? 'active' : ''}`}
                        onClick={() => setActiveSection(tab.id)}
                    >
                        <span>{tab.icon}</span>
                        <span>{tab.label}</span>
                    </button>
                ))}
            </div>

            {/* ════════════ Overview Section ════════════ */}
            {activeSection === 'overview' && (
                <div className="analytics-section">
                    {/* Profile Completeness */}
                    <div className="analytics-card">
                        <h3 className="card-title">📋 اكتمال البروفايلات</h3>
                        <div className="completeness-grid">
                            <div className="completeness-item">
                                <div className="completeness-circle green">
                                    {data.profileCompleteness.complete}
                                </div>
                                <span>مكتمل</span>
                            </div>
                            <div className="completeness-item">
                                <div className="completeness-circle orange">
                                    {data.profileCompleteness.noPhoto}
                                </div>
                                <span>بدون صورة</span>
                            </div>
                            <div className="completeness-item">
                                <div className="completeness-circle red">
                                    {data.profileCompleteness.noBio}
                                </div>
                                <span>بدون نبذة</span>
                            </div>
                            <div className="completeness-item">
                                <div className="completeness-circle blue">
                                    {data.profileCompleteness.total}
                                </div>
                                <span>الإجمالي</span>
                            </div>
                        </div>
                    </div>

                    {/* Device Stats */}
                    <div className="analytics-card">
                        <h3 className="card-title">📱 الأجهزة</h3>
                        <div className="bar-chart">
                            {data.deviceStats.map((d, i) => {
                                const maxCount = Math.max(...data.deviceStats.map(x => x.count));
                                return (
                                    <div key={i} className="bar-item">
                                        <div className="bar-label">{d._id || 'غير محدد'}</div>
                                        <div className="bar-track">
                                            <div
                                                className="bar-fill"
                                                style={{ width: `${(d.count / maxCount * 100)}%` }}
                                            />
                                        </div>
                                        <div className="bar-value">{d.count}</div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {/* Auth Providers */}
                    <div className="analytics-card">
                        <h3 className="card-title">🔐 طرق التسجيل</h3>
                        <div className="auth-stats-grid">
                            {data.authProviderStats.map((a, i) => (
                                <div key={i} className="auth-stat-item">
                                    <span className="auth-icon">
                                        {a._id === 'google' ? '🔵' : a._id === 'apple' ? '🍎' : '📱'}
                                    </span>
                                    <span className="auth-label">{getAuthLabel(a._id)}</span>
                                    <span className="auth-count">{a.count}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {/* ════════════ Top Users Section ════════════ */}
            {activeSection === 'top-users' && (
                <div className="analytics-section">
                    {/* Top Active */}
                    <div className="analytics-card full-width">
                        <h3 className="card-title">🏆 الأكثر نشاطاً (آخر 30 يوم)</h3>
                        <p className="card-subtitle">النقاط = (رسائل × 2) + سوايبات</p>
                        <div className="leaderboard">
                            {data.topActive.map((item, index) => (
                                <div
                                    key={item.userId}
                                    className={`leaderboard-item ${index < 3 ? 'top-three' : ''}`}
                                    onClick={() => onViewUserDetail && onViewUserDetail(item.userId)}
                                >
                                    <div className="rank">
                                        {index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `#${index + 1}`}
                                    </div>
                                    <img
                                        src={item.user.profileImage ? getImageUrl(item.user.profileImage) : getDefaultAvatar(item.user.name)}
                                        alt={item.user.name}
                                        className="leaderboard-avatar"
                                        onError={(e) => { e.target.src = getDefaultAvatar(item.user.name); }}
                                    />
                                    <div className="leaderboard-info">
                                        <span className="leaderboard-name">
                                            {item.user.name}
                                            {item.user.isPremium && <span className="premium-badge">👑</span>}
                                            {item.user.isOnline && <span className="online-dot" />}
                                        </span>
                                        <span className="leaderboard-detail">
                                            {item.messages} رسالة · {item.swipes} سوايب
                                        </span>
                                    </div>
                                    <div className="leaderboard-score">{item.score}</div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Top Messagers */}
                    <div className="analytics-card full-width">
                        <h3 className="card-title">💬 الأكثر إرسالاً للرسائل</h3>
                        <div className="leaderboard">
                            {data.topMessagers.map((item, index) => (
                                <div
                                    key={item.user._id || index}
                                    className={`leaderboard-item ${index < 3 ? 'top-three' : ''}`}
                                    onClick={() => onViewUserDetail && onViewUserDetail(item.user._id)}
                                >
                                    <div className="rank">
                                        {index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `#${index + 1}`}
                                    </div>
                                    <img
                                        src={item.user.profileImage ? getImageUrl(item.user.profileImage) : getDefaultAvatar(item.user.name)}
                                        alt={item.user.name}
                                        className="leaderboard-avatar"
                                        onError={(e) => { e.target.src = getDefaultAvatar(item.user.name); }}
                                    />
                                    <div className="leaderboard-info">
                                        <span className="leaderboard-name">
                                            {item.user.name}
                                            {item.user.isPremium && <span className="premium-badge">👑</span>}
                                        </span>
                                        <span className="leaderboard-detail">
                                            آخر رسالة: {getTimeSince(item.lastMessage)}
                                        </span>
                                    </div>
                                    <div className="leaderboard-score">{item.messageCount}</div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Most Online */}
                    <div className="analytics-card full-width">
                        <h3 className="card-title">🟢 الأكثر تواجداً (أحدث دخول)</h3>
                        <div className="leaderboard">
                            {data.mostOnline.map((user, index) => (
                                <div
                                    key={user._id}
                                    className="leaderboard-item"
                                    onClick={() => onViewUserDetail && onViewUserDetail(user._id)}
                                >
                                    <div className="rank">#{index + 1}</div>
                                    <img
                                        src={user.profileImage ? getImageUrl(user.profileImage) : getDefaultAvatar(user.name)}
                                        alt={user.name}
                                        className="leaderboard-avatar"
                                        onError={(e) => { e.target.src = getDefaultAvatar(user.name); }}
                                    />
                                    <div className="leaderboard-info">
                                        <span className="leaderboard-name">
                                            {user.name}
                                            {user.isPremium && <span className="premium-badge">👑</span>}
                                            {user.isOnline && <span className="online-dot" />}
                                        </span>
                                        <span className="leaderboard-detail">
                                            {user.email}
                                            {user.hasLocation && ' · 📍'}
                                        </span>
                                    </div>
                                    <div className="leaderboard-time">{getTimeSince(user.lastLogin)}</div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {/* ════════════ Demographics Section ════════════ */}
            {activeSection === 'demographics' && (
                <div className="analytics-section">
                    {/* Gender */}
                    <div className="analytics-card">
                        <h3 className="card-title">⚧ توزيع الجنس</h3>
                        <div className="donut-chart-container">
                            {(() => {
                                const total = data.genderStats.reduce((s, g) => s + g.count, 0);
                                const colors = { male: '#4A90D9', female: '#E91E63', other: '#9E9E9E' };
                                let offset = 0;
                                return (
                                    <>
                                        <svg viewBox="0 0 36 36" className="donut-chart">
                                            {data.genderStats.map((g, i) => {
                                                const pct = (g.count / total * 100);
                                                const dashArray = `${pct} ${100 - pct}`;
                                                const currentOffset = offset;
                                                offset += pct;
                                                return (
                                                    <circle key={i} cx="18" cy="18" r="15.9"
                                                        fill="none" stroke={colors[g._id] || '#9E9E9E'}
                                                        strokeWidth="3" strokeDasharray={dashArray}
                                                        strokeDashoffset={-currentOffset}
                                                        className="donut-segment"
                                                    />
                                                );
                                            })}
                                            <text x="18" y="18" textAnchor="middle" dy=".35em"
                                                className="donut-center-text">{total}</text>
                                        </svg>
                                        <div className="donut-legend">
                                            {data.genderStats.map((g, i) => (
                                                <div key={i} className="legend-item">
                                                    <span className="legend-dot" style={{ background: colors[g._id] || '#9E9E9E' }} />
                                                    <span>{getGenderLabel(g._id)}</span>
                                                    <span className="legend-count">{g.count} ({Math.round(g.count / total * 100)}%)</span>
                                                </div>
                                            ))}
                                        </div>
                                    </>
                                );
                            })()}
                        </div>
                    </div>

                    {/* Age Distribution */}
                    <div className="analytics-card">
                        <h3 className="card-title">🎂 توزيع الأعمار</h3>
                        <div className="bar-chart horizontal">
                            {data.ageStats.map((a, i) => {
                                const maxCount = Math.max(...data.ageStats.map(x => x.count));
                                return (
                                    <div key={i} className="bar-item">
                                        <div className="bar-label">{getAgeLabel(a._id)}</div>
                                        <div className="bar-track">
                                            <div
                                                className="bar-fill age"
                                                style={{ width: `${(a.count / maxCount * 100)}%` }}
                                            />
                                        </div>
                                        <div className="bar-value">{a.count}</div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
            )}

            {/* ════════════ Growth Section ════════════ */}
            {activeSection === 'growth' && (
                <div className="analytics-section">
                    {/* User Growth Chart */}
                    <div className="analytics-card full-width">
                        <h3 className="card-title">📈 نمو المستخدمين (آخر 30 يوم)</h3>
                        <div className="growth-chart">
                            {data.userGrowth.length > 0 ? (
                                <div className="chart-bars">
                                    {data.userGrowth.map((day, i) => {
                                        const maxVal = Math.max(...data.userGrowth.map(d => d.count));
                                        const height = maxVal > 0 ? (day.count / maxVal * 100) : 0;
                                        return (
                                            <div key={i} className="chart-bar-col" title={`${day._id}: ${day.count} مستخدم`}>
                                                <div className="chart-bar-value">{day.count}</div>
                                                <div className="chart-bar" style={{ height: `${height}%` }} />
                                                <div className="chart-bar-label">
                                                    {day._id.slice(5)}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            ) : (
                                <p className="no-data">لا توجد بيانات</p>
                            )}
                        </div>
                    </div>

                    {/* Message Growth Chart */}
                    <div className="analytics-card full-width">
                        <h3 className="card-title">💬 نمو الرسائل (آخر 30 يوم)</h3>
                        <div className="growth-chart">
                            {data.messageGrowth.length > 0 ? (
                                <div className="chart-bars">
                                    {data.messageGrowth.map((day, i) => {
                                        const maxVal = Math.max(...data.messageGrowth.map(d => d.count));
                                        const height = maxVal > 0 ? (day.count / maxVal * 100) : 0;
                                        return (
                                            <div key={i} className="chart-bar-col messages" title={`${day._id}: ${day.count} رسالة`}>
                                                <div className="chart-bar-value">{day.count}</div>
                                                <div className="chart-bar" style={{ height: `${height}%` }} />
                                                <div className="chart-bar-label">
                                                    {day._id.slice(5)}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            ) : (
                                <p className="no-data">لا توجد بيانات</p>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* ════════════ Locations Section ════════════ */}
            {activeSection === 'locations' && (
                <div className="analytics-section">
                    <div className="analytics-card">
                        <h3 className="card-title">🌍 توزيع الدول</h3>
                        <div className="bar-chart">
                            {data.locationStats.byCountry.map((loc, i) => {
                                const maxCount = Math.max(...data.locationStats.byCountry.map(x => x.count));
                                return (
                                    <div key={i} className="bar-item">
                                        <div className="bar-label">{loc._id || 'غير محدد'}</div>
                                        <div className="bar-track">
                                            <div
                                                className="bar-fill location"
                                                style={{ width: `${(loc.count / maxCount * 100)}%` }}
                                            />
                                        </div>
                                        <div className="bar-value">{loc.count}</div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    <div className="analytics-card">
                        <h3 className="card-title">📍 GPS الموقع الجغرافي</h3>
                        <div className="location-summary">
                            <div className="location-stat">
                                <div className="location-number green">{data.locationStats.withGPS}</div>
                                <span>لديهم موقع GPS</span>
                            </div>
                            <div className="location-stat">
                                <div className="location-number red">{data.locationStats.withoutGPS}</div>
                                <span>بدون موقع</span>
                            </div>
                            <div className="location-stat">
                                <div className="location-number blue">
                                    {data.locationStats.withGPS + data.locationStats.withoutGPS > 0
                                        ? Math.round(data.locationStats.withGPS / (data.locationStats.withGPS + data.locationStats.withoutGPS) * 100)
                                        : 0}%
                                </div>
                                <span>نسبة التفعيل</span>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

export default Analytics;
