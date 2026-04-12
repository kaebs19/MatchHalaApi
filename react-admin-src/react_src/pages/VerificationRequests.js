import React, { useState, useEffect } from 'react';
import { getVerificationRequests, reviewVerification } from '../services/api';
import { useToast } from '../components/Toast';
import Pagination from '../components/Pagination';
import LoadingSpinner from '../components/LoadingSpinner';
import StatCard from '../components/StatCard';
import DataTable from '../components/DataTable';
import { formatDateTime } from '../utils/formatters';
import { getVerificationStatusBadge } from '../utils/badgeHelpers';
import { getImageUrl, getDefaultAvatar } from '../config';
import './VerificationRequests.css';

function VerificationRequests() {
    const [users, setUsers] = useState([]);
    const [stats, setStats] = useState({ total: 0, pending: 0, approved: 0, rejected: 0 });
    const [loading, setLoading] = useState(true);
    const [filterStatus, setFilterStatus] = useState('all');
    const [currentPage, setCurrentPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [totalItems, setTotalItems] = useState(0);
    const [selectedUser, setSelectedUser] = useState(null);
    const [showSelfieModal, setShowSelfieModal] = useState(false);
    const [actionLoading, setActionLoading] = useState(null);
    const { showToast } = useToast();

    useEffect(() => {
        fetchVerificationRequests();
    }, [currentPage, filterStatus]);

    const fetchVerificationRequests = async () => {
        try {
            setLoading(true);
            const params = { page: currentPage, limit: 20 };
            if (filterStatus !== 'all') params.status = filterStatus;

            const response = await getVerificationRequests(params);
            if (response.success) {
                setUsers(response.data.users);
                setStats(response.data.stats);
                setTotalPages(response.data.totalPages);
                setTotalItems(response.data.total);
            }
        } catch (error) {
            showToast('فشل في تحميل طلبات التوثيق', 'error');
            console.error('Error fetching verification requests:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleReview = async (userId, action) => {
        try {
            setActionLoading(userId);
            const response = await reviewVerification(userId, action);
            if (response.success) {
                const msg = action === 'approved' ? 'تم قبول طلب التوثيق' : 'تم رفض طلب التوثيق';
                showToast(msg, 'success');
                fetchVerificationRequests();
                if (showSelfieModal) {
                    setShowSelfieModal(false);
                    setSelectedUser(null);
                }
            }
        } catch (error) {
            showToast('فشل في تحديث حالة التوثيق', 'error');
            console.error('Error reviewing verification:', error);
        } finally {
            setActionLoading(null);
        }
    };

    const getPlanLabel = (plan) => {
        if (!plan) return '-';
        const plans = { monthly: 'شهري', yearly: 'سنوي', lifetime: 'مدى الحياة' };
        return plans[plan] || plan;
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

    const renderActions = (user) => (
        <div className="actions-cell">
            {user.verification?.selfieUrl && (
                <button
                    className="action-btn btn-view"
                    onClick={() => { setSelectedUser(user); setShowSelfieModal(true); }}
                    title="عرض السيلفي"
                >
                    🖼️
                </button>
            )}
            {user.verification?.status === 'pending' && (
                <>
                    <button
                        className="action-btn btn-approve"
                        onClick={() => handleReview(user._id, 'approved')}
                        disabled={actionLoading === user._id}
                        title="قبول"
                    >
                        {actionLoading === user._id ? '...' : '✓'}
                    </button>
                    <button
                        className="action-btn btn-reject"
                        onClick={() => handleReview(user._id, 'rejected')}
                        disabled={actionLoading === user._id}
                        title="رفض"
                    >
                        {actionLoading === user._id ? '...' : '✗'}
                    </button>
                </>
            )}
        </div>
    );

    if (loading && currentPage === 1) {
        return <LoadingSpinner text="جاري تحميل طلبات التوثيق..." />;
    }

    const columns = [
        { key: 'user', label: 'المستخدم', render: (row) => renderUserCell(row) },
        { key: 'email', label: 'البريد الإلكتروني', render: (row) => <span dir="ltr" className="email-cell">{row.email}</span> },
        { key: 'plan', label: 'الخطة المميزة', render: (row) => row.isPremium ? <span className="badge badge-monthly">{getPlanLabel(row.premiumPlan)}</span> : <span className="text-muted">-</span> },
        { key: 'date', label: 'تاريخ التقديم', render: (row) => formatDateTime(row.verification?.submittedAt) },
        { key: 'status', label: 'الحالة', render: (row) => getVerificationStatusBadge(row.verification?.status) },
        { key: 'actions', label: 'الإجراءات', render: (row) => renderActions(row) }
    ];

    return (
        <div className="verification-page">
            {/* Statistics */}
            <div className="stats-grid">
                <StatCard icon="📋" value={stats.total} label="إجمالي الطلبات" color="purple" />
                <StatCard icon="⏳" value={stats.pending} label="قيد الانتظار" color="orange" />
                <StatCard icon="✅" value={stats.approved} label="مقبولة" color="green" />
                <StatCard icon="❌" value={stats.rejected} label="مرفوضة" color="red" />
            </div>

            {/* Filters */}
            <div className="verification-filters">
                <select
                    value={filterStatus}
                    onChange={(e) => { setFilterStatus(e.target.value); setCurrentPage(1); }}
                >
                    <option value="all">جميع الحالات</option>
                    <option value="pending">قيد الانتظار</option>
                    <option value="approved">مقبولة</option>
                    <option value="rejected">مرفوضة</option>
                </select>
                <button onClick={fetchVerificationRequests} className="refresh-btn">تحديث 🔄</button>
            </div>

            {/* Table */}
            <DataTable
                columns={columns}
                data={users}
                loading={loading && currentPage > 1}
                gradientHeader
                emptyIcon="📭"
                emptyMessage="لا توجد طلبات توثيق"
            >
                {totalPages > 1 && (
                    <Pagination
                        currentPage={currentPage}
                        totalPages={totalPages}
                        onPageChange={setCurrentPage}
                        itemsPerPage={20}
                        totalItems={totalItems}
                    />
                )}
            </DataTable>

            {/* Selfie Modal */}
            {showSelfieModal && selectedUser && (
                <div className="modal-overlay" onClick={() => setShowSelfieModal(false)}>
                    <div className="modal-content selfie-modal" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3>صورة التوثيق</h3>
                            <button className="close-btn" onClick={() => setShowSelfieModal(false)}>✕</button>
                        </div>

                        <div className="selfie-user-info">
                            <img
                                src={selectedUser.profileImage ? getImageUrl(selectedUser.profileImage) : getDefaultAvatar(selectedUser.name)}
                                alt={selectedUser.name}
                                className="selfie-user-avatar"
                                onError={(e) => { e.target.onerror = null; e.target.src = getDefaultAvatar(selectedUser.name); }}
                            />
                            <div className="selfie-user-details">
                                <h4>{selectedUser.name}</h4>
                                <p dir="ltr">{selectedUser.email}</p>
                                <span>{getVerificationStatusBadge(selectedUser.verification?.status)}</span>
                            </div>
                        </div>

                        <div className="selfie-image-container">
                            <img
                                src={getImageUrl(selectedUser.verification?.selfieUrl)}
                                alt="صورة التوثيق"
                                className="selfie-image"
                                onError={(e) => { e.target.onerror = null; e.target.src = ''; e.target.alt = 'فشل في تحميل الصورة'; }}
                            />
                        </div>

                        <div className="selfie-meta">
                            <div className="selfie-meta-item">
                                <span className="meta-label">تاريخ التقديم:</span>
                                <span className="meta-value">{formatDateTime(selectedUser.verification?.submittedAt)}</span>
                            </div>
                            {selectedUser.verification?.reviewedAt && (
                                <div className="selfie-meta-item">
                                    <span className="meta-label">تاريخ المراجعة:</span>
                                    <span className="meta-value">{formatDateTime(selectedUser.verification?.reviewedAt)}</span>
                                </div>
                            )}
                        </div>

                        {selectedUser.verification?.status === 'pending' && (
                            <div className="selfie-modal-actions">
                                <button
                                    className="btn-modal-approve"
                                    onClick={() => handleReview(selectedUser._id, 'approved')}
                                    disabled={actionLoading === selectedUser._id}
                                >
                                    {actionLoading === selectedUser._id ? 'جاري...' : '✅ قبول التوثيق'}
                                </button>
                                <button
                                    className="btn-modal-reject"
                                    onClick={() => handleReview(selectedUser._id, 'rejected')}
                                    disabled={actionLoading === selectedUser._id}
                                >
                                    {actionLoading === selectedUser._id ? 'جاري...' : '❌ رفض التوثيق'}
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

export default VerificationRequests;
