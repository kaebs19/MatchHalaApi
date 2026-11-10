// طلبات إزالة المحتوى — تصل من chathala.com/report-content (أشخاص غالباً خارج التطبيق)
// القائمة يساراً/أعلى، والتفاصيل في لوحة: الحساب المقصود، الأدلة، الحالة، والردّ بالبريد.

import React, { useState, useEffect, useCallback } from 'react';
import {
    getRemovalRequests, getRemovalRequest, updateRemovalRequest, deleteRemovalRequest, getRemovalEvidenceBlob
} from '../services/api';
import { useToast } from '../components/Toast';
import LoadingSpinner from '../components/LoadingSpinner';
import Pagination from '../components/Pagination';
import { formatDateTime } from '../utils/formatters';
import { getImageUrl, getDefaultAvatar } from '../config';
import './RemovalRequests.css';

const TYPES = {
    impersonation: '🎭 انتحال شخصية',
    my_photos: '🖼️ صوري بلا إذن',
    offensive: '⚠️ محتوى مسيء',
    copyright: '©️ حقوق ملكية',
    underage: '🔞 حساب لقاصر',
    other: '📝 أخرى'
};

const RELATIONS = {
    self: 'صاحب الشأن نفسه',
    representative: 'ممثّل عنه',
    rights_holder: 'صاحب الحقوق',
    other: 'أخرى'
};

const STATUSES = {
    new: { label: 'جديد', cls: 'new' },
    reviewing: { label: 'قيد المراجعة', cls: 'reviewing' },
    removed: { label: 'أُزيل', cls: 'removed' },
    rejected: { label: 'مرفوض', cls: 'rejected' }
};

// قوالب الردّ — بلغة صاحب الطلب
const TEMPLATES = {
    ar: [
        { label: 'طلب تفاصيل', status: 'reviewing', text: 'شكراً لتواصلك. لنتمكن من مراجعة طلبك نحتاج تفاصيل إضافية: رابط الحساب أو رقم Hala ID، ولقطة شاشة توضّح المحتوى المقصود. يمكنك الردّ على هذا البريد.' },
        { label: 'تمت الإزالة', status: 'removed', text: 'راجعنا طلبك وتمت إزالة المحتوى المبلَّغ عنه واتخاذ الإجراء المناسب بحق الحساب وفق سياسة هلا. شكراً لمساعدتك في إبقاء المجتمع آمناً.' },
        { label: 'لا مخالفة', status: 'rejected', text: 'راجعنا طلبك بعناية ولم نجد أن المحتوى المبلَّغ عنه يخالف سياسات هلا، لذلك لم نتخذ إجراءً. إن كانت لديك معلومات إضافية فيمكنك الردّ على هذا البريد.' },
        { label: 'لم نعثر على الحساب', status: 'rejected', text: 'لم نتمكن من العثور على الحساب أو المحتوى المذكور في طلبك. إن كان لديك رابط الحساب أو رقم Hala ID أو لقطة شاشة، فأرسل طلباً جديداً بها.' }
    ],
    en: [
        { label: 'Need details', status: 'reviewing', text: 'Thank you for contacting us. To review your request we need more details: the account link or Hala ID, and a screenshot showing the content. You can reply to this email.' },
        { label: 'Removed', status: 'removed', text: 'We reviewed your request and removed the reported content, and took appropriate action on the account under Hala\'s policies. Thank you for helping keep our community safe.' },
        { label: 'No violation', status: 'rejected', text: 'We carefully reviewed your request and did not find that the reported content violates Hala\'s policies, so no action was taken. If you have more information, you can reply to this email.' },
        { label: 'Account not found', status: 'rejected', text: 'We could not find the account or content mentioned in your request. If you have the account link, Hala ID or a screenshot, please submit a new request including it.' }
    ]
};

