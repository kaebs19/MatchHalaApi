import React, { useState, useEffect } from "react";
import { useToast } from "../components/Toast";
import Pagination from "../components/Pagination";
import LoadingSpinner from "../components/LoadingSpinner";
import StatCard from "../components/StatCard";
import DataTable from "../components/DataTable";
import { formatDateTime } from "../utils/formatters";
import { getImageUrl, getDefaultAvatar } from "../config";
import config from "../config";
import socketService from "../services/socket";
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
    const [replyText, setReplyText] = useState("");
    const [sendingReply, setSendingReply] = useState(false);
    const { showToast } = useToast();

    // ✅ قوالب رسائل سريعة للأدمن
    const QUICK_REPLIES = [
        { icon: "👀", label: "استلام", text: "تم استلام طلبك وسنراجعه خلال 24 ساعة." },
        { icon: "📋", label: "طلب تفاصيل", text: "الرجاء تزويدنا بمزيد من التفاصيل حول اعتراضك لنتمكن من مساعدتك." },
        { icon: "❗", label: "توضيح المخالفة", text: "التقييد تم بسبب مخالفة سياسة المحادثات. لا يمكن رفعه خلال فترة التقييد." },
        { icon: "⏳", label: "قيد المراجعة", text: "شكراً لصبرك، طلبك قيد المراجعة من الفريق المختص وسنعود إليك قريباً." },
        { icon: "⚠️", label: "تحذير", text: "يرجى الالتزام بسياسة الاستخدام لتجنب إجراءات أشد في المستقبل." },
        { icon: "✅", label: "قبول", text: "تم قبول استئنافك. تم فك التقييد عن حسابك، مرحباً بك مجدداً." },
        { icon: "❌", label: "رفض", text: "للأسف، تم رفض استئنافك بعد المراجعة. يمكنك تقديم استئناف جديد لاحقاً." },
        { icon: "🛡️", label: "سياسة المحتوى", text: "المحتوى الذي تم نشره يخالف سياسة المحتوى في التطبيق. يرجى مراجعة الشروط." }
    ];

    useEffect(() => {
        fetchAppeals();
    }, [currentPage, filterStatus]);

    // ✅ تحديث فوري عند وصول استئناف جديد أو رد جديد من مستخدم
    useEffect(() => {
        const refreshIfRelevant = () => {
            // أعد التحميل لو في الصفحة الأولى (لتفادي قفز الـ pagination)
            if (currentPage === 1) fetchAppeals();
        };
        socketService.onNewAppeal(refreshIfRelevant);
        socketService.onAppealUserReply(refreshIfRelevant);
        return () => {
            socketService.offNewAppeal(refreshIfRelevant);
            socketService.offAppealUserReply(refreshIfRelevant);
        };
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
        setReplyText("");
        setShowDetailModal(true);

        // ✅ تصفير unreadForAdmin (إذا في رسائل بدون قراءة)
        if ((appeal.unreadForAdmin || 0) > 0) {
            const token = localStorage.getItem("token");
            fetch(config.API_URL + "/appeals/" + appeal._id + "/mark-read", {
                method: "POST",
                headers: { Authorization: "Bearer " + token }
            }).catch(() => {});
            // optimistic — أزل الـ badge فوراً
            setAppeals(prev => prev.map(a => a._id === appeal._id ? { ...a, unreadForAdmin: 0 } : a));
        }
    };

    // ✅ إرسال رسالة من الأدمن في محادثة الاستئناف
    const handleSendAdminReply = async (text) => {
        const content = (text || "").trim();
        if (!selectedAppeal || !content) return;
        try {
            setSendingReply(true);
            const token = localStorage.getItem("token");
            const response = await fetch(config.API_URL + "/appeals/" + selectedAppeal._id + "/admin-reply", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: "Bearer " + token
                },
                body: JSON.stringify({ content })
            });
            const data = await response.json();
            if (data.success) {
                showToast("تم إرسال الرد", "success");
                setReplyText("");
                // تحديث الـ appeal في القائمة + في المودال بالبيانات الجديدة
                if (data.data) {
                    setSelectedAppeal(data.data);
                    setAppeals(prev => prev.map(a => a._id === data.data._id ? data.data : a));
                }
            } else {
                showToast(data.message || "فشل الإرسال", "error");
            }
        } catch (error) {
            showToast("فشل الإرسال", "error");
            console.error("Error sending admin reply:", error);
        } finally {
            setSendingReply(false);
        }
    };

    // ✅ تغيير سريع للحالة من الجدول مباشرة (بدون فتح modal)
    const handleQuickStatus = async (appeal, status, options = {}) => {
        const { confirmText, defaultNote = '', skipConfirm = false } = options;
        if (!skipConfirm && confirmText && !window.confirm(confirmText)) return;
        try {
            const token = localStorage.getItem("token");
            const response = await fetch(config.API_URL + "/appeals/" + appeal._id + "/status", {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: "Bearer " + token
                },
                body: JSON.stringify({ status, adminNote: defaultNote })
            });
            const data = await response.json();
            if (data.success) {
                showToast("تم تحديث الحالة", "success");
                // optimistic update — يجنّب refetch كامل
                setAppeals(prev => prev.map(a => a._id === appeal._id ? { ...a, status } : a));
            } else {
                showToast(data.message || "فشل التحديث", "error");
            }
        } catch (error) {
            showToast("فشل التحديث", "error");
            console.error("Quick status error:", error);
        }
    };

    // ✅ قبول سريع + فك التقييد (action واحد بدلاً من خطوتين)
    const handleQuickApproveAndUnrestrict = async (appeal) => {
        if (!appeal?.user) return;
        const userId = appeal.user._id || appeal.user;
        const userName = appeal.user.name || 'المستخدم';
        if (!window.confirm(`قبول استئناف ${userName} وفك جميع القيود؟`)) return;
        try {
            const token = localStorage.getItem("token");
            const unrestrictRes = await fetch(config.API_URL + "/users/" + userId + "/suspend", {
                method: "PUT",
                headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
                body: JSON.stringify({ duration: "unrestrict", reason: "قبول الاستئناف", notify: true })
            });
            const unrestrictData = await unrestrictRes.json();
            if (!unrestrictData.success) {
                showToast(unrestrictData.message || "فشل فك التقييد", "error");
                return;
            }
            await fetch(config.API_URL + "/appeals/" + appeal._id + "/status", {
                method: "PUT",
                headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
                body: JSON.stringify({ status: "approved", adminNote: "تم القبول وفك التقييد" })
            });
            showToast("تم القبول وفك التقييد ✅", "success");
            setAppeals(prev => prev.map(a => a._id === appeal._id ? { ...a, status: 'approved' } : a));
        } catch (error) {
            showToast("فشل العملية", "error");
            console.error("Quick approve error:", error);
        }
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

    // ✅ فك التقييد عن صاحب الاستئناف مباشرة من المودال
    const handleUnrestrictFromAppeal = async () => {
        if (!selectedAppeal || !selectedAppeal.user) return;
        const userId = selectedAppeal.user._id || selectedAppeal.user;
        if (!window.confirm("فك جميع القيود (تعليق + تقييد مراسلة) وإشعار المستخدم؟")) return;

        try {
            setSaving(true);
            const token = localStorage.getItem("token");
            const response = await fetch(config.API_URL + "/users/" + userId + "/suspend", {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: "Bearer " + token
                },
                body: JSON.stringify({
                    duration: "unrestrict",
                    reason: adminNote || "قبول الاستئناف - فك التقييد",
                    notify: true
                })
            });
            const data = await response.json();
            if (data.success) {
                // إذا الاستئناف ما زال pending → حدّث حالته لـ approved تلقائياً
                if (selectedAppeal.status === "pending" || selectedAppeal.status === "under_review") {
                    await fetch(config.API_URL + "/appeals/" + selectedAppeal._id + "/status", {
                        method: "PUT",
                        headers: {
                            "Content-Type": "application/json",
                            Authorization: "Bearer " + token
                        },
                        body: JSON.stringify({
                            status: "approved",
                            adminNote: adminNote || "تم فك التقييد وقبول الاستئناف"
                        })
                    });
                }
                showToast("تم فك التقييد وإشعار المستخدم", "success");
                setShowDetailModal(false);
                setSelectedAppeal(null);
                fetchAppeals();
            } else {
                showToast(data.message || "فشل فك التقييد", "error");
            }
        } catch (error) {
            showToast("فشل فك التقييد", "error");
            console.error("Error unrestricting user:", error);
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
        const unread = appeal.unreadForAdmin || 0;
        return (
            <div className="user-cell">
                <img
                    src={user.profileImage ? getImageUrl(user.profileImage) : getDefaultAvatar(user.name)}
                    alt={user.name}
                    className="user-avatar-small"
                    onError={(e) => { e.target.onerror = null; e.target.src = getDefaultAvatar(user.name); }}
                />
                <div className="user-cell-info">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span
                            className="user-link"
                            onClick={(e) => { e.stopPropagation(); if (onViewUserDetail) onViewUserDetail(user._id); }}
                        >
                            {user.name}
                        </span>
                        {unread > 0 && (
                            <span className="unread-reply-badge" title={`${unread} رد جديد بدون قراءة`}>
                                💬 {unread}
                            </span>
                        )}
                    </div>
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
        { key: "actionType", label: "نوع الإجراء", render: (row) => (
            <span className="action-type-cell">
                {getActionTypeLabel(row.actionType)}
                {row.isPublicAppeal && (
                    <span style={{
                        marginInlineStart: 6,
                        background: "linear-gradient(135deg,#667eea,#764ba2)",
                        color: "white",
                        padding: "2px 6px",
                        borderRadius: 8,
                        fontSize: 10,
                        fontWeight: 700
                    }} title={row.publicEmail || "استئناف عام"}>
                        📱 عام
                    </span>
                )}
            </span>
        )},
        { key: "status", label: "الحالة", render: (row) => getStatusBadge(row.status) },
        { key: "date", label: "التاريخ", render: (row) => formatDateTime(row.createdAt) },
        {
            key: "actions", label: "الإجراءات", render: (row) => {
                const isOpen = ['pending', 'forwarded', 'under_review'].includes(row.status);
                return (
                    <div className="quick-actions">
                        <button
                            className="action-btn btn-view"
                            onClick={(e) => { e.stopPropagation(); handleOpenDetail(row); }}
                            title="عرض التفاصيل والمحادثة"
                        >👁</button>
                        {isOpen && (
                            <>
                                {row.status === 'pending' && (
                                    <button
                                        className="action-btn btn-review"
                                        onClick={(e) => { e.stopPropagation(); handleQuickStatus(row, 'under_review', { skipConfirm: true, defaultNote: 'بدأت المراجعة' }); }}
                                        title="بدء المراجعة"
                                    >👀</button>
                                )}
                                <button
                                    className="action-btn btn-approve"
                                    onClick={(e) => { e.stopPropagation(); handleQuickApproveAndUnrestrict(row); }}
                                    title="قبول + فك التقييد"
                                >✅</button>
                                <button
                                    className="action-btn btn-reject"
                                    onClick={(e) => { e.stopPropagation(); handleQuickStatus(row, 'rejected', { confirmText: `رفض استئناف ${row.user?.name || 'هذا المستخدم'}؟`, defaultNote: 'تم الرفض بعد المراجعة' }); }}
                                    title="رفض"
                                >❌</button>
                            </>
                        )}
                    </div>
                );
            }
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

                        {/* ✅ Badge للاستئناف العام (جهاز محظور - بدون login) */}
                        {selectedAppeal.isPublicAppeal && (
                            <div style={{
                                background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
                                color: "white",
                                padding: "12px 16px",
                                borderRadius: 10,
                                marginBottom: 14,
                                display: "flex",
                                alignItems: "center",
                                gap: 10
                            }}>
                                <span style={{ fontSize: 20 }}>📱</span>
                                <div style={{ flex: 1 }}>
                                    <div style={{ fontWeight: 700, fontSize: 14 }}>استئناف عام — جهاز محظور</div>
                                    <div style={{ fontSize: 12, opacity: 0.9, marginTop: 2 }}>
                                        قُدِّم بدون تسجيل دخول (المستخدم محظور الجهاز)
                                        {selectedAppeal.publicEmail && (
                                            <span> • البريد: <strong>{selectedAppeal.publicEmail}</strong></span>
                                        )}
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Appeal Info */}
                        <div className="appeal-info-section">
                            <div className="appeal-info-row">
                                <span className="info-label">نوع الإجراء:</span>
                                <span className="info-value">{getActionTypeLabel(selectedAppeal.actionType)}</span>
                            </div>
                            {selectedAppeal.publicEmail && (
                                <div className="appeal-info-row">
                                    <span className="info-label">📧 بريد الاستئناف:</span>
                                    <span className="info-value" style={{ direction: "ltr", color: "#667eea", fontWeight: 600 }}>
                                        {selectedAppeal.publicEmail}
                                    </span>
                                </div>
                            )}
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

                        {/* ✅ Chat Messages — محادثة ثنائية مع المستخدم */}
                        <div className="appeal-chat-section">
                            <h4>💬 محادثة الاستئناف
                                {selectedAppeal.unreadForAdmin > 0 && (
                                    <span style={{ background: "#ff3b30", color: "white", padding: "2px 8px", borderRadius: 10, fontSize: 11, marginInlineStart: 8 }}>
                                        {selectedAppeal.unreadForAdmin} جديد
                                    </span>
                                )}
                            </h4>
                            <div className="appeal-chat-messages" style={{ maxHeight: 320, overflowY: "auto", padding: 12, background: "#f7f7fa", borderRadius: 10, marginBottom: 12 }}>
                                {(!selectedAppeal.messages || selectedAppeal.messages.length === 0) ? (
                                    <p style={{ color: "#999", textAlign: "center", margin: "20px 0" }}>لا توجد رسائل بعد</p>
                                ) : (
                                    selectedAppeal.messages.map((msg, idx) => {
                                        const isAdmin = msg.sender === "admin";
                                        return (
                                            <div
                                                key={msg._id || idx}
                                                style={{
                                                    display: "flex",
                                                    justifyContent: isAdmin ? "flex-end" : "flex-start",
                                                    marginBottom: 10
                                                }}
                                            >
                                                <div
                                                    style={{
                                                        maxWidth: "72%",
                                                        padding: "10px 14px",
                                                        borderRadius: 14,
                                                        background: isAdmin ? "#667eea" : "#ffffff",
                                                        color: isAdmin ? "#ffffff" : "#222",
                                                        border: isAdmin ? "none" : "1px solid #e0e0e6",
                                                        boxShadow: isAdmin ? "0 2px 6px rgba(102,126,234,0.25)" : "0 1px 3px rgba(0,0,0,0.04)"
                                                    }}
                                                >
                                                    <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 4, opacity: 0.7 }}>
                                                        {isAdmin ? "🛡️ الإدارة" : "👤 المستخدم"}
                                                    </div>
                                                    <div style={{ fontSize: 14, lineHeight: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                                                        {msg.content}
                                                    </div>
                                                    <div style={{ fontSize: 10, opacity: 0.6, marginTop: 4, textAlign: isAdmin ? "left" : "right" }}>
                                                        {formatDateTime(msg.createdAt)}
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })
                                )}
                            </div>

                            {/* Quick Replies */}
                            <div style={{ marginBottom: 10 }}>
                                <small style={{ color: "#666", display: "block", marginBottom: 6 }}>ردود سريعة بالمخالفات:</small>
                                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                                    {QUICK_REPLIES.map((q, idx) => (
                                        <button
                                            key={idx}
                                            type="button"
                                            onClick={() => setReplyText(q.text)}
                                            disabled={sendingReply}
                                            style={{
                                                padding: "6px 10px",
                                                borderRadius: 16,
                                                border: "1px solid #d0d7e5",
                                                background: "#fff",
                                                fontSize: 12,
                                                cursor: "pointer",
                                                transition: "all 0.15s",
                                                color: "#333"
                                            }}
                                            title={q.text}
                                            onMouseEnter={(e) => {
                                                e.currentTarget.style.background = "#667eea";
                                                e.currentTarget.style.color = "#fff";
                                                e.currentTarget.style.borderColor = "#667eea";
                                            }}
                                            onMouseLeave={(e) => {
                                                e.currentTarget.style.background = "#fff";
                                                e.currentTarget.style.color = "#333";
                                                e.currentTarget.style.borderColor = "#d0d7e5";
                                            }}
                                        >
                                            {q.icon} {q.label}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Reply Input */}
                            <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
                                <textarea
                                    value={replyText}
                                    onChange={(e) => setReplyText(e.target.value)}
                                    placeholder="اكتب رداً للمستخدم... (Cmd/Ctrl + Enter للإرسال)"
                                    rows={3}
                                    disabled={sendingReply}
                                    onKeyDown={(e) => {
                                        if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                                            e.preventDefault();
                                            handleSendAdminReply(replyText);
                                        }
                                    }}
                                    style={{
                                        flex: 1,
                                        padding: 10,
                                        borderRadius: 10,
                                        border: "1px solid #d0d7e5",
                                        fontSize: 14,
                                        fontFamily: "inherit",
                                        resize: "vertical"
                                    }}
                                />
                                <button
                                    onClick={() => handleSendAdminReply(replyText)}
                                    disabled={sendingReply || !replyText.trim()}
                                    style={{
                                        padding: "10px 18px",
                                        borderRadius: 10,
                                        border: "none",
                                        background: replyText.trim() ? "#667eea" : "#c5cde0",
                                        color: "#fff",
                                        fontWeight: 700,
                                        cursor: replyText.trim() ? "pointer" : "not-allowed",
                                        fontSize: 14,
                                        whiteSpace: "nowrap"
                                    }}
                                >
                                    {sendingReply ? "جاري..." : "📨 إرسال"}
                                </button>
                            </div>
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

                                {/* ✅ زر فك التقييد السريع — يفكّ + يقبل الاستئناف + يُشعر */}
                                <button
                                    className="save-btn"
                                    style={{ background: "#4CAF50", marginTop: 8 }}
                                    onClick={handleUnrestrictFromAppeal}
                                    disabled={saving}
                                    title="فك جميع القيود + قبول الاستئناف + إشعار المستخدم"
                                >
                                    {saving ? "جاري..." : "🔓 فك التقييد + قبول الاستئناف"}
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
