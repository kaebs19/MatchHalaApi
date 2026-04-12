import React, { useState, useEffect } from "react";
import { useToast } from "../components/Toast";
import Pagination from "../components/Pagination";
import LoadingSpinner from "../components/LoadingSpinner";
import StatCard from "../components/StatCard";
import DataTable from "../components/DataTable";
import { formatDateTime } from "../utils/formatters";
import { getImageUrl, getDefaultAvatar } from "../config";
import config from "../config";
import "./Appeals.css";

function Appeals({ onViewUserDetail }) {
    const [appeals, setAppeals] = useState([]);
    const [stats, setStats] = useState({ total: 0, pending: 0, forwarded: 0, under_review: 0, approved: 0, rejected: 0 });
    const [loading, setLoading] = useState(true);
    const [filterStatus, setFilterStatus] = useState("all");
    const [currentPage, setCurrentPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [totalItems, setTotalItems] = useState(0);
    const [selectedAppeal, setSelectedAppeal] = useState(null);
    const [showDetailModal, setShowDetailModal] = useState(false);
    const [newStatus, setNewStatus] = useState("");
    const [adminNote, setAdminNote] = useState("");
    const [saving, setSaving] = useState(false);
    const { showToast } = useToast();

    useEffect(() => {
        fetchAppeals();
    }, [currentPage, filterStatus]);

    const fetchAppeals = async () => {
        try {
            setLoading(true);
            const token = localStorage.getItem("token");
            let url = config.API_URL + "/appeals?page=" + currentPage + "&limit=20";
            if (filterStatus !== "all") url += "&status=" + filterStatus;

            const response = await fetch(url, {
                headers: { Authorization: "Bearer " + token }
            });
            const data = await response.json();
            if (data.success) {
                setAppeals(data.data.appeals || []);
                setTotalPages(data.data.totalPages || 1);
                setTotalItems(data.data.total || 0);
                if (data.data.stats) setStats(data.data.stats);
            }
        } catch (error) {
            showToast("فشل في تحميل الاستئنافات", "error");
            console.error("Error fetching appeals:", error);
        } finally {
            setLoading(false);
        }
    };

    const handleOpenDetail = (appeal) => {
        setSelectedAppeal(appeal);
        setNewStatus(appeal.status || "pending");
        setAdminNote("");
        setShowDetailModal(true);
    };

    const handleSaveStatus = async () => {
        if (!selectedAppeal) return;
        try {
            setSaving(true);
            const token = localStorage.getItem("token");
            const response = await fetch(config.API_URL + "/appeals/" + selectedAppeal._id + "/status", {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: "Bearer " + token
                },
                body: JSON.stringify({ status: newStatus, adminNote: adminNote })
            });
            const data = await response.json();
            if (data.success) {
                showToast("تم تحديث حالة الاستئناف", "success");
                setShowDetailModal(false);
                setSelectedAppeal(null);
                fetchAppeals();
            } else {
                showToast(data.message || "فشل في التحديث", "error");
            }
        } catch (error) {
            showToast("فشل في تحديث الحالة", "error");
            console.error("Error updating appeal:", error);
        } finally {
            setSaving(false);
        }
    };

    const getStatusBadge = (status) => {
        const map = {
            pending: { label: "قيد الانتظار", cls: "badge-pending" },
            forwarded: { label: "مُحال", cls: "badge-forwarded" },
            under_review: { label: "قيد المراجعة", cls: "badge-review" },
            approved: { label: "مقبول", cls: "badge-approved" },
            rejected: { label: "مرفوض", cls: "badge-rejected" }
        };
        const info = map[status] || { label: status, cls: "" };
        return <span className={"badge " + info.cls}>{info.label}</span>;
    };

    const getActionTypeLabel = (type) => {
        const map = {
            warning: "تحذير",
            suspend: "إيقاف مؤقت",
            ban: "حظر",
            restrict: "تقييد",
            mute: "كتم"
        };
        return map[type] || type || "-";
    };

    const truncate = (text, max) => {
        if (!text) return "-";
        return text.length > max ? text.substring(0, max) + "..." : text;
    };

    const renderUserCell = (appeal) => {
        const user = appeal.user;
        if (!user) return <span className="text-muted">-</span>;
        return (
            <div className="user-cell">
                <img
                    src={user.profileImage ? getImageUrl(user.profileImage) : getDefaultAvatar(user.name)}
                    alt={user.name}
                    className="user-avatar-small"
                    onError={(e) => { e.target.onerror = null; e.target.src = getDefaultAvatar(user.name); }}
                />
                <div className="user-cell-info">
                    <span
                        className="user-link"
                        onClick={(e) => { e.stopPropagation(); if (onViewUserDetail) onViewUserDetail(user._id); }}
                    >
                        {user.name}
                    </span>
                    <small dir="ltr" className="email-cell">{user.email}</small>
                </div>
            </div>
        );
    };

    if (loading && currentPage === 1) {
        return <LoadingSpinner text="جاري تحميل الاستئنافات..." />;
    }

    const columns = [
        { key: "user", label: "المستخدم", render: (row) => renderUserCell(row) },
        { key: "reason", label: "السبب", render: (row) => <span title={row.reason}>{truncate(row.reason, 50)}</span> },
        { key: "actionType", label: "نوع الإجراء", render: (row) => <span className="action-type-cell">{getActionTypeLabel(row.actionType)}</span> },
        { key: "status", label: "الحالة", render: (row) => getStatusBadge(row.status) },
        { key: "date", label: "التاريخ", render: (row) => formatDateTime(row.createdAt) },
        {
            key: "actions", label: "الإجراءات", render: (row) => (
                <button className="action-btn btn-view" onClick={(e) => { e.stopPropagation(); handleOpenDetail(row); }} title="عرض التفاصيل">عرض</button>
            )
        }
    ];

    return (
        <div className="appeals-page">
            {/* Statistics */}
            <div className="stats-grid">
                <StatCard icon="📋" value={stats.total} label="إجمالي الاستئنافات" color="purple" />
                <StatCard icon="⏳" value={stats.pending} label="قيد الانتظار" color="orange" />
                <StatCard icon="🔄" value={stats.under_review} label="قيد المراجعة" color="blue" />
                <StatCard icon="✅" value={stats.approved} label="مقبولة" color="green" />
                <StatCard icon="❌" value={stats.rejected} label="مرفوضة" color="red" />
            </div>

            {/* Filters */}
            <div className="appeals-filters">
                <select
                    value={filterStatus}
                    onChange={(e) => { setFilterStatus(e.target.value); setCurrentPage(1); }}
                >
                    <option value="all">جميع الحالات</option>
                    <option value="pending">قيد الانتظار</option>
                    <option value="forwarded">مُحال</option>
                    <option value="under_review">قيد المراجعة</option>
                    <option value="approved">مقبول</option>
                    <option value="rejected">مرفوض</option>
                </select>
                <button onClick={fetchAppeals} className="refresh-btn">تحديث 🔄</button>
            </div>

            {/* Table */}
            <DataTable
                columns={columns}
                data={appeals}
                loading={loading && currentPage > 1}
                gradientHeader
                emptyIcon="📭"
                emptyMessage="لا توجد استئنافات"
                onRowClick={handleOpenDetail}
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

            {/* Detail Modal */}
            {showDetailModal && selectedAppeal && (
                <div className="modal-overlay" onClick={() => setShowDetailModal(false)}>
                    <div className="modal-content appeal-detail-modal" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3>📋 تفاصيل الاستئناف</h3>
                            <button className="close-btn" onClick={() => setShowDetailModal(false)}>✕</button>
                        </div>

                        {/* User Info Enhanced */}
                        {selectedAppeal.user && (
                            <div className="appeal-user-info-enhanced">
                                <div className="appeal-user-header">
                                    <img
                                        src={selectedAppeal.user.profileImage ? getImageUrl(selectedAppeal.user.profileImage) : getDefaultAvatar(selectedAppeal.user.name)}
                                        alt={selectedAppeal.user.name}
                                        className="appeal-user-avatar-lg"
                                        onError={(e) => { e.target.onerror = null; e.target.src = getDefaultAvatar(selectedAppeal.user.name); }}
                                    />
                                    <div className="appeal-user-main">
                                        <h4
                                            className="user-link"
                                            onClick={() => { if (onViewUserDetail) onViewUserDetail(selectedAppeal.user._id); }}
                                        >
                                            {selectedAppeal.user.name}
                                            {selectedAppeal.user.isPremium && <span className="premium-mini-badge">⭐</span>}
                                        </h4>
                                        <p dir="ltr" className="user-email-lg">{selectedAppeal.user.email}</p>
                                        {selectedAppeal.user.halaId && (
                                            <p className="user-hala-id">معرف هلا: <code>{selectedAppeal.user.halaId}</code></p>
                                        )}
                                    </div>
                                    <div className="appeal-user-status-col">
                                        {getStatusBadge(selectedAppeal.status)}
                                    </div>
                                </div>

                                <div className="appeal-user-details-grid">
                                    {selectedAppeal.user.country && (
                                        <div className="detail-item">
                                            <span className="detail-icon">🌍</span>
                                            <div>
                                                <small>الدولة</small>
                                                <strong>{selectedAppeal.user.country}</strong>
                                            </div>
                                        </div>
                                    )}
                                    {selectedAppeal.user.gender && (
                                        <div className="detail-item">
                                            <span className="detail-icon">{selectedAppeal.user.gender === 'female' ? '♀️' : '♂️'}</span>
                                            <div>
                                                <small>الجنس</small>
                                                <strong>{selectedAppeal.user.gender === 'female' ? 'أنثى' : 'ذكر'}</strong>
                                            </div>
                                        </div>
                                    )}
                                    {selectedAppeal.user.createdAt && (
                                        <div className="detail-item">
                                            <span className="detail-icon">📅</span>
                                            <div>
                                                <small>تاريخ التسجيل</small>
                                                <strong>{formatDateTime(selectedAppeal.user.createdAt)}</strong>
                                            </div>
                                        </div>
                                    )}
                                    {selectedAppeal.user.lastLogin && (
                                        <div className="detail-item">
                                            <span className="detail-icon">🕐</span>
                                            <div>
                                                <small>آخر دخول</small>
                                                <strong>{formatDateTime(selectedAppeal.user.lastLogin)}</strong>
                                            </div>
                                        </div>
                                    )}
                                    <div className="detail-item">
                                        <span className="detail-icon">{selectedAppeal.user.isActive ? '✅' : '❌'}</span>
                                        <div>
                                            <small>الحساب</small>
                                            <strong>{selectedAppeal.user.isActive ? 'نشط' : 'غير نشط'}</strong>
                                        </div>
                                    </div>
                                    {selectedAppeal.user.suspension && selectedAppeal.user.suspension.isSuspended && (
                                        <div className="detail-item warning">
                                            <span className="detail-icon">🔒</span>
                                            <div>
                                                <small>التعليق</small>
                                                <strong>المستوى {selectedAppeal.user.suspension.level || 0}</strong>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* Appeal Info */}
                        <div className="appeal-info-section">
                            <div className="appeal-info-row">
                                <span className="info-label">نوع الإجراء:</span>
                                <span className="info-value">{getActionTypeLabel(selectedAppeal.actionType)}</span>
                            </div>
                            {selectedAppeal.suspensionLevel && (
                                <div className="appeal-info-row">
                                    <span className="info-label">مستوى الإيقاف:</span>
                                    <span className="info-value">{selectedAppeal.suspensionLevel}</span>
                                </div>
                            )}
                            <div className="appeal-info-row">
                                <span className="info-label">تاريخ التقديم:</span>
                                <span className="info-value">{formatDateTime(selectedAppeal.createdAt)}</span>
                            </div>
                        </div>

                        {/* Full Reason */}
                        <div className="appeal-reason-section">
                            <h4>سبب الاستئناف</h4>
                            <div className="appeal-reason-text">{selectedAppeal.reason || "-"}</div>
                        </div>

                        {/* Status History Timeline */}
                        {selectedAppeal.statusHistory && selectedAppeal.statusHistory.length > 0 && (
                            <div className="appeal-timeline-section">
                                <h4>سجل الحالات</h4>
                                <div className="timeline">
                                    {selectedAppeal.statusHistory.map((entry, idx) => (
                                        <div key={idx} className={"timeline-item status-" + entry.status}>
                                            <div className="timeline-dot"></div>
                                            <div className="timeline-content">
                                                <div className="timeline-header">
                                                    {getStatusBadge(entry.status)}
                                                    <span className="timeline-date">{formatDateTime(entry.changedAt || entry.date)}</span>
                                                </div>
                                                {entry.note && <p className="timeline-note">{entry.note}</p>}
                                                {entry.changedBy && <small className="timeline-admin">بواسطة: {entry.changedBy.name || entry.changedBy}</small>}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Admin Action */}
                        <div className="appeal-action-section">
                            <h4>تغيير الحالة</h4>
                            <div className="appeal-action-form">
                                <select
                                    value={newStatus}
                                    onChange={(e) => setNewStatus(e.target.value)}
                                    className={"status-select status-" + newStatus}
                                >
                                    <option value="pending">قيد الانتظار</option>
                                    <option value="forwarded">مُحال</option>
                                    <option value="under_review">قيد المراجعة</option>
                                    <option value="approved">مقبول</option>
                                    <option value="rejected">مرفوض</option>
                                </select>
                                <textarea
                                    value={adminNote}
                                    onChange={(e) => setAdminNote(e.target.value)}
                                    placeholder="ملاحظة المدير (اختياري)..."
                                    rows={3}
                                />
                                <button
                                    className="save-btn"
                                    onClick={handleSaveStatus}
                                    disabled={saving}
                                >
                                    {saving ? "جاري الحفظ..." : "حفظ التغييرات"}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

export default Appeals;
