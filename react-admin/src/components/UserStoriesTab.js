// 📸 تبويب «القصص» في صفحة المستخدم: النشطة (مع حذف)، آخر المنتهية (والمؤرشف منها للمُبلَّغ عنها)،
// ومنع النشر لفترة. الخلفيات تطابق ترتيب التطبيق (StoryTextBackgrounds) — 8 خلفيات.
import React, { useEffect, useState, useCallback } from 'react';
import { getUserStories, deleteStoryAdmin, banUserStories, liftStoryBan } from '../services/api';
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

function StoryCard({ story, onDelete, onOpen }) {
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
            </div>
            <div className="story-meta">
                <span>{STATUS_LABEL[story.status] || story.status}</span>
                <span>👁 {story.viewCount}</span>
            </div>
            <div className="story-date">{formatDateTimeLong(story.createdAt)}</div>
            {story.status === 'active' && onDelete && (
                <button className="story-delete" onClick={() => onDelete(story)}>🗑️ حذف</button>
            )}
        </div>
    );
}

export default function UserStoriesTab({ userId }) {
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
        } catch (e) {
            showToast(e?.response?.data?.message || 'فشل جلب القصص', 'error');
        } finally {
            setLoading(false);
        }
    }, [userId, showToast]);

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
                        {data.active.map(s => <StoryCard key={s._id} story={s} onDelete={busy ? null : handleDelete} onOpen={setLightbox} />)}
                    </div>
                )}
            </section>

            <section>
                <h3>آخر القصص المنتهية ({data.ended.length})</h3>
                <p className="stories-hint">صور المنتهية لا تُحفظ إلا للمُبلَّغ عنها (أرشيف للمشرف).</p>
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
