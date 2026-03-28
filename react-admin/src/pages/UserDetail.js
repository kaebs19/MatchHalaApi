import React, { useState, useEffect } from 'react';
import { getUserActivity, toggleUserActive, deleteUser } from '../services/api';
import { useToast } from '../components/Toast';
import { getImageUrl, getDefaultAvatar } from '../config';
import config from '../config';
import { formatDateTimeLong, formatDateLong } from '../utils/formatters';
import ConversationDetail from './ConversationDetail';
import ConversationMessages from './ConversationMessages';
import ConfirmModal from '../components/ConfirmModal';
import './UserDetail.css';

function UserDetail({ userId, onBack }) {
    const [loading, setLoading] = useState(true);
    const [userData, setUserData] = useState(null);
    const [activeTab, setActiveTab] = useState('info');
    const [viewingConversationId, setViewingConversationId] = useState(null);
    const [viewingConversationMessages, setViewingConversationMessages] = useState(false);
    const [showBanConfirm, setShowBanConfirm] = useState(false);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [actionLoading, setActionLoading] = useState(false);
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

    // Toggle active/inactive
    const handleToggleActive = async () => {
        setActionLoading(true);
        try {
            await toggleUserActive(userId);
            showToast(user.isActive ? 'تم تعطيل الحساب' : 'تم تفعيل الحساب', 'success');
            fetchUserActivity();
        } catch (err) {
            showToast('فشل في تغيير حالة الحساب', 'error');
        }
        setActionLoading(false);
    };

    // Ban/Unban user (banned words)
    const handleBanToggle = async () => {
        setActionLoading(true);
        try {
            const API_URL = config.API_URL;
            const token = localStorage.getItem('token');
            const isBanned = user.bannedWords?.isBanned;
            const res = await fetch(`${API_URL}/users/${userId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({
                    'bannedWords.isBanned': !isBanned,
                    'bannedWords.bannedAt': !isBanned ? new Date() : null,
                    'bannedWords.banReason': !isBanned ? 'حظر يدوي من الأدمن' : null,
                    isActive: isBanned ? true : false
                })
            });
            const data = await res.json();
            if (data.success) {
                showToast(isBanned ? 'تم فك الحظر' : 'تم حظر المستخدم', 'success');
                fetchUserActivity();
            }
        } catch (err) {
            showToast('فشل في تغيير حالة الحظر', 'error');
        }
        setActionLoading(false);
        setShowBanConfirm(false);
    };

    // Delete user
    const handleDeleteUser = async () => {
        setActionLoading(true);
        try {
            await deleteUser(userId);
            showToast('تم حذف المستخدم', 'success');
            onBack();
        } catch (err) {
            showToast('فشل في حذف المستخدم', 'error');
        }
        setActionLoading(false);
        setShowDeleteConfirm(false);
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

            {/* Quick Actions */}
            <div className="quick-actions-bar">
                <button
                    className={`action-btn ${user.isActive ? 'warning' : 'success'}`}
                    onClick={handleToggleActive}
                    disabled={actionLoading}
                >
                    {user.isActive ? '🔒 تعطيل الحساب' : '✅ تفعيل الحساب'}
                </button>
                <button
                    className={`action-btn ${user.bannedWords?.isBanned ? 'success' : 'danger'}`}
                    onClick={() => setShowBanConfirm(true)}
                    disabled={actionLoading}
                >
                    {user.bannedWords?.isBanned ? '🔓 فك الحظر' : '🚫 حظر المستخدم'}
                </button>
                <button
                    className="action-btn danger-outline"
                    onClick={() => setShowDeleteConfirm(true)}
                    disabled={actionLoading}
                >
                    🗑️ حذف المستخدم
                </button>
                {user.isPremium && (
                    <span className="premium-badge-large">⭐ Premium — {user.premiumPlan || 'مشترك'}</span>
                )}
            </div>

            {/* Ban Confirm Modal */}
            {showBanConfirm && (
                <ConfirmModal
                    title={user.bannedWords?.isBanned ? 'فك حظر المستخدم' : 'حظر المستخدم'}
                    message={user.bannedWords?.isBanned
                        ? `هل تريد فك حظر ${user.name}؟ سيتمكن من تسجيل الدخول مرة أخرى.`
                        : `هل تريد حظر ${user.name}؟ لن يتمكن من تسجيل الدخول أو إرسال رسائل.`}
                    confirmText={user.bannedWords?.isBanned ? 'فك الحظر' : 'حظر'}
                    onConfirm={handleBanToggle}
                    onCancel={() => setShowBanConfirm(false)}
                    loading={actionLoading}
                />
            )}

            {/* Delete Confirm Modal */}
            {showDeleteConfirm && (
                <ConfirmModal
                    title="حذف المستخدم"
                    message={`هل أنت متأكد من حذف ${user.name}؟ هذا الإجراء لا يمكن التراجع عنه.`}
                    confirmText="حذف نهائي"
                    onConfirm={handleDeleteUser}
                    onCancel={() => setShowDeleteConfirm(false)}
                    loading={actionLoading}
                    danger
                />
            )}

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
                        <div className="device-section">
                            <h4>📱 معلومات الجهاز والشبكة</h4>
                            <div className="device-grid">
                                {user.deviceInfo?.deviceModel && (
                                    <div className="device-item">
                                        <span className="device-label">📱 الجهاز:</span>
                                        <span className="device-value">{user.deviceInfo.deviceModel}</span>
                                    </div>
                                )}
                                {user.deviceInfo?.platform && (
                                    <div className="device-item">
                                        <span className="device-label">💻 النظام:</span>
                                        <span className="device-value">{user.deviceInfo.platform}</span>
                                    </div>
                                )}
                                {user.deviceInfo?.osVersion && (
                                    <div className="device-item">
                                        <span className="device-label">🔢 إصدار النظام:</span>
                                        <span className="device-value">{user.deviceInfo.osVersion}</span>
                                    </div>
                                )}
                                {user.deviceInfo?.appVersion && (
                                    <div className="device-item">
                                        <span className="device-label">📦 إصدار التطبيق:</span>
                                        <span className="device-value">{user.deviceInfo.appVersion}</span>
                                    </div>
                                )}
                                {user.deviceInfo?.language && (
                                    <div className="device-item">
                                        <span className="device-label">🌐 اللغة:</span>
                                        <span className="device-value">{user.deviceInfo.language}</span>
                                    </div>
                                )}
                                {user.city && (
                                    <div className="device-item">
                                        <span className="device-label">🏙️ المدينة:</span>
                                        <span className="device-value">{user.city}</span>
                                    </div>
                                )}
                                {user.lastIP && (
                                    <div className="device-item">
                                        <span className="device-label">🌐 آخر IP:</span>
                                        <span className="device-value ip-value">{user.lastIP}</span>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Login History */}
                        {user.loginHistory && user.loginHistory.length > 0 && (
                            <div className="login-history-section">
                                <h4>📋 سجل تسجيل الدخول (آخر {user.loginHistory.length})</h4>
                                <div className="login-history-table">
                                    <table className="bw-table">
                                        <thead>
                                            <tr>
                                                <th>التاريخ</th>
                                                <th>الجهاز</th>
                                                <th>النظام</th>
                                                <th>الإصدار</th>
                                                <th>الدولة</th>
                                                <th>المدينة</th>
                                                <th>IP</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {[...user.loginHistory].reverse().map((entry, idx) => (
                                                <tr key={idx}>
                                                    <td className="date-cell">{entry.loginAt ? new Date(entry.loginAt).toLocaleString('ar-SA') : '-'}</td>
                                                    <td>{entry.deviceModel || '-'}</td>
                                                    <td>{entry.platform || '-'}</td>
                                                    <td>{entry.appVersion || '-'}</td>
                                                    <td>{entry.country || '-'}</td>
                                                    <td>{entry.city || '-'}</td>
                                                    <td className="ip-value">{entry.ip || '-'}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        )}

                        {/* Banned Words Violations */}
                        {user.bannedWords && user.bannedWords.violations > 0 && (
                            <div className="violations-section">
                                <h4>⚠️ مخالفات الكلمات المحظورة</h4>
                                <div className="violations-info">
                                    <span className="violation-count">{user.bannedWords.violations} مخالفة</span>
                                    {user.bannedWords.isBanned && (
                                        <span className="violation-banned">🚫 محظور - {user.bannedWords.banReason}</span>
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
