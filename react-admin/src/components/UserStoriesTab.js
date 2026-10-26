// 📸 تبويب «القصص» في صفحة المستخدم: النشطة (مع حذف)، آخر المنتهية (والمؤرشف منها للمُبلَّغ عنها)،
// ومنع النشر لفترة. الخلفيات تطابق ترتيب التطبيق (StoryTextBackgrounds) — 8 خلفيات.
import React, { useEffect, useState, useCallback } from 'react';
import { getUserStories, deleteStoryAdmin, releaseStoryAdmin, banUserStories, liftStoryBan } from '../services/api';
import { getImageUrl } from '../config';
import { formatDateTimeLong } from '../utils/formatters';
import { useToast } from './Toast';
import './UserStoriesTab.css';

const TEXT_BACKGROUNDS = [
    ['#833AB4', '#E1306C'], ['#F58529', '#DD2A7B'], ['#0F2027', '#2C5364'], ['#11998E', '#38EF7D'],
    ['#FC466B', '#3F5EFB'], ['#000000', '#434343'], ['#F7971E', '#FFD200'], ['#8E2DE2', '#4A00E0']
];

const STATUS_LABEL = { active: 'نشطة', expired: 'انتهت', deleted: 'حذفها صاحبها', removed: 'حذفها المشرف' };

function archivedSrc(url) {
    if (!url) return null;
    const token = localStorage.getItem('token') || '';
    return `${getImageUrl(url)}?token=${encodeURIComponent(token)}`;
}

function StoryCard({ story, onDelete, onRelease, onOpen }) {
    const isText = story.kind === 'text';
    const src = story.imageUrl ? getImageUrl(story.imageUrl) : archivedSrc(story.archivedUrl);
    const bg = TEXT_BACKGROUNDS[story.background % TEXT_BACKGROUNDS.length] || TEXT_BACKGROUNDS[0];
    return (
        <div className={`story-card ${story.status !== 'active' ? 'ended' : ''}`}>
            <div
                className="story-thumb"
                style={isText ? { background: `linear-gradient(135deg, ${bg[0]}, ${bg[1]})` } : undefined}
                onClick={() => src && onOpen(src)}
            >
                {isText ? <span className="story-text">{story.text}</span>
                    : src ? <img src={src} alt="قصة" loading="lazy" />
                    : <span className="story-missing">الملف غير محفوظ</span>}
                {story.reportCount > 0 && <span className="story-badge reported">🚩 {story.reportCount}</span>}
                {story.heldAt && story.status === 'active' && <span className="story-badge held">⏸ محجوبة</span>}
            </div>
            <div className="story-meta">
                <span>{STATUS_LABEL[story.status] || story.status}</span>
                <span>👁 {story.viewCount}</span>
            </div>
            <div className="story-date">{formatDateTimeLong(story.createdAt)}</div>
            {story.status === 'active' && onDelete && (
                <button className="story-delete" onClick={() => onDelete(story)}>🗑️ حذف</button>
            )}
            {story.status === 'active' && story.heldAt && onRelease && (
                <button className="story-release" onClick={() => onRelease(story)}>👁 إظهار</button>
            )}
        </div>
    );
}

