import React, { useState, useEffect } from 'react';
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
    const [filteredUsers, setFilteredUsers] = useState([]);
    const [paginatedUsers, setPaginatedUsers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [searchTerm, setSearchTerm] = useState('');
    const [filterStatus, setFilterStatus] = useState('all'); // all, active, inactive
    const [filterRole, setFilterRole] = useState('all'); // all, admin, user
    const [filterAuthProvider, setFilterAuthProvider] = useState('all'); // all, app, google, apple
    const [showDeleteModal, setShowDeleteModal] = useState(false);
    const [userToDelete, setUserToDelete] = useState(null);
    const [showEditModal, setShowEditModal] = useState(false);
    const [userToEdit, setUserToEdit] = useState(null);
    const [currentPage, setCurrentPage] = useState(1);
    const [itemsPerPage, setItemsPerPage] = useState(10);
    const [sortField, setSortField] = useState('createdAt');
    const [sortOrder, setSortOrder] = useState('desc');
    const toast = useToast();

    useEffect(() => {
        fetchUsers();
    }, []);

    useEffect(() => {
        filterUsers();
    }, [users, searchTerm, filterStatus, filterRole, filterAuthProvider]);

    useEffect(() => {
        sortAndPaginateUsers();
    }, [filteredUsers, currentPage, itemsPerPage, sortField, sortOrder]);

    const fetchUsers = async () => {
        try {
            setLoading(true);
            const response = await getAllUsers();
            
            if (response.success) {
                setUsers(response.data.users);
            }
        } catch (err) {
            console.error('خطأ في جلب المستخدمين:', err);
            setError(err.response?.data?.message || 'فشل تحميل المستخدمين');
        } finally {
            setLoading(false);
        }
    };

    const filterUsers = () => {
        let filtered = [...users];

        // فلترة حسب البحث
        if (searchTerm) {
            filtered = filtered.filter(user =>
                user.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                user.email.toLowerCase().includes(searchTerm.toLowerCase())
            );
        }

        // فلترة حسب الحالة
        if (filterStatus !== 'all') {
            filtered = filtered.filter(user =>
                filterStatus === 'active' ? user.isActive : !user.isActive
            );
        }

        // فلترة حسب الدور
        if (filterRole !== 'all') {
            filtered = filtered.filter(user => user.role === filterRole);
        }

        // فلترة حسب نوع التسجيل
        if (filterAuthProvider !== 'all') {
            filtered = filtered.filter(user => (user.authProvider || 'app') === filterAuthProvider);
        }

        setFilteredUsers(filtered);
        setCurrentPage(1); // إعادة تعيين الصفحة عند التصفية
    };

    const sortAndPaginateUsers = () => {
        // ترتيب المستخدمين
        let sorted = [...filteredUsers];

        sorted.sort((a, b) => {
            let aValue = a[sortField];
            let bValue = b[sortField];

            // معالجة القيم النصية
            if (typeof aValue === 'string') {
                aValue = aValue.toLowerCase();
                bValue = bValue.toLowerCase();
            }

            // معالجة التواريخ
            if (sortField === 'createdAt' || sortField === 'lastLogin') {
                aValue = new Date(aValue || 0).getTime();
                bValue = new Date(bValue || 0).getTime();
            }

            if (sortOrder === 'asc') {
                return aValue > bValue ? 1 : -1;
            } else {
                return aValue < bValue ? 1 : -1;
            }
        });

        // تطبيق الترقيم
        const startIndex = (currentPage - 1) * itemsPerPage;
        const endIndex = startIndex + itemsPerPage;
        const paginated = sorted.slice(startIndex, endIndex);

        setPaginatedUsers(paginated);
    };

    const handleSort = (field) => {
        if (sortField === field) {
            // عكس الترتيب إذا كان نفس الحقل
            setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
        } else {
            // حقل جديد، ابدأ بـ asc
            setSortField(field);
            setSortOrder('asc');
        }
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
                // تحديث القائمة
                setUsers(users.map(u =>
                    u._id === userId ? { ...u, isActive: !u.isActive } : u
                ));

                // إظهار رسالة نجاح
                const action = user.isActive ? 'إلغاء تفعيل' : 'تفعيل';
                toast.success(`تم ${action} المستخدم بنجاح`);
            }
        } catch (err) {
            console.error('خطأ في تحديث المستخدم:', err);
            const errorMsg = err.response?.data?.message || 'فشل تحديث المستخدم';
            toast.error(errorMsg);
        }
    };

    const openEditModal = (user) => {
        setUserToEdit(user);
        setShowEditModal(true);
    };

    const handleEditUser = async (userData) => {
        try {
            const response = await updateUser(userToEdit._id, userData);

            if (response.success) {
                // تحديث القائمة
                setUsers(users.map(u =>
                    u._id === userToEdit._id ? { ...u, ...userData } : u
                ));
                setShowEditModal(false);
                setUserToEdit(null);

                // إظهار رسالة نجاح
                toast.success('تم تحديث بيانات المستخدم بنجاح');
            }
        } catch (err) {
            console.error('خطأ في تحديث المستخدم:', err);
            const errorMsg = err.response?.data?.message || 'فشل تحديث المستخدم';
            toast.error(errorMsg);
            throw err; // لإيقاف loading في Modal
        }
    };

    const confirmDelete = (user) => {
        setUserToDelete(user);
        setShowDeleteModal(true);
    };

    const handleDelete = async () => {
        if (!userToDelete) return;

        try {
            const response = await deleteUser(userToDelete._id);

            if (response.success) {
                // إزالة المستخدم من القائمة
                setUsers(users.filter(user => user._id !== userToDelete._id));
                setShowDeleteModal(false);
                setUserToDelete(null);

                // إظهار رسالة نجاح
                toast.success(`تم حذف المستخدم ${userToDelete.name} بنجاح`);
            }
        } catch (err) {
            console.error('خطأ في حذف المستخدم:', err);
            const errorMsg = err.response?.data?.message || 'فشل حذف المستخدم';
            toast.error(errorMsg);
        }
    };

    const getStatusBadge = (isActive) => {
        return isActive ? (
            <span className="badge badge-success">نشط ✓</span>
        ) : (
            <span className="badge badge-inactive">غير نشط</span>
        );
    };

    const getRoleBadge = (role) => {
        return role === 'admin' ? (
            <span className="badge badge-admin">مدير 👑</span>
        ) : (
            <span className="badge badge-user">مستخدم</span>
        );
    };

    const getAuthProviderBadge = (provider) => {
        switch (provider) {
            case 'google':
                return <span className="badge badge-google"><img src="/google.png" alt="Google" className="provider-icon" /> Google</span>;
            case 'apple':
                return <span className="badge badge-apple"><img src="/apple-logo.png" alt="Apple" className="provider-icon" /> Apple</span>;
            default:
                return <span className="badge badge-app">التطبيق</span>;
        }
    };

    if (loading) {
        return (
            <div className="users-page">
                <div className="loading-container">
                    <div className="spinner"></div>
                    <p>جاري تحميل المستخدمين...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="users-page">
            {/* Header */}
            <div className="users-header">
                <div>
                    <h1>إدارة المستخدمين 👥</h1>
                    <p>إجمالي المستخدمين: {users.length}</p>
                </div>
                <button className="refresh-btn" onClick={fetchUsers}>
                    تحديث 🔄
                </button>
            </div>

            {error && <div className="error-banner">{error}</div>}

            {/* Filters */}
            <div className="filters-section">
                <div className="search-box">
                    <input
                        type="text"
                        placeholder="ابحث بالاسم أو البريد الإلكتروني..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                    <span className="search-icon">🔍</span>
                </div>

                <div className="filter-group">
                    <select
                        value={filterStatus}
                        onChange={(e) => setFilterStatus(e.target.value)}
                    >
                        <option value="all">جميع الحالات</option>
                        <option value="active">نشط فقط</option>
                        <option value="inactive">غير نشط فقط</option>
                    </select>

                    <select
                        value={filterRole}
                        onChange={(e) => setFilterRole(e.target.value)}
                    >
                        <option value="all">جميع الأدوار</option>
                        <option value="admin">مدير فقط</option>
                        <option value="user">مستخدم فقط</option>
                    </select>

                    <select
                        value={filterAuthProvider}
                        onChange={(e) => setFilterAuthProvider(e.target.value)}
                    >
                        <option value="all">جميع أنواع التسجيل</option>
                        <option value="app">التطبيق</option>
                        <option value="google">Google</option>
                        <option value="apple">Apple</option>
                    </select>
                </div>
            </div>

            {/* Items Per Page Selector */}
            <div className="table-controls">
                <div className="results-info">
                    عرض {filteredUsers.length} من {users.length} مستخدم
                </div>
                <div className="items-per-page">
                    <label>عدد العناصر:</label>
                    <select
                        value={itemsPerPage}
                        onChange={(e) => {
                            setItemsPerPage(Number(e.target.value));
                            setCurrentPage(1);
                        }}
                    >
                        <option value={5}>5</option>
                        <option value={10}>10</option>
                        <option value={20}>20</option>
                        <option value={50}>50</option>
                    </select>
                </div>
            </div>

            {/* Users Table */}
            {filteredUsers.length === 0 ? (
                <div className="no-results">
                    <p>لا توجد نتائج 🔍</p>
                    <button onClick={() => {
                        setSearchTerm('');
                        setFilterStatus('all');
                        setFilterRole('all');
                        setFilterAuthProvider('all');
                    }}>
                        إعادة تعيين الفلاتر
                    </button>
                </div>
            ) : (
                <>
                    <div className="table-container">
                        <table className="users-table">
                            <thead>
                                <tr>
                                    <th onClick={() => handleSort('name')} className="sortable">
                                        الاسم {getSortIcon('name')}
                                    </th>
                                    <th onClick={() => handleSort('email')} className="sortable">
                                        البريد الإلكتروني {getSortIcon('email')}
                                    </th>
                                    <th onClick={() => handleSort('role')} className="sortable">
                                        الدور {getSortIcon('role')}
                                    </th>
                                    <th onClick={() => handleSort('authProvider')} className="sortable">
                                        نوع التسجيل {getSortIcon('authProvider')}
                                    </th>
                                    <th onClick={() => handleSort('isActive')} className="sortable">
                                        الحالة {getSortIcon('isActive')}
                                    </th>
                                    <th onClick={() => handleSort('createdAt')} className="sortable">
                                        تاريخ التسجيل {getSortIcon('createdAt')}
                                    </th>
                                    <th onClick={() => handleSort('lastLogin')} className="sortable">
                                        آخر دخول {getSortIcon('lastLogin')}
                                    </th>
                                    <th>الإجراءات</th>
                                </tr>
                            </thead>
                            <tbody>
                                {loading ? (
                                    <>
                                        <TableRowSkeleton columns={8} />
                                        <TableRowSkeleton columns={8} />
                                        <TableRowSkeleton columns={8} />
                                    </>
                                ) : (
                                    paginatedUsers.map((user) => (
                                <tr key={user._id}>
                                    <td>
                                        <div className="user-cell">
                                            <img
                                                src={user.profileImage ? getImageUrl(user.profileImage) : getDefaultAvatar(user.name)}
                                                alt={user.name}
                                                className="user-avatar-small"
                                                onError={(e) => {
                                                    e.target.onerror = null;
                                                    e.target.src = getDefaultAvatar(user.name);
                                                }}
                                            />
                                            <span>{user.name}</span>
                                        </div>
                                    </td>
                                    <td dir="ltr" className="email-cell">{user.email}</td>
                                    <td>{getRoleBadge(user.role)}</td>
                                    <td>{getAuthProviderBadge(user.authProvider)}</td>
                                    <td>{getStatusBadge(user.isActive)}</td>
                                    <td>{formatDate(user.createdAt)}</td>
                                    <td>
                                        {user.lastLogin 
                                            ? formatDate(user.lastLogin)
                                            : <span className="no-login">لم يسجل دخول</span>
                                        }
                                    </td>
                                    <td>
                                        <div className="actions-cell">
                                            <button
                                                className="action-btn btn-primary"
                                                onClick={() => onViewDetail && onViewDetail(user._id)}
                                                title="عرض التفاصيل"
                                            >
                                                👁️
                                            </button>
                                            <button
                                                className="action-btn btn-info"
                                                onClick={() => openEditModal(user)}
                                                title="تعديل"
                                            >
                                                ✏️
                                            </button>
                                            <button
                                                className={`action-btn ${user.isActive ? 'btn-warning' : 'btn-success'}`}
                                                onClick={() => handleToggleActive(user._id)}
                                                title={user.isActive ? 'إلغاء التفعيل' : 'تفعيل'}
                                            >
                                                {user.isActive ? '🔒' : '✅'}
                                            </button>
                                            <button
                                                className="action-btn btn-danger"
                                                onClick={() => confirmDelete(user)}
                                                title="حذف"
                                            >
                                                🗑️
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>

                    {/* Pagination */}
                    <Pagination
                        currentPage={currentPage}
                        totalPages={Math.ceil(filteredUsers.length / itemsPerPage)}
                        onPageChange={setCurrentPage}
                        itemsPerPage={itemsPerPage}
                        totalItems={filteredUsers.length}
                    />
                </>
            )}

            {/* Edit User Modal */}
            {showEditModal && (
                <EditUserModal
                    user={userToEdit}
                    onClose={() => {
                        setShowEditModal(false);
                        setUserToEdit(null);
                    }}
                    onSave={handleEditUser}
                />
            )}

            {/* Delete Modal */}
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
        </div>
    );
}

export default Users;
