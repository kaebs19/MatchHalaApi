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

    // ↕️ الترتيب: تحديث فوري في الصفحة ثم حفظ (وعند الفشل إعادة التحميل)
    const [drag, setDrag] = useState(null); // { kind: 'cat'|'sticker', id }
    const moveInArray = (arr, from, to) => {
        const copy = [...arr];
        const [item] = copy.splice(from, 1);
        copy.splice(to, 0, item);
        return copy;
    };
    const saveCategoryOrder = async (list) => {
        setCategories(list);
        try {
            await call('/categories/order', { method: 'PUT', body: JSON.stringify({ ids: list.map(c => c._id) }) });
        } catch (e) { showToast(e.message, 'error'); load(); }
    };
    const saveStickerOrder = async (list) => {
        setCategories(prev => prev.map(c => (c._id === selected._id ? { ...c, stickers: list } : c)));
        try {
            await call(`/categories/${selected._id}/order`, { method: 'PUT', body: JSON.stringify({ ids: list.map(s => s._id) }) });
        } catch (e) { showToast(e.message, 'error'); load(); }
    };
    const moveCategory = (delta) => {
        const from = categories.findIndex(c => c._id === selectedId);
        const to = from + delta;
        if (from < 0 || to < 0 || to >= categories.length) return;
        saveCategoryOrder(moveInArray(categories, from, to));
    };
    const moveSticker = (index, delta) => {
        const to = index + delta;
        if (to < 0 || to >= selected.stickers.length) return;
        saveStickerOrder(moveInArray(selected.stickers, index, to));
    };
    const dropOn = (kind, targetId) => {
        if (!drag || drag.kind !== kind || drag.id === targetId) return setDrag(null);
        if (kind === 'cat') {
            const from = categories.findIndex(c => c._id === drag.id);
            const to = categories.findIndex(c => c._id === targetId);
            if (from >= 0 && to >= 0) saveCategoryOrder(moveInArray(categories, from, to));
        } else {
            const list = selected.stickers;
            const from = list.findIndex(s => s._id === drag.id);
            const to = list.findIndex(s => s._id === targetId);
            if (from >= 0 && to >= 0) saveStickerOrder(moveInArray(list, from, to));
        }
        setDrag(null);
    };

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
                <br />↕️ الترتيب: اسحب الفئات والملصقات وأفلتها، أو استعمل أزرار التقديم والتأخير — يُحفظ فوراً ويصل التطبيق خلال 5 دقائق.
            </p>

            <div className="stickers-categories">
                {categories.map(c => (
                    <button
                        key={c._id}
                        className={`stickers-chip ${c._id === selectedId ? 'selected' : ''} ${c.active ? '' : 'off'} ${drag?.kind === 'cat' && drag.id === c._id ? 'dragging' : ''}`}
                        onClick={() => setSelectedId(c._id)}
                        draggable={!busy}
                        onDragStart={() => setDrag({ kind: 'cat', id: c._id })}
                        onDragOver={e => e.preventDefault()}
                        onDrop={() => dropOn('cat', c._id)}
                        onDragEnd={() => setDrag(null)}
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
                        <span className="stickers-order">
                            <button disabled={busy || categories[0]?._id === selected._id} onClick={() => moveCategory(-1)} title="تقديم الفئة">→ تقديم</button>
                            <button disabled={busy || categories[categories.length - 1]?._id === selected._id} onClick={() => moveCategory(1)} title="تأخير الفئة">تأخير ←</button>
                        </span>
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
                        {selected.stickers.map((sticker, index) => (
                            <div key={sticker._id}
                                className={`sticker-card ${sticker.active ? '' : 'off'} ${drag?.kind === 'sticker' && drag.id === sticker._id ? 'dragging' : ''}`}
                                draggable={!busy}
                                onDragStart={() => setDrag({ kind: 'sticker', id: sticker._id })}
                                onDragOver={e => e.preventDefault()}
                                onDrop={() => dropOn('sticker', sticker._id)}
                                onDragEnd={() => setDrag(null)}
                            >
                                <img src={getImageUrl(sticker.imageUrl)} alt={sticker.name || ''} title={sticker.name || ''} loading="lazy" draggable={false} />
                                {sticker.name && <span className="sticker-name">{sticker.name}</span>}
                                <div className="sticker-actions sticker-move">
                                    <button disabled={busy || index === 0} onClick={() => moveSticker(index, -1)} aria-label="تقديم">→</button>
                                    <span>{index + 1}</span>
                                    <button disabled={busy || index === selected.stickers.length - 1} onClick={() => moveSticker(index, 1)} aria-label="تأخير">←</button>
                                </div>
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
