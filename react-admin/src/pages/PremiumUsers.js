import React, { useState, useEffect } from 'react';
import { getPremiumUsers, updateUserPremium } from '../services/api';
import { useToast } from '../components/Toast';
import Pagination from '../components/Pagination';
import LoadingSpinner from '../components/LoadingSpinner';
import StatCard from '../components/StatCard';
import DataTable from '../components/DataTable';
import ConfirmModal from '../components/ConfirmModal';
import { formatDate, getRelativeTime, formatDateTimeLocal } from '../utils/formatters';
import { getPlanBadge } from '../utils/badgeHelpers';
import { getImageUrl, getDefaultAvatar } from '../config';
import './PremiumUsers.css';

function PremiumUsers() {
    const [users, setUsers] = useState([]);
    const [stats, setStats] = useState({ total: 0, active: 0, expired: 0, weekly: 0, monthly: 0, quarterly: 0 });
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [filterPlan, setFilterPlan] = useState('all');
    const [filterStatus, setFilterStatus] = useState('all');
    const [currentPage, setCurrentPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [totalItems, setTotalItems] = useState(0);
    const [showEditModal, setShowEditModal] = useState(false);
    const [userToEdit, setUserToEdit] = useState(null);
    const [editForm, setEditForm] = useState({ isPremium: true, premiumPlan: 'monthly', premiumExpiresAt: '' });
    const [editLoading, setEditLoading] = useState(false);
    const [showRemoveModal, setShowRemoveModal] = useState(false);
    const [userToRemove, setUserToRemove] = useState(null);
    const toast = useToast();

    useEffect(() => {
        fetchPremiumUsers();
    }, [currentPage, filterPlan, filterStatus]);

    const fetchPremiumUsers = async () => {
        try {
            setLoading(true);
            const params = { page: currentPage, limit: 10 };
            if (filterPlan !== 'all') params.plan = filterPlan;
            if (filterStatus !== 'all') params.expired = filterStatus === 'expired';

            const response = await getPremiumUsers(params);
            if (response.success) {
                setUsers(response.data.users);
                setStats(response.data.stats);
                setTotalPages(response.data.totalPages);
                setTotalItems(response.data.total);
            }
        } catch (err) {
            console.error('خطأ في جلب المشتركين المميزين:', err);
            setError(err.response?.data?.message || 'فشل تحميل المشتركين المميزين');
        } finally {
            setLoading(false);
        }
    };

    const isExpired = (dateString) => {
        if (!dateString) return true;
        return new Date(dateString) < new Date();
    };

    const getExpiryDisplay = (expiresAt) => {
        const expired = isExpired(expiresAt);
        return (
            <div className={`expiry-display ${expired ? 'expired' : 'active'}`}>
                <span className="expiry-date">{formatDate(expiresAt)}</span>
                <span className="expiry-relative">{getRelativeTime(expiresAt)}</span>
            </div>
        );
    };

    const getVerifiedBadge = (verification) => {
        return verification?.isVerified
            ? <span className="badge badge-verified">موثق ✓</span>
            : <span className="badge badge-unverified">غير موثق ✗</span>;
    };

    const openEditModal = (user) => {
        setUserToEdit(user);
        setEditForm({
            isPremium: user.isPremium !== false,
            premiumPlan: user.premiumPlan || 'monthly',
            premiumExpiresAt: formatDateTimeLocal(user.premiumExpiresAt)
        });
        setShowEditModal(true);
    };

    const handleEditChange = (e) => {
        const { name, value, type, checked } = e.target;
        setEditForm(prev => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
    };

    const handleEditSubmit = async (e) => {
        e.preventDefault();
        if (!userToEdit) return;

        setEditLoading(true);
        try {
            const data = {
                isPremium: editForm.isPremium,
                premiumPlan: editForm.premiumPlan,
                premiumExpiresAt: editForm.premiumExpiresAt ? new Date(editForm.premiumExpiresAt).toISOString() : null
            };
            const response = await updateUserPremium(userToEdit._id, data);
            if (response.success) {
                toast.success('تم تحديث بيانات الاشتراك بنجاح');
                setShowEditModal(false);
                setUserToEdit(null);
                fetchPremiumUsers();
            }
        } catch (err) {
            console.error('خطأ في تحديث الاشتراك:', err);
            toast.error(err.response?.data?.message || 'فشل تحديث بيانات الاشتراك');
        } finally {
            setEditLoading(false);
        }
    };

    const handleRemovePremium = async () => {
        if (!userToRemove) return;
        try {
            const response = await updateUserPremium(userToRemove._id, {
                isPremium: false, premiumPlan: null, premiumExpiresAt: null
            });
            if (response.success) {
                toast.success(`تم إلغاء اشتراك ${userToRemove.name} بنجاح`);
                setShowRemoveModal(false);
                setUserToRemove(null);
                fetchPremiumUsers();
            }
        } catch (err) {
            console.error('خطأ في إلغاء الاشتراك:', err);
            toast.error(err.response?.data?.message || 'فشل إلغاء الاشتراك');
        }
    };

    const renderUserCell = (user) => (
        <div className="user-cell">
            <img
                src={user.profileImage ? getImageUrl(user.profileImage) : getDefaultAvatar(user.name)}
                alt={user.name}
                className="user-avatar-small"
                onError={(e) => { e.target.onerror = null; e.target.src = getDefaultAvatar(user.name); }}
            />
            <span>{user.name}</span>
        </div>
    );

    if (loading && users.length === 0) {
        return <LoadingSpinner text="جاري تحميل المشتركين المميزين..." />;
    }

    const columns = [
        { key: 'user', label: 'المستخدم', render: (row) => renderUserCell(row) },
        { key: 'email', label: 'البريد الإلكتروني', render: (row) => <span dir="ltr" className="email-cell">{row.email}</span> },
        { key: 'plan', label: 'الخطة', render: (row) => getPlanBadge(row.premiumPlan) },
        { key: 'expiry', label: 'تاريخ الانتهاء', render: (row) => getExpiryDisplay(row.premiumExpiresAt) },
        { key: 'verification', label: 'التوثيق', render: (row) => getVerifiedBadge(row.verification) },
        { key: 'actions', label: 'الإجراءات', render: (row) => (
            <div className="actions-cell">
                <button className="action-btn btn-info" onClick={() => openEditModal(row)} title="تعديل الاشتراك">✏️</button>
                <button className="action-btn btn-danger-light" onClick={() => { setUserToRemove(row); setShowRemoveModal(true); }} title="إلغاء الاشتراك">🗑️</button>
            </div>
        )}
    ];

    return (
        <div className="premium-users-page">
            {/* Header */}
            <div className="page-header">
                <div>
                    <h1>إدارة المشتركين المميزين ⭐</h1>
                    <p>إدارة اشتراكات المستخدمين المميزين</p>
                </div>
                <button className="refresh-btn" onClick={() => { setCurrentPage(1); fetchPremiumUsers(); }}>تحديث 🔄</button>
            </div>

            {error && <div className="error-banner">{error}</div>}

            {/* Stats */}
            <div className="stats-grid">
                <StatCard icon="⭐" value={stats.total} label="إجمالي المشتركين" color="purple">
                    <div className="plan-breakdown">
                        <span className="plan-tag weekly">{stats.weekly} أسبوعي</span>
                        <span className="plan-tag monthly">{stats.monthly} شهري</span>
                        <span className="plan-tag quarterly">{stats.quarterly} ربع سنوي</span>
                    </div>
                </StatCard>
                <StatCard icon="✅" value={stats.active} label="نشط" color="green" />
                <StatCard icon="⏰" value={stats.expired} label="منتهي" color="orange" />
            </div>

            {/* Filters */}
            <div className="premium-filters">
                <div className="filter-group">
                    <select value={filterPlan} onChange={(e) => { setFilterPlan(e.target.value); setCurrentPage(1); }}>
                        <option value="all">جميع الخطط</option>
                        <option value="weekly">أسبوعي</option>
                        <option value="monthly">شهري</option>
                        <option value="quarterly">ربع سنوي</option>
                    </select>
                    <select value={filterStatus} onChange={(e) => { setFilterStatus(e.target.value); setCurrentPage(1); }}>
                        <option value="all">جميع الحالات</option>
                        <option value="active">نشط فقط</option>
                        <option value="expired">منتهي فقط</option>
                    </select>
                </div>
            </div>

            {/* Results Info */}
            <div className="table-controls">
                <div className="results-info">عرض {users.length} من {totalItems} مشترك</div>
            </div>

            {/* Table */}
            <DataTable
                columns={columns}
                data={users}
                loading={loading && users.length > 0}
                gradientHeader
                emptyIcon="🔍"
                emptyMessage="لا يوجد مشتركين مميزين"
            >
                {totalPages > 1 && (
                    <Pagination
                        currentPage={currentPage}
                        totalPages={totalPages}
                        onPageChange={setCurrentPage}
                        itemsPerPage={10}
                        totalItems={totalItems}
                    />
                )}
            </DataTable>

            {/* Edit Premium Modal */}
            {showEditModal && (
                <div className="modal-overlay" onClick={() => setShowEditModal(false)}>
                    <div className="modal-content premium-edit-modal" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header premium-modal-header">
                            <h2>تعديل الاشتراك المميز</h2>
                            <button className="modal-close-white" onClick={() => setShowEditModal(false)}>×</button>
                        </div>

                        <form onSubmit={handleEditSubmit}>
                            <div className="modal-body">
                                <div className="edit-user-info">
                                    <img
                                        src={userToEdit?.profileImage ? getImageUrl(userToEdit.profileImage) : getDefaultAvatar(userToEdit?.name)}
                                        alt={userToEdit?.name}
                                        className="edit-user-avatar"
                                        onError={(e) => { e.target.onerror = null; e.target.src = getDefaultAvatar(userToEdit?.name); }}
                                    />
                                    <div>
                                        <strong>{userToEdit?.name}</strong>
                                        <span>{userToEdit?.email}</span>
                                    </div>
                                </div>

                                <div className="form-group">
                                    <label className="toggle-label">
                                        <span>الاشتراك المميز</span>
                                        <div className="toggle-switch">
                                            <input type="checkbox" name="isPremium" checked={editForm.isPremium} onChange={handleEditChange} />
                                            <span className="toggle-slider"></span>
                                        </div>
                                        <span className={`toggle-status ${editForm.isPremium ? 'on' : 'off'}`}>
                                            {editForm.isPremium ? 'مفعل' : 'معطل'}
                                        </span>
                                    </label>
                                </div>

                                <div className="form-group">
                                    <label htmlFor="premiumPlan">نوع الخطة</label>
                                    <select id="premiumPlan" name="premiumPlan" value={editForm.premiumPlan} onChange={handleEditChange} disabled={!editForm.isPremium}>
                                        <option value="weekly">أسبوعي</option>
                                        <option value="monthly">شهري</option>
                                        <option value="quarterly">ربع سنوي</option>
                                    </select>
                                </div>

                                <div className="form-group">
                                    <label htmlFor="premiumExpiresAt">تاريخ الانتهاء</label>
                                    <input type="datetime-local" id="premiumExpiresAt" name="premiumExpiresAt" value={editForm.premiumExpiresAt} onChange={handleEditChange} disabled={!editForm.isPremium} />
                                </div>
                            </div>

                            <div className="modal-footer premium-modal-footer">
                                <button type="button" className="btn-cancel" onClick={() => setShowEditModal(false)} disabled={editLoading}>إلغاء</button>
                                <button type="submit" className="btn-submit" disabled={editLoading}>
                                    {editLoading ? 'جاري الحفظ...' : 'حفظ التعديلات'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Remove Confirmation */}
            <ConfirmModal
                isOpen={showRemoveModal}
                onClose={() => setShowRemoveModal(false)}
                onConfirm={handleRemovePremium}
                title="تأكيد إلغاء الاشتراك"
                message="هل أنت متأكد من إلغاء الاشتراك المميز؟"
                confirmText="إلغاء الاشتراك"
                cancelText="تراجع"
                variant="danger"
            >
                {userToRemove && (
                    <div className="user-to-delete">
                        <strong>{userToRemove.name}</strong>
                        <span>{userToRemove.email}</span>
                    </div>
                )}
            </ConfirmModal>
        </div>
    );
}

export default PremiumUsers;
