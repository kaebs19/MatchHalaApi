import React, { useState, useEffect } from 'react';
import { getAllUsers, deleteUser, toggleUserActive, updateUser, suspendUser, unsuspendUser, banUser, sendUserNotification, setUserViolations } from '../services/api';
import { useToast } from '../components/Toast';
import EditUserModal from '../components/EditUserModal';
import Pagination from '../components/Pagination';
import { TableRowSkeleton } from '../components/Skeleton';
import { getImageUrl, getDefaultAvatar } from '../config';
import { formatDate } from '../utils/formatters';
import ConfirmModal from '../components/ConfirmModal';
import './Users.css';

function Users({ onViewDetail }) {
    const [users, setUsers] = useState([]);
    const [filteredUsers, setFilteredUsers] = useState([]);
    const [paginatedUsers, setPaginatedUsers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [searchTerm, setSearchTerm] = useState('');
    const [filterStatus, setFilterStatus] = useState('all');
    const [filterRole, setFilterRole] = useState('all');
    const [filterAuthProvider, setFilterAuthProvider] = useState('all');
    const [filterBanned, setFilterBanned] = useState('all');
    const [filterGender, setFilterGender] = useState('all');
    const [filterPremium, setFilterPremium] = useState('all');
    const [filterOnline, setFilterOnline] = useState('all');
    const [showDeleteModal, setShowDeleteModal] = useState(false);
    const [userToDelete, setUserToDelete] = useState(null);
    const [showEditModal, setShowEditModal] = useState(false);
    const [userToEdit, setUserToEdit] = useState(null);
    const [currentPage, setCurrentPage] = useState(1);
    const [itemsPerPage, setItemsPerPage] = useState(20);
    const [sortField, setSortField] = useState('createdAt');
    const [sortOrder, setSortOrder] = useState('desc');
    const [showFilters, setShowFilters] = useState(false);
    // ✅ Quick Actions State
    const [quickActionUser, setQuickActionUser] = useState(null);
    const [showQuickActions, setShowQuickActions] = useState(false);
    const [showPhotoPreview, setShowPhotoPreview] = useState(null);
    const [showQuickNotify, setShowQuickNotify] = useState(false);
    const [quickNotifyForm, setQuickNotifyForm] = useState({ title: '', body: '' });
    const [quickActionLoading, setQuickActionLoading] = useState(false);
    const toast = useToast();

    useEffect(() => { fetchUsers(); }, []);
    useEffect(() => { filterUsers(); }, [users, searchTerm, filterStatus, filterRole, filterAuthProvider, filterBanned, filterGender, filterPremium, filterOnline]);
    useEffect(() => { sortAndPaginateUsers(); }, [filteredUsers, currentPage, itemsPerPage, sortField, sortOrder]);

    const fetchUsers = async () => {
        try {
            setLoading(true);
            const response = await getAllUsers();
            if (response.success) setUsers(response.data.users);
        } catch (err) {
            setError(err.response?.data?.message || 'فشل تحميل المستخدمين');
        } finally {
            setLoading(false);
        }
    };

    const filterUsers = () => {
        let filtered = [...users];

        if (searchTerm) {
            const s = searchTerm.toLowerCase();
            filtered = filtered.filter(u =>
                u.name?.toLowerCase().includes(s) ||
                u.email?.toLowerCase().includes(s) ||
                u._id?.toLowerCase().includes(s) ||
                u.country?.toLowerCase().includes(s) ||
                u.city?.toLowerCase().includes(s)
            );
        }

        if (filterStatus !== 'all') filtered = filtered.filter(u => filterStatus === 'active' ? u.isActive : !u.isActive);
        if (filterRole !== 'all') filtered = filtered.filter(u => u.role === filterRole);
        if (filterAuthProvider !== 'all') filtered = filtered.filter(u => (u.authProvider || 'app') === filterAuthProvider);
        if (filterBanned === 'banned') filtered = filtered.filter(u => u.bannedWords?.isBanned);
        if (filterBanned === 'suspended') filtered = filtered.filter(u => u.suspension?.isSuspended);
        if (filterBanned === 'violations') filtered = filtered.filter(u => (u.bannedWords?.violations || 0) > 0);
        if (filterBanned === 'clean') filtered = filtered.filter(u => !u.bannedWords?.isBanned && !u.suspension?.isSuspended && !(u.bannedWords?.violations > 0));
        if (filterGender !== 'all') filtered = filtered.filter(u => u.gender === filterGender);
        if (filterPremium === 'premium') filtered = filtered.filter(u => u.isPremium);
        if (filterPremium === 'free') filtered = filtered.filter(u => !u.isPremium);
        if (filterOnline === 'online') filtered = filtered.filter(u => u.isOnline);
        if (filterOnline === 'offline') filtered = filtered.filter(u => !u.isOnline);

        setFilteredUsers(filtered);
        setCurrentPage(1);
    };

    const sortAndPaginateUsers = () => {
        let sorted = [...filteredUsers];
        sorted.sort((a, b) => {
            let aVal = a[sortField], bVal = b[sortField];
            if (sortField === 'violations') {
                aVal = a.bannedWords?.violations || 0;
                bVal = b.bannedWords?.violations || 0;
            }
            if (typeof aVal === 'string') { aVal = aVal.toLowerCase(); bVal = (bVal || '').toLowerCase(); }
            if (sortField === 'createdAt' || sortField === 'lastLogin') {
                aVal = new Date(aVal || 0).getTime();
                bVal = new Date(bVal || 0).getTime();
            }
            return sortOrder === 'asc' ? (aVal > bVal ? 1 : -1) : (aVal < bVal ? 1 : -1);
        });
        const start = (currentPage - 1) * itemsPerPage;
        setPaginatedUsers(sorted.slice(start, start + itemsPerPage));
    };

    const handleSort = (field) => {
        if (sortField === field) setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
        else { setSortField(field); setSortOrder('asc'); }
    };

    const getSortIcon = (field) => {
        if (sortField !== field) return '⇅';
        return sortOrder === 'asc' ? '↑' : '↓';
    };

    const handleToggleActive = async (userId) => {
        try {
            const user = users.find(u => u._id === userId);
            const response = await toggleUserActive(userId);
            if (response.success) {
                setUsers(users.map(u => u._id === userId ? { ...u, isActive: !u.isActive } : u));
                toast.success(`تم ${user.isActive ? 'إلغاء تفعيل' : 'تفعيل'} المستخدم`);
            }
        } catch (err) {
            toast.error(err.response?.data?.message || 'فشل التحديث');
        }
    };

    // ✅ تعليق سريع (auto — المستوى التالي)
    const handleQuickSuspend = async (userId) => {
        try {
            const user = users.find(u => u._id === userId);
            const nextLevel = Math.min((user?.suspension?.level || 0) + 1, 5);
            const levelNames = { 1: '24 ساعة', 2: '48 ساعة', 3: '3 أيام', 4: '7 أيام', 5: 'دائم' };
            const res = await suspendUser(userId, 'auto', 'تعليق سريع من قائمة المستخدمين');
            if (res.success) {
                toast.success(`تم تعليق ${user?.name} — المستوى ${nextLevel} (${levelNames[nextLevel]})`);
                fetchUsers();
            }
        } catch (err) {
            toast.error(err.response?.data?.message || 'فشل التعليق');
        }
    };

    // ✅ فك التعليق
    const handleQuickUnsuspend = async (userId) => {
        try {
            const user = users.find(u => u._id === userId);
            const res = await unsuspendUser(userId);
            if (res.success) {
                toast.success(`تم إلغاء تعليق ${user?.name}`);
                fetchUsers();
            }
        } catch (err) {
            toast.error(err.response?.data?.message || 'فشل إلغاء التعليق');
        }
    };

    // ✅ Quick Actions
    const openQuickActions = (user) => { setQuickActionUser(user); setShowQuickActions(true); };

    const handleQuickBan = async () => {
        if (!quickActionUser) return;
        setQuickActionLoading(true);
        try {
            const res = await banUser(quickActionUser._id);
            if (res.success) {
                toast.success(quickActionUser.bannedWords?.isBanned ? `تم فك حظر ${quickActionUser.name}` : `تم حظر ${quickActionUser.name}`);
                fetchUsers();
                setShowQuickActions(false);
            }
        } catch (err) { toast.error(err.response?.data?.message || 'فشل'); }
        finally { setQuickActionLoading(false); }
    };

    const handleQuickResetViolations = async () => {
        if (!quickActionUser) return;
        setQuickActionLoading(true);
        try {
            const res = await setUserViolations(quickActionUser._id, 0);
            if (res.success) {
                toast.success(`تم تصفير مخالفات ${quickActionUser.name}`);
                fetchUsers();
                setShowQuickActions(false);
            }
        } catch (err) { toast.error(err.response?.data?.message || 'فشل'); }
        finally { setQuickActionLoading(false); }
    };

    const handleQuickNotify = async () => {
        if (!quickActionUser || !quickNotifyForm.title) return;
        setQuickActionLoading(true);
        try {
            const res = await sendUserNotification(quickActionUser._id, quickNotifyForm.title, quickNotifyForm.body);
            if (res.success) {
                toast.success(`تم إرسال إشعار لـ ${quickActionUser.name}`);
                setShowQuickNotify(false);
                setQuickNotifyForm({ title: '', body: '' });
                setShowQuickActions(false);
            }
        } catch (err) { toast.error(err.response?.data?.message || 'فشل'); }
        finally { setQuickActionLoading(false); }
    };

    const openEditModal = (user) => { setUserToEdit(user); setShowEditModal(true); };

    const handleEditUser = async (userData) => {
        try {
            const response = await updateUser(userToEdit._id, userData);
            if (response.success) {
                setUsers(users.map(u => u._id === userToEdit._id ? { ...u, ...userData } : u));
                setShowEditModal(false);
                setUserToEdit(null);
                toast.success('تم تحديث البيانات');
            }
        } catch (err) {
            toast.error(err.response?.data?.message || 'فشل التحديث');
            throw err;
        }
    };

    const confirmDelete = (user) => { setUserToDelete(user); setShowDeleteModal(true); };

    const handleDelete = async () => {
        if (!userToDelete) return;
        try {
            const response = await deleteUser(userToDelete._id);
            if (response.success) {
                setUsers(users.filter(u => u._id !== userToDelete._id));
                setShowDeleteModal(false);
                setUserToDelete(null);
                toast.success(`تم حذف ${userToDelete.name}`);
            }
        } catch (err) {
            toast.error(err.response?.data?.message || 'فشل الحذف');
        }
    };

    const resetFilters = () => {
        setSearchTerm(''); setFilterStatus('all'); setFilterRole('all');
        setFilterAuthProvider('all'); setFilterBanned('all'); setFilterGender('all');
        setFilterPremium('all'); setFilterOnline('all');
    };

    // الإحصائيات
    const stats = {
        total: users.length,
        active: users.filter(u => u.isActive).length,
        banned: users.filter(u => u.bannedWords?.isBanned).length,
        violations: users.filter(u => (u.bannedWords?.violations || 0) > 0).length,
        premium: users.filter(u => u.isPremium).length,
        online: users.filter(u => u.isOnline).length,
        today: users.filter(u => {
            const d = new Date(u.createdAt);
            const t = new Date();
            return d.toDateString() === t.toDateString();
        }).length,
    };

    const formatRelativeTime = (date) => {
        if (!date) return '-';
        const diff = Date.now() - new Date(date);
        const mins = Math.floor(diff / 60000);
        if (mins < 1) return 'الآن';
        if (mins < 60) return `${mins} د`;
        const hours = Math.floor(diff / 3600000);
        if (hours < 24) return `${hours} س`;
        const days = Math.floor(diff / 86400000);
        if (days < 30) return `${days} ي`;
        return formatDate(date);
    };

    if (loading) {
        return (
            <div className="users-page">
                <div className="loading-container"><div className="spinner"></div><p>جاري التحميل...</p></div>
            </div>
        );
    }

    return (
        <div className="users-page">
            {/* Stats Bar */}
            <div className="users-stats-bar">
                <div className="users-stat" data-color="blue">
                    <span className="users-stat-num">{stats.total}</span>
                    <span className="users-stat-label">إجمالي</span>
                </div>
                <div className="users-stat" data-color="green">
                    <span className="users-stat-num">{stats.active}</span>
                    <span className="users-stat-label">نشط</span>
                </div>
                <div className="users-stat" data-color="cyan">
                    <span className="users-stat-num">{stats.online}</span>
                    <span className="users-stat-label">متصل</span>
                </div>
                <div className="users-stat" data-color="gold">
                    <span className="users-stat-num">{stats.premium}</span>
                    <span className="users-stat-label">بريميوم</span>
                </div>
                <div className="users-stat" data-color="orange">
                    <span className="users-stat-num">{stats.violations}</span>
                    <span className="users-stat-label">مخالفات</span>
                </div>
                <div className="users-stat" data-color="red">
                    <span className="users-stat-num">{stats.banned}</span>
                    <span className="users-stat-label">محظور</span>
                </div>
                <div className="users-stat" data-color="purple">
                    <span className="users-stat-num">{stats.today}</span>
                    <span className="users-stat-label">اليوم</span>
                </div>
            </div>

            {error && <div className="error-banner">{error}</div>}

            {/* Search + Filter Toggle */}
            <div className="users-toolbar">
                <div className="users-search-row">
                    <div className="search-box">
                        <input
                            type="text"
                            placeholder="بحث بالاسم، البريد، ID، الدولة، المدينة..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                        <span className="search-icon">🔍</span>
                    </div>
                    <button className={`users-filter-toggle ${showFilters ? 'active' : ''}`} onClick={() => setShowFilters(!showFilters)}>
                        🔽 فلاتر {showFilters ? '▲' : '▼'}
                    </button>
                    <button className="refresh-btn" onClick={fetchUsers}>🔄</button>
                </div>

                {showFilters && (
                    <div className="users-filters-grid">
                        <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
                            <option value="all">جميع الحالات</option>
                            <option value="active">نشط</option>
                            <option value="inactive">غير نشط</option>
                        </select>
                        <select value={filterRole} onChange={(e) => setFilterRole(e.target.value)}>
                            <option value="all">جميع الأدوار</option>
                            <option value="admin">مدير</option>
                            <option value="user">مستخدم</option>
                        </select>
                        <select value={filterAuthProvider} onChange={(e) => setFilterAuthProvider(e.target.value)}>
                            <option value="all">جميع أنواع التسجيل</option>
                            <option value="app">التطبيق</option>
                            <option value="google">Google</option>
                            <option value="apple">Apple</option>
                        </select>
                        <select value={filterBanned} onChange={(e) => setFilterBanned(e.target.value)}>
                            <option value="all">جميع - محظور/معلّق</option>
                            <option value="banned">محظور فقط</option>
                            <option value="suspended">معلّق فقط</option>
                            <option value="violations">لديه مخالفات</option>
                            <option value="clean">بدون مخالفات</option>
                        </select>
                        <select value={filterGender} onChange={(e) => setFilterGender(e.target.value)}>
                            <option value="all">الجنس - الكل</option>
                            <option value="male">ذكر</option>
                            <option value="female">أنثى</option>
                        </select>
                        <select value={filterPremium} onChange={(e) => setFilterPremium(e.target.value)}>
                            <option value="all">الاشتراك - الكل</option>
                            <option value="premium">بريميوم</option>
                            <option value="free">مجاني</option>
                        </select>
                        <select value={filterOnline} onChange={(e) => setFilterOnline(e.target.value)}>
                            <option value="all">الاتصال - الكل</option>
                            <option value="online">متصل الآن</option>
                            <option value="offline">غير متصل</option>
                        </select>
                        <button className="users-reset-filters" onClick={resetFilters}>مسح الفلاتر</button>
                    </div>
                )}
            </div>

            {/* Table Controls */}
            <div className="table-controls">
                <div className="results-info">
                    عرض {filteredUsers.length} من {users.length} مستخدم
                </div>
                <div className="items-per-page">
                    <label>عدد:</label>
                    <select value={itemsPerPage} onChange={(e) => { setItemsPerPage(Number(e.target.value)); setCurrentPage(1); }}>
                        <option value={10}>10</option>
                        <option value={20}>20</option>
                        <option value={50}>50</option>
                        <option value={100}>100</option>
                    </select>
                </div>
            </div>

            {/* Table */}
            {filteredUsers.length === 0 ? (
                <div className="no-results">
                    <p>لا توجد نتائج 🔍</p>
                    <button onClick={resetFilters}>إعادة تعيين الفلاتر</button>
                </div>
            ) : (
                <>
                    <div className="table-container">
                        <table className="users-table">
                            <thead>
                                <tr>
                                    <th onClick={() => handleSort('name')} className="sortable">الاسم {getSortIcon('name')}</th>
                                    <th onClick={() => handleSort('email')} className="sortable">البريد {getSortIcon('email')}</th>
                                    <th>معلومات</th>
                                    <th onClick={() => handleSort('isActive')} className="sortable">الحالة {getSortIcon('isActive')}</th>
                                    <th onClick={() => handleSort('violations')} className="sortable">مخالفات {getSortIcon('violations')}</th>
                                    <th onClick={() => handleSort('lastLogin')} className="sortable">آخر ظهور {getSortIcon('lastLogin')}</th>
                                    <th onClick={() => handleSort('createdAt')} className="sortable">التسجيل {getSortIcon('createdAt')}</th>
                                    <th>الإجراءات</th>
                                </tr>
                            </thead>
                            <tbody>
                                {loading ? (
                                    <><TableRowSkeleton columns={8} /><TableRowSkeleton columns={8} /><TableRowSkeleton columns={8} /></>
                                ) : (
                                    paginatedUsers.map((user) => (
                                        <tr key={user._id} className={user.bannedWords?.isBanned ? 'row-banned' : ''}>
                                            <td>
                                                <div className="user-cell" onClick={() => onViewDetail && onViewDetail(user._id)} style={{ cursor: 'pointer' }}>
                                                    <div className="user-avatar-wrap">
                                                        <img
                                                            src={user.profileImage ? getImageUrl(user.profileImage) : getDefaultAvatar(user.name)}
                                                            alt={user.name}
                                                            className="user-avatar-small"
                                                            onError={(e) => { e.target.onerror = null; e.target.src = getDefaultAvatar(user.name); }}
                                                        />
                                                        {user.isOnline && <span className="user-online-dot" />}
                                                    </div>
                                                    <div className="user-name-col">
                                                        <span className="user-name-text">{user.name}</span>
                                                        <div className="user-name-badges">
                                                            {user.isPremium && <span className="ubadge premium">PRO</span>}
                                                            {user.verification?.isVerified && <span className="ubadge verified">✓</span>}
                                                            {user.role === 'admin' && <span className="ubadge admin">مدير</span>}
                                                        </div>
                                                    </div>
                                                </div>
                                            </td>
                                            <td>
                                                <div className="email-col">
                                                    <span dir="ltr" className="email-text">{user.email}</span>
                                                    <span className="auth-badge auth-{(user.authProvider || 'app')}">
                                                        {user.authProvider === 'google' ? 'G' : user.authProvider === 'apple' ? '' : '📧'}
                                                    </span>
                                                </div>
                                            </td>
                                            <td>
                                                <div className="user-info-col">
                                                    {user.gender && <span className="uinfo">{user.gender === 'male' ? '♂' : '♀'}</span>}
                                                    {user.country && <span className="uinfo">{user.country}</span>}
                                                    {user.city && <span className="uinfo">{user.city}</span>}
                                                    {user.deviceInfo?.platform && <span className="uinfo">{user.deviceInfo.platform === 'ios' ? '📱' : '🤖'}</span>}
                                                </div>
                                            </td>
                                            <td>
                                                <div className="status-col">
                                                    {user.bannedWords?.isBanned ? (
                                                        <span className="ubadge banned-badge">محظور</span>
                                                    ) : user.suspension?.isSuspended ? (
                                                        <span className="ubadge suspended-badge">
                                                            معلّق {user.suspension.level ? `(${['', '24h', '48h', '3d', '7d', '∞'][user.suspension.level]})` : ''}
                                                        </span>
                                                    ) : user.isActive ? (
                                                        <span className="ubadge active-badge">نشط</span>
                                                    ) : (
                                                        <span className="ubadge inactive-badge">معطل</span>
                                                    )}
                                                </div>
                                            </td>
                                            <td>
                                                <div className="violations-col">
                                                    {(user.bannedWords?.violations || 0) > 0 ? (
                                                        <span className={`violations-count v-${Math.min(user.bannedWords.violations, 3)}`}>
                                                            {user.bannedWords.violations}/3
                                                        </span>
                                                    ) : (
                                                        <span className="violations-clean">-</span>
                                                    )}
                                                </div>
                                            </td>
                                            <td>
                                                <span className="last-seen-text">
                                                    {formatRelativeTime(user.lastLogin)}
                                                </span>
                                            </td>
                                            <td>
                                                <span className="date-text">{formatDate(user.createdAt)}</span>
                                            </td>
                                            <td>
                                                <div className="actions-cell">
                                                    <button className="action-btn btn-primary" onClick={() => onViewDetail && onViewDetail(user._id)} title="التفاصيل">👁️</button>
                                                    <button className="action-btn btn-photo" onClick={() => setShowPhotoPreview(user)} title="عرض الصورة">🖼️</button>
                                                    <button className="action-btn btn-admin-actions" onClick={() => openQuickActions(user)} title="إجراءات سريعة">🛡️</button>
                                                    <button className="action-btn btn-danger" onClick={() => confirmDelete(user)} title="حذف">🗑️</button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>

                    <Pagination
                        currentPage={currentPage}
                        totalPages={Math.ceil(filteredUsers.length / itemsPerPage)}
                        onPageChange={setCurrentPage}
                        itemsPerPage={itemsPerPage}
                        totalItems={filteredUsers.length}
                    />
                </>
            )}

            {showEditModal && (
                <EditUserModal
                    user={userToEdit}
                    onClose={() => { setShowEditModal(false); setUserToEdit(null); }}
                    onSave={handleEditUser}
                />
            )}

            <ConfirmModal
                isOpen={showDeleteModal}
                onClose={() => { setShowDeleteModal(false); setUserToDelete(null); }}
                onConfirm={handleDelete}
                title="تأكيد الحذف"
                message="هل أنت متأكد من حذف المستخدم؟"
                confirmText="حذف نهائياً"
                cancelText="إلغاء"
                variant="danger"
            >
                <div className="user-to-delete">
                    <strong>{userToDelete?.name}</strong>
                    <span>{userToDelete?.email}</span>
                </div>
            </ConfirmModal>

            {/* ✅ Quick Actions Panel */}
            {showQuickActions && quickActionUser && (
                <div className="modal-overlay" onClick={() => setShowQuickActions(false)}>
                    <div className="quick-actions-panel" onClick={(e) => e.stopPropagation()}>
                        <div className="qap-header">
                            <div className="qap-user-info">
                                <img
                                    src={getImageUrl(quickActionUser.profileImage)}
                                    alt=""
                                    className="qap-avatar"
                                    onError={(e) => { e.target.onerror = null; e.target.src = getDefaultAvatar(quickActionUser.name); }}
                                />
                                <div>
                                    <h3>{quickActionUser.name}</h3>
                                    <span>{quickActionUser.email}</span>
                                </div>
                            </div>
                            <button className="qap-close" onClick={() => setShowQuickActions(false)}>✕</button>
                        </div>

                        {/* Status Badges */}
                        <div className="qap-status-row">
                            {quickActionUser.bannedWords?.isBanned && <span className="qap-badge danger">محظور</span>}
                            {quickActionUser.suspension?.isSuspended && <span className="qap-badge warning">معلّق (مستوى {quickActionUser.suspension.level || 0})</span>}
                            {!quickActionUser.isActive && !quickActionUser.bannedWords?.isBanned && !quickActionUser.suspension?.isSuspended && <span className="qap-badge muted">معطل</span>}
                            {quickActionUser.isActive && !quickActionUser.suspension?.isSuspended && <span className="qap-badge success">نشط</span>}
                            <span className="qap-badge info">مخالفات: {quickActionUser.bannedWords?.violations || 0}</span>
                        </div>

                        {/* Quick Action Buttons */}
                        <div className="qap-actions">
                            {/* تعليق / فك */}
                            {quickActionUser.suspension?.isSuspended ? (
                                <button className="qap-btn success" onClick={() => { handleQuickUnsuspend(quickActionUser._id); setShowQuickActions(false); }} disabled={quickActionLoading}>
                                    🔓 فك التعليق
                                </button>
                            ) : (
                                <button className="qap-btn warning" onClick={() => { handleQuickSuspend(quickActionUser._id); setShowQuickActions(false); }} disabled={quickActionLoading}>
                                    🔒 تعليق (المستوى {Math.min((quickActionUser.suspension?.level || 0) + 1, 5)})
                                </button>
                            )}

                            {/* حظر / فك حظر */}
                            <button className="qap-btn danger" onClick={handleQuickBan} disabled={quickActionLoading}>
                                {quickActionUser.bannedWords?.isBanned ? '✅ فك الحظر' : '🚫 حظر المستخدم'}
                            </button>

                            {/* تصفير المخالفات */}
                            {(quickActionUser.bannedWords?.violations || 0) > 0 && (
                                <button className="qap-btn info" onClick={handleQuickResetViolations} disabled={quickActionLoading}>
                                    🔄 تصفير المخالفات ({quickActionUser.bannedWords.violations} → 0)
                                </button>
                            )}

                            {/* تفعيل / تعطيل */}
                            <button
                                className={`qap-btn ${quickActionUser.isActive ? 'muted' : 'success'}`}
                                onClick={() => { handleToggleActive(quickActionUser._id); setShowQuickActions(false); }}
                                disabled={quickActionLoading}
                            >
                                {quickActionUser.isActive ? '⏸️ تعطيل الحساب' : '▶️ تفعيل الحساب'}
                            </button>

                            {/* إرسال إشعار */}
                            <button className="qap-btn notify" onClick={() => setShowQuickNotify(true)} disabled={quickActionLoading}>
                                📨 إرسال إشعار
                            </button>

                            {/* عرض الصورة */}
                            <button className="qap-btn photo" onClick={() => { setShowPhotoPreview(quickActionUser); setShowQuickActions(false); }}>
                                🖼️ عرض الصورة
                            </button>

                            {/* تفاصيل كاملة */}
                            <button className="qap-btn primary" onClick={() => { onViewDetail && onViewDetail(quickActionUser._id); setShowQuickActions(false); }}>
                                👁️ التفاصيل الكاملة
                            </button>
                        </div>

                        {/* Quick Notify Form (inline) */}
                        {showQuickNotify && (
                            <div className="qap-notify-form">
                                <input
                                    type="text"
                                    placeholder="عنوان الإشعار..."
                                    value={quickNotifyForm.title}
                                    onChange={(e) => setQuickNotifyForm({...quickNotifyForm, title: e.target.value})}
                                />
                                <textarea
                                    placeholder="نص الإشعار..."
                                    value={quickNotifyForm.body}
                                    onChange={(e) => setQuickNotifyForm({...quickNotifyForm, body: e.target.value})}
                                    rows={2}
                                />
                                <div className="qap-notify-btns">
                                    <button onClick={() => setShowQuickNotify(false)}>إلغاء</button>
                                    <button className="send" onClick={handleQuickNotify} disabled={!quickNotifyForm.title || quickActionLoading}>
                                        {quickActionLoading ? 'جاري الإرسال...' : '📨 إرسال'}
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* ✅ Photo Preview Modal */}
            {showPhotoPreview && (
                <div className="modal-overlay" onClick={() => setShowPhotoPreview(null)}>
                    <div className="photo-preview-modal" onClick={(e) => e.stopPropagation()}>
                        <button className="photo-preview-close" onClick={() => setShowPhotoPreview(null)}>✕</button>
                        <img
                            src={getImageUrl(showPhotoPreview.profileImage)}
                            alt={showPhotoPreview.name}
                            className="photo-preview-img"
                            onError={(e) => { e.target.onerror = null; e.target.src = getDefaultAvatar(showPhotoPreview.name); }}
                        />
                        <div className="photo-preview-info">
                            <strong>{showPhotoPreview.name}</strong>
                            <span>{showPhotoPreview.email}</span>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

export default Users;