export default function UserStoriesTab({ userId, onChanged }) {
    const { showToast } = useToast();
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [banForm, setBanForm] = useState({ days: 7, reason: '', removeActive: true });
    const [lightbox, setLightbox] = useState(null);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const res = await getUserStories(userId);
            setData(res.data);
            onChanged && onChanged();
        } catch (e) {
            showToast(e?.response?.data?.message || 'فشل جلب القصص', 'error');
        } finally {
            setLoading(false);
        }
    }, [userId, showToast, onChanged]);

    useEffect(() => { load(); }, [load]);

    const handleDelete = async (story) => {
        if (!window.confirm('حذف هذه القصة؟ تختفي فوراً عند كل المستخدمين.')) return;
        setBusy(true);
        try {
            await deleteStoryAdmin(story._id);
            showToast('تم حذف القصة', 'success');
            await load();
        } catch (e) {
            showToast(e?.response?.data?.message || 'فشل الحذف', 'error');
        } finally { setBusy(false); }
    };

    // محجوبة تلقائياً (3 بلاغات) — المشرف راجعها ولم يجد مخالفة
    const handleRelease = async (story) => {
        setBusy(true);
        try {
            await releaseStoryAdmin(story._id);
            showToast('أُظهرت القصة', 'success');
            await load();
        } catch (e) {
            showToast(e?.response?.data?.message || 'فشل الإظهار', 'error');
        } finally { setBusy(false); }
    };

    const handleBan = async () => {
        const days = parseInt(banForm.days, 10);
        if (!days || days < 1 || days > 365) { showToast('المدة بين 1 و365 يوماً', 'error'); return; }
        setBusy(true);
        try {
            const res = await banUserStories(userId, { ...banForm, days });
            showToast(res.message || 'تم المنع', 'success');
            await load();
        } catch (e) {
            showToast(e?.response?.data?.message || 'فشل المنع', 'error');
        } finally { setBusy(false); }
    };

    const handleLift = async () => {
        setBusy(true);
        try {
            await liftStoryBan(userId);
            showToast('رُفع منع القصص', 'success');
            await load();
        } catch (e) {
            showToast(e?.response?.data?.message || 'فشل رفع المنع', 'error');
        } finally { setBusy(false); }
    };

    if (loading && !data) return <div className="stories-tab"><p className="stories-empty">جاري التحميل…</p></div>;
    if (!data) return null;

    return (
        <div className="stories-tab">
            <section className="stories-ban">
                <h3>🚫 منع نشر القصص</h3>
                {data.ban ? (
                    <div className="ban-active">
                        <p>ممنوع حتى <b>{formatDateTimeLong(data.ban.until)}</b>{data.ban.reason ? ` — ${data.ban.reason}` : ''}</p>
                        <button disabled={busy} onClick={handleLift}>رفع المنع</button>
                    </div>
                ) : (
                    <div className="ban-form">
                        <label>المدة (أيام)
                            <select value={banForm.days} onChange={e => setBanForm({ ...banForm, days: e.target.value })}>
                                {[1, 3, 7, 14, 30, 90, 365].map(d => <option key={d} value={d}>{d}</option>)}
                            </select>
                        </label>
                        <label className="grow">السبب
                            <input value={banForm.reason} maxLength={300} placeholder="مثلاً: صور مخالفة / ترويج حسابات"
                                   onChange={e => setBanForm({ ...banForm, reason: e.target.value })} />
                        </label>
                        <label className="check">
                            <input type="checkbox" checked={banForm.removeActive}
                                   onChange={e => setBanForm({ ...banForm, removeActive: e.target.checked })} />
                            حذف قصصه النشطة
                        </label>
                        <button className="danger" disabled={busy} onClick={handleBan}>منع</button>
                    </div>
                )}
            </section>

            <section>
                <h3>القصص النشطة ({data.active.length})</h3>
                {data.active.length === 0 ? <p className="stories-empty">لا قصص نشطة</p> : (
                    <div className="stories-grid">
                        {data.active.map(s => <StoryCard key={s._id} story={s} onDelete={busy ? null : handleDelete} onRelease={busy ? null : handleRelease} onOpen={setLightbox} />)}
                    </div>
                )}
            </section>

            <section>
                <h3>القصص المنتهية — للمراجعة ({data.ended.length})</h3>
                <p className="stories-hint">كل قصة منتهية تبقى هنا للمراجعة (صورها في أرشيف المشرف، لا تظهر للمستخدمين).</p>
                {data.ended.length === 0 ? <p className="stories-empty">لا شيء</p> : (
                    <div className="stories-grid">
                        {data.ended.map(s => <StoryCard key={s._id} story={s} onOpen={setLightbox} />)}
                    </div>
                )}
            </section>

            {lightbox && (
                <div className="stories-lightbox" onClick={() => setLightbox(null)}>
                    <img src={lightbox} alt="قصة" />
                </div>
            )}
        </div>
    );
}

