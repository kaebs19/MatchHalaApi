import React, { useState, useEffect, useCallback } from "react";
import { useToast } from "../components/Toast";
import Pagination from "../components/Pagination";
import StatCard from "../components/StatCard";
import DataTable from "../components/DataTable";
import { formatDateTime } from "../utils/formatters";
import { getImageUrl, getDefaultAvatar } from "../config";
import {
    getNewcomers,
    getNewcomersStats,
    approveNewcomer,
    rejectNewcomer,
    getNewcomerGroups,
    bulkApproveNewcomers,
} from "../services/api";
import ConfirmModal from "../components/ConfirmModal";
import "./Newcomers.css";

const STATUS_LABELS = {
    pending: { label: "قيد المراجعة", color: "orange" },
    flagged: { label: "مخالفة مرصودة", color: "red" },
    rejected: { label: "مرفوض", color: "red" },
    approved: { label: "معتمد", color: "green" },
};

const LIMIT = 20;

function Newcomers({ onViewUserDetail }) {
    const [rows, setRows] = useState([]);
    const [stats, setStats] = useState({ flagged: 0, flaggedRecent: 0, pending: 0, needsReview: 0, hideDays: 3 });
    const [groups, setGroups] = useState([]);
    const [reason, setReason] = useState("");      // تصفية حسب سبب الرفع
    const [bulkAsk, setBulkAsk] = useState(null);   // { key, label, count } قبل التأكيد
    const [bulkBusy, setBulkBusy] = useState(false);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState("review"); // review | pending | flagged | all
    const [page, setPage] = useState(1);
    const [total, setTotal] = useState(0);
    const [actingId, setActingId] = useState(null);
    const { showToast } = useToast();

    const fetchStats = useCallback(async () => {
        try {
            const [res, g] = await Promise.all([getNewcomersStats(), getNewcomerGroups()]);
            if (res.success) setStats(res.data);
            if (g.success) setGroups(g.data || []);
        } catch (_) { /* غير حرج */ }
    }, []);

    // اعتماد جماعي: عدد فعلي من السيرفر (dryRun) ثم تأكيد
    const askBulk = async (group) => {
        try {
            const r = await bulkApproveNewcomers(group.key, true);
            if (r.success) setBulkAsk({ key: group.key, label: group.label, count: r.data.wouldApprove });
        } catch (_) { showToast("تعذّر حساب العدد", "error"); }
    };
    const runBulk = async () => {
        if (!bulkAsk) return;
        setBulkBusy(true);
        try {
            const r = await bulkApproveNewcomers(bulkAsk.key);
            if (r.success) {
                showToast(r.message || "تم الاعتماد", "success");
                setBulkAsk(null);
                fetchRows();
                fetchStats();
            }
        } catch (_) {
            showToast("فشل الاعتماد الجماعي", "error");
        } finally {
            setBulkBusy(false);
        }
    };

    const fetchRows = useCallback(async () => {
        setLoading(true);
        try {
            const res = await getNewcomers(filter, page, LIMIT, reason);
            if (res.success) {
                setRows(res.data || []);
                setTotal(res.total || 0);
            }
        } catch (e) {
            showToast("تعذّر جلب الحسابات الجديدة", "error");
        } finally {
            setLoading(false);
        }
    }, [filter, page, reason, showToast]);

    useEffect(() => { fetchRows(); }, [fetchRows]);
    useEffect(() => { fetchStats(); }, [fetchStats]);

    const handleApprove = async (row) => {
        setActingId(row._id);
        try {
            const res = await approveNewcomer(row._id);
            if (res.success) {
                showToast(`تم اعتماد ${row.name}`, "success");
                fetchRows();
                fetchStats();
            }
        } catch (_) {
            showToast("فشل الاعتماد", "error");
        } finally {
            setActingId(null);
        }
    };

    const handleReject = async (row) => {
        const reason = window.prompt(`سبب رفض حساب ${row.name}؟ (اختياري)`, "مخالفة سياسة المحتوى");
        if (reason === null) return; // ألغى
        setActingId(row._id);
        try {
            const res = await rejectNewcomer(row._id, reason);
            if (res.success) {
                showToast(`تم رفض وإخفاء ${row.name}`, "success");
                fetchRows();
                fetchStats();
            }
        } catch (_) {
            showToast("فشل الرفض", "error");
        } finally {
            setActingId(null);
        }
    };

    const columns = [
        {
            key: "user",
            label: "المستخدم",
            render: (row) => (
                <div
                    className="nc-user"
                    onClick={() => onViewUserDetail && onViewUserDetail(row._id)}
                    title="عرض الملف"
                >
                    <img
                        src={row.profileImage ? getImageUrl(row.profileImage) : getDefaultAvatar(row.name)}
                        alt={row.name}
                        className="nc-avatar"
                        onError={(e) => { e.target.src = getDefaultAvatar(row.name); }}
                    />
                    <div>
                        <div className="nc-name">
                            {row.name} {row.isVerified && <span title="موثّق">✔️</span>}
                        </div>
                        <div className="nc-meta">{row.country || "—"} · {row.gender === "female" ? "أنثى" : "ذكر"}</div>
                    </div>
                </div>
            ),
        },
        {
            key: "status",
            label: "الحالة",
            render: (row) => {
                const s = STATUS_LABELS[row.status] || STATUS_LABELS.pending;
                return <span className={`nc-badge nc-badge--${s.color}`}>{s.label}</span>;
            },
        },
        {
            key: "violations",
            label: "المخالفات",
            render: (row) => {
                const total = (row.bannedWordViolations || 0) + (row.externalPromoViolations || 0);
                if (!total) return <span className="nc-muted">—</span>;
                return (
                    <span className="nc-viol" title={row.flaggedReason || ""}>
                        {row.bannedWordViolations ? `كلمات: ${row.bannedWordViolations} ` : ""}
                        {row.externalPromoViolations ? `ترويج: ${row.externalPromoViolations}` : ""}
                    </span>
                );
            },
        },
        {
            key: "reason",
            label: "السبب",
            render: (row) => row.flaggedReason
                ? <span className="nc-reason">{row.flaggedReason}</span>
                : <span className="nc-muted">—</span>,
        },
        {
            key: "createdAt",
            label: "تاريخ التسجيل",
            render: (row) => <span className="nc-muted">{formatDateTime(row.createdAt)}</span>,
        },
        {
            key: "actions",
            label: "إجراء",
            render: (row) => (
                <div className="nc-actions">
                    <button
                        className="nc-btn nc-btn--approve"
                        disabled={actingId === row._id}
                        onClick={() => handleApprove(row)}
                    >
                        ✅ اعتماد
                    </button>
                    <button
                        className="nc-btn nc-btn--reject"
                        disabled={actingId === row._id}
                        onClick={() => handleReject(row)}
                    >
                        ⛔ رفض
                    </button>
                </div>
            ),
        },
    ];

    const FILTERS = [
        { id: "review", label: "بحاجة لمراجعة" },
        { id: "flagged", label: "كل المرفوعين" },
        { id: "pending", label: "قيد المراجعة" },
        { id: "all", label: "الكل" },
    ];

    return (
        <div className="newcomers-page">
            <div className="nc-stats">
                <StatCard icon="🆕" value={stats.needsReview} label="بحاجة لمراجعة" color="purple" />
                <StatCard icon="🚩" value={stats.flaggedRecent ?? stats.flagged} label={`مخفي الآن (آخر ${stats.hideDays || 3} أيام)`} color="red" />
                <StatCard icon="⏳" value={stats.pending} label="قيد المراجعة (24س)" color="orange" />
            </div>

            <p className="nc-note">
                الحساب المرفوع يُخفى من الاكتشاف {stats.hideDays || 3} أيام ثم يعود تلقائياً. العقوبات الفعلية (تعليق/حظر/إخفاء) لا تتأثر.
            </p>

            {groups.length > 0 && (
                <div className="nc-groups">
                    {groups.map((g) => (
                        <div key={g.key} className={`nc-group ${reason === g.key ? "active" : ""}`}>
                            <button
                                className="nc-group-main"
                                onClick={() => { setReason(reason === g.key ? "" : g.key); setFilter("flagged"); setPage(1); }}
                                title="عرض هذه المجموعة فقط"
                            >
                                <span className="nc-group-label">{g.label}</span>
                                <span className="nc-group-count">{g.total.toLocaleString("en-US")}</span>
                                <span className="nc-group-sub">{g.recent} مخفي الآن · {g.older.toLocaleString("en-US")} أقدم</span>
                            </button>
                            {g.older > 0 && (
                                <button className="nc-btn nc-btn--approve nc-group-bulk" onClick={() => askBulk(g)}>
                                    ✅ اعتماد الأقدم
                                </button>
                            )}
                        </div>
                    ))}
                </div>
            )}

            {bulkAsk && (
                <ConfirmModal
                    isOpen
                    title="اعتماد جماعي"
                    message={`اعتماد ${bulkAsk.count.toLocaleString("en-US")} حساباً مرفوعاً بسبب «${bulkAsk.label}» منذ أكثر من ${stats.hideDays || 3} أيام؟ يُزالون من الطابور فقط — لا تتغيّر أي عقوبة عليهم.`}
                    confirmText={bulkBusy ? "جارٍ…" : "اعتماد"}
                    cancelText="إلغاء"
                    onConfirm={runBulk}
                    onClose={() => !bulkBusy && setBulkAsk(null)}
                />
            )}

            <div className="nc-filters">
                {FILTERS.map((f) => (
                    <button
                        key={f.id}
                        className={`nc-filter ${filter === f.id ? "active" : ""}`}
                        onClick={() => { setFilter(f.id); setPage(1); }}
                    >
                        {f.label}
                    </button>
                ))}
            </div>

            <DataTable
                columns={columns}
                data={rows}
                loading={loading}
                emptyIcon="🎉"
                emptyMessage="لا توجد حسابات جديدة بحاجة لمراجعة"
            />

            {total > LIMIT && (
                <Pagination
                    currentPage={page}
                    totalPages={Math.ceil(total / LIMIT)}
                    onPageChange={setPage}
                    itemsPerPage={LIMIT}
                    totalItems={total}
                />
            )}
        </div>
    );
}

export default Newcomers;
