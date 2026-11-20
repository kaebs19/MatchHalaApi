// 📊 أداء الإعلانات من AdMob — الأرباح، الظهور، eCPM، نسبة الامتلاء، النقر؛ يومياً ولكل وحدة.
// الربط مرة من هنا (OAuth، قراءة فقط) — routes/adminAdmob.js + utils/admobReport.js.
import React, { useCallback, useEffect, useState } from 'react';
import { getAdmobStatus, connectAdmob, disconnectAdmob, getAdmobReport } from '../services/api';
import { useToast } from './Toast';
import './AdsPerformancePanel.css';

const PERIODS = [7, 14, 30, 90];

const fmtMoney = (v, cur) => {
    try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: cur || 'USD', maximumFractionDigits: 2 }).format(v || 0); }
    catch { return `${(v || 0).toFixed(2)} ${cur || ''}`; }
};
const fmtNum = (v) => new Intl.NumberFormat('en-US').format(Math.round(v || 0));

function Delta({ cur, prev, inverse = false }) {
    if (!prev) return <span className="ads-perf__delta is-flat">—</span>;
    const pct = Math.round(((cur - prev) / prev) * 100);
    const up = pct > 0;
    const good = inverse ? !up : up;
    if (pct === 0) return <span className="ads-perf__delta is-flat">0%</span>;
    return <span className={`ads-perf__delta ${good ? 'is-good' : 'is-bad'}`}>{up ? '▲' : '▼'} {Math.abs(pct)}%</span>;
}