// ═══ عارض القصص عند الضغط على صورة المستخدم ═══
// يعرض النشطة؛ إن لم توجد يعرض المنتهية (للمراجعة) مع وسمها. ←/→ للتنقّل، Esc للإغلاق.
export function UserStoriesViewer({ userId, onClose, onChanged }) {
    const { showToast } = useToast();
    const [items, setItems] = useState(null);
    const [index, setIndex] = useState(0);
    const [fromEnded, setFromEnded] = useState(false);

    useEffect(() => {
        let alive = true;
        getUserStories(userId).then(res => {
            if (!alive) return;
            const active = res.data?.active || [];
            const ended = res.data?.ended || [];
            setFromEnded(active.length === 0);
            setItems(active.length ? active : ended);
        }).catch(() => { if (alive) setItems([]); });
        return () => { alive = false; };
    }, [userId]);

    useEffect(() => {
        const onKey = (e) => {
            if (e.key === 'Escape') onClose();
            // RTL: السهم الأيسر = التالي
            if (e.key === 'ArrowLeft') setIndex(i => Math.min(i + 1, (items?.length || 1) - 1));
            if (e.key === 'ArrowRight') setIndex(i => Math.max(i - 1, 0));
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [items, onClose]);

    const story = items?.[index];
    const isText = story?.kind === 'text';
    const src = story ? (story.imageUrl ? getImageUrl(story.imageUrl) : archivedSrc(story.archivedUrl)) : null;
    const bg = story ? (TEXT_BACKGROUNDS[story.background % TEXT_BACKGROUNDS.length] || TEXT_BACKGROUNDS[0]) : null;

    const remove = async () => {
        if (!story || story.status !== 'active') return;
        if (!window.confirm('حذف هذه القصة؟ تختفي فوراً عند كل المستخدمين.')) return;
        try {
            await deleteStoryAdmin(story._id);
            showToast('تم حذف القصة', 'success');
            const next = items.filter(x => x._id !== story._id);
            setItems(next);
            setIndex(i => Math.max(0, Math.min(i, next.length - 1)));
            onChanged && onChanged();
        } catch (e) {
            showToast(e?.response?.data?.message || 'فشل الحذف', 'error');
        }
    };

    return (
        <div className="story-viewer-backdrop" onClick={onClose}>
            <div className="story-viewer" onClick={e => e.stopPropagation()}>
                <div className="story-viewer-bars">
                    {(items || []).map((s, i) => <span key={s._id} className={i <= index ? 'on' : ''} />)}
                </div>
                <button className="story-viewer-close" onClick={onClose} aria-label="إغلاق">✕</button>
                {items === null ? <div className="story-viewer-empty">جاري التحميل…</div>
                    : !story ? <div className="story-viewer-empty">لا توجد قصص لهذا المستخدم</div>
                    : (
                        <>
                            <div className="story-viewer-media"
                                 style={isText ? { background: `linear-gradient(135deg, ${bg[0]}, ${bg[1]})` } : undefined}>
                                {isText ? <span className="story-viewer-text">{story.text}</span>
                                    : src ? <img src={src} alt="قصة" />
                                    : <span className="story-viewer-empty">الملف غير محفوظ</span>}
                            </div>
                            {index > 0 && <button className="story-nav prev" onClick={() => setIndex(index - 1)} aria-label="السابقة">›</button>}
                            {index < items.length - 1 && <button className="story-nav next" onClick={() => setIndex(index + 1)} aria-label="التالية">‹</button>}
                            <div className="story-viewer-meta">
                                {fromEnded && <span className="pill">منتهية — للمراجعة</span>}
                                <span className="pill">{STATUS_LABEL[story.status] || story.status}</span>
                                <span>👁 {story.viewCount}</span>
                                {story.reportCount > 0 && <span className="pill danger">🚩 {story.reportCount}</span>}
                                <span>{formatDateTimeLong(story.createdAt)}</span>
                                {story.status === 'active' && <button className="story-delete" onClick={remove}>🗑️ حذف</button>}
                            </div>
                        </>
                    )}
            </div>
        </div>
    );
}
