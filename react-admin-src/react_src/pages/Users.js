import React, { useState, useEffect, useCallback } from 'react';
import { getAllUsers, deleteUser, toggleUserActive, updateUser } from '../services/api';
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
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [searchTerm, setSearchTerm] = useState('');
    const [searchInput, setSearchInput] = useState('');
    const [filterStatus, setFilterStatus] = useState('all');
    const [filterRole, setFilterRole] = useState('all');
    const [filterAuthProvider, setFilterAuthProvider] = useState('all');
    const [quickFilter, setQuickFilter] = useState('');
    const [showDeleteModal, setShowDeleteModal] = useState(false);
    const [userToDelete, setUserToDelete] = useState(null);
    const [showEditModal, setShowEditModal] = useState(false);
    const [userToEdit, setUserToEdit] = useState(null);
    const [currentPage, setCurrentPage] = useState(1);
    const [itemsPerPage, setItemsPerPage] = useState(20);
    const [sortField, setSortField] = useState('createdAt');
    const [sortOrder, setSortOrder] = useState('desc');
    const [totalItems, setTotalItems] = useState(0);
    const [totalPages, setTotalPages] = useState(0);
    const toast = useToast();

    const fetchUsers = useCallback(async () => {
        try {
            setLoading(true);
            const params = {
                page: currentPage,
                limit: itemsPerPage,
                sortBy: sortField,
                sortOrder: sortOrder,
            };
            if (searchTerm) params.search = searchTerm;
            if (filterStatus !== 'all') params.status = filterStatus;
            if (filterRole !== 'all') params.role = filterRole;
            if (filterAuthProvider !== 'all') params.authProvider = filterAuthProvider;
            if (quickFilter) params.filter = quickFilter;

            const response = await getAllUsers(params);
            if (response.success) {
                setUsers(response.data.users);
                setTotalItems(response.data.total || response.count);
                setTotalPages(response.data.totalPages || Math.ceil((response.data.total || response.count) / itemsPerPage));
            }
        } catch (err) {
            console.error('خطأ في جلب المستخدمين:', err);
            setError(err.response?.data?.message || 'فشل تحميل المستخدمين');
        } finally {
            setLoading(false);
        }
    }, [currentPage, itemsPerPage, searchTerm, filterStatus, filterRole, filterAuthProvider, quickFilter, sortField, sortOrder]);

    useEffect(() => { fetchUsers(); }, [fetchUsers]);

    // Debounce search
    useEffect(() => {
        const timer = setTimeout(() => {
            setSearchTerm(searchInput);
            setCurrentPage(1);
        }, 400);
        return () => clearTimeout(timer);
    }, [searchInput]);

    const handleSort = (field) => {
        if (sortField === field) {
            setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
        } else {
            setSortField(field);
            setSortOrder('asc');
        }
        setCurrentPage(1);
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
                const action = user.isActive ? 'إلغاء تفعيل' : 'تفعيل';
                toast.success(`تم ${action} المستخدم بنجاح`);
            }
        } catch (err) {
            toast.error(err.response?.data?.message || 'فشل تحديث المستخدم');
        }
    };

    const openEditModal = (user) => { setUserToEdit(user); setShowEditModal(true); };

    const handleEditUser = async (userData) => {
        try {
            const response = await updateUser(userToEdit._id, userData);
            if (response.success) {
                setUsers(users.map(u => u._id === userToEdit._id ? { ...u, ...userData } : u));
                setShowEditModal(false);
                setUserToEdit(null);
                toast.success('تم تحديث بيانات المستخدم بنجاح');
            }
        } catch (err) {
            toast.error(err.response?.data?.message || 'فشل تحديث المستخدم');
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
                setTotalItems(prev => prev - 1);
                setShowDeleteModal(false);
                setUserToDelete(null);
                toast.success(`تم حذف المستخدم ${userToDelete.name} بنجاح`);
            }
        } catch (err) {
            toast.error(err.response?.data?.message || 'فشل حذف المستخدم');
        }
    };

    const getStatusBadge = (isActive) => isActive
        ? <span className="badge badge-success">نشط ✓</span>
        : <span className="badge badge-inactive">غير نشط</span>;

    const getRoleBadge = (role) => role === 'admin'
        ? <span className="badge badge-admin">مدير 👑</span>
        : <span className="badge badge-user">مستخدم</span>;

    const getAuthProviderBadge = (provider) => {
        switch (provider) {
            case 'google': return <span className="badge badge-google"><img src="/google.png" alt="Google" className="provider-icon" /> Google</span>;
            case 'apple': return <span className="badge badge-apple"><img src="/apple-logo.png" alt="Apple" className="provider-icon" /> Apple</span>;
            default: return <span className="badge badge-app">التطبيق</span>;
        }
    };

    const quickFilters = [
        { key: '', label: 'الكل', icon: '👥' },
        { key: 'new', label: 'جدد', icon: '🆕' },
        { key: 'violated', label: 'مخالفين', icon: '⚠️' },
        { key: 'banned', label: 'محظورين', icon: '🚫' },
        { key: 'premium', label: 'مميزين', icon: '⭐' },
        { key: 'online', label: 'متصلين', icon: '🟢' },
    ];

    return (
        <div className="users-page">
            {/* Header */}
            <div className="users-header">
                <div>
                    <h1>إدارة المستخدمين 👥</h1>
                    <p>إجمالي: {totalItems} مستخدم</p>
                </div>
                <button className="refresh-btn" onClick={fetchUsers}>تحديث 🔄</button>
            </div>

            {error && <div className="error-banner">{error}</div>}

            {/* Quick Filters */}
            <div className="quick-filters" style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
                {quickFilters.map(f => (
                    <button
                        key={f.key}
                        className={`quick-filter-btn ${quickFilter === f.key ? 'active' : ''}`}
                        onClick={() => { setQuickFilter(f.key); setCurrentPage(1); }}
                        style={{
                            padding: '8px 16px',
                            borderRadius: '20px',
                            border: quickFilter === f.key ? '2px solid #e91e63' : '1px solid #333',
                            background: quickFilter === f.key ? 'rgba(233,30,99,0.15)' : 'rgba(255,255,255,0.05)',
                            color: quickFilter === f.key ? '#e91e63' : '#ccc',
                            cursor: 'pointer',
                            fontSize: '14px',
                            transition: 'all 0.2s'
                        }}
                    >
                        {f.icon} {f.label}
                    </button>
                ))}
            </div>

            {/* Filters */}
            <div className="filters-section">
                <div className="search-box">
                    <input
                        type="text"
                        placeholder="ابحث بالاسم أو البريد الإلكتروني..."
                        value={searchInput}
                        onChange={(e) => setSearchInput(e.target.value)}
                    />
                    <span className="search-icon">🔍</span>
                </div>
                <div className="filter-group">
                    <select value={filterStatus} onChange={(e) => { setFilterStatus(e.target.value); setCurrentPage(1); }}>
                        <option value="all">جميع الحالات</option>
                        <option value="active">نشط فقط</option>
                        <option value="inactive">غير نشط فقط</option>
                    </select>
                    <select value={filterRole} onChange={(e) => { setFilterRole(e.target.value); setCurrentPage(1); }}>
                        <option value="all">جميع الأدوار</option>
                        <option value="admin">مدير فقط</option>
                        <option value="user">مستخدم فقط</option>
                    </select>
                    <select value={filterAuthProvider} onChange={(e) => { setFilterAuthProvider(e.target.value); setCurrentPage(1); }}>
                        <option value="all">جميع أنواع التسجيل</option>
                        <option value="app">التطبيق</option>
                        <option value="google">Google</option>
                        <option value="apple">Apple</option>
                    </select>
                </div>
            </div>

            {/* Table Controls */}
            <div className="table-controls">
                <div className="results-info">عرض {users.length} من {totalItems} مستخدم</div>
                <div className="items-per-page">
                    <label>عدد العناصر:</label>
                    <select value={itemsPerPage} onChange={(e) => { setItemsPerPage(Number(e.target.value)); setCurrentPage(1); }}>
                        <option value={10}>10</option>
                        <option value={20}>20</option>
                        <option value={50}>50</option>
                    </select>
                </div>
            </div>

            {/* Users Table */}
            {!loading && users.length === 0 ? (
                <div className="no-results">
                    <p>لا توجد نتائج 🔍</p>
                    <button onClick={() => { setSearchInput(''); setSearchTerm(''); setFilterStatus('all'); setFilterRole('all'); setFilterAuthProvider('all'); setQuickFilter(''); }}>
                        إعادة تعيين الفلاتر
                    </button>
                </div>
            ) : (
                <>
                    <div className="table-container">
                        <table className="users-table">
                            <thead>
                                <tr>
                                    <th onClick={() => handleSort('name')} className="sortable">الاسم {getSortIcon('name')}</th>
                                    <th onClick={() => handleSort('email')} className="sortable">البريد الإلكتروني {getSortIcon('email')}</th>
                                    <th onClick={() => handleSort('role')} className="sortable">الدور {getSortIcon('role')}</th>
                                    <th onClick={() => handleSort('authProvider')} className="sortable">نوع التسجيل {getSortIcon('authProvider')}</th>
                                    <th onClick={() => handleSort('isActive')} className="sortable">الحالة {getSortIcon('isActive')}</th>
                                    <th onClick={() => handleSort('createdAt')} className="sortable">تاريخ التسجيل {getSortIcon('createdAt')}</th>
                                    <th onClick={() => handleSort('lastLogin')} className="sortable">آخر دخول {getSortIcon('lastLogin')}</th>
                                    <th>الإجراءات</th>
                                </tr>
                            </thead>
                            <tbody>
                                {loading ? (
                                    <><TableRowSkeleton columns={8} /><TableRowSkeleton columns={8} /><TableRowSkeleton columns={8} /></>
                                ) : (
                                    users.map((user) => (
                                        <tr key={user._id}>
                                            <td>
                                                <div className="user-cell">
                                                    <img src={user.profileImage ? getImageUrl(user.profileImage) : getDefaultAvatar(user.name)} alt={user.name} className="user-avatar-small" onError={(e) => { e.target.onerror = null; e.target.src = getDefaultAvatar(user.name); }} />
                                                    <span>{user.name}</span>
                                                </div>
                                            </td>
                                            <td dir="ltr" className="email-cell">{user.email}</td>
                                            <td>{getRoleBadge(user.role)}</td>
                                            <td>{getAuthProviderBadge(user.authProvider)}</td>
                                            <td>{getStatusBadge(user.isActive)}</td>
                                            <td>{formatDate(user.createdAt)}</td>
                                            <td>{user.lastLogin ? formatDate(user.lastLogin) : <span className="no-login">لم يسجل دخول</span>}</td>
                                            <td>
                                                <div className="actions-cell">
                                                    <button className="action-btn btn-primary" onClick={() => onViewDetail && onViewDetail(user._id)} title="عرض التفاصيل">👁️</button>
                                                    <button className="action-btn btn-info" onClick={() => openEditModal(user)} title="تعديل">✏️</button>
                                                    <button className={`action-btn ${user.isActive ? 'btn-warning' : 'btn-success'}`} onClick={() => handleToggleActive(user._id)} title={user.isActive ? 'إلغاء التفعيل' : 'تفعيل'}>{user.isActive ? '🔒' : '✅'}</button>
                                                    <button className="action-btn btn-danger" onClick={() => confirmDelete(user)} title="حذف">🗑️</button>
                                                    <div style={{display:"flex",gap:"2px",marginTop:"4px"}}>
                                                        <button className="action-btn" style={{fontSize:"10px",padding:"2px 6px",background:"#2196F3",color:"#fff",border:"none",borderRadius:"4px",cursor:"pointer"}} onClick={() => handleQuickAction(user._id, "escalate")} title="تصعيد تلقائي">🔄</button>
                                                        <button className="action-btn" style={{fontSize:"10px",padding:"2px 6px",background:"#FF9800",color:"#fff",border:"none",borderRadius:"4px",cursor:"pointer"}} onClick={() => handleQuickAction(user._id, "restrict-new")} title="تقييد جزئي 24 ساعة">🔒</button>
                                                        <button className="action-btn" style={{fontSize:"10px",padding:"2px 6px",background:"#f44336",color:"#fff",border:"none",borderRadius:"4px",cursor:"pointer"}} onClick={() => handleQuickAction(user._id, "restrict-all")} title="تقييد كامل 48 ساعة">⛔</button>
                                                        <button className="action-btn" style={{fontSize:"10px",padding:"2px 6px",background:"#4CAF50",color:"#fff",border:"none",borderRadius:"4px",cursor:"pointer"}} onClick={() => handleQuickAction(user._id, "unrestrict")} title="إلغاء التقييد">🔓</button>
                                                        <button className="action-btn" style={{fontSize:"10px",padding:"2px 6px",background:"#9C27B0",color:"#fff",border:"none",borderRadius:"4px",cursor:"pointer"}} onClick={() => handleQuickAction(user._id, "ban-device")} title="حظر الجهاز">📵</button>
                                                    </div>
                                                </div>
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                    <Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={setCurrentPage} itemsPerPage={itemsPerPage} totalItems={totalItems} />
                </>
            )}

            {showEditModal && <EditUserModal user={userToEdit} onClose={() => { setShowEditModal(false); setUserToEdit(null); }} onSave={handleEditUser} />}

            <ConfirmModal isOpen={showDeleteModal} onClose={() => { setShowDeleteModal(false); setUserToDelete(null); }} onConfirm={handleDelete} title="تأكيد الحذف" message="هل أنت متأكد من حذف المستخدم؟" confirmText="حذف نهائياً" cancelText="إلغاء" variant="danger">
                <div className="user-to-delete"><strong>{userToDelete?.name}</strong><span>{userToDelete?.email}</span></div>
            </ConfirmModal>
        </div>
    );
}

export default Users;
