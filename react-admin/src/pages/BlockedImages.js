// 🛡️ الصور الممنوعة — منعها كشف العُري على الخادم (utils/nudity) قبل نشرها: قصص وصور ملف.
// الصورة مموّهة حتى «اعرض» (حماية للمشرف)، والمراجعة: «عُري فعلاً» أو «خطأ في الكشف» — الأخيرة تقيس العتبة (NSFW_BLOCK_THRESHOLD).

import React, { useState, useEffect, useCallback } from 'react';
import { getBlockedImages, getBlockedImagesStats, getBlockedImageBlob, reviewBlockedImage } from '../services/api';
import { useToast } from '../components/Toast';
import LoadingSpinner from '../components/LoadingSpinner';
import Pagination from '../components/Pagination';
import { formatDateTime } from '../utils/formatters';
import { getImageUrl, getDefaultAvatar } from '../config';
import './BlockedImages.css';

const SOURCES = { story: '📸 قصة', profile: '👤 صورة الملف', gallery: '🖼️ معرض الملف' };
const STATUSES = [
    { key: 'pending', label: 'بانتظار المراجعة' },
    { key: 'confirmed', label: 'عُري فعلاً' },
    { key: 'false_positive', label: 'خطأ في الكشف' },
    { key: '', label: 'الكل' }
];

function BlurredImage({ id, hasImage }) {
    const [url, setUrl] = useState(null);
    const [shown, setShown] = useState(false);
    useEffect(() => {
        if (!hasImage) return undefined;
        let objectUrl = null;
        let alive = true;
        getBlockedImageBlob(id).then(blob => {
            if (!alive) return;
            objectUrl = URL.createObjectURL(blob);
            setUrl(objectUrl);
        }).catch(() => {});
        return () => { alive = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
    }, [id, hasImage]);
    if (!hasImage) return <div className="bi-image bi-image--empty">لا نسخة محفوظة</div>;
    return (
        <div className="bi-image" onClick={() => setShown(s => !s)} title={shown ? 'إخفاء' : 'اعرض'}>
            {url ? <img src={url} alt="" className={shown ? '' : 'is-blurred'} /> : <span className="bi-loading">⏳</span>}
            {!shown && url && <span className="bi-reveal">👁 اعرض</span>}
        </div>
    );
}

const pct = (v) => `${Math.round((v || 0) * 100)}%`;

export default function BlockedImages({ onViewUserDetail, onCountChange }) {
    const { showToast } = useToast();
    const [status, setStatus] = useState('pending');
    const [page, setPage] = useState(1);
    const [data, setData] = useState(null);
    const [stats, setStats] = useState(null);
    const [loading, setLoading] = useState(true);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const [list, st] = await Promise.all([
                getBlockedImages({ status: status || undefined, page }),
                getBlockedImagesStats()
            ]);
            if (list.success) setData(list.data);
            if (st.success) setStats(st.data);
        } catch (e) {
            showToast('تعذّر تحميل الصور الممنوعة', 'error');
        } finally {
            setLoading(false);
        }
        // eslint-disable-next-line
    }, [status, page]);

    useEffect(() => { load(); }, [load]);

    const review = async (item, next) => {
        try {
            await reviewBlockedImage(item._id, next);
            setData(d => ({ ...d, items: d.items.map(i => (i._id === item._id ? { ...i, status: next } : i)) }));
            setStats(s => s && ({ ...s, pending: Math.max(0, s.pending + (next === 'pending' ? 1 : item.status === 'pending' ? -1 : 0)) }));
            onCountChange && onCountChange();
        } catch (e) {
            showToast('تعذّر الحفظ', 'error');
        }
    };

    return (
        <div className="blocked-images">
            <div className="bi-head">
                <div>
                    <h2>🛡️ الصور الممنوعة</h2>
                    <p className="bi-muted">
                        صور قصص وملفات منعها كشف العُري على خادمنا قبل نشرها. صاحبها رأى رسالة الرفض ولم تظهر لأحد.
                        «خطأ في الكشف» يساعد على ضبط حساسية الكشف. تُحذف بعد 90 يوماً.
                    </p>
                </div>
                {stats && (
                    <div className="bi-stats">
                        <span><b>{stats.pending}</b> بانتظار المراجعة</span>
                        <span><b>{stats.last24h}</b> خلال 24 ساعة</span>
                        <span><b>{stats.confirmed}</b> مؤكَّدة</span>
                        <span><b>{stats.falsePositive}</b> خطأ في الكشف</span>
                    </div>
                )}
            </div>

            <div className="bi-tabs">
                {STATUSES.map(s => (
                    <button key={s.key || 'all'} className={status === s.key ? 'is-on' : ''} onClick={() => { setStatus(s.key); setPage(1); }}>
                        {s.label}
                    </button>
                ))}
            </div>

            {loading && !data ? <LoadingSpinner /> : (
                <>
                    {data?.items?.length === 0 && <p className="bi-muted bi-empty">لا صور هنا 🎉</p>}
                    <div className="bi-grid">
                        {data?.items?.map(item => (
                            <div key={item._id} className={`bi-card is-${item.status}`}>
                                <BlurredImage id={item._id} hasImage={item.hasImage} />
                                <div className="bi-body">
                                    <div className="bi-user" onClick={() => item.user && onViewUserDetail && onViewUserDetail(item.user._id)}>
                                        <img src={getImageUrl(item.user?.profileImage) || getDefaultAvatar()} alt="" onError={e => { e.target.src = getDefaultAvatar(); }} />
                                        <div>
                                            <b>{item.user?.name || 'حساب محذوف'}</b>
                                            <small>{SOURCES[item.source] || item.source} · {formatDateTime(item.createdAt)}</small>
                                        </div>
                                    </div>
                                    <div className="bi-scores">
                                        <span title="إباحي">🔞 {pct(item.scores?.porn)}</span>
                                        <span title="رسوم إباحية">🎨 {pct(item.scores?.hentai)}</span>
                                        <span title="مثير (لا يُمنع وحده)">👙 {pct(item.scores?.sexy)}</span>
                                        {item.attempts7d > 1 && <span className="bi-repeat" title="محاولات هذا المستخدم خلال 7 أيام">🔁 {item.attempts7d}</span>}
                                    </div>
                                    <div className="bi-actions">
                                        {item.status === 'pending' ? (
                                            <>
                                                <button className="bi-confirm" onClick={() => review(item, 'confirmed')}>عُري فعلاً</button>
                                                <button className="bi-false" onClick={() => review(item, 'false_positive')}>خطأ في الكشف</button>
                                            </>
                                        ) : (
                                            <>
                                                <span className="bi-status">{item.status === 'confirmed' ? '✅ عُري فعلاً' : '↩️ خطأ في الكشف'}{item.reviewedBy?.name ? ` — ${item.reviewedBy.name}` : ''}</span>
                                                <button className="bi-link" onClick={() => review(item, 'pending')}>تراجع</button>
                                            </>
                                        )}
                                        {item.user && <button className="bi-link" onClick={() => onViewUserDetail && onViewUserDetail(item.user._id)}>الحساب ←</button>}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                    {data?.pages > 1 && <Pagination currentPage={page} totalPages={data.pages} onPageChange={setPage} />}
                </>
            )}
        </div>
    );
}
