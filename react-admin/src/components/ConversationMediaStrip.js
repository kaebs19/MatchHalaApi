import React, { useState } from 'react';
import { getMessagePhotoUrl } from '../config';
import { formatDate } from '../utils/formatters';
import './ConversationMediaStrip.css';

// شريط تصفّح أعلى الدردشة: كل الصور والصوتيات والمخالفات في مكان واحد.
// كان على المشرف أن يمرّر المحادثة كاملة ليعثر على صورة أو مخالفة —
// هنا يراها كلها ويقفز إلى موضعها في الدردشة بنقرة.

const TABS = [
    { id: 'images', label: '📷 الصور' },
    { id: 'audio', label: '🎙️ الصوتيات' },
    { id: 'flagged', label: '⚠️ المخالفات' }
];

const STORAGE_KEY = 'admin-media-strip-open';

function ConversationMediaStrip({ images, audios, flagged, onJump, onZoom }) {
    const groups = { images, audio: audios, flagged };
    const firstFilled = TABS.find(t => groups[t.id].length > 0)?.id || 'images';
    const [tab, setTab] = useState(firstFilled);
    const [open, setOpen] = useState(() => {
        try { return localStorage.getItem(STORAGE_KEY) !== 'false'; } catch (e) { return true; }
    });

    const toggle = () => {
        setOpen(prev => {
            const next = !prev;
            try { localStorage.setItem(STORAGE_KEY, String(next)); } catch (e) { /* ignore */ }
            return next;
        });
    };

    const total = images.length + audios.length + flagged.length;
    if (total === 0) return null;

    const items = groups[tab] || [];

    return (
        <div className={`media-strip ${open ? '' : 'collapsed'}`}>
            <div className="media-strip-bar">
                <div className="media-strip-tabs">
                    {TABS.map(t => (
                        <button
                            key={t.id}
                            className={`ms-tab ${tab === t.id ? 'active' : ''} ms-${t.id}`}
                            onClick={() => { setTab(t.id); if (!open) toggle(); }}
                            disabled={groups[t.id].length === 0}
                        >
                            {t.label} <span className="ms-count">{groups[t.id].length}</span>
                        </button>
                    ))}
                </div>
                <button className="ms-toggle" onClick={toggle} title={open ? 'طيّ الشريط' : 'فتح الشريط'}>
                    {open ? '▲' : '▼'}
                </button>
            </div>

            {open && (
                <div className="media-strip-track">
                    {items.length === 0 && <div className="ms-empty">لا شيء هنا</div>}

                    {tab === 'images' && items.map(m => {
                        const src = getMessagePhotoUrl(m);
                        return (
                            <div key={m._id} className="ms-item ms-item-image" title={`${m.sender?.name || 'مستخدم'} — ${formatDate(m.createdAt)}`}>
                                {src ? (
                                    <img src={src} alt="" onClick={() => onZoom({ url: src, sender: m.sender })} />
                                ) : (
                                    <div className="ms-thumb-missing">⏱️<br />غير متوفرة</div>
                                )}
                                {m.isExpiredPhoto && <span className="ms-badge ms-badge-expired">مؤقتة</span>}
                                {m.hasBannedWords && <span className="ms-badge ms-badge-flag">⚠️</span>}
                                <button className="ms-jump" onClick={() => onJump(m._id)}>↩︎ في الدردشة</button>
                            </div>
                        );
                    })}

                    {tab === 'audio' && items.map(m => (
                        <button
                            key={m._id}
                            className="ms-item ms-item-audio"
                            onClick={() => onJump(m._id)}
                            title="القفز إلى الرسالة الصوتية"
                        >
                            <span className="ms-audio-icon">🎙️</span>
                            <span className="ms-audio-meta">
                                <span className="ms-audio-sender">{m.sender?.name || 'مستخدم'}</span>
                                <span className="ms-audio-time">
                                    {m.audioDuration ? `${Math.round(m.audioDuration)} ثانية · ` : ''}
                                    {formatDate(m.createdAt)}
                                </span>
                            </span>
                        </button>
                    ))}

                    {tab === 'flagged' && items.map(m => (
                        <button
                            key={m._id}
                            className="ms-item ms-item-flagged"
                            onClick={() => onJump(m._id)}
                            title="القفز إلى الرسالة المخالفة"
                        >
                            <span className="ms-flag-words">
                                {(m.bannedWordsFound || []).slice(0, 3).map((w, i) => (
                                    <span key={i} className="ms-flag-word">{typeof w === 'string' ? w : (w.word || w.matched || '؟')}</span>
                                ))}
                                {(!m.bannedWordsFound || m.bannedWordsFound.length === 0) && (
                                    <span className="ms-flag-word">مخالفة</span>
                                )}
                            </span>
                            <span className="ms-flag-text">{(m.content || '').slice(0, 60) || (m.type === 'image' ? '📷 صورة' : '—')}</span>
                            <span className="ms-flag-meta">{m.sender?.name || 'مستخدم'} · {formatDate(m.createdAt)}</span>
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

export default ConversationMediaStrip;
