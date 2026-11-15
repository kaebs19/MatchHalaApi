// 🎲 هلا لودو — قسم مستقل في اللوحة (كان تبويباً داخل «ألعاب المحادثة»)
// التبويبات: نظرة عامة · اللاعبون · المباريات · الإعدادات والجوائز (LudoSettings)
// المصدر: /api/admin/games/ludo/{overview,players,matches,matches/:id,config,…} — routes/adminGames.js
// التبويب في الرابط (#/ludo?tab=players) فيعود إليه التحديث والرجوع.
import React, { useState, useEffect, useCallback } from 'react';
import { useToast } from '../components/Toast';
import config, { getImageUrl, getDefaultAvatar } from '../config';
import LudoSettings from './LudoSettings';
import './Ludo.css';

const API = `${config.API_URL}/admin/games`;
const call = async (path, options = {}) => {
    const res = await fetch(`${API}${path}`, {
        ...options,
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` }
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) throw new Error(data.message || 'فشل الطلب');
    return data.data;
};

const fmt = (n) => Number(n || 0).toLocaleString('en-US');
const short = (n) => {
    const a = Math.abs(n || 0);
    if (a >= 1e6) return `${+(n / 1e6).toFixed(1)}M`;
    if (a >= 1e3) return `${+(n / 1e3).toFixed(1)}K`;
    return String(n || 0);
};
const when = (d) => (d ? new Date(d).toLocaleString('ar', { dateStyle: 'medium', timeStyle: 'short' }) : '—');

const LEAGUES = {
    bronze: { title: 'برونز', icon: '🥉', color: '#C77B3B' },
    silver: { title: 'فضة', icon: '🥈', color: '#8E9AAF' },
    gold: { title: 'ذهب', icon: '🥇', color: '#E0A800' },
    friendly: { title: 'ودّي', icon: '🤝', color: '#7446EE' }
};
const SOURCES = {
    queue: '🔎 بحث عن خصم', solo: '🤖 ضدّ الكمبيوتر', room: '🚪 غرفة خاصة', invite: '💬 دعوة محادثة', challenge: '⚔️ تحدٍّ مباشر'
};
const TIERS = { bronze: '🥉 برونز', silver: '🥈 فضة', gold: '🥇 ذهب' };
const GAMES_TAB_LABELS = {
    off: { title: 'مخفي', hint: 'لا يظهر التبويب لأحد' },
    admins: { title: 'المشرفون فقط', hint: 'للتجربة على الإنتاج' },
    all: { title: 'الجميع', hint: 'لكل المستخدمين (النسخ التي تدعمه)' }
};
const TABS = [
    { id: 'overview', icon: '📊', label: 'نظرة عامة' },
    { id: 'players', icon: '👥', label: 'اللاعبون' },
    { id: 'matches', icon: '🎮', label: 'المباريات' },
    { id: 'settings', icon: '⚙️', label: 'الإعدادات والجوائز' }
];

function Avatar({ name, photo, size = 32 }) {
    return (
        <img className="lx-avatar" style={{ width: size, height: size }} alt=""
            src={photo ? getImageUrl(photo) : getDefaultAvatar(name)}
            onError={(e) => { e.target.onerror = null; e.target.src = getDefaultAvatar(name); }} />
    );
}

// ─────────────────────────── نظرة عامة ───────────────────────────
function Overview({ onOpenUser }) {
    const { showToast } = useToast();
    const [days, setDays] = useState(14);
    const [d, setD] = useState(null);
    const [tab, setTab] = useState(null);

    const load = useCallback(async () => {
        try {
            const [o, t] = await Promise.all([call(`/ludo/overview?days=${days}`), call('/tab')]);
            setD(o); setTab(t);
        } catch (e) { showToast(e.message, 'error'); }
    }, [days, showToast]);
    useEffect(() => { load(); }, [load]);
    // الحيّ الآن يتحدّث كل 30ث ما دامت الصفحة مفتوحة
    useEffect(() => { const t = setInterval(load, 30000); return () => clearInterval(t); }, [load]);

    const changeGamesTab = async (mode) => {
        if (!tab || mode === tab.gamesTab) return;
        if (mode === 'all' && !window.confirm('إظهار قسم الألعاب لكل المستخدمين؟ يصلهم خلال دقيقة.')) return;
        try {
            const r = await call('/tab', { method: 'PUT', body: JSON.stringify({ gamesTab: mode }) });
            setTab({ ...tab, gamesTab: r.gamesTab });
            showToast('تم الحفظ — يسري على التطبيق خلال دقيقة', 'success');
        } catch (e) { showToast(e.message, 'error'); }
    };

    if (!d) return <div className="lx-empty">جارٍ التحميل…</div>;
    const max = Math.max(1, ...d.perDay.map(x => x.total));
    const bot = d.bot.league;
    const botWarn = bot && bot.total >= 20 && bot.humanWinRate < 40;
    const purchasesTotal = d.purchases.reduce((a, p) => a + p.n, 0);
    const refunds = d.purchases.reduce((a, p) => a + p.refunded, 0);
    const invitesTotal = Object.values(d.invites || {}).reduce((a, b) => a + b, 0);
    const sourcesTotal = Object.values(d.sources).reduce((a, b) => a + b, 0) || 1;

    return (
        <div className="lx-overview">
            <div className="lx-toolbar">
                <div className="lx-live">
                    <span className="lx-dot" />
                    <b>الآن:</b> {fmt(d.live.games)} مباراة جارية · {fmt(d.live.queue)} في الطابور
                </div>
                <div className="lx-range">
                    {[7, 14, 30, 90].map(n => (
                        <button key={n} className={n === days ? 'active' : ''} onClick={() => setDays(n)}>{n} يوماً</button>
                    ))}
                </div>
            </div>

            <div className="lx-kpis">
                <div className="lx-kpi"><span>🎮</span><b>{fmt(d.matches.range)}</b><small>مباراة في المدة · {fmt(d.matches.all)} إجمالاً</small></div>
                <div className="lx-kpi"><span>👥</span><b>{fmt(d.players.range)}</b><small>لاعب نشط · {fmt(d.players.newInRange)} جديد</small></div>
                <div className="lx-kpi"><span>⏱️</span><b>{d.matches.avgMinutes ?? '—'}<em> د</em></b><small>متوسط مدة المباراة{d.matches.avgRolls ? ` · ${d.matches.avgRolls} رمية` : ''}</small></div>
                <div className={`lx-kpi ${botWarn ? 'warn' : ''}`}>
                    <span>🤖</span><b>{bot ? `${bot.humanWinRate}%` : '—'}</b>
                    <small>فوز البشر ضدّ البوت (دوري{bot ? ` · ${bot.total} مباراة` : ''})</small>
                </div>
                <div className="lx-kpi"><span>🪙</span><b>{short(d.economy.coins)}</b><small>عملات لدى اللاعبين</small></div>
                <div className="lx-kpi"><span>💎</span><b>{fmt(d.economy.gems)}</b><small>جواهر لدى اللاعبين</small></div>
                <div className="lx-kpi"><span>🛒</span><b>{fmt(purchasesTotal)}</b><small>عملية شراء{refunds ? ` · ${refunds} مستردّة` : ''}</small></div>
                <div className="lx-kpi"><span>🚩</span><b>{fmt(d.chatReports)}</b><small>بلاغ من دردشة المباراة</small></div>
            </div>

            <section className="lx-card">
                <div className="lx-card-head">
                    <h3>📈 المباريات يومياً</h3>
                    <div className="lx-legend">
                        {['friendly', 'bronze', 'silver', 'gold'].map(k => (
                            <span key={k}><i style={{ background: LEAGUES[k].color }} />{LEAGUES[k].title}</span>
                        ))}
                    </div>
                </div>
                <div className="lx-bars">
                    {d.perDay.map(x => (
                        <div key={x.day} className="lx-bar"
                            title={`${x.day}: ${x.total} — ودّي ${x.friendly} · برونز ${x.bronze} · فضة ${x.silver} · ذهب ${x.gold}`}>
                            <em>{x.total || ''}</em>
                            <div className="lx-stack" style={{ height: `${(x.total / max) * 100}%` }}>
                                {['gold', 'silver', 'bronze', 'friendly'].map(k => x[k] > 0 && (
                                    <i key={k} style={{ flex: x[k], background: LEAGUES[k].color }} />
                                ))}
                            </div>
                            <small>{x.day.slice(5).replace('-', '/')}</small>
                        </div>
                    ))}
                </div>
            </section>

            <div className="lx-grid2">
                <section className="lx-card">
                    <h3>🏟️ الدوريات</h3>
                    <div className="lx-leagues">
                        {['bronze', 'silver', 'gold'].map(k => {
                            const l = d.leagues[k] || { n: 0, fees: 0 };
                            return (
                                <div key={k} className="lx-league" style={{ borderColor: LEAGUES[k].color }}>
                                    <span>{LEAGUES[k].icon} {LEAGUES[k].title}</span>
                                    <b>{fmt(l.n)}</b><small>مباراة</small>
                                    <em>{short(l.fees)} 🪙 رسوم دخول</em>
                                </div>
                            );
                        })}
                    </div>
                    <p className="lx-note">الرسوم عملات لعب فقط — مجموع ما دُفع للدخول في المدة (يذهب جوائزَ للفائزين).</p>
                </section>

                <section className="lx-card">
                    <h3>🧭 من أين تبدأ المباريات</h3>
                    <div className="lx-sources">
                        {Object.entries(SOURCES).map(([k, label]) => {
                            const n = d.sources[k] || 0;
                            return (
                                <div key={k} className="lx-source">
                                    <span>{label}</span>
                                    <div><i style={{ width: `${(n / sourcesTotal) * 100}%` }} /></div>
                                    <b>{fmt(n)}</b>
                                </div>
                            );
                        })}
                    </div>
                    <p className="lx-note">دعوات المحادثة آخر ٧ أيام: {fmt(invitesTotal)}
                        {d.invites?.finished ? ` · لُعبت ${fmt((d.invites.finished || 0) + (d.invites.playing || 0))}` : ''}
                        {d.invites?.expired ? ` · انتهت بلا ردّ ${fmt(d.invites.expired)}` : ''}
                        {d.invites?.declined ? ` · اعتُذر ${fmt(d.invites.declined)}` : ''}</p>
                </section>
            </div>

            <div className="lx-grid2">
                <section className={`lx-card ${botWarn ? 'warn' : ''}`}>
                    <h3>🤖 عدالة البوت</h3>
                    {['league', 'friendly'].map(k => {
                        const r = d.bot[k];
                        return (
                            <div key={k} className="lx-bot">
                                <span>{k === 'league' ? 'الدوري (برسوم)' : 'الودّي'}</span>
                                <div className="lx-meter"><i style={{ width: `${r ? r.humanWinRate : 0}%` }} /><b style={{ insetInlineStart: '50%' }} /></div>
                                <em>{r ? `${r.humanWinRate}% من ${r.total}` : 'لا بيانات'}</em>
                            </div>
                        );
                    })}
                    <p className="lx-note">المتوقّع قرابة 50%. تحت 40% في الدوري (بعد 20 مباراة فأكثر) = البوت أقوى من اللازم واللاعب يخسر رسومه أمامه.</p>
                </section>

                <section className="lx-card">
                    <h3>🛒 المشتريات والهدايا</h3>
                    {d.purchases.length === 0 ? <p className="lx-note">لا مشتريات في المدة.</p> : (
                        <table className="lx-table compact">
                            <thead><tr><th>المنتج</th><th>العدد</th><th>منح</th><th>مستردّ</th></tr></thead>
                            <tbody>
                                {d.purchases.map(p => (
                                    <tr key={p.productId}>
                                        <td>{p.productId.replace('com.app.hala.ludo.', '')}</td>
                                        <td>{fmt(p.n)}</td>
                                        <td>{[p.gems ? `${fmt(p.gems)} 💎` : null, p.coins ? `${short(p.coins)} 🪙` : null].filter(Boolean).join(' · ')}</td>
                                        <td>{p.refunded || '—'}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                    <p className="lx-note">🎁 هدية الإطلاق: استلمها {fmt(d.economy.giftClaimed)}{d.economy.giftBlocked ? ` · رُفض ${fmt(d.economy.giftBlocked)} (جهاز استلمها بحساب آخر)` : ''}</p>
                </section>
            </div>

            <div className="lx-grid2">
                <section className="lx-card">
                    <h3>🏆 الأكثر فوزاً (الدوري، كل الوقت)</h3>
                    {d.topWinners.length === 0 ? <p className="lx-note">لا انتصارات بعد.</p> : d.topWinners.map((w, i) => (
                        <button key={w.id || i} className="lx-person" onClick={() => w.id && onOpenUser(w.id)}>
                            <span className="rank">{['🥇', '🥈', '🥉'][i] || `#${i + 1}`}</span>
                            <Avatar name={w.name} photo={w.photo} />
                            <span className="name">{w.name}</span>
                            <span className="meta">{fmt(w.wins)} فوز من {fmt(w.played)} · {fmt(w.points)} ⭐</span>
                        </button>
                    ))}
                </section>

                {tab && (
                    <section className="lx-card">
                        <h3>👁️ من يرى تبويب «الألعاب» في التطبيق</h3>
                        <div className="lx-modes">
                            {tab.modes.map(mode => (
                                <button key={mode} className={tab.gamesTab === mode ? `active mode-${mode}` : ''} onClick={() => changeGamesTab(mode)}>
                                    <b>{GAMES_TAB_LABELS[mode]?.title || mode}</b>
                                    <span>{GAMES_TAB_LABELS[mode]?.hint}</span>
                                </button>
                            ))}
                        </div>
                        <p className="lx-note">اللاعبون في المحافظ: {fmt(d.players.all)} — من فتح اللعبة مرة على الأقل.</p>
                    </section>
                )}
            </div>
        </div>
    );
}