export default function AdsPerformancePanel() {
    const { showToast } = useToast();
    const [status, setStatus] = useState(null);
    const [days, setDays] = useState(7);
    const [report, setReport] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [metric, setMetric] = useState('earnings');

    const loadStatus = useCallback(async () => {
        try {
            const res = await getAdmobStatus();
            if (res.success) setStatus(res.data);
        } catch (e) {
            setStatus({ configured: false, connected: false });
        }
    }, []);

    const loadReport = useCallback(async (d) => {
        setLoading(true); setError(null);
        try {
            const res = await getAdmobReport(d);
            if (res.success) setReport(res.data);
        } catch (e) {
            setError(e?.response?.data?.message || 'تعذّر جلب تقرير AdMob');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadStatus();
        // العودة من صفحة موافقة Google: #/settings?tab=ads&admob=connected|denied|expired|failed
        const m = window.location.hash.match(/admob=(\w+)/);
        if (m) {
            const msg = {
                connected: ['تم ربط حساب AdMob ✅', 'success'],
                denied: ['أُلغي الربط من صفحة Google', 'error'],
                expired: ['انتهت مهلة الربط — أعد المحاولة', 'error'],
                failed: ['تعذّر إكمال الربط — راجع إعدادات OAuth', 'error']
            }[m[1]];
            if (msg) showToast(msg[0], msg[1]);
            window.history.replaceState(null, '', window.location.hash.replace(/[&?]admob=\w+/, ''));
        }
        // eslint-disable-next-line
    }, []);

    useEffect(() => {
        if (status?.connected) loadReport(days);
    }, [status?.connected, days, loadReport]);

    const connect = async () => {
        try {
            const res = await connectAdmob();
            if (res.success) window.location.href = res.data.url;
        } catch (e) {
            showToast(e?.response?.data?.message || 'تعذّر بدء الربط', 'error');
        }
    };

    const disconnect = async () => {
        if (!window.confirm('إلغاء ربط AdMob؟ تتوقف شاشة الأداء حتى تعيد الربط.')) return;
        try {
            await disconnectAdmob();
            setReport(null);
            loadStatus();
            showToast('أُلغي ربط AdMob', 'success');
        } catch (e) {
            showToast('تعذّر إلغاء الربط', 'error');
        }
    };

    if (!status) return <div className="ads-perf"><p className="ads-perf__muted">⏳ جارٍ التحميل…</p></div>;

    if (!status.configured) {
        return (
            <div className="ads-perf">
                <h2>📊 أداء الإعلانات</h2>
                <div className="ads-perf__setup">
                    <p><strong>خطوة إعداد واحدة (على المالك):</strong></p>
                    <ol>
                        <li>في Google Cloud Console: أنشئ مشروعاً (أو استعمل الحالي) وفعّل <b dir="ltr">AdMob API</b>.</li>
                        <li>APIs &amp; Services ← Credentials ← <b dir="ltr">OAuth client ID</b> من نوع <b dir="ltr">Web application</b>.</li>
                        <li>أضف في Authorized redirect URIs:<br /><code dir="ltr">{status.redirectUri || 'https://matchhala.chathala.com/api/admin/admob/oauth/callback'}</code></li>
                        <li>ضع القيمتين في <code dir="ltr">.env</code> على الخادم: <code dir="ltr">ADMOB_OAUTH_CLIENT_ID</code> و <code dir="ltr">ADMOB_OAUTH_CLIENT_SECRET</code> ثم أعد تشغيل الخادم.</li>
                        <li>ارجع هنا واضغط «ربط حساب AdMob».</li>
                    </ol>
                    <p className="ads-perf__muted">⚠️ شاشة موافقة OAuth في وضع «Testing» تقبل الحسابات المضافة كـ Test users فقط — أضف بريد حساب AdMob هناك.</p>
                </div>
            </div>
        );
    }

    if (!status.connected) {
        return (
            <div className="ads-perf">
                <h2>📊 أداء الإعلانات</h2>
                <div className="ads-perf__setup">
                    <p>اربط حساب AdMob مرة واحدة لعرض الأرباح والظهور ونسبة الامتلاء هنا (قراءة فقط).</p>
                    {status.lastError && <p className="ads-perf__error">آخر خطأ: {status.lastError}</p>}
                    <button className="btn-save" onClick={connect}>🔗 ربط حساب AdMob</button>
                </div>
            </div>
        );
    }

    const cur = report?.currencyCode;
    const t = report?.totals; const p = report?.previous;
    const maxDay = Math.max(1, ...(report?.byDay || []).map(d => d[metric] || 0));
    const metricLabel = { earnings: 'الأرباح', impressions: 'الظهور', ecpm: 'eCPM' }[metric];

    return (
        <div className="ads-perf">
            <div className="ads-perf__head">
                <div>
                    <h2>📊 أداء الإعلانات</h2>
                    <p className="ads-perf__muted">
                        من AdMob مباشرة{status.publisherId ? <> · <span dir="ltr">{status.publisherId}</span></> : null}
                        {report?.generatedAt ? ` · حُدّث ${new Date(report.generatedAt).toLocaleTimeString('ar')}` : ''} · الأرقام تقديرية وتتأخر ساعات
                    </p>
                </div>
                <div className="ads-perf__controls">
                    <div className="ads-perf__seg">
                        {PERIODS.map(d => (
                            <button key={d} className={d === days ? 'is-on' : ''} onClick={() => setDays(d)}>{d} يوماً</button>
                        ))}
                    </div>
                    <button className="ads-perf__link" onClick={() => loadReport(days)} disabled={loading}>⟳ تحديث</button>
                    <button className="ads-perf__link is-danger" onClick={disconnect}>إلغاء الربط</button>
                </div>
            </div>

            {error && <div className="ads-perf__error">{error}</div>}
            {loading && !report && <p className="ads-perf__muted">⏳ جارٍ جلب التقرير…</p>}

            {t && (
                <>
                    <div className="ads-perf__kpis">
                        <div className="ads-perf__kpi"><span>الأرباح</span><b>{fmtMoney(t.earnings, cur)}</b><Delta cur={t.earnings} prev={p.earnings} /></div>
                        <div className="ads-perf__kpi"><span>الظهور</span><b>{fmtNum(t.impressions)}</b><Delta cur={t.impressions} prev={p.impressions} /></div>
                        <div className="ads-perf__kpi"><span>eCPM</span><b>{fmtMoney(t.ecpm, cur)}</b><Delta cur={t.ecpm} prev={p.ecpm} /></div>
                        <div className="ads-perf__kpi"><span>نسبة الامتلاء</span><b>{t.matchRate}%</b><Delta cur={t.matchRate} prev={p.matchRate} /></div>
                        <div className="ads-perf__kpi"><span>الطلبات</span><b>{fmtNum(t.requests)}</b><Delta cur={t.requests} prev={p.requests} /></div>
                        <div className="ads-perf__kpi"><span>النقر (CTR)</span><b>{fmtNum(t.clicks)} · {t.ctr}%</b><Delta cur={t.clicks} prev={p.clicks} /></div>
                    </div>
                    <p className="ads-perf__muted">المقارنة مع {days} يوماً قبلها.</p>

                    <div className="ads-perf__card">
                        <div className="ads-perf__card-head">
                            <h3>يومياً — {metricLabel}</h3>
                            <div className="ads-perf__seg is-small">
                                {['earnings', 'impressions', 'ecpm'].map(m => (
                                    <button key={m} className={m === metric ? 'is-on' : ''} onClick={() => setMetric(m)}>
                                        {{ earnings: 'الأرباح', impressions: 'الظهور', ecpm: 'eCPM' }[m]}
                                    </button>
                                ))}
                            </div>
                        </div>
                        <div className="ads-perf__bars" dir="ltr">
                            {report.byDay.map(d => (
                                <div key={d.date} className="ads-perf__bar"
                                    title={`${d.date}\nالأرباح ${fmtMoney(d.earnings, cur)}\nالظهور ${fmtNum(d.impressions)}\neCPM ${fmtMoney(d.ecpm, cur)}`}>
                                    <div className="ads-perf__bar-fill" style={{ height: `${Math.max(2, ((d[metric] || 0) / maxDay) * 100)}%` }} />
                                    {report.byDay.length <= 14 && <small>{d.date.slice(8)}</small>}
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="ads-perf__card">
                        <h3>حسب الوحدة</h3>
                        <div className="ads-perf__table-wrap">
                            <table className="ads-perf__table">
                                <thead>
                                    <tr><th>الوحدة</th><th>المنصة</th><th>الأرباح</th><th>الظهور</th><th>eCPM</th><th>الامتلاء</th><th>CTR</th></tr>
                                </thead>
                                <tbody>
                                    {report.byUnit.map(u => (
                                        <tr key={u.unitId}>
                                            <td><b>{u.name}</b><small dir="ltr">{u.format || ''}</small></td>
                                            <td>{u.platform === 'IOS' ? 'iOS' : u.platform === 'ANDROID' ? 'أندرويد' : (u.platform || '—')}</td>
                                            <td>{fmtMoney(u.earnings, cur)}</td>
                                            <td>{fmtNum(u.impressions)}</td>
                                            <td>{fmtMoney(u.ecpm, cur)}</td>
                                            <td>{u.matchRate}%</td>
                                            <td>{u.ctr}%</td>
                                        </tr>
                                    ))}
                                    {!report.byUnit.length && <tr><td colSpan={7} className="ads-perf__muted">لا بيانات في هذا المدى</td></tr>}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}
