import React, { useState, useEffect, useCallback } from 'react';
import { useToast } from '../components/Toast';
import config from '../config';
import './GamesManagement.css';

const API = `${config.API_URL}/admin/games`;

const authHeaders = () => ({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${localStorage.getItem('token')}`
});

const call = async (path, options = {}) => {
    const res = await fetch(`${API}${path}`, { ...options, headers: authHeaders() });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) throw new Error(data.message || 'فشل الطلب');
    return data.data;
};

const KINDS = {
    truth_dare: { title: 'حقيقة أم جرأة', icon: '🎭' },
    would_you_rather: { title: 'هل تفضّل؟', icon: '🤔' },
    never_have_i_ever: { title: 'لم أفعل قط', icon: '🙈' },
    two_truths_lie: { title: 'حقيقتان وكذبة', icon: '🕵️' }
};

const BANKS = {
    truth: { title: 'حقيقة', icon: '🧠' },
    dare: { title: 'جرأة', icon: '🔥' },
    wyr: { title: 'هل تفضّل؟', icon: '🤔' },
    never: { title: 'لم أفعل قط', icon: '🙈' }
};

const emptyForm = { ar: '', en: '', aAr: '', aEn: '', bAr: '', bEn: '' };

function GamesManagement() {
    const { showToast } = useToast();
    const [tab, setTab] = useState('questions');

    // الأسئلة
    const [bank, setBank] = useState('truth');
    const [search, setSearch] = useState('');
    const [page, setPage] = useState(1);
    const [list, setList] = useState({ items: [], total: 0, pages: 1, byBank: {} });
    const [loading, setLoading] = useState(true);

    // نموذج إضافة/تعديل
    const [editing, setEditing] = useState(null);   // null | 'new' | question
    const [form, setForm] = useState(emptyForm);
    const [saving, setSaving] = useState(false);

    // إضافة جماعية
    const [bulkOpen, setBulkOpen] = useState(false);
    const [bulkText, setBulkText] = useState('');

    // الإعدادات والإحصائيات
    const [cfg, setCfg] = useState(null);
    const [stats, setStats] = useState(null);

    const loadQuestions = useCallback(async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams({ bank, page, limit: 30 });
            if (search.trim()) params.set('search', search.trim());
            setList(await call(`/questions?${params}`));
        } catch (e) {
            showToast(e.message, 'error');
        } finally {
            setLoading(false);
        }
    }, [bank, page, search, showToast]);

    const loadOverview = useCallback(async () => {
        try {
            const [c, s] = await Promise.all([call('/config'), call('/stats')]);
            setCfg(c);
            setStats(s.kinds);
        } catch (e) {
            showToast(e.message, 'error');
        }
    }, [showToast]);

    useEffect(() => { loadQuestions(); }, [loadQuestions]);
    useEffect(() => { loadOverview(); }, [loadOverview]);
    useEffect(() => { setPage(1); }, [bank, search]);

    const openNew = () => { setForm(emptyForm); setEditing('new'); };
    const openEdit = (q) => {
        setForm({
            ar: q.ar || '', en: q.en || '',
            aAr: q.a?.ar || '', aEn: q.a?.en || '',
            bAr: q.b?.ar || '', bEn: q.b?.en || ''
        });
        setEditing(q);
    };

    const payload = () => bank === 'wyr'
        ? { a: { ar: form.aAr, en: form.aEn }, b: { ar: form.bAr, en: form.bEn } }
        : { ar: form.ar, en: form.en };

    const save = async () => {
        setSaving(true);
        try {
            if (editing === 'new') {
                await call('/questions', { method: 'POST', body: JSON.stringify({ bank, ...payload() }) });
                showToast('تمت الإضافة', 'success');
            } else {
                await call(`/questions/${editing._id}`, { method: 'PUT', body: JSON.stringify(payload()) });
                showToast('تم الحفظ', 'success');
            }
            setEditing(null);
            loadQuestions();
        } catch (e) {
            showToast(e.message, 'error');
        } finally {
            setSaving(false);
        }
    };

    const toggleActive = async (q) => {
        try {
            await call(`/questions/${q._id}`, { method: 'PUT', body: JSON.stringify({ active: !q.active }) });
            loadQuestions();
        } catch (e) { showToast(e.message, 'error'); }
    };

    const remove = async (q) => {
        if (!window.confirm('حذف هذا السؤال نهائياً؟')) return;
        try {
            await call(`/questions/${q._id}`, { method: 'DELETE' });
            showToast('تم الحذف', 'success');
            loadQuestions();
        } catch (e) { showToast(e.message, 'error'); }
    };

    const submitBulk = async () => {
        try {
            const r = await call('/questions/bulk', { method: 'POST', body: JSON.stringify({ bank, text: bulkText }) });
            showToast(`أُضيف ${r.added} سؤال${r.skipped ? ` — تجاوز ${r.skipped}` : ''}`, 'success');
            setBulkOpen(false);
            setBulkText('');
            loadQuestions();
        } catch (e) { showToast(e.message, 'error'); }
    };

    const toggleKind = async (kind) => {
        const enabled = cfg.enabledKinds.includes(kind)
            ? cfg.enabledKinds.filter(k => k !== kind)
            : [...cfg.enabledKinds, kind];
        try {
            const r = await call('/config', { method: 'PUT', body: JSON.stringify({ enabledKinds: enabled }) });
            setCfg({ ...cfg, enabledKinds: r.enabledKinds });
            showToast('تم الحفظ — يسري فوراً على التطبيق', 'success');
        } catch (e) { showToast(e.message, 'error'); }
    };

    const isWyr = bank === 'wyr';
    const canSave = isWyr ? form.aAr.trim() && form.bAr.trim() : form.ar.trim();

    return (
        <div className="games-page">
            <div className="games-header">
                <h1>🎮 ألعاب المحادثة</h1>
                <p>أدر الأسئلة وفعّل الألعاب أو أوقفها للمستخدمين</p>
            </div>

            <div className="games-tabs">
                <button className={tab === 'questions' ? 'active' : ''} onClick={() => setTab('questions')}>📝 الأسئلة</button>
                <button className={tab === 'overview' ? 'active' : ''} onClick={() => setTab('overview')}>⚙️ الألعاب والإحصائيات</button>
            </div>

            {tab === 'overview' && (
                <div className="games-grid">
                    {!cfg || !stats ? <div className="games-empty">جارٍ التحميل…</div> :
                        Object.entries(KINDS).map(([kind, meta]) => {
                            const on = cfg.enabledKinds.includes(kind);
                            const s = stats[kind] || {};
                            return (
                                <div key={kind} className={`game-card ${on ? '' : 'off'}`}>
                                    <div className="game-card-top">
                                        <span className="game-card-icon">{meta.icon}</span>
                                        <div>
                                            <h3>{meta.title}</h3>
                                            <span className={`game-state ${on ? 'on' : 'off'}`}>{on ? 'متاحة' : 'متوقفة'}</span>
                                        </div>
                                        <label className="switch">
                                            <input type="checkbox" checked={on} onChange={() => toggleKind(kind)} />
                                            <span className="slider" />
                                        </label>
                                    </div>
                                    <div className="game-stats">
                                        <div><b>{s.total || 0}</b><span>إجمالي</span></div>
                                        <div><b>{s.last7 || 0}</b><span>آخر ٧ أيام</span></div>
                                        <div><b>{s.active || 0}</b><span>جارية</span></div>
                                        <div><b>{s.rounds || 0}</b><span>جولات</span></div>
                                        <div><b>{s.declined || 0}</b><span>رُفضت</span></div>
                                    </div>
                                </div>
                            );
                        })}
                </div>
            )}

            {tab === 'questions' && (
                <>
                    <div className="games-banks">
                        {Object.entries(BANKS).map(([id, meta]) => {
                            const c = list.byBank?.[id] || { total: 0, active: 0 };
                            return (
                                <button key={id} className={bank === id ? 'active' : ''} onClick={() => setBank(id)}>
                                    {meta.icon} {meta.title}
                                    <small>{c.active}/{c.total}</small>
                                </button>
                            );
                        })}
                    </div>

                    <div className="games-toolbar">
                        <input
                            type="search"
                            placeholder="بحث في الأسئلة…"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                        />
                        <button className="btn-primary" onClick={openNew}>➕ سؤال جديد</button>
                        {!isWyr && <button className="btn-ghost" onClick={() => setBulkOpen(true)}>📋 إضافة جماعية</button>}
                    </div>

                    {loading ? <div className="games-empty">جارٍ التحميل…</div> :
                        list.items.length === 0 ? <div className="games-empty">لا توجد أسئلة</div> : (
                            <div className="games-list">
                                {list.items.map(q => (
                                    <div key={q._id} className={`q-row ${q.active ? '' : 'inactive'}`}>
                                        <div className="q-text">
                                            {isWyr ? (
                                                <>
                                                    <div><span className="ab">A</span> {q.a?.ar} <em>{q.a?.en}</em></div>
                                                    <div><span className="ab">B</span> {q.b?.ar} <em>{q.b?.en}</em></div>
                                                </>
                                            ) : (
                                                <>
                                                    <div>{q.ar}</div>
                                                    {q.en && <em dir="ltr">{q.en}</em>}
                                                </>
                                            )}
                                        </div>
                                        <div className="q-actions">
                                            <button title={q.active ? 'تعطيل' : 'تفعيل'} onClick={() => toggleActive(q)}>{q.active ? '🟢' : '⚪'}</button>
                                            <button title="تعديل" onClick={() => openEdit(q)}>✏️</button>
                                            <button title="حذف" onClick={() => remove(q)}>🗑️</button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}

                    {list.pages > 1 && (
                        <div className="games-pager">
                            <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}>السابق</button>
                            <span>{page} / {list.pages}</span>
                            <button disabled={page >= list.pages} onClick={() => setPage(p => p + 1)}>التالي</button>
                        </div>
                    )}
                </>
            )}

            {editing && (
                <div className="games-modal-backdrop" onClick={() => setEditing(null)}>
                    <div className="games-modal" onClick={(e) => e.stopPropagation()}>
                        <h3>{editing === 'new' ? 'سؤال جديد' : 'تعديل السؤال'} — {BANKS[bank].icon} {BANKS[bank].title}</h3>
                        {isWyr ? (
                            <>
                                <label>الخيار A (عربي)</label>
                                <input value={form.aAr} onChange={e => setForm({ ...form, aAr: e.target.value })} maxLength={200} dir="rtl" />
                                <label>Option A (English)</label>
                                <input value={form.aEn} onChange={e => setForm({ ...form, aEn: e.target.value })} maxLength={200} dir="ltr" />
                                <label>الخيار B (عربي)</label>
                                <input value={form.bAr} onChange={e => setForm({ ...form, bAr: e.target.value })} maxLength={200} dir="rtl" />
                                <label>Option B (English)</label>
                                <input value={form.bEn} onChange={e => setForm({ ...form, bEn: e.target.value })} maxLength={200} dir="ltr" />
                            </>
                        ) : (
                            <>
                                <label>النص (عربي)</label>
                                <textarea rows={3} value={form.ar} onChange={e => setForm({ ...form, ar: e.target.value })} maxLength={200} dir="rtl" />
                                <label>Text (English) — اختياري</label>
                                <textarea rows={3} value={form.en} onChange={e => setForm({ ...form, en: e.target.value })} maxLength={200} dir="ltr" />
                            </>
                        )}
                        <div className="games-modal-actions">
                            <button className="btn-ghost" onClick={() => setEditing(null)}>إلغاء</button>
                            <button className="btn-primary" disabled={!canSave || saving} onClick={save}>{saving ? '…' : 'حفظ'}</button>
                        </div>
                    </div>
                </div>
            )}

            {bulkOpen && (
                <div className="games-modal-backdrop" onClick={() => setBulkOpen(false)}>
                    <div className="games-modal" onClick={(e) => e.stopPropagation()}>
                        <h3>إضافة جماعية — {BANKS[bank].icon} {BANKS[bank].title}</h3>
                        <p className="hint">سطر لكل سؤال. للترجمة أضف «|» ثم الإنجليزية:<br /><code>ما أكثر شيء يضحكك؟ | What makes you laugh most?</code></p>
                        <textarea rows={10} value={bulkText} onChange={e => setBulkText(e.target.value)} dir="rtl" />
                        <div className="games-modal-actions">
                            <button className="btn-ghost" onClick={() => setBulkOpen(false)}>إلغاء</button>
                            <button className="btn-primary" disabled={!bulkText.trim()} onClick={submitBulk}>إضافة</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

export default GamesManagement;
