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
} from "../services/api";
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
    const [stats, setStats] = useState({ flagged: 0, pending: 0, needsReview: 0 });
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState("review"); // review | pending | flagged | all
    const [page, setPage] = useState(1);
    const [total, setTotal] = useState(0);
    const [actingId, setActingId] = useState(null);
    const { showToast } = useToast();

    const fetchStats = useCallback(async () => {
        try {
            const res = await getNewcomersStats();
            if (res.success) setStats(res.data);
        } catch (_) { /* غير حرج */ }
    }, []);

    const fetchRows = useCallback(async () => {
        setLoading(true);
        try {
            const res = await getNewcomers(filter, page, LIMIT);
            if (res.success) {
                setRows(res.data || []);
                setTotal(res.total || 0);
            }
        } catch (e) {
            showToast("تعذّر جلب الحسابات الجديدة", "error");
        } finally {
            setLoading(false);
        }
    }, [filter, page, showToast]);

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
        { id: "flagged", label: "مخالفات مرصودة" },
        { id: "pending", label: "قيد المراجعة" },
        { id: "all", label: "الكل" },
    ];

    return (
        <div className="newcomers-page">
            <div className="nc-stats">
                <StatCard icon="🆕" value={stats.needsReview} label="بحاجة لمراجعة" color="purple" />
                <StatCard icon="🚩" value={stats.flagged} label="مخالفات مرصودة" color="red" />
                <StatCard icon="⏳" value={stats.pending} label="قيد المراجعة (24س)" color="orange" />
            </div>

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
