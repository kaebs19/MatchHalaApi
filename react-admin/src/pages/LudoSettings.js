// 🎲 هلا لودو — الإعدادات والجوائز (تبويب في «الألعاب»)
// المصدر: GET/PUT /api/admin/games/ludo/config ← utils/ludo/config.js (يُطبَّق على كل نسخ الخادم خلال دقيقة، بلا نشر).
// كل حفظ يُسجَّل في «سجلّ الإشراف» تلقائياً (adminOnly).
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useToast } from '../components/Toast';
import config from '../config';

const API = `${config.API_URL}/admin/games/ludo`;
const call = async (path, options = {}) => {
    const res = await fetch(`${API}${path}`, {
        ...options,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` }
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) {
        const err = new Error(data.message || 'فشل الطلب');
        err.errors = data.errors;
        throw err;
    }
    return data.data;
};

const LEAGUES = [
    { id: 'bronze', title: 'دوري البرونز', icon: '🥉' },
    { id: 'silver', title: 'دوري الفضة', icon: '🥈' },
    { id: 'gold', title: 'دوري الذهب', icon: '🥇' }
];
const MISSIONS = {
    play3: 'العب مباريات',
    win1: 'فُز بمباريات',
    capture3: 'كُل قطعاً للخصم',
    friend1: 'العب مع صديق'
};
// اقتراح الجوائز (المالك ١٤ نوفمبر: «مليون عملة + ألف جوهرة» للأول) — يملأ الجدول فقط، الحفظ بزرّه
const SUGGESTED_PRIZES = [
    [1000000, 1000], [500000, 500], [250000, 250], [100000, 100], [100000, 100],
    [50000, 50], [50000, 50], [50000, 50], [50000, 50], [50000, 50]
].map(([coins, gems]) => ({ coins, gems }));

const fmt = (n) => Number(n || 0).toLocaleString('en-US');
const short = (n) => {
    const a = Math.abs(n);
    if (a >= 1e6) return `${+(n / 1e6).toFixed(1)}M`;
    if (a >= 1e3) return `${+(n / 1e3).toFixed(1)}K`;
    return String(n);
};

function NumberField({ label, value, onChange, suffix, min = 0, hint }) {
    return (
        <label className="ludo-field">
            <span>{label}</span>
            <div className="ludo-input">
                <input
                    type="number" inputMode="numeric" min={min} step="1"
                    value={value ?? ''}
                    onChange={e => onChange(e.target.value === '' ? '' : Number(e.target.value))}
                />
                {suffix && <em>{suffix}</em>}
            </div>
            {hint && <small>{hint}</small>}
        </label>
    );
}

function LudoSettings() {
    const { showToast } = useToast();
    const [cfg, setCfg] = useState(null);
    const [saved, setSaved] = useState(null);
    const [meta, setMeta] = useState({});
    const [defaults, setDefaults] = useState(null);
    const [errors, setErrors] = useState([]);
    const [saving, setSaving] = useState(false);
    const [standings, setStandings] = useState(null);
    const [seasons, setSeasons] = useState([]);

    const load = useCallback(async () => {
        try {
            const [c, s, h] = await Promise.all([call('/config'), call('/standings'), call('/seasons')]);
            setCfg(c.config); setSaved(c.config); setDefaults(c.defaults);
            setMeta({ updatedAt: c.updatedAt, refreshMs: c.refreshMs });
            setStandings(s); setSeasons(h);
        } catch (e) {
            showToast(e.message, 'error');
        }
    }, [showToast]);
    useEffect(() => { load(); }, [load]);

    const dirty = useMemo(() => JSON.stringify(cfg) !== JSON.stringify(saved), [cfg, saved]);
    const set = (path, value) => setCfg(prev => {
        const next = JSON.parse(JSON.stringify(prev));
        let o = next;
        for (let i = 0; i < path.length - 1; i++) o = o[path[i]];
        o[path[path.length - 1]] = value;
        return next;
    });

    const save = async () => {
        setSaving(true); setErrors([]);
        try {
            const r = await call('/config', { method: 'PUT', body: JSON.stringify({ config: cfg }) });
            setCfg(r.config); setSaved(r.config); setMeta(m => ({ ...m, updatedAt: r.updatedAt }));
            showToast('حُفظت الإعدادات — تصل كل الخوادم خلال دقيقة', 'success');
            setStandings(await call('/standings'));
        } catch (e) {
            setErrors(e.errors || [e.message]);
            showToast('لم تُحفظ — راجع الأخطاء', 'error');
        } finally {
            setSaving(false);
        }
    };

    if (!cfg) return <div className="games-empty">جارٍ التحميل…</div>;

    const totals = cfg.weeklyPrizes.reduce((a, p) => ({ coins: a.coins + (Number(p.coins) || 0), gems: a.gems + (Number(p.gems) || 0) }), { coins: 0, gems: 0 });
    const winsForFee = (fee) => (cfg.startCoins > 0 ? Math.floor(cfg.startCoins / fee) : 0);

    return (
        <div className="ludo-settings">
            {/* شريط الحفظ — ثابت أعلى الصفحة حين يوجد تعديل */}
            <div className={`ludo-savebar ${dirty ? 'dirty' : ''}`}>
                <div>
                    <b>{dirty ? 'تعديلات غير محفوظة' : 'الإعدادات محفوظة'}</b>
                    <span>
                        {meta.updatedAt ? `آخر حفظ: ${new Date(meta.updatedAt).toLocaleString('ar')}` : 'القيم الافتراضية من الكود'}
                        {' · '}تُطبَّق على المباريات الجديدة، والجارية تحتفظ برسومها
                    </span>
                </div>
                <div className="ludo-savebar-actions">
                    <button className="btn-ghost" disabled={!dirty || saving} onClick={() => { setCfg(saved); setErrors([]); }}>تراجع</button>
                    <button className="btn-primary" disabled={!dirty || saving} onClick={save}>{saving ? 'جارٍ الحفظ…' : '💾 حفظ'}</button>
                </div>
            </div>

            {errors.length > 0 && (
                <div className="ludo-errors">
                    {errors.map((e, i) => <div key={i}>⚠️ {e}</div>)}
                </div>
            )}

            {/* ── جوائز الأسبوع ── */}
            <section className="ludo-section">
                <div className="ludo-section-head">
                    <div>
                        <h3>🏆 جوائز أفضل 10 أسبوعياً</h3>
                        <p>تُوزَّع تلقائياً بعد نهاية الأسبوع (الاثنين 00:00 UTC) لأعلى 10 بنجوم الأسبوع، ويصل الفائز إشعار.</p>
                    </div>
                    <button className="btn-ghost" onClick={() => set(['weeklyPrizes'], SUGGESTED_PRIZES.map(p => ({ ...p })))}>
                        ✨ املأ بالمقترح
                    </button>
                </div>
                <div className="ludo-prizes">
                    <div className="ludo-prize-row head"><span>المركز</span><span>عملات</span><span>جواهر</span></div>
                    {cfg.weeklyPrizes.map((p, i) => (
                        <div key={i} className={`ludo-prize-row ${i < 3 ? `top top-${i + 1}` : ''}`}>
                            <span className="rank">{['🥇', '🥈', '🥉'][i] || `#${i + 1}`}</span>
                            <div className="ludo-input"><input type="number" min="0" value={p.coins} onChange={e => set(['weeklyPrizes', i, 'coins'], e.target.value === '' ? '' : Number(e.target.value))} /><em>🪙</em></div>
                            <div className="ludo-input"><input type="number" min="0" value={p.gems} onChange={e => set(['weeklyPrizes', i, 'gems'], e.target.value === '' ? '' : Number(e.target.value))} /><em>💎</em></div>
                        </div>
                    ))}
                    <div className="ludo-prize-row total">
                        <span>المجموع أسبوعياً</span><b>{fmt(totals.coins)} 🪙</b><b>{fmt(totals.gems)} 💎</b>
                    </div>
                </div>
                {totals.gems > 900 && (
                    <p className="ludo-note">💡 الجواهر تُباع بمال حقيقي (900 جوهرة = 3.99$) — {fmt(totals.gems)} جوهرة أسبوعياً تقلّل حاجة المتصدّرين للشراء.</p>
                )}
            </section>

            {/* ── ترتيب الأسبوع الحالي ── */}
            <section className="ludo-section">
                <div className="ludo-section-head">
                    <div>
                        <h3>📊 ترتيب هذا الأسبوع</h3>
                        <p>{standings ? `ينتهي ${new Date(standings.endsAt).toLocaleString('ar')} — ما سيأخذه كل مركز بالجوائز المحفوظة` : ''}</p>
                    </div>
                    <button className="btn-ghost" onClick={async () => setStandings(await call('/standings'))}>↻ تحديث</button>
                </div>
                {!standings || standings.rows.length === 0 ? (
                    <div className="games-empty">لا نجوم هذا الأسبوع بعد — النجوم من الفوز في الدوري</div>
                ) : (
                    <div className="ludo-standings">
                        {standings.rows.map(r => (
                            <a key={r.rank} className={`ludo-standing ${r.inactive ? 'inactive' : ''}`} href={r.id ? `#/user/${r.id}` : undefined}>
                                <span className="rank">{['🥇', '🥈', '🥉'][r.rank - 1] || `#${r.rank}`}</span>
                                <span className="name">{r.name}{r.inactive && <small> (موقوف/غير نشط)</small>}</span>
                                <span className="pts">{fmt(r.weekPoints)} ⭐</span>
                                <span className="prize">{r.prize ? `${short(r.prize.coins)} 🪙 · ${fmt(r.prize.gems)} 💎` : '—'}</span>
                            </a>
                        ))}
                    </div>
                )}
            </section>

            {/* ── الدوريات ── */}
            <section className="ludo-section">
                <div className="ludo-section-head">
                    <div>
                        <h3>🏟️ الدوريات</h3>
                        <p>الجائزة = رسوم كل المقاعد للفائز (لاعبان: ضعف الرسوم). النجوم تحدّد الترتيب الأسبوعي والمرتبة.</p>
                    </div>
                </div>
                <div className="ludo-leagues">
                    {LEAGUES.map(l => (
                        <div key={l.id} className={`ludo-league league-${l.id}`}>
                            <h4>{l.icon} {l.title}</h4>
                            <NumberField label="رسوم الدخول" suffix="🪙" min={1} value={cfg.leagues[l.id].fee} onChange={v => set(['leagues', l.id, 'fee'], v)}
                                hint={`جائزة لاعبَين: ${short((Number(cfg.leagues[l.id].fee) || 0) * 2)} · يكفي رصيد البداية لـ ${winsForFee(cfg.leagues[l.id].fee)} مباراة`} />
                            <NumberField label="نجوم الفوز" suffix="⭐" value={cfg.leagues[l.id].points} onChange={v => set(['leagues', l.id, 'points'], v)} />
                        </div>
                    ))}
                </div>
            </section>

            {/* ── الاقتصاد ── */}
            <section className="ludo-section">
                <div className="ludo-section-head"><div><h3>🪙 الأرصدة والمكافآت</h3><p>رصيد البداية لمن يفتح اللعبة أول مرة فقط — لا يمسّ الأرصدة الحالية.</p></div></div>
                <div className="ludo-grid">
                    <NumberField label="رصيد البداية (عملات)" suffix="🪙" value={cfg.startCoins} onChange={v => set(['startCoins'], v)} />
                    <NumberField label="رصيد البداية (جواهر)" suffix="💎" value={cfg.startGems} onChange={v => set(['startGems'], v)} />
                    <NumberField label="المكافأة اليومية" suffix="🪙" value={cfg.dailyBonus} onChange={v => set(['dailyBonus'], v)} />
                    <NumberField label="مكافأة الإعلان (عملات)" suffix="🪙" value={cfg.adReward.coins} onChange={v => set(['adReward', 'coins'], v)} />
                    <NumberField label="مكافأة الإعلان (جواهر)" suffix="💎" value={cfg.adReward.gems} onChange={v => set(['adReward', 'gems'], v)} />
                    <NumberField label="إعلانات المكافأة يومياً" suffix="مرة" value={cfg.adDailyMax} onChange={v => set(['adDailyMax'], v)} />
                </div>
            </section>

            {/* ── هدية الإطلاق ── */}
            {cfg.launchGift && (() => {
                const g = cfg.launchGift;
                const now = Date.now();
                const s = g.startsAt ? Date.parse(g.startsAt) : null;
                const e = g.endsAt ? Date.parse(g.endsAt) : null;
                const status = !s ? 'مطفأة' : now < s ? `تبدأ ${new Date(s).toLocaleString('ar')}`
                    : now < e ? `مفعّلة — تنتهي ${new Date(e).toLocaleString('ar')} (بعد ${Math.ceil((e - now) / 86400000)} يوماً)` : 'انتهت';
                const toDay = (iso) => (iso ? iso.slice(0, 10) : '');
                const fromDay = (d) => (d ? new Date(`${d}T00:00:00Z`).toISOString() : null);
                return (
                    <section className="ludo-section">
                        <div className="ludo-section-head">
                            <div>
                                <h3>🎁 هدية الإطلاق</h3>
                                <p>تظهر بطاقة «استلم هديتك» في الألعاب لكل مستخدم خلال المدة — مرة لكل حساب ولكل جهاز (الحساب الثاني على الجهاز نفسه لا يأخذها). الحالة: <b>{status}</b></p>
                            </div>
                            <div className="ludo-savebar-actions">
                                <button className="btn-ghost" onClick={() => {
                                    const start = new Date();
                                    set(['launchGift'], { ...g, startsAt: start.toISOString(), endsAt: new Date(start.getTime() + 30 * 86400000).toISOString() });
                                }}>▶️ ابدأ الآن لـ 30 يوماً</button>
                                {g.startsAt && <button className="btn-ghost" onClick={() => set(['launchGift'], { ...g, startsAt: null, endsAt: null })}>⏹ أوقف</button>}
                            </div>
                        </div>
                        <div className="ludo-grid">
                            <NumberField label="عملات" suffix="🪙" value={g.coins} onChange={v => set(['launchGift', 'coins'], v)} />
                            <NumberField label="جواهر" suffix="💎" value={g.gems} onChange={v => set(['launchGift', 'gems'], v)} />
                            <label className="ludo-field">
                                <span>البداية (UTC)</span>
                                <div className="ludo-input"><input type="date" value={toDay(g.startsAt)} onChange={ev => set(['launchGift', 'startsAt'], fromDay(ev.target.value))} /></div>
                            </label>
                            <label className="ludo-field">
                                <span>النهاية (UTC)</span>
                                <div className="ludo-input"><input type="date" value={toDay(g.endsAt)} onChange={ev => set(['launchGift', 'endsAt'], fromDay(ev.target.value))} /></div>
                            </label>
                        </div>
                        {Number(g.gems) > 900 && (
                            <p className="ludo-note">💡 {fmt(g.gems)} جوهرة لكل مستخدم أكثر من أكبر باقة تُباع (900 جوهرة = 3.99$) — قد يتوقّف شراء الجواهر طوال المدة.</p>
                        )}
                    </section>
                );
            })()}

            {/* ── مهام اليوم ── */}
            <section className="ludo-section">
                <div className="ludo-section-head"><div><h3>🎯 مهام اليوم</h3><p>تتجدّد كل يوم (UTC). تغيير الهدف يسري فوراً على تقدّم اليوم.</p></div></div>
                <div className="ludo-missions">
                    {Object.keys(cfg.missions).map(id => (
                        <div key={id} className="ludo-mission">
                            <h4>{MISSIONS[id] || id}</h4>
                            <NumberField label="الهدف" value={cfg.missions[id].target} min={1} onChange={v => set(['missions', id, 'target'], v)} />
                            <NumberField label="عملات" suffix="🪙" value={cfg.missions[id].coins} onChange={v => set(['missions', id, 'coins'], v)} />
                            <NumberField label="جواهر" suffix="💎" value={cfg.missions[id].gems} onChange={v => set(['missions', id, 'gems'], v)} />
                        </div>
                    ))}
                </div>
            </section>

            {/* ── أرشيف الجوائز ── */}
            <section className="ludo-section">
                <div className="ludo-section-head"><div><h3>🗂️ أرشيف الجوائز</h3><p>آخر 12 أسبوعاً وُزّعت جوائزه.</p></div></div>
                {seasons.length === 0 ? <div className="games-empty">لم تُوزَّع جوائز بعد</div> : seasons.map(s => (
                    <details key={s.weekKey} className="ludo-season">
                        <summary>أسبوع {s.weekKey} — {s.winners.length} فائزاً</summary>
                        {s.winners.map(w => (
                            <a key={w.rank} className="ludo-standing" href={w.id ? `#/user/${w.id}` : undefined}>
                                <span className="rank">#{w.rank}</span>
                                <span className="name">{w.name}</span>
                                <span className="pts">{fmt(w.points)} ⭐</span>
                                <span className="prize">{short(w.coins)} 🪙 · {fmt(w.gems)} 💎</span>
                            </a>
                        ))}
                    </details>
                ))}
            </section>

            {defaults && (
                <button className="btn-ghost ludo-reset" onClick={() => { if (window.confirm('إعادة كل الحقول إلى القيم الافتراضية؟ (لا تُحفظ حتى تضغط حفظ)')) setCfg(defaults); }}>
                    ↺ القيم الافتراضية
                </button>
            )}
        </div>
    );
}

export default LudoSettings;
