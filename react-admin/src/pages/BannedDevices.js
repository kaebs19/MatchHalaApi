import React, { useState, useEffect, useCallback } from 'react';
import { getBannedDevices, unbanDevice, unbanBulkDevices } from '../services/api';
import { useToast } from '../components/Toast';
import LoadingSpinner from '../components/LoadingSpinner';
import { getImageUrl, getDefaultAvatar } from '../config';
import { formatDateTime } from '../utils/formatters';
import './BannedDevices.css';

function BannedDevices({ onViewUserDetail }) {
    const [devices, setDevices] = useState([]);
    const [loading, setLoading] = useState(true);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [search, setSearch] = useState('');
    const [searchInput, setSearchInput] = useState('');
    const [source, setSource] = useState('all'); // all | manual | auto
    const [stats, setStats] = useState({
        totalActive: 0, today: 0, thisWeek: 0, thisMonth: 0,
        manualCount: 0, autoCount: 0
    });
    const [bulkLoading, setBulkLoading] = useState(false);
    const { showToast } = useToast();

    const fetchDevices = useCallback(async () => {
        try {
            setLoading(true);
            const response = await getBannedDevices({ search, page, limit: 50, source });
            if (response.success) {
                setDevices(response.data.devices || []);
                setTotal(response.data.total || 0);
                setTotalPages(response.data.totalPages || 1);
                setStats(response.data.stats || stats);
            }
        } catch (err) {
            showToast('فشل في تحميل الأجهزة المحظورة', 'error');
        } finally {
            setLoading(false);
        }
        // eslint-disable-next-line
    }, [search, page, source]);

    useEffect(() => { fetchDevices(); }, [fetchDevices]);

    // Debounce search
    useEffect(() => {
        const t = setTimeout(() => {
            setPage(1);
            setSearch(searchInput);
        }, 400);
        return () => clearTimeout(t);
    }, [searchInput]);

    // عند تغيير المصدر — ارجع للصفحة الأولى
    const handleSourceChange = (newSource) => {
        if (newSource === source) return;
        setSource(newSource);
        setPage(1);
    };

    const handleUnban = async (userId) => {
        if (!userId) {
            showToast('لا يمكن فك الحظر — معرف المستخدم غير موجود', 'error');
            return;
        }
        if (!window.confirm('هل أنت متأكد من فك حظر هذا الجهاز؟')) return;
        try {
            const res = await unbanDevice(userId);
            if (res.success) {
                showToast('تم فك حظر الجهاز بنجاح', 'success');
                fetchDevices();
            }
        } catch (err) {
            showToast('فشل في فك الحظر', 'error');
        }
    };

    // ✅ فك حظر جماعي للأجهزة التلقائية فقط (auto + spam_system)
    const handleBulkUnbanAuto = async () => {
        const count = stats.autoCount;
        if (count === 0) {
            showToast('لا توجد أجهزة محظورة تلقائياً حالياً', 'info');
            return;
        }
        // تأكيد مزدوج — لأن العملية لا تُلغى
        const first = window.confirm(
            `سيتم فك حظر ${count} جهاز محظور تلقائياً + فك تعليق حساباتهم.\n\n` +
            `هذا يشمل: حظر السبام التلقائي + الحظر التلقائي عند تسجيل دخول حساب موقوف.\n\n` +
            `الحظر اليدوي (من الأدمن) لن يتأثر.\n\nهل تريد المتابعة؟`
        );
        if (!first) return;

        const confirmText = window.prompt(
            `للتأكيد، اكتب: AUTO`
        );
        if (confirmText !== 'AUTO') {
            showToast('تم الإلغاء', 'info');
            return;
        }

        try {
            setBulkLoading(true);
            const res = await unbanBulkDevices('auto');
            if (res.success) {
                showToast(res.message || `تم فك حظر ${res.data?.unbannedDevices || 0} جهاز`, 'success');
                fetchDevices();
            }
        } catch (err) {
            showToast('فشل في فك الحظر الجماعي', 'error');
        } finally {
            setBulkLoading(false);
        }
    };

    const sourceLabel = (bannedBy) => {
        if (bannedBy === 'admin') return { text: 'يدوي', icon: '👤', cls: 'admin' };
        if (bannedBy === 'spam_system') return { text: 'سبام', icon: '🛡️', cls: 'auto' };
        return { text: 'تلقائي', icon: '🤖', cls: 'auto' };
    };

    return (
        <div className='banned-devices-page'>
            {/* Stats Cards */}
            <div className='banned-stats-row'>
                <div className='banned-stat-card total'>
                    <div className='stat-icon'>📵</div>
                    <div className='stat-info'>
                        <div className='stat-value'>{stats.totalActive}</div>
                        <div className='stat-label'>إجمالي المحظورة</div>
                    </div>
                </div>
                <div className='banned-stat-card manual'>
                    <div className='stat-icon'>👤</div>
                    <div className='stat-info'>
                        <div className='stat-value'>{stats.manualCount}</div>
                        <div className='stat-label'>يدوي (أدمن)</div>
                    </div>
                </div>
                <div className='banned-stat-card auto'>
                    <div className='stat-icon'>🤖</div>
                    <div className='stat-info'>
                        <div className='stat-value'>{stats.autoCount}</div>
                        <div className='stat-label'>تلقائي</div>
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
                    <div className='stat-icon'>🗓️</div>
                    <div className='stat-info'>
                        <div className='stat-value'>{stats.thisMonth}</div>
                        <div className='stat-label'>الشهر</div>
                    </div>
                </div>
            </div>

            {/* Filter Tabs + Bulk Action */}
            <div className='banned-filter-row'>
                <div className='source-tabs'>
                    <button
                        className={'source-tab ' + (source === 'all' ? 'active' : '')}
                        onClick={() => handleSourceChange('all')}
                    >
                        الكل ({stats.totalActive})
                    </button>
                    <button
                        className={'source-tab ' + (source === 'manual' ? 'active' : '')}
                        onClick={() => handleSourceChange('manual')}
                    >
                        👤 يدوي ({stats.manualCount})
                    </button>
                    <button
                        className={'source-tab ' + (source === 'auto' ? 'active' : '')}
                        onClick={() => handleSourceChange('auto')}
                    >
                        🤖 تلقائي ({stats.autoCount})
                    </button>
                </div>

                <button
                    className='bulk-unban-btn'
                    onClick={handleBulkUnbanAuto}
                    disabled={bulkLoading || stats.autoCount === 0}
                    title='فك حظر كل الأجهزة المحظورة تلقائياً (auto + spam) دون لمس الحظر اليدوي'
                >
                    {bulkLoading ? '⏳ جاري...' : `🔓 فك التلقائي (${stats.autoCount})`}
                </button>
            </div>

            {/* Search Bar */}
            <div className='page-header-row'>
                <div className='search-bar-container'>
                    <input
                        type='text'
                        className='banned-search-input'
                        placeholder='🔍 ابحث بالاسم، البريد، أو البصمة...'
                        value={searchInput}
                        onChange={(e) => setSearchInput(e.target.value)}
                    />
                    {searchInput && (
                        <button className='clear-search-btn' onClick={() => setSearchInput('')}>✕</button>
                    )}
                </div>
                <button onClick={fetchDevices} className='refresh-btn'>تحديث 🔄</button>
            </div>

            {loading ? (
                <LoadingSpinner text='جاري تحميل الأجهزة المحظورة...' />
            ) : devices.length === 0 ? (
                <div className='no-devices'>
                    <p>📭 {search ? 'لا توجد نتائج للبحث' : 'لا توجد أجهزة محظورة'}</p>
                </div>
            ) : (
                <>
                    <div className='results-count'>
                        عرض {devices.length} من أصل {total}
                    </div>
                    <div className='devices-grid'>
                        {devices.map((d) => {
                            const src = sourceLabel(d.bannedBy);
                            const u = d.user;
                            const dInfo = d.deviceInfo || {};
                            return (
                                <div key={d.id} className='device-card'>
                                    {/* رأس البطاقة: المستخدم + مصدر الحظر */}
                                    <div className='device-card-header'>
                                        {u ? (
                                            <div className='device-user'>
                                                <img
                                                    src={u.profileImage ? getImageUrl(u.profileImage) : getDefaultAvatar(u.name)}
                                                    alt={u.name}
                                                    className='device-user-avatar'
                                                    onError={(e) => { e.target.src = getDefaultAvatar(u.name || '?'); }}
                                                />
                                                <div className='device-user-info'>
                                                    <span
                                                        className='user-link'
                                                        onClick={() => onViewUserDetail && onViewUserDetail(u._id)}
                                                    >
                                                        {u.name}
                                                        {u.isPremium && <span className='premium-badge'>⭐</span>}
                                                    </span>
                                                    <small dir='ltr'>{u.email}</small>
                                                    {u.halaId && (
                                                        <small className='hala-id' dir='ltr'>ID: {u.halaId}</small>
                                                    )}
                                                </div>
                                            </div>
                                        ) : (
                                            <div className='device-user'>
                                                <div className='device-user-avatar' style={{background:'#e0e0e0'}}>?</div>
                                                <span style={{color:'#999'}}>مستخدم محذوف</span>
                                            </div>
                                        )}
                                        <span className={'ban-source ' + src.cls}>
                                            {src.icon} {src.text}
                                        </span>
                                    </div>

                                    {/* معلومات إضافية للمستخدم */}
                                    {u && (
                                        <div className='user-meta-grid'>
                                            {u.gender && (
                                                <span className='user-meta-chip'>
                                                    {u.gender === 'female' ? '♀️ أنثى' : '♂️ ذكر'}
                                                </span>
                                            )}
                                            {u.age && <span className='user-meta-chip'>🎂 {u.age}</span>}
                                            {u.country && <span className='user-meta-chip'>🌍 {u.country}</span>}
                                            {u.city && <span className='user-meta-chip'>📍 {u.city}</span>}
                                            {u.suspension?.isSuspended && (
                                                <span className='user-meta-chip suspended'>⛔ موقوف</span>
                                            )}
                                            {u.bannedWords?.isBanned && (
                                                <span className='user-meta-chip banned'>🚫 محظور كلامي</span>
                                            )}
                                        </div>
                                    )}

                                    {/* تفاصيل الحظر */}
                                    <div className='device-details'>
                                        <div className='detail-row'>
                                            <span className='detail-label'>📌 السبب:</span>
                                            <span className='detail-value'>{d.reasonDetails || d.reason}</span>
                                        </div>
                                        <div className='detail-row'>
                                            <span className='detail-label'>🔑 البصمة:</span>
                                            <code className='fingerprint'>
                                                {d.pendingFingerprint ? '⏳ قيد الانتظار' : d.fingerprint}
                                            </code>
                                        </div>
                                        {(dInfo.model || dInfo.systemVersion) && (
                                            <div className='detail-row'>
                                                <span className='detail-label'>📱 الجهاز:</span>
                                                <span className='detail-value'>
                                                    {dInfo.deviceName || dInfo.model || '?'}
                                                    {dInfo.systemVersion ? ` · iOS ${dInfo.systemVersion}` : ''}
                                                </span>
                                            </div>
                                        )}
                                        <div className='detail-row'>
                                            <span className='detail-label'>📅 تاريخ الحظر:</span>
                                            <span className='detail-value'>{formatDateTime(d.createdAt)}</span>
                                        </div>
                                        {u?.createdAt && (
                                            <div className='detail-row'>
                                                <span className='detail-label'>👤 إنشاء الحساب:</span>
                                                <span className='detail-value'>{formatDateTime(u.createdAt)}</span>
                                            </div>
                                        )}
                                        {u?.lastLogin && (
                                            <div className='detail-row'>
                                                <span className='detail-label'>🕐 آخر دخول:</span>
                                                <span className='detail-value'>{formatDateTime(u.lastLogin)}</span>
                                            </div>
                                        )}
                                        {d.rejectedAttempts > 0 && (
                                            <div className='detail-row'>
                                                <span className='detail-label'>🚫 محاولات مرفوضة:</span>
                                                <span className='detail-value warning'>
                                                    {d.rejectedAttempts}
                                                    {d.lastAttempt?.action && ` (آخرها: ${d.lastAttempt.action})`}
                                                </span>
                                            </div>
                                        )}
                                        {d.admin && (
                                            <div className='detail-row'>
                                                <span className='detail-label'>👤 الأدمن:</span>
                                                <span className='detail-value'>{d.admin.name}</span>
                                            </div>
                                        )}
                                    </div>

                                    <div className='device-actions'>
                                        <button
                                            className='unban-btn'
                                            onClick={() => handleUnban(u && u._id)}
                                            disabled={!u}
                                        >
                                            🔓 فك الحظر
                                        </button>
                                        {u && (
                                            <button
                                                className='view-user-btn'
                                                onClick={() => onViewUserDetail && onViewUserDetail(u._id)}
                                            >
                                                👁️ ملف المستخدم
                                            </button>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    {/* Pagination */}
                    {totalPages > 1 && (
                        <div className='pagination-row'>
                            <button
                                disabled={page <= 1}
                                onClick={() => setPage(p => p - 1)}
                                className='page-btn'
                            >
                                ← السابق
                            </button>
                            <span className='page-info'>صفحة {page} من {totalPages}</span>
                            <button
                                disabled={page >= totalPages}
                                onClick={() => setPage(p => p + 1)}
                                className='page-btn'
                            >
                                التالي →
                            </button>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}

export default BannedDevices;