// ─────────────────────────── اللاعبون ───────────────────────────
const PLAYER_SORTS = [
    { id: 'points', label: 'النجوم' }, { id: 'week', label: 'نجوم الأسبوع' }, { id: 'wins', label: 'الانتصارات' },
    { id: 'played', label: 'المباريات' }, { id: 'coins', label: 'العملات' }, { id: 'gems', label: 'الجواهر' }, { id: 'newest', label: 'الأحدث' }
];

function Players({ onOpenUser, onShowMatches }) {
    const { showToast } = useToast();
    const [q, setQ] = useState('');
    const [query, setQuery] = useState('');
    const [sort, setSort] = useState('points');
    const [page, setPage] = useState(1);
    const [d, setD] = useState(null);

    useEffect(() => { const t = setTimeout(() => { setQuery(q.trim()); setPage(1); }, 350); return () => clearTimeout(t); }, [q]);
    useEffect(() => {
        call(`/ludo/players?sort=${sort}&page=${page}&q=${encodeURIComponent(query)}`).then(setD).catch(e => showToast(e.message, 'error'));
    }, [sort, page, query, showToast]);

    return (
        <section className="lx-card">
            <div className="lx-filters">
                <input className="lx-search" placeholder="🔍 ابحث بالاسم أو المعرّف…" value={q} onChange={e => setQ(e.target.value)} />
                <select value={sort} onChange={e => { setSort(e.target.value); setPage(1); }}>
                    {PLAYER_SORTS.map(s => <option key={s.id} value={s.id}>ترتيب: {s.label}</option>)}
                </select>
                {d && <span className="lx-count">{fmt(d.total)} لاعب</span>}
            </div>
            {!d ? <div className="lx-empty">جارٍ التحميل…</div> : d.rows.length === 0 ? <div className="lx-empty">لا نتائج</div> : (
                <div className="lx-table-wrap">
                    <table className="lx-table">
                        <thead>
                            <tr><th>اللاعب</th><th>المرتبة</th><th>⭐ النجوم</th><th>الأسبوع</th><th>دوري</th><th>نسبة الفوز</th><th>ودّي</th><th>🪙</th><th>💎</th><th>🎁</th><th /></tr>
                        </thead>
                        <tbody>
                            {d.rows.map(r => (
                                <tr key={r.id || r.name} className={r.inactive ? 'inactive' : ''}>
                                    <td>
                                        <button className="lx-person inline" onClick={() => r.id && onOpenUser(r.id)}>
                                            <Avatar name={r.name} photo={r.photo} size={30} />
                                            <span className="name">{r.name}{r.inactive && <small> (موقوف)</small>}</span>
                                        </button>
                                    </td>
                                    <td>{TIERS[r.tier] || '—'}</td>
                                    <td>{fmt(r.points)}</td>
                                    <td>{r.weekPoints ? fmt(r.weekPoints) : '—'}</td>
                                    <td>{fmt(r.wins)}/{fmt(r.played)}</td>
                                    <td>{r.played ? `${Math.round((r.wins / r.played) * 100)}%` : '—'}</td>
                                    <td>{fmt(r.friendlyPlayed)}</td>
                                    <td title={fmt(r.coins)}>{short(r.coins)}</td>
                                    <td>{fmt(r.gems)}</td>
                                    <td>{r.launchGift === 'claimed' ? '✅' : r.launchGift === 'blocked' ? '⛔' : ''}</td>
                                    <td><button className="lx-link" onClick={() => r.id && onShowMatches(r)}>مبارياته ←</button></td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
            {d && d.pages > 1 && (
                <div className="lx-pager">
                    <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}>السابق</button>
                    <span>{page} / {d.pages}</span>
                    <button disabled={page >= d.pages} onClick={() => setPage(p => p + 1)}>التالي</button>
                </div>
            )}
        </section>
    );
}

// ─────────────────────────── المباريات ───────────────────────────
function MatchDetail({ gameId, onClose, onOpenUser }) {
    const [m, setM] = useState(null);
    const { showToast } = useToast();
    useEffect(() => { call(`/ludo/matches/${gameId}`).then(setM).catch(e => showToast(e.message, 'error')); }, [gameId, showToast]);
    return (
        <div className="lx-modal" onClick={onClose}>
            <div className="lx-modal-body" onClick={e => e.stopPropagation()}>
                <button className="lx-close" onClick={onClose}>✕</button>
                {!m ? <div className="lx-empty">جارٍ التحميل…</div> : (
                    <>
                        <h3>🎮 مباراة {m.gameId}</h3>
                        <p className="lx-note">
                            {LEAGUES[m.league || 'friendly'].icon} {LEAGUES[m.league || 'friendly'].title}
                            {m.fee ? ` · رسوم ${short(m.fee)} · جائزة ${short(m.prize)}` : ''} · {SOURCES[m.source] || m.source}
                            {' · '}{when(m.endedAt)}{m.minutes ? ` · ${m.minutes} د` : ''}{m.linkedPlayers ? ' · ⚠️ حسابات على جهاز واحد' : ''}
                        </p>
                        <div className="lx-players">
                            {m.players.map((p, i) => (
                                <button key={i} className={`lx-chip ${p.winner ? 'win' : ''}`} onClick={() => p.id && onOpenUser(p.id)}>
                                    <i style={{ background: p.color }} />
                                    {p.isBot ? '🤖' : <Avatar name={p.name} photo={p.photo} size={22} />}
                                    {p.name}{p.winner ? ' 👑' : ''}{p.left ? ' (انسحب)' : ''}{p.takenOver ? ' (تولّاه البوت)' : ''}
                                </button>
                            ))}
                        </div>
                        <h4>💬 الدردشة ({m.chatLines.length})</h4>
                        {m.chatLines.length === 0 ? <p className="lx-note">لا رسائل.</p> : (
                            <div className="lx-chat">
                                {m.chatLines.map((l, i) => (
                                    <div key={i}><b>{l.name}</b><span>{l.text}</span><small>{l.at ? new Date(l.at).toLocaleTimeString('ar', { timeStyle: 'short' }) : ''}</small></div>
                                ))}
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}

function Matches({ userFilter, onClearUser, onOpenUser }) {
    const { showToast } = useToast();
    const [league, setLeague] = useState('');
    const [source, setSource] = useState('');
    const [page, setPage] = useState(1);
    const [d, setD] = useState(null);
    const [open, setOpen] = useState(null);

    useEffect(() => { setPage(1); }, [league, source, userFilter]);
    useEffect(() => {
        const qs = new URLSearchParams({ page, ...(league ? { league } : {}), ...(source ? { source } : {}), ...(userFilter ? { user: userFilter.id } : {}) });
        call(`/ludo/matches?${qs}`).then(setD).catch(e => showToast(e.message, 'error'));
    }, [league, source, page, userFilter, showToast]);

    return (
        <section className="lx-card">
            <div className="lx-filters">
                <select value={league} onChange={e => setLeague(e.target.value)}>
                    <option value="">كل الأنواع</option>
                    {Object.entries(LEAGUES).map(([k, l]) => <option key={k} value={k}>{l.icon} {l.title}</option>)}
                </select>
                <select value={source} onChange={e => setSource(e.target.value)}>
                    <option value="">كل المصادر</option>
                    {Object.entries(SOURCES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
                {userFilter && <button className="lx-tag" onClick={onClearUser}>👤 {userFilter.name} ✕</button>}
                {d && <span className="lx-count">{fmt(d.total)} مباراة</span>}
            </div>
            {!d ? <div className="lx-empty">جارٍ التحميل…</div> : d.rows.length === 0 ? <div className="lx-empty">لا مباريات</div> : (
                <div className="lx-table-wrap">
                    <table className="lx-table">
                        <thead><tr><th>الوقت</th><th>النوع</th><th>المصدر</th><th>اللاعبون</th><th>المدة</th><th>💬</th></tr></thead>
                        <tbody>
                            {d.rows.map(m => (
                                <tr key={m.gameId} className="clickable" onClick={() => setOpen(m.gameId)}>
                                    <td>{when(m.endedAt)}</td>
                                    <td>{LEAGUES[m.league || 'friendly'].icon} {LEAGUES[m.league || 'friendly'].title}{m.fee ? ` · ${short(m.fee)}` : ''}</td>
                                    <td>{SOURCES[m.source] || m.source}</td>
                                    <td>
                                        <div className="lx-players">
                                            {m.players.map((p, i) => (
                                                <span key={i} className={`lx-chip ${p.winner ? 'win' : ''}`}>
                                                    <i style={{ background: p.color }} />{p.isBot ? '🤖' : p.name}{p.winner ? ' 👑' : ''}{p.left ? ' ↩︎' : ''}
                                                </span>
                                            ))}
                                        </div>
                                    </td>
                                    <td>{m.minutes ? `${m.minutes} د` : '—'}</td>
                                    <td>{m.chat || ''}{m.linkedPlayers ? ' ⚠️' : ''}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
            {d && d.pages > 1 && (
                <div className="lx-pager">
                    <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}>السابق</button>
                    <span>{page} / {d.pages}</span>
                    <button disabled={page >= d.pages} onClick={() => setPage(p => p + 1)}>التالي</button>
                </div>
            )}
            {open && <MatchDetail gameId={open} onClose={() => setOpen(null)} onOpenUser={onOpenUser} />}
        </section>
    );
}

// ─────────────────────────── الصفحة ───────────────────────────
function Ludo({ initialTab, onTabChange, onViewUserDetail }) {
    const [tab, setTab] = useState(TABS.some(t => t.id === initialTab) ? initialTab : 'overview');
    const [userFilter, setUserFilter] = useState(null);
    const go = (t) => { setTab(t); onTabChange?.(t); };
    const openUser = (id) => onViewUserDetail?.(id);

    return (
        <div className="lx-page">
            <div className="lx-header">
                <h1>🎲 هلا لودو</h1>
                <p>اللعبة واقتصادها ولاعبوها ومبارياتها — والإعدادات والجوائز</p>
            </div>
            <div className="lx-tabs">
                {TABS.map(t => (
                    <button key={t.id} className={tab === t.id ? 'active' : ''} onClick={() => go(t.id)}>{t.icon} {t.label}</button>
                ))}
            </div>
            {tab === 'overview' && <Overview onOpenUser={openUser} />}
            {tab === 'players' && <Players onOpenUser={openUser} onShowMatches={(r) => { setUserFilter({ id: r.id, name: r.name }); go('matches'); }} />}
            {tab === 'matches' && <Matches userFilter={userFilter} onClearUser={() => setUserFilter(null)} onOpenUser={openUser} />}
            {tab === 'settings' && <LudoSettings />}
        </div>
    );
}

export default Ludo;
