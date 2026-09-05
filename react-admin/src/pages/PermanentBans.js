import React, { useState, useEffect, useCallback } from 'react';
import { getPermanentSuspensions, unsuspendUser, unbanDevice } from '../services/api';
import { useToast } from '../components/Toast';
import LoadingSpinner from '../components/LoadingSpinner';
import { getImageUrl, getDefaultAvatar } from '../config';
import { formatDateTime } from '../utils/formatters';
import './BannedDevices.css';

// الحسابات المعلّقة دائماً — الحساب هو الوحدة هنا، والجهاز حالةٌ عليه.
// صفحة «الأجهزة المحظورة» تبقى لحظر الجهاز الصريح؛ خلطُهما أغرقها بـ ١٣١٩
// حساباً بعد الـ backfill لا أجهزة.
function PermanentBans({ onViewUserDetail }) {
    const [accounts, setAccounts] = useState([]);
    const [loading, setLoading] = useState(true);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [search, setSearch] = useState('');
    const [searchInput, setSearchInput] = useState('');
    const [device, setDevice] = useState('all');     // all | banned | pending | none
    const [source, setSource] = useState('all');     // all | admin | auto
    const [stats, setStats] = useState({ total: 0, today: 0, thisWeek: 0, byAdmin: 0, byAuto: 0, withoutDevice: 0, pendingCount: 0 });
    const { showToast } = useToast();

    const fetchAccounts = useCallback(async () => {
        try {
            setLoading(true);
            const response = await getPermanentSuspensions({ search, page, limit: 50, device, source });
            if (response.success) {
                setAccounts(response.data.accounts || []);
                setTotal(response.data.total || 0);
                setTotalPages(response.data.totalPages || 1);
                setStats(response.data.stats || stats);
            }
        } catch (err) {
            showToast('فشل في تحميل الحسابات المحظورة', 'error');
        } finally {
            setLoading(false);
        }
        // eslint-disable-next-line
    }, [search, page, device, source]);

    useEffect(() => { fetchAccounts(); }, [fetchAccounts]);

    useEffect(() => {
        const t = setTimeout(() => { setPage(1); setSearch(searchInput); }, 400);
        return () => clearTimeout(t);
    }, [searchInput]);

    const pick = (setter, current) => (v) => { if (v !== current) { setter(v); setPage(1); } };
    const pickDevice = pick(setDevice, device);
    const pickSource = pick(setSource, source);

    // إلغاء التعليق يفكّ حظر الجهاز معه (الخادم يتكفّل) — الحساب يعود كاملاً
    const handleUnsuspend = async (u) => {
        if (!window.confirm(`إلغاء التعليق الدائم عن ${u.name}؟\n\nسيُفكّ حظر جهازه أيضاً ويعود الحساب للعمل.`)) return;
        try {
            const res = await unsuspendUser(u._id);
            if (res.success) { showToast('تم إلغاء التعليق', 'success'); fetchAccounts(); }
        } catch (err) {
            showToast('فشل إلغاء التعليق', 'error');
        }
    };

    // فكّ الجهاز وحده: يبقى الحساب موقوفاً لكن يُسمح للجهاز بحساب جديد
    const handleUnbanDeviceOnly = async (u) => {
        if (!window.confirm(`فكّ حظر جهاز ${u.name} فقط؟\n\nيبقى الحساب موقوفاً، لكن يُسمح لهذا الجهاز بإنشاء حساب جديد.`)) return;
        try {
            const res = await unbanDevice(u._id);
            if (res.success) { showToast('تم فكّ حظر الجهاز', 'success'); fetchAccounts(); }
        } catch (err) {
            showToast('فشل فكّ حظر الجهاز', 'error');
        }
    };

    const deviceChip = (d) => {
        if (!d || d.status === 'none') return { text: 'بلا حظر جهاز', icon: '⚠️', style: { background: '#fef3c7', color: '#92400e' } };
        if (d.status === 'pending') return { text: 'جهاز قيد الانتظار', icon: '⏳', style: { background: '#e0e7ff', color: '#3730a3' } };
        if (d.sharedRecord) return { text: 'الجهاز محظور (بصمة مشتركة)', icon: '📵', style: { background: '#fee2e2', color: '#991b1b' } };
        return { text: 'الجهاز محظور', icon: '📵', style: { background: '#fee2e2', color: '#991b1b' } };
    };

    return (
        <div className='banned-devices-page'>
            <div className='banned-stats-row'>
                <div className='banned-stat-card total'>
                    <div className='stat-icon'>⛔</div>
                    <div className='stat-info'>
                        <div className='stat-value'>{stats.total}</div>
                        <div className='stat-label'>محظورون دائماً</div>
                    </div>
                </div>
                <div className='banned-stat-card manual'>
                    <div className='stat-icon'>👤</div>
                    <div className='stat-info'>
                        <div className='stat-value'>{stats.byAdmin}</div>
                        <div className='stat-label'>بقرار أدمن</div>
                    </div>
                </div>
                <div className='banned-stat-card auto'>
                    <div className='stat-icon'>🤖</div>
                    <div className='stat-info'>
                        <div className='stat-value'>{stats.byAuto}</div>
                        <div className='stat-label'>تلقائي (بلاغات/تصعيد)</div>
                    </div>
                </div>
                <div className='banned-stat-card today'>
                    <div className='stat-icon'>📅</div>
                    <div className='stat-info'>
                        <div className='stat-value'>{stats.today}</div>
                        <div className='stat-label'>اليوم</div>
                    </div>
                </div>
                <div className='banned-stat-card week'>
                    <div className='stat-icon'>📆</div>
                    <div className='stat-info'>
                        <div className='stat-value'>{stats.thisWeek}</div>
                        <div className='stat-label'>الأسبوع</div>
                    </div>
                </div>
                <div className='banned-stat-card month'>
                    <div className='stat-icon'>⚠️</div>
                    <div className='stat-info'>
                        <div className='stat-value'>{stats.withoutDevice}</div>
                        <div className='stat-label'>بلا حظر جهاز</div>
                    </div>
                </div>
            </div>

            <div className='banned-filter-row'>
                <div className='source-tabs'>
                    <button className={'source-tab ' + (source === 'all' ? 'active' : '')} onClick={() => pickSource('all')}>الكل ({stats.total})</button>
                    <button className={'source-tab ' + (source === 'admin' ? 'active' : '')} onClick={() => pickSource('admin')}>👤 أدمن ({stats.byAdmin})</button>
                    <button className={'source-tab ' + (source === 'auto' ? 'active' : '')} onClick={() => pickSource('auto')}>🤖 تلقائي ({stats.byAuto})</button>
                </div>
                <div className='source-tabs'>
                    <button className={'source-tab ' + (device === 'all' ? 'active' : '')} onClick={() => pickDevice('all')}>كل الأجهزة</button>
                    <button className={'source-tab ' + (device === 'banned' ? 'active' : '')} onClick={() => pickDevice('banned')}>📵 محظور</button>
                    <button className={'source-tab ' + (device === 'pending' ? 'active' : '')} onClick={() => pickDevice('pending')}>⏳ قيد الانتظار ({stats.pendingCount})</button>
                    <button className={'source-tab ' + (device === 'none' ? 'active' : '')} onClick={() => pickDevice('none')}>⚠️ بلا حظر ({stats.withoutDevice})</button>
                </div>
            </div>

            <div className='page-header-row'>
                <div className='search-bar-container'>
                    <input
                        type='text'
                        className='banned-search-input'
                        placeholder='🔍 ابحث بالاسم، البريد، أو HalaID...'
                        value={searchInput}
                        onChange={(e) => setSearchInput(e.target.value)}
                    />
                    {searchInput && <button className='clear-search-btn' onClick={() => setSearchInput('')}>✕</button>}
                </div>
                <button onClick={fetchAccounts} className='refresh-btn'>تحديث 🔄</button>
            </div>

            {loading ? (
                <LoadingSpinner text='جاري تحميل الحسابات المحظورة...' />
            ) : accounts.length === 0 ? (
                <div className='no-devices'><p>📭 {search ? 'لا توجد نتائج للبحث' : 'لا توجد حسابات محظورة دائماً'}</p></div>
            ) : (
                <>
                    <div className='results-count'>عرض {accounts.length} من أصل {total}</div>
                    <div className='devices-grid'>
                        {accounts.map((a) => {
                            const u = a.user;
                            const chip = deviceChip(a.device);
                            return (
                                <div key={a.id} className='device-card'>
                                    <div className='device-card-header'>
                                        <div className='device-user'>
                                            <img
                                                src={u.profileImage ? getImageUrl(u.profileImage) : getDefaultAvatar(u.name)}
                                                alt={u.name}
                                                className='device-user-avatar'
                                                onError={(e) => { e.target.src = getDefaultAvatar(u.name || '?'); }}
                                            />
                                            <div className='device-user-info'>
                                                <span className='user-link' onClick={() => onViewUserDetail && onViewUserDetail(u._id)}>
                                                    {u.name}
                                                    {u.isPremium && <span className='premium-badge'>⭐</span>}
                                                </span>
                                                <small dir='ltr'>{u.email}</small>
                                                {u.halaId && <small className='hala-id' dir='ltr'>ID: {u.halaId}</small>}
                                            </div>
                                        </div>
                                        <span className={'ban-source ' + (a.suspendedBy ? 'admin' : 'auto')}>
                                            {a.suspendedBy ? `👤 ${a.suspendedBy.name || 'أدمن'}` : '🤖 تلقائي'}
                                        </span>
                                    </div>

                                    <div className='user-meta-grid'>
                                        {u.gender && <span className='user-meta-chip'>{u.gender === 'female' ? '♀️ أنثى' : '♂️ ذكر'}</span>}
                                        {u.age && <span className='user-meta-chip'>🎂 {u.age}</span>}
                                        {u.country && <span className='user-meta-chip'>🌍 {u.country}</span>}
                                        {u.city && <span className='user-meta-chip'>📍 {u.city}</span>}
                                        <span className='user-meta-chip' style={chip.style}>{chip.icon} {chip.text}</span>
                                        {u.bannedWords?.isBanned && <span className='user-meta-chip banned'>🚫 محظور كلامي</span>}
                                    </div>

                                    <div className='device-details'>
                                        <div className='detail-row'>
                                            <span className='detail-label'>📌 السبب:</span>
                                            <span className='detail-value'>{a.reason || 'مخالفة شروط الاستخدام'}</span>
                                        </div>
                                        <div className='detail-row'>
                                            <span className='detail-label'>📅 تاريخ التعليق:</span>
                                            <span className='detail-value'>{a.suspendedAt ? formatDateTime(a.suspendedAt) : '—'}</span>
                                        </div>
                                        {a.totalSuspensions > 1 && (
                                            <div className='detail-row'>
                                                <span className='detail-label'>🔁 مرات التعليق:</span>
                                                <span className='detail-value'>{a.totalSuspensions}</span>
                                            </div>
                                        )}
                                        {u.createdAt && (
                                            <div className='detail-row'>
                                                <span className='detail-label'>👤 إنشاء الحساب:</span>
                                                <span className='detail-value'>{formatDateTime(u.createdAt)}</span>
                                            </div>
                                        )}
                                        {u.lastLogin && (
                                            <div className='detail-row'>
                                                <span className='detail-label'>🕐 آخر دخول:</span>
                                                <span className='detail-value'>{formatDateTime(u.lastLogin)}</span>
                                            </div>
                                        )}
                                        {a.device?.rejectedAttempts > 0 && (
                                            <div className='detail-row'>
                                                <span className='detail-label'>🚫 محاولات مرفوضة:</span>
                                                <span className='detail-value warning'>
                                                    {a.device.rejectedAttempts}
                                                    {a.device.lastAttempt?.action && ` (آخرها: ${a.device.lastAttempt.action})`}
                                                </span>
                                            </div>
                                        )}
                                    </div>

                                    <div className='device-actions'>
                                        <button className='unban-btn' onClick={() => handleUnsuspend(u)}>
                                            ✅ إلغاء التعليق
                                        </button>
                                        {a.device?.status !== 'none' && !a.device?.sharedRecord && (
                                            <button className='view-user-btn' onClick={() => handleUnbanDeviceOnly(u)} title='يبقى الحساب موقوفاً — يُسمح للجهاز بحساب جديد'>
                                                🔓 الجهاز فقط
                                            </button>
                                        )}
                                        <button className='view-user-btn' onClick={() => onViewUserDetail && onViewUserDetail(u._id)}>
                                            👁️ ملف المستخدم
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    {totalPages > 1 && (
                        <div className='pagination-row'>
                            <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} className='page-btn'>← السابق</button>
                            <span className='page-info'>صفحة {page} من {totalPages}</span>
                            <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)} className='page-btn'>التالي →</button>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}

export default PermanentBans;
