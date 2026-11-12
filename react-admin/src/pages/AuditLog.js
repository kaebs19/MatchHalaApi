import React, { useCallback, useEffect, useState } from 'react';
import api from '../services/api';
import Pagination from '../components/Pagination';
import { formatDateTime } from '../utils/formatters';
import { navigate } from '../router';
import './AuditLog.css';

// 📜 سجلّ إجراءات المشرفين — يكتبه السيرفر تلقائياً لكل طلب تعديل يمرّ بـ adminOnly (180 يوماً)

const DURATIONS = { '24h': '24 ساعة', '48h': '48 ساعة', '3d': '3 أيام', '7d': '7 أيام', permanent: 'دائم', auto: 'تصعيد تلقائي' };

// وصف مقروء للإجراء من المسار والجسم — وإلا «الطريقة + المسار»
function describe(row) {
    const p = row.path || '';
    const b = row.body || {};
    const m = row.method;
    if (/\/users\/[0-9a-f]{24}\/suspend$/i.test(p)) {
        if (b.duration === 'unsuspend') return '🔓 إلغاء التعليق';
        if (b.duration === 'unrestrict') return '🔓 رفع تقييد المراسلة';
        if (b.duration === 'escalate') return '⬆️ تصعيد العقوبة';
        if (String(b.duration || '').startsWith('warn')) return '⚠️ تحذير';
        if (String(b.duration || '').startsWith('restrict')) return '✉️ تقييد المراسلة';
        return `⛔ تعليق${DURATIONS[b.duration] ? ` (${DURATIONS[b.duration]})` : ''}`;
    }
    if (/\/ban-device$/.test(p)) return '📵 حظر الجهاز';
    if (/\/banned-devices\/unban/.test(p)) return '♻️ فكّ حظر أجهزة';
    if (/\/users\/[0-9a-f]{24}\/hide$/i.test(p)) return '🙈 إخفاء الحساب';
    if (/\/users\/[0-9a-f]{24}\/unhide$/i.test(p)) return '👁️ إظهار الحساب';
    if (/\/official-warning$/.test(p)) return '📣 تحذير رسمي';
    if (/\/premium-grant$/.test(p)) return '💎 منح هلا+';
    if (/\/send-notification$/.test(p)) return '📢 إرسال إشعار';
    if (/\/newcomers\/bulk-approve$/.test(p)) return b.dryRun ? '🗂️ حساب عدد الاعتماد الجماعي' : '✅ اعتماد جماعي للجدد';
    if (/\/newcomers\/[0-9a-f]{24}\/approve$/i.test(p)) return '✅ اعتماد حساب جديد';
    if (/\/newcomers\/[0-9a-f]{24}\/reject$/i.test(p)) return '⛔ رفض حساب جديد';
    if (/\/clear-reports$/.test(p)) return '🧹 مسح البلاغات';
    if (m === 'DELETE' && /\/users\/[0-9a-f]{24}$/i.test(p)) return '🗑️ حذف الحساب';
    if (m === 'PUT' && /\/users\/[0-9a-f]{24}$/i.test(p)) return '✏️ تعديل بيانات الحساب';
    return `${m} ${p.replace(/^\/api/, '')}`;
}

// تفاصيل مختصرة: السبب والحقول المفيدة، لا الجسم كله
function details(row) {
    const b = row.body;
    if (!b || typeof b !== 'object') return '';
    if (b._multipart) return 'ملف مرفوع';
    const parts = [];
    if (b.reason) parts.push(`السبب: ${b.reason}`);
    if (b.title) parts.push(`العنوان: ${b.title}`);
    if (b.days) parts.push(`${b.days} يوم`);
    if (!parts.length) {
        const keys = Object.keys(b).filter(k => k !== 'duration' && k !== 'notify');
        if (keys.length) parts.push(keys.slice(0, 4).map(k => `${k}: ${typeof b[k] === 'object' ? '…' : String(b[k]).slice(0, 40)}`).join(' · '));
    }
    return parts.join(' — ');
}

const LIMIT = 30;

function AuditLog({ initialTarget }) {
    const [rows, setRows] = useState([]);
    const [admins, setAdmins] = useState([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [admin, setAdmin] = useState('');
    const [failed, setFailed] = useState(false);
    const [target, setTarget] = useState(initialTarget || '');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    useEffect(() => { setTarget(initialTarget || ''); setPage(1); }, [initialTarget]);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams({ page, limit: LIMIT });
            if (admin) params.append('admin', admin);
            if (target) params.append('target', target);
            if (failed) params.append('failed', '1');
            const { data } = await api.get(`/admin/audit?${params}`);
            if (data.success) {
                setRows(data.data || []);
                setTotal(data.total || 0);
                setAdmins(data.admins || []);
                setError('');
            }
        } catch (e) {
            setError(e.response?.data?.message || 'تعذّر تحميل السجلّ');
        } finally {
            setLoading(false);
        }
    }, [page, admin, target, failed]);

    useEffect(() => { load(); }, [load]);

    return (
        <div className="audit-page">
            <div className="audit-toolbar">
                <select value={admin} onChange={(e) => { setAdmin(e.target.value); setPage(1); }} aria-label="المشرف">
                    <option value="">كل المشرفين</option>
                    {admins.map(a => <option key={a._id} value={a._id}>{a.name || a._id} ({a.n})</option>)}
                </select>
                <label className="audit-check">
                    <input type="checkbox" checked={failed} onChange={(e) => { setFailed(e.target.checked); setPage(1); }} />
                    الفاشلة فقط
                </label>
                {target && (
                    <span className="audit-chip">
                        حساب محدّد
                        <button onClick={() => navigate('audit-log')} aria-label="إزالة التصفية">✕</button>
                    </span>
                )}
                <button className="audit-refresh" onClick={load}>🔄</button>
                <span className="audit-total">{total.toLocaleString('en-US')} إجراء</span>
            </div>

            {error && <div className="error-banner">{error}</div>}

            <div className="audit-list">
                {loading && rows.length === 0 && <div className="audit-empty">جارٍ التحميل…</div>}
                {!loading && rows.length === 0 && <div className="audit-empty">لا إجراءات مسجّلة بعد{target ? ' على هذا الحساب' : ''}.</div>}
                {rows.map(r => (
                    <div key={r._id} className={`audit-row ${r.status >= 400 ? 'failed' : ''}`}>
                        <div className="audit-main">
                            <span className="audit-action">{describe(r)}</span>
                            {r.targetId && (
                                <button className="audit-target" onClick={() => navigate('user-detail', r.targetId)}>
                                    {r.targetName || 'حساب'} ↗
                                </button>
                            )}
                            {r.status >= 400 && <span className="audit-status">فشل {r.status}</span>}
                        </div>
                        {details(r) && <div className="audit-details">{details(r)}</div>}
                        <div className="audit-meta">
                            <span>👤 {r.adminName || r.admin}</span>
                            <span>🕐 {formatDateTime(r.at)}</span>
                        </div>
                    </div>
                ))}
            </div>

            {total > LIMIT && (
                <Pagination currentPage={page} totalPages={Math.ceil(total / LIMIT)} onPageChange={setPage}
                    itemsPerPage={LIMIT} totalItems={total} />
            )}
        </div>
    );
}

export default AuditLog;
