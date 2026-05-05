import React, { useState, useEffect } from 'react';
import { useToast } from '../components/Toast';
import LoadingSpinner from '../components/LoadingSpinner';
import StatCard from '../components/StatCard';
import { formatDateTime } from '../utils/formatters';
import {
    getSensitiveContentSettings,
    updateSensitiveContentSettings,
    getSensitiveContentStats,
    getSensitiveContentReveals
} from '../services/api';
import './SensitiveContent.css';

const ALL_CATEGORIES = [
    { value: 'sexual', label: '🔞 جنسي' },
    { value: 'violence', label: '🩸 عنف' },
    { value: 'hate', label: '😡 كراهية' },
    { value: 'spam', label: '📨 سبام' },
    { value: 'other', label: '📌 أخرى' }
];

function SensitiveContent({ onViewUserDetail }) {
    const [activeTab, setActiveTab] = useState('settings');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [settings, setSettings] = useState(null);
    const [stats, setStats] = useState(null);
    const [reveals, setReveals] = useState({ items: [], total: 0, page: 1, totalPages: 1 });
    const [revealsPage, setRevealsPage] = useState(1);
    const [revealsCategory, setRevealsCategory] = useState('');
    const [statsDays, setStatsDays] = useState(30);
    const { showToast } = useToast();

    useEffect(() => {
        loadAll();
    }, []);

    useEffect(() => {
        if (activeTab === 'stats') loadStats();
        if (activeTab === 'reveals') loadReveals();
    }, [activeTab, statsDays, revealsPage, revealsCategory]);

    const loadAll = async () => {
        try {
            setLoading(true);
            const settingsRes = await getSensitiveContentSettings();
            if (settingsRes.success) setSettings(settingsRes.data);
        } catch (error) {
            showToast('فشل تحميل الإعدادات', 'error');
        } finally {
            setLoading(false);
        }
    };

    const loadStats = async () => {
        try {
            const res = await getSensitiveContentStats(statsDays);
            if (res.success) setStats(res.data);
        } catch (error) {
            showToast('فشل تحميل الإحصائيات', 'error');
        }
    };

    const loadReveals = async () => {
        try {
            const filters = {};
            if (revealsCategory) filters.category = revealsCategory;
            const res = await getSensitiveContentReveals(revealsPage, 50, filters);
            if (res.success) setReveals({
                items: res.data.reveals,
                total: res.data.total,
                page: res.data.page,
                totalPages: res.data.totalPages
            });
        } catch (error) {
            showToast('فشل تحميل سجل الكشف', 'error');
        }
    };

    const handleSave = async () => {
        if (!settings) return;
        if (settings.featureEnabled && !window.confirm(
            '⚠️ تحذير: تفعيل هذه الميزة سيسمح للمستخدمين البالغين (18+) بكشف الكلمات الجنسية المحجوبة في الرسائل (بعد تفعيلهم للإعداد من تطبيقهم).\n\nهل أنت متأكد؟'
        )) return;
        try {
            setSaving(true);
            const res = await updateSensitiveContentSettings(settings);
            if (res.success) {
                showToast('تم حفظ الإعدادات', 'success');
                setSettings(res.data);
            } else {
                showToast(res.message || 'فشل الحفظ', 'error');
            }
        } catch (error) {
            showToast(error?.response?.data?.message || 'فشل الحفظ', 'error');
        } finally {
            setSaving(false);
        }
    };

    const toggleCategory = (cat) => {
        setSettings(prev => ({
            ...prev,
            affectedCategories: prev.affectedCategories.includes(cat)
                ? prev.affectedCategories.filter(c => c !== cat)
                : [...prev.affectedCategories, cat]
        }));
    };

    if (loading) return <LoadingSpinner text="جاري التحميل..." />;
    if (!settings) return <div className="error-state">فشل تحميل الإعدادات</div>;

    return (
        <div className="sensitive-content-page">
            <header className="page-header">
                <h1>🔞 المحتوى الحساس</h1>
                <p className="page-desc">
                    التحكم في ميزة عرض المحتوى الحساس للبالغين. الميزة مفعّلة افتراضياً = OFF،
                    والمستخدمون يقدرون يفعّلوها من إعدادات التطبيق فقط لو الميزة مفعّلة من الأدمن.
                </p>
            </header>

            {/* Tabs */}
            <div className="tabs-bar">
                {[
                    { id: 'settings', label: '⚙️ الإعدادات' },
                    { id: 'stats', label: '📊 الإحصائيات' },
                    { id: 'reveals', label: '📋 سجل الكشف' }
                ].map(t => (
                    <button
                        key={t.id}
                        className={`tab-btn ${activeTab === t.id ? 'active' : ''}`}
                        onClick={() => setActiveTab(t.id)}
                    >{t.label}</button>
                ))}
            </div>

            {/* === SETTINGS TAB === */}
            {activeTab === 'settings' && (
                <div className="settings-section">
                    {/* Feature Toggle */}
                    <div className="setting-card">
                        <div className="setting-header">
                            <div>
                                <h3>تفعيل الميزة كاملة</h3>
                                <small>لو OFF، الميزة معطّلة لكل المستخدمين بصرف النظر عن إعداداتهم</small>
                            </div>
                            <label className="toggle-switch">
                                <input
                                    type="checkbox"
                                    checked={settings.featureEnabled}
                                    onChange={e => setSettings({ ...settings, featureEnabled: e.target.checked })}
                                />
                                <span className="slider"></span>
                            </label>
                        </div>
                        {settings.featureEnabled && (
                            <div className="warning-box">
                                ⚠️ <strong>الميزة مفعّلة.</strong> المستخدمون البالغون (18+) في v6.3+ يمكنهم رؤية المحتوى المُكتم بعد تفعيل الإعداد من تطبيقهم.
                            </div>
                        )}
                    </div>

                    {/* Affected Categories */}
                    <div className="setting-card">
                        <h3>الفئات المشمولة</h3>
                        <small>اختر أي فئات من الكلمات المحجوبة يُسمح بكشفها (الباقي يبقى محجوب نهائياً)</small>
                        <div className="categories-grid">
                            {ALL_CATEGORIES.map(c => (
                                <label key={c.value} className={`category-chip ${settings.affectedCategories.includes(c.value) ? 'selected' : ''}`}>
                                    <input
                                        type="checkbox"
                                        checked={settings.affectedCategories.includes(c.value)}
                                        onChange={() => toggleCategory(c.value)}
                                    />
                                    {c.label}
                                </label>
                            ))}
                        </div>
                        <div className="info-box">
                            ℹ️ Apple/Google قد يطلبون رفع rating إلى 17+ لو فعّلت categories متعددة.
                        </div>
                    </div>

                    {/* Min Age */}
                    <div className="setting-card">
                        <div className="setting-header">
                            <div>
                                <h3>الحد الأدنى للعمر</h3>
                                <small>لا يقل عن 18 (محمي بالقانون)</small>
                            </div>
                            <input
                                type="number"
                                min="18"
                                max="99"
                                value={settings.minAge}
                                onChange={e => setSettings({ ...settings, minAge: parseInt(e.target.value) || 18 })}
                                className="number-input"
                            />
                        </div>
                    </div>

                    {/* Min Client Version */}
                    <div className="setting-card">
                        <div className="setting-header">
                            <div>
                                <h3>الحد الأدنى لإصدار التطبيق</h3>
                                <small>التطبيقات الأقدم لن ترى الميزة (version gate)</small>
                            </div>
                            <input
                                type="text"
                                value={settings.minClientVersion}
                                onChange={e => setSettings({ ...settings, minClientVersion: e.target.value })}
                                className="text-input"
                                placeholder="6.3"
                            />
                        </div>
                    </div>

                    {/* Require Double Confirm */}
                    <div className="setting-card">
                        <div className="setting-header">
                            <div>
                                <h3>طلب تأكيد مزدوج</h3>
                                <small>شاشة موافقة كاملة قبل تفعيل المستخدم للإعداد في تطبيقه</small>
                            </div>
                            <label className="toggle-switch">
                                <input
                                    type="checkbox"
                                    checked={settings.requireDoubleConfirm}
                                    onChange={e => setSettings({ ...settings, requireDoubleConfirm: e.target.checked })}
                                />
                                <span className="slider"></span>
                            </label>
                        </div>
                    </div>

                    {/* Save Button */}
                    <button
                        className="save-btn"
                        onClick={handleSave}
                        disabled={saving}
                    >
                        {saving ? '⏳ جاري الحفظ...' : '💾 حفظ الإعدادات'}
                    </button>
                </div>
            )}

            {/* === STATS TAB === */}
            {activeTab === 'stats' && (
                <div className="stats-section">
                    <div className="period-selector">
                        <label>الفترة:</label>
                        <select value={statsDays} onChange={e => setStatsDays(parseInt(e.target.value))}>
                            <option value="7">آخر 7 أيام</option>
                            <option value="30">آخر 30 يوم</option>
                            <option value="90">آخر 90 يوم</option>
                        </select>
                    </div>

                    {!stats ? <LoadingSpinner text="..." /> : (
                        <>
                            <div className="stats-grid">
                                <StatCard label="مستخدمون فعّلوا الإعداد" value={stats.users.enabledSetting} icon="👥" color="#9C27B0" />
                                <StatCard label="رسائل محجوبة (إجمالي)" value={stats.messages.totalFlagged} icon="🔒" color="#FF5722" />
                                <StatCard label={`رسائل محجوبة (${statsDays} يوم)`} value={stats.messages.recentFlagged} icon="📅" color="#FF9800" />
                                <StatCard label="عمليات كشف (إجمالي)" value={stats.reveals.total} icon="👁️" color="#2196F3" />
                                <StatCard label={`عمليات كشف (${statsDays} يوم)`} value={stats.reveals.recent} icon="🔍" color="#4CAF50" />
                                <StatCard label="مستخدمون فريدون كشفوا" value={stats.reveals.uniqueUsers} icon="🧑" color="#E91E63" />
                            </div>

                            {stats.reveals.byCategory.length > 0 && (
                                <div className="chart-card">
                                    <h3>الكشف حسب الفئة</h3>
                                    <div className="bars">
                                        {stats.reveals.byCategory.map(c => {
                                            const max = Math.max(...stats.reveals.byCategory.map(x => x.count));
                                            const pct = max > 0 ? (c.count / max) * 100 : 0;
                                            const label = ALL_CATEGORIES.find(ac => ac.value === c._id)?.label || c._id;
                                            return (
                                                <div key={c._id} className="bar-row">
                                                    <span className="bar-label">{label}</span>
                                                    <div className="bar-track">
                                                        <div className="bar-fill" style={{ width: `${pct}%` }}></div>
                                                    </div>
                                                    <span className="bar-value">{c.count}</span>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}

                            {stats.reveals.dailyTrend.length > 0 && (
                                <div className="chart-card">
                                    <h3>اتجاه الكشف اليومي</h3>
                                    <div className="trend-list">
                                        {stats.reveals.dailyTrend.map(d => (
                                            <div key={d._id} className="trend-row">
                                                <span>{d._id}</span>
                                                <span className="badge">{d.count} كشف</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </>
                    )}
                </div>
            )}

            {/* === REVEALS TAB === */}
            {activeTab === 'reveals' && (
                <div className="reveals-section">
                    <div className="filters-bar">
                        <select value={revealsCategory} onChange={e => { setRevealsCategory(e.target.value); setRevealsPage(1); }}>
                            <option value="">كل الفئات</option>
                            {ALL_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                        </select>
                        <span className="total-info">{reveals.total} كشف إجمالي</span>
                    </div>

                    {reveals.items.length === 0 ? (
                        <div className="empty-state">📭 لا يوجد سجل كشف حتى الآن</div>
                    ) : (
                        <table className="reveals-table">
                            <thead>
                                <tr>
                                    <th>المستخدم</th>
                                    <th>الفئة</th>
                                    <th>العمر</th>
                                    <th>إصدار التطبيق</th>
                                    <th>التاريخ</th>
                                </tr>
                            </thead>
                            <tbody>
                                {reveals.items.map(r => (
                                    <tr key={r._id}>
                                        <td>
                                            {r.user ? (
                                                <span className="user-link" onClick={() => onViewUserDetail && onViewUserDetail(r.user._id)}>
                                                    {r.user.name} <small>({r.user.halaId})</small>
                                                </span>
                                            ) : <span className="text-muted">محذوف</span>}
                                        </td>
                                        <td>{ALL_CATEGORIES.find(ac => ac.value === r.category)?.label || r.category}</td>
                                        <td>{r.userAgeAtReveal || '-'}</td>
                                        <td>{r.clientVersion || '-'}</td>
                                        <td>{formatDateTime(r.revealedAt)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}

                    {reveals.totalPages > 1 && (
                        <div className="pagination">
                            <button disabled={revealsPage <= 1} onClick={() => setRevealsPage(p => p - 1)}>السابق</button>
                            <span>صفحة {revealsPage} / {reveals.totalPages}</span>
                            <button disabled={revealsPage >= reveals.totalPages} onClick={() => setRevealsPage(p => p + 1)}>التالي</button>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

export default SensitiveContent;
