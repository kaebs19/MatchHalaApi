import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useToast } from '../components/Toast';
import config, { getImageUrl } from '../config';
import './StickersManagement.css';

const API = `${config.API_URL}/admin/stickers`;

const authHeader = () => ({ Authorization: `Bearer ${localStorage.getItem('token')}` });

const call = async (path, options = {}) => {
    const res = await fetch(`${API}${path}`, {
        ...options,
        headers: {
            ...authHeader(),
            ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' })
        }
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) throw new Error(data.message || 'فشل الطلب');
    return data.data;
};

function StickersManagement() {
    const { showToast } = useToast();
    const [categories, setCategories] = useState([]);
    const [selectedId, setSelectedId] = useState(null);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [newName, setNewName] = useState('');
    const fileInput = useRef(null);

    const load = useCallback(async () => {
        try {
            const data = await call('');
            setCategories(data.categories);
            setSelectedId(current => current || data.categories[0]?._id || null);
        } catch (e) {
            showToast(e.message, 'error');
        } finally {
            setLoading(false);
        }
    }, [showToast]);

    useEffect(() => { load(); }, [load]);

    const run = async (action, success) => {
        setBusy(true);
        try {
            await action();
            if (success) showToast(success, 'success');
            await load();
        } catch (e) {
            showToast(e.message, 'error');
        } finally {
            setBusy(false);
        }
    };

    const selected = categories.find(c => c._id === selectedId);

    const addCategory = () => {
        const name = newName.trim();
        if (!name) return;
        run(async () => {
            await call('/categories', { method: 'POST', body: JSON.stringify({ name }) });
            setNewName('');
        }, 'أُضيفت الفئة');
    };

    const updateCategory = (body) => run(() => call(`/categories/${selected._id}`, { method: 'PUT', body: JSON.stringify(body) }));

    const deleteCategory = () => {
        if (!window.confirm(`حذف فئة «${selected.name}» وكل ملصقاتها نهائياً؟`)) return;
        run(async () => {
            await call(`/categories/${selected._id}`, { method: 'DELETE' });
            setSelectedId(null);
        }, 'حُذفت الفئة');
    };

    const upload = (event) => {
        const files = Array.from(event.target.files || []);
        event.target.value = '';
        if (!files.length) return;
        const form = new FormData();
        files.forEach(file => form.append('images', file));
        run(() => call(`/categories/${selected._id}/items`, { method: 'POST', body: form }), `رُفع ${files.length} ملصق`);
    };

    const toggleSticker = (sticker) => run(() => call(`/items/${sticker._id}`, {
        method: 'PUT',
        body: JSON.stringify({ active: !sticker.active })
    }));

    const deleteSticker = (sticker) => {
        if (!window.confirm('حذف هذا الملصق نهائياً؟')) return;
        run(() => call(`/items/${sticker._id}`, { method: 'DELETE' }), 'حُذف الملصق');
    };

    if (loading) return <div className="stickers-page"><p>جارٍ التحميل…</p></div>;

    return (
        <div className="stickers-page">
            <p className="stickers-hint">
                التعطيل أو الحذف يخفي الملصق من التطبيق فوراً. ما نُشر به في قصة يبقى حتى انتهائها، لأنه مرسوم داخل الصورة.
            </p>

            <div className="stickers-categories">
                {categories.map(c => (
                    <button
                        key={c._id}
                        className={`stickers-chip ${c._id === selectedId ? 'selected' : ''} ${c.active ? '' : 'off'}`}
                        onClick={() => setSelectedId(c._id)}
                    >
                        {c.premium ? '👑 ' : ''}{c.name} ({c.stickers.length})
                    </button>
                ))}
                <span className="stickers-new">
                    <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="فئة جديدة" maxLength={40} />
                    <button disabled={busy || !newName.trim()} onClick={addCategory}>إضافة</button>
                </span>
            </div>

            {selected ? (
                <>
                    <div className="stickers-toolbar">
                        <strong>{selected.name}</strong>
                        <label>
                            <input type="checkbox" checked={selected.active} disabled={busy}
                                onChange={e => updateCategory({ active: e.target.checked })} /> مفعّلة
                        </label>
                        <label>
                            <input type="checkbox" checked={selected.premium} disabled={busy}
                                onChange={e => updateCategory({ premium: e.target.checked })} /> لهلا+ فقط
                        </label>
                        <button disabled={busy} onClick={() => fileInput.current?.click()}>رفع ملصقات</button>
                        <button className="danger" disabled={busy} onClick={deleteCategory}>حذف الفئة</button>
                        <input ref={fileInput} type="file" accept="image/webp,image/png" multiple hidden onChange={upload} />
                    </div>

                    <div className="stickers-grid">
                        {selected.stickers.map(sticker => (
                            <div key={sticker._id} className={`sticker-card ${sticker.active ? '' : 'off'}`}>
                                <img src={getImageUrl(sticker.imageUrl)} alt="" loading="lazy" />
                                <div className="sticker-actions">
                                    <button disabled={busy} onClick={() => toggleSticker(sticker)}>
                                        {sticker.active ? 'تعطيل' : 'تفعيل'}
                                    </button>
                                    <button className="danger" disabled={busy} onClick={() => deleteSticker(sticker)}>حذف</button>
                                </div>
                            </div>
                        ))}
                        {selected.stickers.length === 0 && <p>لا ملصقات في هذه الفئة بعد.</p>}
                    </div>
                </>
            ) : (
                <p>أضف فئة للبدء.</p>
            )}
        </div>
    );
}

export default StickersManagement;
