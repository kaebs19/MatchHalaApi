import React, { useState, useEffect } from 'react';
import { getUserActivity } from '../services/api';
import { useToast } from '../components/Toast';
import { getImageUrl, getDefaultAvatar } from '../config';
import { formatDateTimeLong, formatDateLong } from '../utils/formatters';
import ConversationDetail from './ConversationDetail';
import ConversationMessages from './ConversationMessages';
import './UserDetail.css';

function UserDetail({ userId, onBack }) {
    const [loading, setLoading] = useState(true);
    const [userData, setUserData] = useState(null);
    const [activeTab, setActiveTab] = useState('info');
    const [viewingConversationId, setViewingConversationId] = useState(null);
    const [viewingConversationMessages, setViewingConversationMessages] = useState(false);
    const { showToast } = useToast();

    useEffect(() => {
        fetchUserActivity();
    }, [userId]);

    const fetchUserActivity = async () => {
        try {
            setLoading(true);
            const response = await getUserActivity(userId);
            setUserData(response.data);
        } catch (error) {
            showToast('فشل في تحميل بيانات المستخدم', 'error');
            console.error('Error fetching user activity:', error);
        } finally {
            setLoading(false);
        }
    };

    const formatDate = (date) => formatDateTimeLong(date) === '-' ? 'غير محدد' : formatDateTimeLong(date);
    const formatBirthDate = (date) => formatDateLong(date) === '-' ? 'غير محدد' : formatDateLong(date);

    const calculateAge = (birthDate) => {
        if (!birthDate) return null;
        const today = new Date();
        const birth = new Date(birthDate);
        let age = today.getFullYear() - birth.getFullYear();
        const monthDiff = today.getMonth() - birth.getMonth();
        if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
            age--;
        }
        return age;
    };

    const getGenderText = (gender) => {
        switch (gender) {
            case 'male': return 'ذكر';
            case 'female': return 'أنثى';
            default: return 'غير محدد';
        }
    };

    const getAuthProviderText = (provider) => {
        switch (provider) {
            case 'google': return 'Google';
            case 'apple': return 'Apple';
            case 'app': return 'التطبيق';
            default: return 'غير محدد';
        }
    };

    const getAuthProviderIcon = (provider) => {
        switch (provider) {
            case 'google': return '🔵';
            case 'apple': return '🍎';
            case 'app': return '📱';
            default: return '❓';
        }
    };

    if (loading) {
        return (
            <div className="user-detail">
                <div className="loading">جاري التحميل...</div>
            </div>
        );
    }

    if (!userData) {
        return (
            <div className="user-detail">
                <div className="error">لم يتم العثور على بيانات المستخدم</div>
            </div>
        );
    }

    const { user, stats, conversations, recentMessages } = userData;
    const userAge = calculateAge(user.birthDate);

    // عرض تفاصيل محادثة
    if (viewingConversationId && !viewingConversationMessages) {
        return (
            <ConversationDetail
                conversationId={viewingConversationId}
                onBack={() => setViewingConversationId(null)}
            />
        );
    }

    // عرض رسائل محادثة مباشرة
    if (viewingConversationId && viewingConversationMessages) {
        return (
            <ConversationMessages
                conversationId={viewingConversationId}
                onBack={() => {
                    setViewingConversationId(null);
                    setViewingConversationMessages(false);
                }}
            />
        );
    }

    return (
        <div className="user-detail">
            <div className="detail-header">
                <button onClick={onBack} className="back-btn">
                    ← رجوع
                </button>
                <h2>تفاصيل المستخدم</h2>
            </div>

            {/* User Info Card */}
            <div className="user-info-card">
                <div className="user-avatar-container">
                    {user.profileImage ? (
                        <img
                            src={getImageUrl(user.profileImage)}
                            alt={user.name}
                            className="user-avatar-image"
                            onError={(e) => {
                                e.target.onerror = null;
                                e.target.src = getDefaultAvatar(user.name);
                            }}
                        />
                    ) : (
                        <div className="user-avatar-large">
                            {user.name.charAt(0)}
                        </div>
                    )}
                    <span className={`status-indicator ${user.isActive ? 'online' : 'offline'}`}></span>
                </div>
                <div className="user-info-details">
                    <h3>{user.name}</h3>
                    <p className="user-email">{user.email}</p>
                    <div className="user-badges">
                        <span className={`role-badge ${user.role}`}>
                            {user.role === 'admin' ? 'مدير' : 'مستخدم'}
                        </span>
                        <span className={`status-badge ${user.isActive ? 'active' : 'inactive'}`}>
                            {user.isActive ? 'نشط' : 'غير نشط'}
                        </span>
                        <span className="auth-badge">
                            {getAuthProviderIcon(user.authProvider)} {getAuthProviderText(user.authProvider)}
                        </span>
                    </div>
                    <p className="user-joined">
                        انضم في: {formatDate(user.createdAt)}
                    </p>
                    {user.lastLogin && (
                        <p className="user-last-login">
                            آخر دخول: {formatDate(user.lastLogin)}
                        </p>
                    )}
                </div>
            </div>

            {/* Tabs Navigation */}
            <div className="tabs-navigation">
                <button
                    className={`tab-btn ${activeTab === 'info' ? 'active' : ''}`}
                    onClick={() => setActiveTab('info')}
                >
                    👤 المعلومات الشخصية
                </button>
                <button
                    className={`tab-btn ${activeTab === 'stats' ? 'active' : ''}`}
                    onClick={() => setActiveTab('stats')}
                >
                    📊 الإحصائيات
                </button>
                <button
                    className={`tab-btn ${activeTab === 'conversations' ? 'active' : ''}`}
                    onClick={() => setActiveTab('conversations')}
                >
                    💬 المحادثات
                </button>
                <button
                    className={`tab-btn ${activeTab === 'messages' ? 'active' : ''}`}
                    onClick={() => setActiveTab('messages')}
                >
                    📨 الرسائل
                </button>
            </div>

            {/* Tab Content */}
            <div className="tab-content">
                {/* Personal Info Tab */}
                {activeTab === 'info' && (
                    <div className="personal-info-section">
                        <h3>👤 المعلومات الشخصية</h3>
                        <div className="info-grid">
                            <div className="info-item">
                                <span className="info-icon">🎂</span>
                                <div className="info-content">
                                    <p className="info-label">تاريخ الميلاد</p>
                                    <p className="info-value">
                                        {formatBirthDate(user.birthDate)}
                                        {userAge && <span className="age-badge">({userAge} سنة)</span>}
                                    </p>
                                </div>
                            </div>
                            <div className="info-item">
                                <span className="info-icon">⚧</span>
                                <div className="info-content">
                                    <p className="info-label">الجنس</p>
                                    <p className="info-value">{getGenderText(user.gender)}</p>
                                </div>
                            </div>
                            <div className="info-item">
                                <span className="info-icon">🌍</span>
                                <div className="info-content">
                                    <p className="info-label">الدولة</p>
                                    <p className="info-value">{user.country || 'غير محدد'}</p>
                                </div>
                            </div>
                            {user.location && user.location.coordinates &&
                             user.location.coordinates.length === 2 &&
                             (user.location.coordinates[0] !== 0 || user.location.coordinates[1] !== 0) && (
                                <div className="info-item">
                                    <span className="info-icon">📍</span>
                                    <div className="info-content">
                                        <p className="info-label">الموقع الجغرافي</p>
                                        <p className="info-value">
                                            {user.location.coordinates[1].toFixed(4)}, {user.location.coordinates[0].toFixed(4)}
                                            <a
                                                href={`https://www.google.com/maps?q=${user.location.coordinates[1]},${user.location.coordinates[0]}`}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="map-link"
                                            >
                                                عرض على الخريطة
                                            </a>
                                        </p>
                                    </div>
                                </div>
                            )}
                            <div className="info-item">
                                <span className="info-icon">🔐</span>
                                <div className="info-content">
                                    <p className="info-label">طريقة التسجيل</p>
                                    <p className="info-value">
                                        {getAuthProviderIcon(user.authProvider)} {getAuthProviderText(user.authProvider)}
                                    </p>
                                </div>
                            </div>
                        </div>

                        {/* Bio Section */}
                        <div className="bio-section">
                            <h4>📝 نبذة عن المستخدم</h4>
                            <div className="bio-content">
                                {user.bio ? (
                                    <p>{user.bio}</p>
                                ) : (
                                    <p className="no-bio">لم يتم إضافة نبذة</p>
                                )}
                            </div>
                        </div>

                        {/* Privacy Settings */}
                        {user.privacySettings && (
                            <div className="privacy-section">
                                <h4>🔒 إعدادات الخصوصية</h4>
                                <div className="privacy-grid">
                                    <div className="privacy-item">
                                        <span className="privacy-label">ظهور الملف الشخصي:</span>
                                        <span className="privacy-value">
                                            {user.privacySettings.profileVisibility === 'public' && '🌐 عام'}
                                            {user.privacySettings.profileVisibility === 'contacts' && '👥 جهات الاتصال'}
                                            {user.privacySettings.profileVisibility === 'private' && '🔒 خاص'}
                                        </span>
                                    </div>
                                    <div className="privacy-item">
                                        <span className="privacy-label">إظهار آخر ظهور:</span>
                                        <span className="privacy-value">
                                            {user.privacySettings.showLastSeen ? '✅ مفعل' : '❌ معطل'}
                                        </span>
                                    </div>
                                    <div className="privacy-item">
                                        <span className="privacy-label">صوت الإشعارات:</span>
                                        <span className="privacy-value">
                                            {user.privacySettings.notificationSound ? '🔔 مفعل' : '🔕 معطل'}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Device Info */}
                        {user.deviceInfo && (user.deviceInfo.platform || user.deviceInfo.osVersion || user.deviceInfo.appVersion) && (
                            <div className="device-section">
                                <h4>📱 معلومات الجهاز</h4>
                                <div className="device-grid">
                                    {user.deviceInfo.platform && (
                                        <div className="device-item">
                                            <span className="device-label">النظام:</span>
                                            <span className="device-value">{user.deviceInfo.platform}</span>
                                        </div>
                                    )}
                                    {user.deviceInfo.osVersion && (
                                        <div className="device-item">
                                            <span className="device-label">إصدار النظام:</span>
                                            <span className="device-value">{user.deviceInfo.osVersion}</span>
                                        </div>
                                    )}
                                    {user.deviceInfo.appVersion && (
                                        <div className="device-item">
                                            <span className="device-label">إصدار التطبيق:</span>
                                            <span className="device-value">{user.deviceInfo.appVersion}</span>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {/* Stats Tab */}
                {activeTab === 'stats' && (
                    <div className="stats-section">
                        <h3>📊 إحصائيات النشاط</h3>
                        <div className="stats-grid">
                            <div className="stat-card">
                                <div className="stat-icon">💬</div>
                                <div className="stat-info">
                                    <p className="stat-label">المحادثات</p>
                                    <p className="stat-value">{stats.totalConversations}</p>
                                </div>
                            </div>
                            <div className="stat-card">
                                <div className="stat-icon">📨</div>
                                <div className="stat-info">
                                    <p className="stat-label">الرسائل المرسلة</p>
                                    <p className="stat-value">{stats.totalMessagesSent}</p>
                                </div>
                            </div>
                            <div className="stat-card">
                                <div className="stat-icon">👥</div>
                                <div className="stat-info">
                                    <p className="stat-label">المحادثات النشطة</p>
                                    <p className="stat-value">{stats.activeConversations}</p>
                                </div>
                            </div>
                            <div className="stat-card">
                                <div className="stat-icon">📅</div>
                                <div className="stat-info">
                                    <p className="stat-label">آخر رسالة</p>
                                    <p className="stat-value">
                                        {stats.lastMessageDate
                                            ? formatDate(stats.lastMessageDate).split(' ')[0]
                                            : 'لا يوجد'}
                                    </p>
                                </div>
                            </div>
                        </div>

                        {/* Additional Stats */}
                        <div className="additional-stats">
                            <div className="stat-row">
                                <span className="stat-row-label">🚫 المستخدمين المحظورين:</span>
                                <span className="stat-row-value">{user.blockedUsers?.length || 0}</span>
                            </div>
                            <div className="stat-row">
                                <span className="stat-row-label">🔇 المحادثات المكتومة:</span>
                                <span className="stat-row-value">{user.mutedConversations?.length || 0}</span>
                            </div>
                        </div>
                    </div>
                )}

                {/* Conversations Tab */}
                {activeTab === 'conversations' && (
                    <div className="conversations-section">
                        <h3>💬 المحادثات ({conversations.length})</h3>
                        {conversations.length === 0 ? (
                            <p className="empty-message">لا توجد محادثات لهذا المستخدم</p>
                        ) : (
                            <div className="conversations-list">
                                {conversations.map((conv) => (
                                    <div key={conv._id} className="conversation-item clickable">
                                        <div className="conversation-header">
                                            <h4>{conv.title}</h4>
                                            <span className={`conv-type ${conv.type}`}>
                                                {conv.type === 'private' ? 'خاصة' : 'جماعية'}
                                            </span>
                                        </div>
                                        <div className="conversation-meta">
                                            <p>👥 {conv.metadata.totalParticipants} مشارك</p>
                                            <p>📨 {conv.metadata.totalMessages} رسالة</p>
                                            <p className={conv.isActive ? 'active' : 'inactive'}>
                                                {conv.isActive ? '● نشطة' : '○ غير نشطة'}
                                            </p>
                                        </div>
                                        <p className="conversation-date">
                                            آخر تحديث: {formatDate(conv.updatedAt)}
                                        </p>
                                        <div className="conversation-actions-row">
                                            <button
                                                className="conv-action-btn view-detail"
                                                onClick={() => setViewingConversationId(conv._id)}
                                            >
                                                👁️ التفاصيل
                                            </button>
                                            <button
                                                className="conv-action-btn view-messages"
                                                onClick={() => {
                                                    setViewingConversationId(conv._id);
                                                    setViewingConversationMessages(true);
                                                }}
                                            >
                                                💬 الرسائل
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {/* Messages Tab */}
                {activeTab === 'messages' && (
                    <div className="messages-section">
                        <h3>📨 آخر الرسائل ({recentMessages.length})</h3>
                        {recentMessages.length === 0 ? (
                            <p className="empty-message">لا توجد رسائل حديثة</p>
                        ) : (
                            <div className="messages-list">
                                {recentMessages.map((msg) => (
                                    <div key={msg._id} className="message-item enhanced">
                                        <div className="message-header">
                                            <span className={`message-type ${msg.type}`}>
                                                {msg.type === 'text' && '📝 نص'}
                                                {msg.type === 'image' && '🖼️ صورة'}
                                                {msg.type === 'file' && '📎 ملف'}
                                                {msg.type === 'audio' && '🎵 صوت'}
                                                {msg.type === 'video' && '🎥 فيديو'}
                                            </span>
                                            <span className={`message-status ${msg.status}`}>
                                                {msg.status === 'read' && '✓✓ مقروءة'}
                                                {msg.status === 'delivered' && '✓ مُوصلة'}
                                                {msg.status === 'sent' && '○ مرسلة'}
                                            </span>
                                        </div>
                                        {msg.content && <p className="message-content">{msg.content}</p>}
                                        {msg.type === 'image' && msg.mediaUrl && (
                                            <div className="message-media">
                                                <img
                                                    src={getImageUrl(msg.mediaUrl)}
                                                    alt="صورة"
                                                    className="message-image-preview"
                                                    onError={(e) => { e.target.style.display = 'none'; }}
                                                />
                                            </div>
                                        )}
                                        <p className="message-date">
                                            {formatDate(msg.createdAt)}
                                        </p>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}

export default UserDetail;