function Evidence({ requestId, count }) {
    const [urls, setUrls] = useState([]);
    useEffect(() => {
        let alive = true;
        const created = [];
        (async () => {
            const out = [];
            for (let i = 0; i < count; i++) {
                try {
                    const blob = await getRemovalEvidenceBlob(requestId, i);
                    const u = URL.createObjectURL(blob);
                    created.push(u);
                    out.push(u);
                } catch (_) { out.push(null); }
            }
            if (alive) setUrls(out);
        })();
        return () => { alive = false; created.forEach(URL.revokeObjectURL); };
    }, [requestId, count]);

    if (!count) return <p className="rr-muted">لا مرفقات</p>;
    return (
        <div className="rr-evidence">
            {urls.length === 0 && <span className="rr-muted">جاري تحميل الأدلة…</span>}
            {urls.map((u, i) => u
                ? <a key={i} href={u} target="_blank" rel="noopener noreferrer"><img src={u} alt={`دليل ${i + 1}`} /></a>
                : <span key={i} className="rr-muted">تعذّر تحميل الصورة {i + 1}</span>)}
        </div>
    );
}

function RemovalRequests({ onViewUserDetail, onCountChange }) {
    const { showToast } = useToast();
    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(true);
    const [status, setStatus] = useState('open');
    const [type, setType] = useState('');
    const [q, setQ] = useState('');
    const [page, setPage] = useState(1);
    const [pages, setPages] = useState(1);
    const [total, setTotal] = useState(0);

    const [selectedId, setSelectedId] = useState(null);
    const [detail, setDetail] = useState(null);
    const [note, setNote] = useState('');
    const [reply, setReply] = useState('');
    const [targetInput, setTargetInput] = useState('');
    const [saving, setSaving] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const res = await getRemovalRequests({ status, type, q, page });
            if (res.success) {
                setItems(res.data.items);
                setPages(res.data.pages || 1);
                setTotal(res.data.total);
            }
        } catch (e) {
            showToast('تعذّر جلب الطلبات', 'error');
        } finally {
            setLoading(false);
        }
    }, [status, type, q, page, showToast]);

    useEffect(() => { load(); }, [load]);

    const open = async (id) => {
        setSelectedId(id);
        setDetail(null);
        try {
            const res = await getRemovalRequest(id);
            if (res.success) {
                setDetail(res.data);
                setNote(res.data.adminNote || '');
                setReply('');
                setTargetInput('');
                // فتح طلب جديد ينقله «قيد المراجعة» — كي لا يعمل مشرفان عليه معاً دون علم
                if (res.data.status === 'new') {
                    const upd = await updateRemovalRequest(id, { status: 'reviewing' });
                    if (upd.success) { setDetail(d => ({ ...d, ...upd.data })); load(); onCountChange && onCountChange(); }
                }
            }
        } catch (e) {
            showToast('تعذّر جلب الطلب', 'error');
        }
    };

    const save = async (body, okToast) => {
        if (!detail) return;
        setSaving(true);
        try {
            const res = await updateRemovalRequest(detail._id, body);
            if (res.success) {
                setDetail(d => ({ ...d, ...res.data }));
                showToast(okToast || res.message, 'success');
                load();
                onCountChange && onCountChange();
                return true;
            }
            showToast(res.message || 'فشل الحفظ', 'error');
        } catch (e) {
            showToast(e.response?.data?.message || 'فشل الحفظ', 'error');
        } finally {
            setSaving(false);
        }
        return false;
    };

    const decide = async (newStatus) => {
        const notify = reply.trim().length > 0;
        if (!notify && !window.confirm('لن يُرسل بريد لصاحب الطلب (لا نصّ ردّ). متابعة؟')) return;
        const ok = await save({ status: newStatus, adminNote: note, message: reply, notify });
        if (ok && notify) setReply('');
    };

    const remove = async () => {
        if (!detail || !window.confirm(`حذف الطلب ${detail.reference} وأدلته نهائياً؟ (للطلبات المزعجة فقط)`)) return;
        try {
            const res = await deleteRemovalRequest(detail._id);
            if (res.success) {
                showToast('حُذف الطلب', 'success');
                setSelectedId(null);
                setDetail(null);
                load();
                onCountChange && onCountChange();
            }
        } catch (e) {
            showToast('فشل الحذف', 'error');
        }
    };

    const lang = detail?.lang === 'en' ? 'en' : 'ar';
    const tu = detail?.targetUser;

    return (
        <div className="rr-page">
            <p className="rr-hint">
                طلبات من نموذج <a href="https://chathala.com/report-content" target="_blank" rel="noopener noreferrer">chathala.com/report-content</a>
                {' '}— غالباً من أشخاص خارج التطبيق. فتح الطلب ينقله «قيد المراجعة». الردّ يُرسل لبريد صاحب الطلب بلغته.
            </p>

            <div className="rr-toolbar">
                {[['open', 'المفتوحة'], ['new', 'جديد'], ['reviewing', 'قيد المراجعة'], ['removed', 'أُزيل'], ['rejected', 'مرفوض'], ['', 'الكل']].map(([v, l]) => (
                    <button key={v || 'all'} className={`rr-chip ${status === v ? 'selected' : ''}`} onClick={() => { setStatus(v); setPage(1); }}>{l}</button>
                ))}
                <select value={type} onChange={e => { setType(e.target.value); setPage(1); }}>
                    <option value="">كل الأنواع</option>
                    {Object.entries(TYPES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
                <input
                    placeholder="بحث: الرقم المرجعي، البريد، الحساب…"
                    defaultValue={q}
                    onKeyDown={e => { if (e.key === 'Enter') { setQ(e.target.value.trim()); setPage(1); } }}
                />
                <span className="rr-muted">{total} طلب</span>
            </div>

            <div className={`rr-layout ${detail || selectedId ? 'with-detail' : ''}`}>
                <div className="rr-list">
                    {loading ? <LoadingSpinner /> : items.length === 0 ? (
                        <p className="rr-muted rr-empty">لا طلبات هنا</p>
                    ) : items.map(it => (
                        <button key={it._id} className={`rr-item ${selectedId === it._id ? 'active' : ''}`} onClick={() => open(it._id)}>
                            <div className="rr-item-top">
                                <span className="rr-type">{TYPES[it.type] || it.type}</span>
                                <span className={`rr-status ${STATUSES[it.status]?.cls}`}>{STATUSES[it.status]?.label}</span>
                            </div>
                            <div className="rr-item-target" dir="auto">{it.target}</div>
                            <div className="rr-item-meta">
                                <code>{it.reference}</code>
                                <span>{formatDateTime(it.createdAt)}</span>
                                {it.targetUser && <span title="الحساب المطابق">👤 {it.targetUser.name}</span>}
                                {it.evidence?.length > 0 && <span>📎 {it.evidence.length}</span>}
                            </div>
                        </button>
                    ))}
                    {pages > 1 && <Pagination currentPage={page} totalPages={pages} onPageChange={setPage} />}
                </div>

                {selectedId && (
                    <div className="rr-detail">
                        {!detail ? <LoadingSpinner /> : (
                            <>
                                <div className="rr-detail-head">
                                    <div>
                                        <h3>{TYPES[detail.type]} <code>{detail.reference}</code></h3>
                                        <span className={`rr-status ${STATUSES[detail.status]?.cls}`}>{STATUSES[detail.status]?.label}</span>
                                        {detail.handledBy && <span className="rr-muted"> · آخر إجراء: {detail.handledBy.name} — {formatDateTime(detail.handledAt)}</span>}
                                    </div>
                                    <button className="rr-close" onClick={() => { setSelectedId(null); setDetail(null); }}>✕</button>
                                </div>

                                <section>
                                    <h4>صاحب الطلب</h4>
                                    <p>{detail.requesterName} — <a href={`mailto:${detail.requesterEmail}`} dir="ltr">{detail.requesterEmail}</a></p>
                                    <p className="rr-muted">الصفة: {RELATIONS[detail.relation]} · اللغة: {detail.lang === 'en' ? 'English' : 'العربية'} · {formatDateTime(detail.createdAt)}</p>
                                </section>

                                <section>
                                    <h4>الحساب / المحتوى المقصود</h4>
                                    <p className="rr-pre" dir="auto">{detail.target}</p>
                                    {tu ? (
                                        <div className="rr-user">
                                            <img src={getImageUrl(tu.profileImage) || getDefaultAvatar(tu.name)} alt="" />
                                            <div>
                                                <strong>{tu.name}</strong> {tu.verification?.isVerified && '✓'}
                                                <div className="rr-muted" dir="ltr">{tu.halaId || tu._id} · {tu.isActive === false ? 'معطّل' : 'نشط'}{tu.isPremium ? ' · هلا+' : ''}</div>
                                                <div className="rr-muted">مطابقة {detail.targetMatchedBy === 'auto' ? 'تلقائية — تأكّد منها' : 'من مشرف'}</div>
                                            </div>
                                            <button onClick={() => onViewUserDetail && onViewUserDetail(tu._id)}>فتح الحساب ←</button>
                                            <button className="rr-link" onClick={() => save({ targetUserId: null }, 'أُلغيت المطابقة')}>إلغاء المطابقة</button>
                                        </div>
                                    ) : (
                                        <p className="rr-muted">لم يُطابَق حساب تلقائياً.</p>
                                    )}
                                    <div className="rr-inline">
                                        <input value={targetInput} onChange={e => setTargetInput(e.target.value)} placeholder="Hala ID أو معرّف الحساب" dir="ltr" />
                                        <button disabled={!targetInput.trim() || saving} onClick={async () => { if (await save({ targetUserId: targetInput.trim() }, 'رُبط الحساب')) setTargetInput(''); }}>ربط</button>
                                    </div>
                                </section>

                                <section>
                                    <h4>الوصف</h4>
                                    <p className="rr-pre" dir="auto">{detail.description}</p>
                                </section>

                                <section>
                                    <h4>الأدلة</h4>
                                    <Evidence requestId={detail._id} count={detail.evidence?.length || 0} />
                                </section>

                                {detail.related?.length > 0 && (
                                    <section>
                                        <h4>طلبات مرتبطة (نفس البريد أو الحساب)</h4>
                                        <ul className="rr-related">
                                            {detail.related.map(r => (
                                                <li key={r._id}>
                                                    <button className="rr-link" onClick={() => open(r._id)}>{r.reference}</button>
                                                    {' '}{TYPES[r.type]} · {STATUSES[r.status]?.label} · {formatDateTime(r.createdAt)}
                                                </li>
                                            ))}
                                        </ul>
                                    </section>
                                )}

                                <section>
                                    <h4>ملاحظة داخلية (لا تُرسل)</h4>
                                    <textarea rows="2" value={note} onChange={e => setNote(e.target.value)} placeholder="ما الإجراء الذي اتُّخذ على الحساب…" />
                                    <button disabled={saving || note === (detail.adminNote || '')} onClick={() => save({ adminNote: note }, 'حُفظت الملاحظة')}>حفظ الملاحظة</button>
                                </section>

                                <section>
                                    <h4>الردّ على صاحب الطلب ({lang === 'en' ? 'English' : 'العربية'})</h4>
                                    <div className="rr-templates">
                                        {TEMPLATES[lang].map(t => (
                                            <button key={t.label} className="rr-chip" onClick={() => setReply(t.text)}>{t.label}</button>
                                        ))}
                                    </div>
                                    <textarea rows="5" value={reply} onChange={e => setReply(e.target.value)} dir={lang === 'en' ? 'ltr' : 'rtl'}
                                        placeholder="نصّ البريد — يُرسل مع تغيير الحالة" />
                                    {detail.responseMessage && (
                                        <details className="rr-muted"><summary>آخر ردّ أُرسل</summary><p className="rr-pre">{detail.responseMessage}</p></details>
                                    )}
                                    <div className="rr-actions">
                                        <button className="ok" disabled={saving} onClick={() => decide('removed')}>✅ أُزيل المحتوى</button>
                                        <button className="no" disabled={saving} onClick={() => decide('rejected')}>✕ رفض</button>
                                        <button disabled={saving} onClick={() => decide('reviewing')}>⏳ قيد المراجعة</button>
                                        <button className="danger" disabled={saving} onClick={remove}>🗑 حذف (مزعج)</button>
                                    </div>
                                </section>
                            </>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}

export default RemovalRequests;
