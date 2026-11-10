// 🎁 منح/تمديد/سحب هلا+ لمستخدم — من صفحة المستخدم
import React, { useState } from 'react';
import { grantPremium, revokePremiumGrant } from '../services/api';
import { formatDateLong } from '../utils/formatters';

const PRESETS = [
    { days: 7, label: 'أسبوع' },
    { days: 30, label: 'شهر' },
    { days: 90, label: '3 أشهر' },
    { days: 365, label: 'سنة' }
];
const REASONS = ['تعويض', 'مسابقة', 'تجربة', 'دعم', 'حساب فريق العمل'];

function PremiumGrantModal({ user, onClose, onDone, showToast }) {
    const now = new Date();
    const active = user.isPremium && user.premiumExpiresAt && new Date(user.premiumExpiresAt) > now;
    const [mode, setMode] = useState('preset');          // preset | date
    const [days, setDays] = useState(30);
    const [until, setUntil] = useState('');
    const [reason, setReason] = useState('');
    const [busy, setBusy] = useState(false);

    const base = active ? new Date(user.premiumExpiresAt) : now;
    const preview = mode === 'preset'
        ? new Date(base.getTime() + days * 86400000)
        : (until ? new Date(`${until}T23:59:00`) : null);

    const submit = async () => {
        if (mode === 'date' && !until) { showToast('اختر تاريخ الانتهاء', 'error'); return; }
        setBusy(true);
        try {
            const body = mode === 'preset' ? { days, reason } : { until: new Date(`${until}T23:59:00`).toISOString(), reason };
            const res = await grantPremium(user._id, body);
            if (res.success) {
                showToast(res.data?.hasStoreSubscription
                    ? `${res.message} — تنبيه: لديه اشتراك متجر قد يغيّر تاريخ الانتهاء عند تجديده`
                    : `${res.message} وأُرسل إشعار للمستخدم`, 'success');
                onDone();
            }
        } catch (e) {
            showToast(e.response?.data?.message || 'فشل منح هلا+', 'error');
        } finally {
            setBusy(false);
        }
    };

    const revoke = async () => {
        if (!window.confirm(`سحب هلا+ من ${user.name} الآن؟ تُزال كل المزايا فوراً.`)) return;
        setBusy(true);
        try {
            const res = await revokePremiumGrant(user._id);
            if (res.success) { showToast(res.message, 'success'); onDone(); }
        } catch (e) {
            showToast(e.response?.data?.message || 'فشل السحب', 'error');
        } finally {
            setBusy(false);
        }
    };

    const g = user.premiumGrant;
    const chip = (selected) => ({
        padding: '8px 14px', borderRadius: 18, cursor: 'pointer', fontSize: 13, fontWeight: 600,
        border: selected ? '1px solid #f59e0b' : '1px solid rgba(128,128,128,.35)',
        background: selected ? 'linear-gradient(135deg,#fbbf24,#f59e0b)' : 'transparent',
        color: selected ? '#1a1a1a' : 'inherit'
    });

    return (
        <div className="modal-overlay" onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
            <div onClick={e => e.stopPropagation()} style={{ background: 'var(--bg-card, #fff)', color: 'var(--text-primary, #111)', borderRadius: 18, width: '100%', maxWidth: 460, padding: 22, boxShadow: '0 20px 60px rgba(0,0,0,.35)' }} dir="rtl">
                <h3 style={{ margin: '0 0 4px', fontSize: 19 }}>⭐ {active ? 'تمديد هلا+' : 'منح هلا+'} — {user.name}</h3>
                <p style={{ margin: '0 0 16px', fontSize: 13, opacity: .7 }}>
                    {active
                        ? `مشترك حتى ${formatDateLong(user.premiumExpiresAt)} — المدة تُضاف بعد هذا التاريخ.`
                        : 'يتفعّل عند فتح المستخدم التطبيق، بلا شراء. يعود حساباً عادياً عند الانتهاء.'}
                </p>

                <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                    <button type="button" style={chip(mode === 'preset')} onClick={() => setMode('preset')}>مدة</button>
                    <button type="button" style={chip(mode === 'date')} onClick={() => setMode('date')}>حتى تاريخ</button>
                </div>

                {mode === 'preset' ? (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
                        {PRESETS.map(p => (
                            <button key={p.days} type="button" style={chip(days === p.days)} onClick={() => setDays(p.days)}>{p.label}</button>
                        ))}
                    </div>
                ) : (
                    <input type="date" value={until} onChange={e => setUntil(e.target.value)}
                        min={new Date(now.getTime() + 86400000).toISOString().slice(0, 10)}
                        style={{ width: '100%', padding: 10, borderRadius: 10, border: '1px solid rgba(128,128,128,.35)', marginBottom: 14, background: 'transparent', color: 'inherit' }} />
                )}

                <label style={{ fontSize: 13, opacity: .8 }}>السبب (اختياري — يُحفظ في السجل)</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, margin: '6px 0 8px' }}>
                    {REASONS.map(r => (
                        <button key={r} type="button" onClick={() => setReason(r)}
                            style={{ ...chip(reason === r), padding: '4px 10px', fontSize: 12 }}>{r}</button>
                    ))}
                </div>
                <input value={reason} onChange={e => setReason(e.target.value)} maxLength={200} placeholder="أو اكتب سبباً"
                    style={{ width: '100%', padding: 10, borderRadius: 10, border: '1px solid rgba(128,128,128,.35)', background: 'transparent', color: 'inherit', boxSizing: 'border-box' }} />

                {preview && (
                    <div style={{ marginTop: 14, padding: 12, borderRadius: 12, background: 'rgba(245,158,11,.12)', fontSize: 14 }}>
                        🎁 هلا+ حتى <strong>{formatDateLong(preview.toISOString())}</strong>
                    </div>
                )}

                {g?.history?.length > 0 && (
                    <details style={{ marginTop: 12, fontSize: 12, opacity: .8 }}>
                        <summary>سجل المنح ({g.history.length})</summary>
                        <ul style={{ margin: '6px 0 0', paddingInlineStart: 18, lineHeight: 1.9 }}>
                            {[...g.history].reverse().map((h, i) => (
                                <li key={i}>
                                    {h.action === 'grant' ? 'منح' : h.action === 'extend' ? 'تمديد' : 'سحب'}
                                    {' — '}{h.byName || 'مشرف'} · {formatDateLong(h.at)}
                                    {h.until ? ` · حتى ${formatDateLong(h.until)}` : ''}
                                    {h.reason ? ` · ${h.reason}` : ''}
                                </li>
                            ))}
                        </ul>
                    </details>
                )}

                <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
                    <button type="button" onClick={submit} disabled={busy}
                        style={{ flex: 1, padding: 12, borderRadius: 12, border: 'none', fontWeight: 700, cursor: 'pointer', background: 'linear-gradient(135deg,#fbbf24,#f59e0b)', color: '#1a1a1a' }}>
                        {busy ? '…' : active ? 'تمديد' : 'منح هلا+'}
                    </button>
                    {active && (
                        <button type="button" onClick={revoke} disabled={busy}
                            style={{ padding: '12px 16px', borderRadius: 12, border: 'none', fontWeight: 700, cursor: 'pointer', background: '#dc2626', color: '#fff' }}>
                            سحب
                        </button>
                    )}
                    <button type="button" onClick={onClose} disabled={busy}
                        style={{ padding: '12px 16px', borderRadius: 12, border: '1px solid rgba(128,128,128,.35)', background: 'transparent', color: 'inherit', cursor: 'pointer' }}>
                        إغلاق
                    </button>
                </div>
            </div>
        </div>
    );
}

export default PremiumGrantModal;
