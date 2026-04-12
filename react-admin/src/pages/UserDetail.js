import React, { useState, useEffect } from 'react';
import { userBioAction,
    getUserActivity,
    suspendUser,
    unsuspendUser,
    setUserViolations,
    userNameAction,
    deleteUserPhoto,
    sendUserNotification,
    restrictUser,
    getUserReportsCount
} from '../services/api';
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

    // Admin Actions State
    const [actionLoading, setActionLoading] = useState(false);
    const [showSuspendModal, setShowSuspendModal] = useState(false);
    const [showNameModal, setShowNameModal] = useState(false);
    const [showNotifyModal, setShowNotifyModal] = useState(false);
    const [showViolationsModal, setShowViolationsModal] = useState(false);
    const [showPhotoDeleteModal, setShowPhotoDeleteModal] = useState(false);
    const [showRestrictModal, setShowRestrictModal] = useState(false);

    // Suspend form
    const [suspendForm, setSuspendForm] = useState({ duration: 'auto', customDays: 7, reason: '' });
    // Restrict form
    const [restrictForm, setRestrictForm] = useState({ type: 'photo', duration: '7d', reason: '' });
    // Name action form
    const [nameForm, setNameForm] = useState({ action: 'suspend', reason: '', newName: '' });
    // Notification form
    const [notifyForm, setNotifyForm] = useState({ title: '', body: '' });
    // Violations form
    const [violationsCount, setViolationsCount] = useState(0);
    // Photo delete form
    const [photoDeleteForm, setPhotoDeleteForm] = useState({ photoIndex: 'profile', reason: '' });
    // Reports count
    const [reportsCount, setReportsCount] = useState(null);
    // Photo lightbox
    const [lightboxImage, setLightboxImage] = useState(null);
    const [convFilter, setConvFilter] = useState('all');

    useEffect(() => {
        fetchUserActivity();
        fetchReportsCount();
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

    const fetchReportsCount = async () => {
        try {
            const response = await getUserReportsCount(userId);
            if (response.success) {
                setReportsCount(response.data);
            }
        } catch (error) {
            console.error('Error fetching reports count:', error);
        }
    };

    // ========== Admin Action Handlers ==========

    const handleSuspendUser = async () => {
        try {
            setActionLoading(true);
            const res = await suspendUser(userId, suspendForm.duration === 'custom' ? `${suspendForm.customDays}d` : suspendForm.duration, suspendForm.reason);
            if (res.success) {
                showToast('تم تعليق المستخدم بنجاح', 'success');
                setShowSuspendModal(false);
                setSuspendForm({ duration: 'auto', customDays: 7, reason: '' });
                fetchUserActivity();
            }
        } catch (error) {
            showToast(error.response?.data?.message || 'فشل في تعليق المستخدم', 'error');
        } finally {
            setActionLoading(false);
        }
    };

    const handleUnsuspendUser = async () => {
        try {
            setActionLoading(true);
            const res = await unsuspendUser(userId);
            if (res.success) {
                showToast('تم إلغاء تعليق المستخدم', 'success');
                fetchUserActivity();
            }
        } catch (error) {
            showToast(error.response?.data?.message || 'فشل في إلغاء التعليق', 'error');
        } finally {
            setActionLoading(false);
        }
    };

    const handleSetViolations = async () => {
        try {
            setActionLoading(true);
            const res = await setUserViolations(userId, violationsCount);
            if (res.success) {
                showToast(`تم تحديد المخالفات إلى ${violationsCount}`, 'success');
                setShowViolationsModal(false);
                fetchUserActivity();
            }
        } catch (error) {
            showToast(error.response?.data?.message || 'فشل في تحديث المخالفات', 'error');
        } finally {
            setActionLoading(false);
        }
    };

    const handleNameAction = async () => {
        try {
            setActionLoading(true);
            const res = await userNameAction(userId, nameForm.action, nameForm.reason, nameForm.newName);
            if (res.success) {
                const actionText = {
                    'suspend': 'تم تعليق الاسم',
                    'ban': 'تم حظر الاسم',
                    'restore': 'تم استعادة الاسم',
                    'change': 'تم تغيير الاسم'
                };
                showToast(actionText[nameForm.action] || 'تم تنفيذ الإجراء', 'success');
                setShowNameModal(false);
                setNameForm({ action: 'suspend', reason: '', newName: '' });
                fetchUserActivity();
            }
        } catch (error) {
            showToast(error.response?.data?.message || 'فشل في تنفيذ إجراء الاسم', 'error');
        } finally {
            setActionLoading(false);
        }
    };

    const handleDeletePhoto = async () => {
        try {
            setActionLoading(true);
            const res = await deleteUserPhoto(userId, photoDeleteForm.photoIndex, photoDeleteForm.reason);
            if (res.success) {
                showToast('تم حذف الصورة وإشعار المستخدم', 'success');
                setShowPhotoDeleteModal(false);
                setPhotoDeleteForm({ photoIndex: 'profile', reason: '' });
                fetchUserActivity();
            }
        } catch (error) {
            showToast(error.response?.data?.message || 'فشل في حذف الصورة', 'error');
        } finally {
            setActionLoading(false);
        }
    };

    const handleRestrict = async () => {
        try {
            setActionLoading(true);
            const res = await restrictUser(userId, restrictForm.type, restrictForm.duration, restrictForm.reason);
            if (res.success) {
                showToast(res.message || 'تم تطبيق القيد بنجاح', 'success');
                setShowRestrictModal(false);
                setRestrictForm({ type: 'photo', duration: '7d', reason: '' });
                fetchUserActivity();
            }
        } catch (error) {
            showToast(error.response?.data?.message || 'فشل في تطبيق القيد', 'error');
        } finally {
            setActionLoading(false);
        }
    };

    const handleSendNotification = async () => {
        if (!notifyForm.title || !notifyForm.body) {
            showToast('العنوان والمحتوى مطلوبان', 'error');
            return;
        }
        try {
            setActionLoading(true);
            const res = await sendUserNotification(notifyForm.title, notifyForm.body, userId, 'id');
            if (res.success) {
                showToast('تم إرسال الإشعار بنجاح', 'success');
                setShowNotifyModal(false);
                setNotifyForm({ title: '', body: '' });
            }
        } catch (error) {
            showToast(error.response?.data?.message || 'فشل في إرسال الإشعار', 'error');
        } finally {
            setActionLoading(false);
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


    const getAccountAge = (createdAt) => {
        if (!createdAt) return '';
        const now = new Date();
        const created = new Date(createdAt);
        const diffMs = now - created;
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
        if (diffDays < 1) return 'اليوم';
        if (diffDays < 30) return `منذ ${diffDays} يوم`;
        const diffMonths = Math.floor(diffDays / 30);
        if (diffMonths < 12) return `منذ ${diffMonths} شهر`;
        const diffYears = Math.floor(diffMonths / 12);
        return `منذ ${diffYears} سنة`;
    };

    const getTimeSince = (date) => {
        if (!date) return 'غير معروف';
        const now = new Date();
        const d = new Date(date);
        const diffMs = now - d;
        const diffMins = Math.floor(diffMs / 60000);
        if (diffMins < 1) return 'الآن';
        if (diffMins < 60) return `منذ ${diffMins} دقيقة`;
        const diffHours = Math.floor(diffMins / 60);
        if (diffHours < 24) return `منذ ${diffHours} ساعة`;
        const diffDays = Math.floor(diffHours / 24);
        return `منذ ${diffDays} يوم`;
    };

    const buildTimelineEvents = () => {
        if (!userData) return [];
        const events = [];
        // Account creation
        if (user.createdAt) {
            events.push({ date: user.createdAt, type: 'created', color: 'green', icon: '🟢', text: 'إنشاء الحساب' });
        }
        // Suspension history
        if (user.suspension?.history) {
            user.suspension.history.forEach(h => {
                events.push({
                    date: h.suspendedAt || h.date,
                    type: 'suspension',
                    color: 'red',
                    icon: '🔴',
                    text: `تعليق — المستوى ${h.level} — ${h.reason || 'بدون سبب'}`,
                    detail: h.suspendedUntil ? `حتى ${new Date(h.suspendedUntil).toLocaleDateString('ar-SA')}` : 'دائم'
                });
            });
        }
        // Warnings history
        if (user.warnings?.history) {
            user.warnings.history.forEach(w => {
                events.push({
                    date: w.date || w.createdAt,
                    type: 'warning',
                    color: 'yellow',
                    icon: '🟡',
                    text: `تحذير — ${w.reason || w.message || 'بدون سبب'}`
                });
            });
        }
        // Appeals
        if (userData.appeals) {
            (Array.isArray(userData.appeals) ? userData.appeals : []).forEach(a => {
                events.push({
                    date: a.createdAt || a.date,
                    type: 'appeal',
                    color: a.status === 'approved' ? 'green' : 'blue',
                    icon: a.status === 'approved' ? '🟢' : '🔵',
                    text: `استئناف — ${a.status === 'approved' ? 'مقبول' : a.status === 'rejected' ? 'مرفوض' : 'قيد المراجعة'}`,
                    detail: a.reason || a.message || ''
                });
            });
        }
        // Recent reports received
        if (userData.recentReportsReceived) {
            (Array.isArray(userData.recentReportsReceived) ? userData.recentReportsReceived : []).forEach(r => {
                events.push({
                    date: r.createdAt || r.date,
                    type: 'report',
                    color: 'red',
                    icon: '🔴',
                    text: `بلاغ — ${r.reason || r.type || 'غير محدد'}`,
                    detail: r.description || ''
                });
            });
        }
        // Sort newest first
        events.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
        return events;
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
                    <p className="user-id" style={{fontSize: '12px', color: '#95a5a6', direction: 'ltr', textAlign: 'right', margin: '2px 0 8px', fontFamily: 'monospace', cursor: 'pointer'}}
                       onClick={() => { navigator.clipboard.writeText(user._id); showToast('تم نسخ المعرف', 'success'); }}
                       title="انقر للنسخ">
                        {user.halaId ? `معرف هلا: ${user.halaId}` : `ID: ${user._id}`}
                    </p>
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
                    {/* Enhanced badges row */}
                    <div className="user-badges" style={{marginTop: '6px'}}>
                        <span className="account-age-badge" title={formatDate(user.createdAt)}>
                            🕐 {getAccountAge(user.createdAt)}
                        </span>
                        {user.isOnline ? (
                            <span className="online-status-badge online">🟢 متصل الآن</span>
                        ) : (
                            <span className="online-status-badge offline">آخر ظهور: {getTimeSince(user.lastLogin)}</span>
                        )}
                        {(user.isPremium || user.subscription?.isActive) && (
                            <span className="premium-badge">⭐ Premium</span>
                        )}
                        {(reportsCount?.totalReports > 0 || userData?.reportsCount > 0) && (
                            <span className="reports-badge">🚨 {reportsCount?.totalReports || userData?.reportsCount || 0} بلاغ</span>
                        )}
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

            {/* Suspension Status Bar */}
            <div className={`suspension-status-bar ${
                user.suspension?.isSuspended
                    ? (user.suspension.suspendedUntil ? 'temp-suspended' : 'perm-suspended')
                    : user.restrictions?.messagingRestricted
                        ? 'restricted'
                        : 'active-account'
            }`}>
                {user.suspension?.isSuspended ? (
                    user.suspension.suspendedUntil ? (
                        <span>🟡 معلّق مؤقتاً — حتى {formatDate(user.suspension.suspendedUntil)}</span>
                    ) : (
                        <span>🔴 معلّق نهائياً</span>
                    )
                ) : user.restrictions?.messagingRestricted ? (
                    <span>🟠 مقيّد — الرسائل محظورة</span>
                ) : (
                    <span>🟢 حساب نشط</span>
                )}
            </div>

            {/* Quick Actions Row */}
            <div className="quick-actions-row">
                {user.suspension?.isSuspended ? (
                    <button className="quick-action-btn unsuspend" onClick={handleUnsuspendUser} disabled={actionLoading}>
                        🔓 فك التعليق
                    </button>
                ) : (
                    <button className="quick-action-btn suspend" onClick={() => setShowSuspendModal(true)} disabled={actionLoading}>
                        ⛔ تعليق
                    </button>
                )}
                <button className="quick-action-btn notify" onClick={() => setShowNotifyModal(true)} disabled={actionLoading}>
                    📩 إرسال إشعار
                </button>
                <button className="quick-action-btn copy-id" onClick={() => { navigator.clipboard.writeText(user._id); showToast('تم نسخ المعرف', 'success'); }}>
                    📋 نسخ المعرف
                </button>
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
                <button
                    className={`tab-btn ${activeTab === 'photos' ? 'active' : ''}`}
                    onClick={() => setActiveTab('photos')}
                >
                    🖼️ الصور ({(user.photos?.length || 0) + (user.profileImage ? 1 : 0)})
                </button>
                <button
                    className={`tab-btn ${activeTab === 'timeline' ? 'active' : ''}`}
                    onClick={() => setActiveTab('timeline')}
                >
                    📜 سجل الأحداث
                </button>
                <button
                    className={`tab-btn ${activeTab === 'admin-actions' ? 'active' : ''}`}
                    onClick={() => {
                        setActiveTab('admin-actions');
                        setViolationsCount(user.bannedWords?.violations || 0);
                    }}
                >
                    🛡️ إجراءات الأدمن
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

                        {/* Interests Section */}
                        {user.interests && user.interests.length > 0 && (
                            <div className="interests-section" style={{marginTop: '20px'}}>
                                <h4>✨ الاهتمامات</h4>
                                <div className="interest-chips">
                                    {user.interests.map((interest, idx) => (
                                        <span key={idx} className="interest-chip">{interest}</span>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Bio Section */}
                        <div className="bio-section">
                            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>                                <h4>📝 نبذة عن المستخدم {user.bioStatus?.status === 'banned' ? <span className="bio-status-badge banned">🔴 محظورة</span> : user.bio ? <span className="bio-status-badge normal">🟢 عادية</span> : null}</h4>
                                {user.nameStatus?.status && user.nameStatus.status !== 'normal' && (
                                    <span className="name-status-inline-badge">{user.nameStatus.status === 'banned' ? '🔴 الاسم محظور' : '🟡 الاسم معلّق'}</span>
                                )}                                {user.bio && (                                    user.bioStatus?.status === "banned" ? (                                        <button onClick={async () => { try { const r = await userBioAction(userId, "restore"); if(r.success){showToast("تم إعادة النبذة","success");fetchUserActivity();}} catch(e){showToast("فشل","error")}}} style={{padding:"4px 12px",borderRadius:"8px",border:"1px solid #22c55e",background:"#dcfce7",color:"#166534",fontSize:"12px",cursor:"pointer"}}>↩️ إعادة النبذة</button>                                    ) : (                                        <button onClick={async () => { try { const r = await userBioAction(userId, "ban", "نبذة مخالفة"); if(r.success){showToast("تم حظر النبذة","success");fetchUserActivity();}} catch(e){showToast("فشل","error")}}} style={{padding:"4px 12px",borderRadius:"8px",border:"1px solid #ef4444",background:"#fef2f2",color:"#dc2626",fontSize:"12px",cursor:"pointer"}}>🚫 حظر النبذة</button>                                    )                                )}                            </div>
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

                        {/* Extended Stats */}
                        <div className="stats-grid" style={{marginTop: '20px'}}>
                            <div className="stat-card">
                                <div className="stat-icon">👍</div>
                                <div className="stat-info">
                                    <p className="stat-label">لايكات أُرسلت</p>
                                    <p className="stat-value">{stats.likesGiven || 0}</p>
                                </div>
                            </div>
                            <div className="stat-card">
                                <div className="stat-icon">👎</div>
                                <div className="stat-info">
                                    <p className="stat-label">ديسلايك</p>
                                    <p className="stat-value">{stats.dislikesGiven || 0}</p>
                                </div>
                            </div>
                            <div className="stat-card">
                                <div className="stat-icon">⭐</div>
                                <div className="stat-info">
                                    <p className="stat-label">سوبر لايك</p>
                                    <p className="stat-value">{stats.superlikesGiven || 0}</p>
                                </div>
                            </div>
                            <div className="stat-card">
                                <div className="stat-icon">❤️</div>
                                <div className="stat-info">
                                    <p className="stat-label">لايكات مُستقبلة</p>
                                    <p className="stat-value">{stats.likesReceived || 0}</p>
                                </div>
                            </div>
                            <div className="stat-card">
                                <div className="stat-icon">👁️</div>
                                <div className="stat-info">
                                    <p className="stat-label">زوار البروفايل</p>
                                    <p className="stat-value">{stats.profileViewsReceived || 0}</p>
                                </div>
                            </div>
                            <div className="stat-card">
                                <div className="stat-icon">🚨</div>
                                <div className="stat-info">
                                    <p className="stat-label">بلاغات عليه</p>
                                    <p className="stat-value">{stats.reportsReceived || 0}</p>
                                </div>
                            </div>
                            <div className="stat-card">
                                <div className="stat-icon">📢</div>
                                <div className="stat-info">
                                    <p className="stat-label">بلاغات أرسلها</p>
                                    <p className="stat-value">{stats.reportsSent || 0}</p>
                                </div>
                            </div>
                            <div className="stat-card">
                                <div className="stat-icon">🤖</div>
                                <div className="stat-info">
                                    <p className="stat-label">بلاغات سبام</p>
                                    <p className="stat-value">{stats.spamReportsCount || 0}</p>
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
                        <div className="conv-filters">
                            <button className={convFilter === 'all' ? 'active' : ''} onClick={() => setConvFilter('all')}>الكل</button>
                            <button className={convFilter === 'active' ? 'active' : ''} onClick={() => setConvFilter('active')}>🟢 نشطة</button>
                            <button className={convFilter === 'closed' ? 'active' : ''} onClick={() => setConvFilter('closed')}>🔴 مغلقة</button>
                        </div>
                        {conversations.length === 0 ? (
                            <p className="empty-message">لا توجد محادثات لهذا المستخدم</p>
                        ) : (
                            <div className="conversations-list">
                                {[...conversations]
                                    .filter(c => convFilter === 'all' ? true : convFilter === 'active' ? c.isActive : !c.isActive)
                                    .sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0))
                                    .map((conv) => (
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

                {/* Photos Tab */}
                {activeTab === 'photos' && (
                    <div className="photos-section">
                        <h3>🖼️ صور المستخدم</h3>

                        {/* Profile Image */}
                        {user.profileImage && (
                            <div className="photos-group">
                                <h4>صورة الملف الشخصي</h4>
                                <div className="photos-grid">
                                    <div className="photo-card">
                                        <img
                                            src={getImageUrl(user.profileImage)}
                                            alt="صورة الملف الشخصي"
                                            className="photo-thumb"
                                            onClick={() => setLightboxImage(getImageUrl(user.profileImage))}
                                            onError={(e) => { e.target.onerror = null; e.target.src = getDefaultAvatar(user.name); }}
                                        />
                                        <div className="photo-actions">
                                            <button className="photo-view-btn" onClick={() => setLightboxImage(getImageUrl(user.profileImage))}>🔍 عرض</button>
                                            <button className="photo-delete-btn" onClick={() => { setPhotoDeleteForm({ photoIndex: 'profile', reason: '' }); setShowPhotoDeleteModal(true); }}>🗑️ حذف</button>
                                        </div>
                                        <span className="photo-label">الرئيسية</span>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Additional Photos */}
                        {user.photos && user.photos.length > 0 && (
                            <div className="photos-group">
                                <h4>الصور الإضافية ({user.photos.length})</h4>
                                <div className="photos-grid">
                                    {user.photos.map((photo, idx) => (
                                        <div key={idx} className="photo-card">
                                            <img
                                                src={getImageUrl(photo.original || photo.medium || photo.thumbnail)}
                                                alt={`صورة ${idx + 1}`}
                                                className="photo-thumb"
                                                onClick={() => setLightboxImage(getImageUrl(photo.original || photo.medium))}
                                                onError={(e) => { e.target.onerror = null; e.target.src = getDefaultAvatar(user.name); }}
                                            />
                                            <div className="photo-actions">
                                                <button className="photo-view-btn" onClick={() => setLightboxImage(getImageUrl(photo.original || photo.medium))}>🔍 عرض</button>
                                                <button className="photo-delete-btn" onClick={() => { setPhotoDeleteForm({ photoIndex: idx, reason: '' }); setShowPhotoDeleteModal(true); }}>🗑️ حذف</button>
                                            </div>
                                            <span className="photo-label">صورة {idx + 1}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {!user.profileImage && (!user.photos || user.photos.length === 0) && (
                            <p style={{ textAlign: 'center', color: '#95a5a6', padding: '40px' }}>لا توجد صور لهذا المستخدم</p>
                        )}
                    </div>
                )}

                {/* Timeline Tab */}
                {activeTab === 'timeline' && (
                    <div className="timeline-section">
                        <h3>📜 سجل الأحداث</h3>
                        {(() => {
                            const events = buildTimelineEvents();
                            if (events.length === 0) {
                                return <p className="empty-message">لا توجد أحداث مسجلة</p>;
                            }
                            return (
                                <div className="timeline-list">
                                    {events.map((event, idx) => (
                                        <div key={idx} className={`timeline-item timeline-${event.color}`}>
                                            <div className="timeline-dot-wrapper">
                                                <span className={`timeline-dot dot-${event.color}`}></span>
                                                {idx < events.length - 1 && <span className="timeline-line"></span>}
                                            </div>
                                            <div className="timeline-content">
                                                <div className="timeline-header-row">
                                                    <span className="timeline-icon">{event.icon}</span>
                                                    <span className="timeline-text">{event.text}</span>
                                                </div>
                                                {event.detail && <p className="timeline-detail">{event.detail}</p>}
                                                <span className="timeline-date">{event.date ? new Date(event.date).toLocaleDateString('ar-SA', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}</span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            );
                        })()}
                    </div>
                )}

                {/* Admin Actions Tab */}
                {activeTab === 'admin-actions' && (
                    <div className="admin-actions-section">
                        <h3>🛡️ إجراءات الأدمن</h3>

                        {/* Current Status Overview */}
                        <div className="admin-status-overview">
                            <div className="status-cards-row">
                                <div className={`admin-status-card ${user.suspension?.isSuspended ? 'warning' : 'ok'}`}>
                                    <span className="status-card-icon">{user.suspension?.isSuspended ? '🔒' : '🔓'}</span>
                                    <div>
                                        <p className="status-card-label">حالة التعليق</p>
                                        <p className="status-card-value">
                                            {user.suspension?.isSuspended
                                                ? `معلّق${user.suspension.suspendedUntil ? ` حتى ${formatDate(user.suspension.suspendedUntil)}` : ' (دائم)'}`
                                                : 'غير معلّق'}
                                        </p>
                                        {user.suspension?.reason && (
                                            <p className="status-card-sub">السبب: {user.suspension.reason}</p>
                                        )}
                                    </div>
                                </div>

                                {/* Suspension Level & Reports */}
                                <div className={`admin-status-card ${(user.suspension?.level || 0) >= 3 ? 'danger' : (user.suspension?.level || 0) >= 1 ? 'warning' : 'ok'}`}>
                                    <span className="status-card-icon">📊</span>
                                    <div>
                                        <p className="status-card-label">مستوى التعليق</p>
                                        <p className="status-card-value">
                                            المستوى {user.suspension?.level || 0} / 5
                                        </p>
                                        <div className="suspension-level-bar">
                                            {[1,2,3,4,5].map(lvl => (
                                                <div key={lvl} className={`level-dot ${lvl <= (user.suspension?.level || 0) ? 'active' : ''} ${lvl === 5 ? 'permanent' : ''}`}>
                                                    {lvl <= (user.suspension?.level || 0) ? '●' : '○'}
                                                </div>
                                            ))}
                                        </div>
                                        <p className="status-card-sub">
                                            {['', '24 ساعة', '48 ساعة', '3 أيام', '7 أيام', 'دائم'][user.suspension?.level || 0] || 'لا تعليق'}
                                            {' — '}مرات التعليق: {user.suspension?.totalSuspensions || 0}
                                        </p>
                                    </div>
                                </div>

                                {/* Reports Count */}
                                <div className={`admin-status-card ${reportsCount && reportsCount.uniqueReporters >= 5 ? 'danger' : reportsCount && reportsCount.uniqueReporters >= 3 ? 'warning' : 'ok'}`}>
                                    <span className="status-card-icon">🚨</span>
                                    <div>
                                        <p className="status-card-label">البلاغات</p>
                                        <p className="status-card-value">
                                            {reportsCount ? `${reportsCount.uniqueReporters} / ${reportsCount.autoSuspendThreshold} مبلّغ فريد` : 'جاري التحميل...'}
                                        </p>
                                        {reportsCount && (
                                            <p className="status-card-sub">
                                                إجمالي: {reportsCount.totalReports} — معلّقة: {reportsCount.pendingReports}
                                            </p>
                                        )}
                                        {reportsCount && reportsCount.uniqueReporters >= 5 && !user.suspension?.isSuspended && (
                                            <p className="status-card-sub" style={{color: '#e74c3c', fontWeight: 'bold'}}>
                                                تجاوز الحد — سيُعلّق تلقائياً عند البلاغ القادم
                                            </p>
                                        )}
                                    </div>
                                </div>

                                <div className={`admin-status-card ${(user.bannedWords?.violations || 0) > 0 ? 'warning' : 'ok'}`}>
                                    <span className="status-card-icon">⚠️</span>
                                    <div>
                                        <p className="status-card-label">مخالفات الكلمات المحظورة</p>
                                        <p className="status-card-value">{user.bannedWords?.violations || 0} مخالفة</p>
                                        {user.bannedWords?.isBanned && (
                                            <p className="status-card-sub" style={{color: '#e74c3c'}}>محظور تلقائياً</p>
                                        )}
                                    </div>
                                </div>

                                <div className={`admin-status-card ${user.nameStatus?.status !== 'normal' && user.nameStatus?.status ? 'warning' : 'ok'}`}>
                                    <span className="status-card-icon">📛</span>
                                    <div>
                                        <p className="status-card-label">حالة الاسم</p>
                                        <p className="status-card-value">
                                            {(!user.nameStatus?.status || user.nameStatus.status === 'normal') && 'عادي'}
                                            {user.nameStatus?.status === 'suspended' && 'معلّق (يظهر ***)'}
                                            {user.nameStatus?.status === 'banned' && 'محظور (اسم محظور)'}
                                        </p>
                                        {user.nameStatus?.originalName && user.nameStatus.status !== 'normal' && (
                                            <p className="status-card-sub">الاسم الأصلي: {user.nameStatus.originalName}</p>
                                        )}
                                    </div>
                                </div>

                                <div className="admin-status-card ok">
                                    <span className="status-card-icon">🖼️</span>
                                    <div>
                                        <p className="status-card-label">الصور المحذوفة</p>
                                        <p className="status-card-value">{user.photoRemovals?.length || 0} صورة</p>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Suspension History */}
                        {user.suspension?.history && user.suspension.history.length > 0 && (
                            <div className="suspension-history-section">
                                <h4>📋 سجل التعليقات ({user.suspension.history.length})</h4>
                                <div className="suspension-history-list">
                                    {[...user.suspension.history].reverse().map((entry, idx) => (
                                        <div key={idx} className={`suspension-history-item ${entry.source === 'auto' ? 'auto' : 'admin'}`}>
                                            <div className="history-item-header">
                                                <span className={`history-source-badge ${entry.source}`}>
                                                    {entry.source === 'auto' ? '🤖 تلقائي' : '👤 أدمن'}
                                                </span>
                                                <span className="history-level-badge">المستوى {entry.level}</span>
                                                <span className="history-date">
                                                    {entry.suspendedAt ? new Date(entry.suspendedAt).toLocaleDateString('ar-SA', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}
                                                </span>
                                            </div>
                                            <p className="history-reason">{entry.reason || 'بدون سبب'}</p>
                                            <p className="history-duration">
                                                {entry.suspendedUntil
                                                    ? `حتى ${new Date(entry.suspendedUntil).toLocaleDateString('ar-SA', { year: 'numeric', month: 'short', day: 'numeric' })}`
                                                    : 'دائم'}
                                            </p>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Action Buttons */}
                        <div className="admin-actions-grid">
                            {/* Suspend / Unsuspend */}
                            {user.suspension?.isSuspended ? (
                                <button className="admin-action-btn unsuspend" onClick={handleUnsuspendUser} disabled={actionLoading}>
                                    🔓 إلغاء التعليق
                                </button>
                            ) : (
                                <button className="admin-action-btn suspend" onClick={() => setShowSuspendModal(true)} disabled={actionLoading}>
                                    🔒 تعليق المستخدم
                                </button>
                            )}

                            {/* Set Violations */}
                            <button className="admin-action-btn violations" onClick={() => {
                                setViolationsCount(user.bannedWords?.violations || 0);
                                setShowViolationsModal(true);
                            }} disabled={actionLoading}>
                                ⚠️ تعديل المخالفات
                            </button>

                            {/* Name Action */}
                            <button className="admin-action-btn name-action" onClick={() => setShowNameModal(true)} disabled={actionLoading}>
                                📛 إجراء على الاسم
                            </button>

                            {/* Delete Photo */}
                            {user.profileImage && (
                                <button className="admin-action-btn delete-photo" onClick={() => setShowPhotoDeleteModal(true)} disabled={actionLoading}>
                                    🗑️ حذف الصورة
                                </button>
                            )}

                            {/* Restrict Photo/Name */}
                            <button className="admin-action-btn restrict" onClick={() => setShowRestrictModal(true)} disabled={actionLoading}>
                                ⛔ منع تغيير صورة/اسم
                            </button>

                            {/* ✅ تصعيد تلقائي */}
                            <button className="admin-action-btn" style={{background:"#2196F3",color:"#fff",border:"none"}} onClick={async () => {
                                try {
                                    const token = localStorage.getItem("token");
                                    const res = await fetch("/api/users/" + user._id + "/escalate", { method: "POST", headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token }, body: JSON.stringify({ reason: "تصعيد من تفاصيل المستخدم" }) });
                                    const data = await res.json();
                                    if (data.success) { showToast(data.message, "success"); fetchUser(); }
                                    else showToast(data.message, "error");
                                } catch(e) { showToast("فشل التصعيد", "error"); }
                            }} disabled={actionLoading}>🔄 تصعيد تلقائي</button>

                            {/* ✅ تقييد جزئي */}
                            <button className="admin-action-btn" style={{background:"#FF9800",color:"#fff",border:"none"}} onClick={async () => {
                                try {
                                    const { restrictUser } = await import("../services/api");
                                    const { suspendUser } = await import("../services/api");
                                    const res = await suspendUser(user._id, "restrict-new", "تقييد جزئي من الأدمن");
                                    if (res.success) { showToast(res.message || "تم التقييد الجزئي", "success"); fetchUser(); }
                                } catch(e) { showToast(e.response?.data?.message || "فشل التقييد", "error"); }
                            }} disabled={actionLoading}>🔒 تقييد جزئي 24س</button>

                            {/* ✅ تقييد كامل */}
                            <button className="admin-action-btn" style={{background:"#f44336",color:"#fff",border:"none"}} onClick={async () => {
                                try {
                                    const { restrictUser } = await import("../services/api");
                                    const { suspendUser } = await import("../services/api");
                                    const res = await suspendUser(user._id, "restrict-all", "تقييد كامل من الأدمن");
                                    if (res.success) { showToast(res.message || "تم التقييد الكامل", "success"); fetchUser(); }
                                } catch(e) { showToast(e.response?.data?.message || "فشل التقييد", "error"); }
                            }} disabled={actionLoading}>⛔ تقييد كامل 48س</button>

                            {/* ✅ إلغاء التقييد */}
                            <button className="admin-action-btn" style={{background:"#4CAF50",color:"#fff",border:"none"}} onClick={async () => {
                                try {
                                    const { unrestrictUser } = await import("../services/api");
                                    const { suspendUser } = await import("../services/api");
                                    const res = await suspendUser(user._id, "unrestrict", "إلغاء تقييد من الأدمن");
                                    if (res.success) { showToast(res.message || "تم إلغاء التقييد", "success"); fetchUser(); }
                                } catch(e) { showToast(e.response?.data?.message || "فشل إلغاء التقييد", "error"); }
                            }} disabled={actionLoading}>🔓 إلغاء التقييد</button>

                            {/* ✅ حظر الجهاز */}
                            <button className="admin-action-btn" style={{background:"#9C27B0",color:"#fff",border:"none"}} onClick={async () => {
                                if (!window.confirm("هل أنت متأكد من حظر جهاز " + user.name + "؟ هذا إجراء نهائي!")) return;
                                try {
                                    const token = localStorage.getItem("token");
                                    const res = await fetch("/api/users/" + user._id + "/ban-device", { method: "POST", headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token }, body: JSON.stringify({ reason: "admin", details: "حظر من تفاصيل المستخدم" }) });
                                    const data = await res.json();
                                    if (data.success) { showToast(data.message, "success"); fetchUser(); }
                                    else showToast(data.message, "error");
                                } catch(e) { showToast("فشل حظر الجهاز", "error"); }
                            }} disabled={actionLoading}>📵 حظر الجهاز</button>

                            {/* Send Notification */}
                            <button className="admin-action-btn notify" onClick={() => setShowNotifyModal(true)} disabled={actionLoading}>
                                📢 إرسال إشعار
                            </button>
                        </div>

                        {/* ✅ سجل المخالفات */}
                        {user.suspension?.history && user.suspension.history.length > 0 && (
                            <div style={{marginTop:"20px",background:"#fff",borderRadius:"12px",padding:"16px",boxShadow:"0 1px 4px rgba(0,0,0,0.08)"}}>
                                <h4 style={{margin:"0 0 12px",display:"flex",alignItems:"center",gap:"8px"}}>📋 سجل المخالفات والإجراءات ({user.suspension.history.length})</h4>
                                <div style={{maxHeight:"300px",overflowY:"auto"}}>
                                    <table style={{width:"100%",borderCollapse:"collapse",fontSize:"13px"}}>
                                        <thead><tr style={{background:"#f5f5f5",textAlign:"right"}}>
                                            <th style={{padding:"8px"}}>المستوى</th>
                                            <th style={{padding:"8px"}}>السبب</th>
                                            <th style={{padding:"8px"}}>المصدر</th>
                                            <th style={{padding:"8px"}}>التاريخ</th>
                                        </tr></thead>
                                        <tbody>
                                            {user.suspension.history.slice().reverse().map((h, i) => (
                                                <tr key={i} style={{borderBottom:"1px solid #eee"}}>
                                                    <td style={{padding:"8px"}}><span style={{background: h.level >= 5 ? "#f44336" : h.level >= 3 ? "#FF9800" : "#FFC107", color:"#fff", padding:"2px 8px", borderRadius:"12px", fontSize:"11px"}}>{h.level}</span></td>
                                                    <td style={{padding:"8px"}}>{h.reason || "—"}</td>
                                                    <td style={{padding:"8px"}}>{h.source === "auto" ? "تلقائي" : h.source === "admin_escalate" ? "تصعيد أدمن" : "أدمن"}</td>
                                                    <td style={{padding:"8px",direction:"ltr"}}>{h.suspendedAt ? new Date(h.suspendedAt).toLocaleString("ar-SA") : "—"}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        )}

                        {/* Active Restrictions */}
                        {(user.restrictions?.photoBlocked || user.restrictions?.nameBlocked) && (
                            <div className="active-restrictions">
                                <h4>⛔ القيود النشطة</h4>
                                {user.restrictions.photoBlocked && (
                                    <div className="restriction-item photo">
                                        <span>📷 منع تغيير الصورة</span>
                                        <span>{user.restrictions.photoBlockedUntil ? `حتى ${formatDate(user.restrictions.photoBlockedUntil)}` : 'دائم'}</span>
                                        <span className="restriction-reason">{user.restrictions.photoBlockedReason}</span>
                                    </div>
                                )}
                                {user.restrictions.nameBlocked && (
                                    <div className="restriction-item name">
                                        <span>📛 منع تغيير الاسم</span>
                                        <span>{user.restrictions.nameBlockedUntil ? `حتى ${formatDate(user.restrictions.nameBlockedUntil)}` : 'دائم'}</span>
                                        <span className="restriction-reason">{user.restrictions.nameBlockedReason}</span>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* User Interests */}
                        {user.interests && user.interests.length > 0 && (
                            <div className="user-interests-section">
                                <h4>✨ الاهتمامات</h4>
                                <div className="interests-chips">
                                    {user.interests.map((interest, idx) => (
                                        <span key={idx} className="interest-chip">{interest}</span>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Photo Removals History */}
                        {user.photoRemovals && user.photoRemovals.length > 0 && (
                            <div className="photo-removals-history">
                                <h4>📋 سجل حذف الصور</h4>
                                <div className="removals-list">
                                    {user.photoRemovals.map((removal, idx) => (
                                        <div key={idx} className="removal-item">
                                            <span>🗑️ {removal.reason || 'بدون سبب'}</span>
                                            <span className="removal-date">{formatDate(removal.removedAt)}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* ========== Admin Modals ========== */}

            {/* Suspend Modal */}
            {showSuspendModal && (
                <div className="modal-overlay" onClick={() => setShowSuspendModal(false)}>
                    <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3>🔒 تعليق المستخدم</h3>
                            <button className="close-modal-btn" onClick={() => setShowSuspendModal(false)}>✕</button>
                        </div>
                        <div className="modal-body">
                            {/* Next Level Suggestion */}
                            {(() => {
                                const currentLevel = user.suspension?.level || 0;
                                const nextLevel = Math.min(currentLevel + 1, 5);
                                const levelNames = { 1: '24 ساعة', 2: '48 ساعة', 3: '3 أيام', 4: '7 أيام', 5: 'دائم' };
                                const levelCodes = { 1: '24h', 2: '48h', 3: '3d', 4: '7d', 5: 'permanent' };
                                return (
                                    <div className={`next-level-suggestion ${nextLevel === 5 ? 'danger' : 'info'}`}>
                                        <p>المستوى الحالي: <strong>{currentLevel}</strong> — المستوى التالي المقترح: <strong>{nextLevel} ({levelNames[nextLevel]})</strong></p>
                                        {nextLevel === 5 && <p style={{color: '#e74c3c', fontWeight: 'bold'}}>تحذير: المستوى التالي هو تعليق دائم!</p>}
                                        <button
                                            className="auto-level-btn"
                                            onClick={() => setSuspendForm({...suspendForm, duration: 'auto'})}
                                        >
                                            استخدام المستوى التالي تلقائياً ({levelNames[nextLevel]})
                                        </button>
                                    </div>
                                );
                            })()}

                            <div className="form-group">
                                <label>مدة التعليق</label>
                                <select value={suspendForm.duration} onChange={(e) => setSuspendForm({...suspendForm, duration: e.target.value})}>
                                    <option value="auto">تلقائي (المستوى التالي)</option>
                                    <option value="24h">24 ساعة (مستوى 1)</option>
                                    <option value="48h">48 ساعة (مستوى 2)</option>
                                    <option value="3d">3 أيام (مستوى 3)</option>
                                    <option value="7d">أسبوع (مستوى 4)</option>
                                    <option value="permanent">دائم (مستوى 5)</option>
                                    <option value="custom">مدة مخصصة</option>
                                </select>
                            </div>
                            {suspendForm.duration === 'custom' && (
                                <div className="form-group">
                                    <label>عدد الأيام</label>
                                    <input
                                        type="number"
                                        min="1"
                                        max="365"
                                        value={suspendForm.customDays}
                                        onChange={(e) => setSuspendForm({...suspendForm, customDays: parseInt(e.target.value) || 1})}
                                    />
                                </div>
                            )}
                            <div className="form-group">
                                <label>سبب التعليق</label>
                                <textarea
                                    value={suspendForm.reason}
                                    onChange={(e) => setSuspendForm({...suspendForm, reason: e.target.value})}
                                    placeholder="أدخل سبب التعليق..."
                                    rows={3}
                                />
                            </div>
                        </div>
                        <div className="modal-actions">
                            <button className="cancel-btn" onClick={() => setShowSuspendModal(false)} disabled={actionLoading}>إلغاء</button>
                            <button className="submit-btn danger" onClick={handleSuspendUser} disabled={actionLoading}>
                                {actionLoading ? 'جاري التعليق...' : 'تعليق المستخدم'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Violations Modal */}
            {showViolationsModal && (
                <div className="modal-overlay" onClick={() => setShowViolationsModal(false)}>
                    <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3>⚠️ تعديل عدد المخالفات</h3>
                            <button className="close-modal-btn" onClick={() => setShowViolationsModal(false)}>✕</button>
                        </div>
                        <div className="modal-body">
                            <p style={{marginBottom: '12px', color: '#7f8c8d'}}>
                                المخالفات الحالية: <strong>{user.bannedWords?.violations || 0}</strong>
                            </p>
                            <div className="form-group">
                                <label>عدد المخالفات الجديد</label>
                                <input
                                    type="number"
                                    min="0"
                                    max="100"
                                    value={violationsCount}
                                    onChange={(e) => setViolationsCount(parseInt(e.target.value) || 0)}
                                />
                            </div>
                            <p style={{fontSize: '13px', color: '#e67e22', marginTop: '8px'}}>
                                تنبيه: إذا تجاوز العدد حد المخالفات سيتم حظر المستخدم تلقائياً
                            </p>
                        </div>
                        <div className="modal-actions">
                            <button className="cancel-btn" onClick={() => setShowViolationsModal(false)} disabled={actionLoading}>إلغاء</button>
                            <button className="submit-btn" onClick={handleSetViolations} disabled={actionLoading}>
                                {actionLoading ? 'جاري التحديث...' : 'تحديث المخالفات'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Name Action Modal */}
            {showNameModal && (
                <div className="modal-overlay" onClick={() => setShowNameModal(false)}>
                    <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3>📛 إجراء على الاسم</h3>
                            <button className="close-modal-btn" onClick={() => setShowNameModal(false)}>✕</button>
                        </div>
                        <div className="modal-body">
                            <p style={{marginBottom: '12px'}}>
                                الاسم الحالي: <strong>{user.name}</strong>
                                {user.nameStatus?.status && user.nameStatus.status !== 'normal' && (
                                    <span style={{color: '#e74c3c', marginRight: '8px'}}>
                                        ({user.nameStatus.status === 'suspended' ? 'معلّق' : 'محظور'})
                                    </span>
                                )}
                            </p>
                            <div className="form-group">
                                <label>نوع الإجراء</label>
                                <select value={nameForm.action} onChange={(e) => setNameForm({...nameForm, action: e.target.value})}>
                                    <option value="suspend">تعليق الاسم (يظهر ***)</option>
                                    <option value="ban">حظر الاسم (يظهر "اسم محظور")</option>
                                    <option value="restore">استعادة الاسم الأصلي</option>
                                    <option value="change">تغيير الاسم</option>
                                </select>
                            </div>
                            {nameForm.action === 'change' && (
                                <div className="form-group">
                                    <label>الاسم الجديد</label>
                                    <input
                                        type="text"
                                        value={nameForm.newName}
                                        onChange={(e) => setNameForm({...nameForm, newName: e.target.value})}
                                        placeholder="أدخل الاسم الجديد..."
                                    />
                                </div>
                            )}
                            <div className="form-group">
                                <label>السبب</label>
                                <textarea
                                    value={nameForm.reason}
                                    onChange={(e) => setNameForm({...nameForm, reason: e.target.value})}
                                    placeholder="أدخل سبب الإجراء..."
                                    rows={3}
                                />
                            </div>
                        </div>
                        <div className="modal-actions">
                            <button className="cancel-btn" onClick={() => setShowNameModal(false)} disabled={actionLoading}>إلغاء</button>
                            <button className="submit-btn danger" onClick={handleNameAction} disabled={actionLoading}>
                                {actionLoading ? 'جاري التنفيذ...' : 'تنفيذ الإجراء'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Photo Delete Modal */}
            {showPhotoDeleteModal && (
                <div className="modal-overlay" onClick={() => setShowPhotoDeleteModal(false)}>
                    <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3>🗑️ حذف صورة المستخدم</h3>
                            <button className="close-modal-btn" onClick={() => setShowPhotoDeleteModal(false)}>✕</button>
                        </div>
                        <div className="modal-body">
                            {/* اختيار الصورة المراد حذفها */}
                            <div className="form-group">
                                <label>اختر الصورة المراد حذفها</label>
                                <div style={{display: 'flex', gap: '10px', flexWrap: 'wrap', marginTop: '8px'}}>
                                    {/* الصورة الرئيسية */}
                                    {user.profileImage && (
                                        <div
                                            onClick={() => setPhotoDeleteForm({...photoDeleteForm, photoIndex: 'profile'})}
                                            style={{
                                                cursor: 'pointer',
                                                border: photoDeleteForm.photoIndex === 'profile' ? '3px solid #e74c3c' : '3px solid transparent',
                                                borderRadius: '12px', padding: '4px', textAlign: 'center'
                                            }}
                                        >
                                            <img
                                                src={getImageUrl(user.profileImage)}
                                                alt="الرئيسية"
                                                style={{width: '80px', height: '80px', borderRadius: '8px', objectFit: 'cover'}}
                                                onError={(e) => { e.target.style.display = 'none'; }}
                                            />
                                            <div style={{fontSize: '11px', marginTop: '4px', color: photoDeleteForm.photoIndex === 'profile' ? '#e74c3c' : '#666'}}>
                                                الرئيسية
                                            </div>
                                        </div>
                                    )}
                                    {/* الصور الإضافية */}
                                    {(user.photos || []).map((photo, idx) => (
                                        <div
                                            key={idx}
                                            onClick={() => setPhotoDeleteForm({...photoDeleteForm, photoIndex: idx})}
                                            style={{
                                                cursor: 'pointer',
                                                border: photoDeleteForm.photoIndex === idx ? '3px solid #e74c3c' : '3px solid transparent',
                                                borderRadius: '12px', padding: '4px', textAlign: 'center'
                                            }}
                                        >
                                            <img
                                                src={getImageUrl(photo.thumbnail || photo.medium || photo.original)}
                                                alt={`صورة ${idx + 1}`}
                                                style={{width: '80px', height: '80px', borderRadius: '8px', objectFit: 'cover'}}
                                                onError={(e) => { e.target.style.display = 'none'; }}
                                            />
                                            <div style={{fontSize: '11px', marginTop: '4px', color: photoDeleteForm.photoIndex === idx ? '#e74c3c' : '#666'}}>
                                                صورة {idx + 1}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                            <div className="form-group">
                                <label>سبب الحذف (سيتم إشعار المستخدم داخل التطبيق)</label>
                                <textarea
                                    value={photoDeleteForm.reason}
                                    onChange={(e) => setPhotoDeleteForm({...photoDeleteForm, reason: e.target.value})}
                                    placeholder="صورة غير لائقة / تنتهك شروط الاستخدام..."
                                    rows={3}
                                />
                            </div>
                        </div>
                        <div className="modal-actions">
                            <button className="cancel-btn" onClick={() => setShowPhotoDeleteModal(false)} disabled={actionLoading}>إلغاء</button>
                            <button className="submit-btn danger" onClick={handleDeletePhoto} disabled={actionLoading}>
                                {actionLoading ? 'جاري الحذف...' : '🗑️ حذف الصورة + إشعار المستخدم'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Send Notification Modal */}
            {showNotifyModal && (
                <div className="modal-overlay" onClick={() => setShowNotifyModal(false)}>
                    <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3>📢 إرسال إشعار لـ {user.name}</h3>
                            <button className="close-modal-btn" onClick={() => setShowNotifyModal(false)}>✕</button>
                        </div>
                        <div className="modal-body">
                            <div className="form-group">
                                <label>عنوان الإشعار *</label>
                                <input
                                    type="text"
                                    value={notifyForm.title}
                                    onChange={(e) => setNotifyForm({...notifyForm, title: e.target.value})}
                                    placeholder="عنوان الإشعار"
                                    maxLength={100}
                                />
                            </div>
                            <div className="form-group">
                                <label>محتوى الإشعار *</label>
                                <textarea
                                    value={notifyForm.body}
                                    onChange={(e) => setNotifyForm({...notifyForm, body: e.target.value})}
                                    placeholder="محتوى الإشعار..."
                                    rows={4}
                                    maxLength={500}
                                />
                            </div>
                        </div>
                        <div className="modal-actions">
                            <button className="cancel-btn" onClick={() => setShowNotifyModal(false)} disabled={actionLoading}>إلغاء</button>
                            <button className="submit-btn" onClick={handleSendNotification} disabled={actionLoading}>
                                {actionLoading ? 'جاري الإرسال...' : 'إرسال الإشعار'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Restrict Photo/Name Modal */}
            {showRestrictModal && (
                <div className="modal-overlay" onClick={() => setShowRestrictModal(false)}>
                    <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3>⛔ منع تغيير صورة/اسم</h3>
                            <button className="close-modal-btn" onClick={() => setShowRestrictModal(false)}>✕</button>
                        </div>
                        <div className="modal-body">
                            <div className="form-group">
                                <label>نوع المنع</label>
                                <select value={restrictForm.type} onChange={(e) => setRestrictForm({...restrictForm, type: e.target.value})}>
                                    <option value="photo">📷 منع تغيير الصورة</option>
                                    <option value="name">📛 منع تغيير الاسم</option>
                                </select>
                            </div>
                            <div className="form-group">
                                <label>المدة</label>
                                <select value={restrictForm.duration} onChange={(e) => setRestrictForm({...restrictForm, duration: e.target.value})}>
                                    <option value="7d">7 أيام</option>
                                    <option value="30d">30 يوم</option>
                                    <option value="90d">90 يوم</option>
                                    <option value="permanent">دائم</option>
                                </select>
                            </div>
                            <div className="form-group">
                                <label>السبب (سيتم إشعار المستخدم)</label>
                                <textarea
                                    value={restrictForm.reason}
                                    onChange={(e) => setRestrictForm({...restrictForm, reason: e.target.value})}
                                    placeholder="صورة/اسم مخالف لسياسة الاستخدام..."
                                    rows={3}
                                />
                            </div>
                        </div>
                        <div className="modal-actions">
                            <button className="cancel-btn" onClick={() => setShowRestrictModal(false)} disabled={actionLoading}>إلغاء</button>
                            <button className="submit-btn danger" onClick={handleRestrict} disabled={actionLoading}>
                                {actionLoading ? 'جاري التطبيق...' : '⛔ تطبيق المنع + إشعار المستخدم'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
            {/* Photo Lightbox */}
            {lightboxImage && (
                <div className="lightbox-overlay" onClick={() => setLightboxImage(null)}>
                    <div className="lightbox-content" onClick={(e) => e.stopPropagation()}>
                        <button className="lightbox-close" onClick={() => setLightboxImage(null)}>✕</button>
                        <img src={lightboxImage} alt="صورة كاملة" className="lightbox-image" />
                    </div>
                </div>
            )}
        </div>
    );
}

export default UserDetail;
