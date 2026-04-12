import React, { useState, useEffect, useCallback } from 'react';
import { getBannedDevices, unbanDevice } from '../services/api';
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
    const [stats, setStats] = useState({ totalActive: 0, today: 0, thisWeek: 0, thisMonth: 0 });
    const { showToast } = useToast();

    const fetchDevices = useCallback(async () => {
        try {
            setLoading(true);
            const response = await getBannedDevices({ search, page, limit: 50 });
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
    }, [search, page]);

    useEffect(() => { fetchDevices(); }, [fetchDevices]);

    // Debounce search
    useEffect(() => {
        const t = setTimeout(() => {
            setPage(1);
            setSearch(searchInput);
        }, 400);
        return () => clearTimeout(t);
    }, [searchInput]);

    const handleUnban = async (userId, deviceId) => {
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

    return (
        <div className='banned-devices-page'>
            {/* Stats Cards */}
            <div className='banned-stats-row'>
                <div className='banned-stat-card total'>
                    <div className='stat-icon'>📵</div>
                    <div className='stat-info'>
                        <div className='stat-value'>{stats.totalActive}</div>
                        <div className='stat-label'>إجمالي الأجهزة المحظورة</div>
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
                        <div className='stat-label'>هذا الأسبوع</div>
                    </div>
                </div>
                <div className='banned-stat-card month'>
                    <div className='stat-icon'>🗓️</div>
                    <div className='stat-info'>
                        <div className='stat-value'>{stats.thisMonth}</div>
                        <div className='stat-label'>هذا الشهر</div>
                    </div>
                </div>
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
                        {devices.map((d) => (
                            <div key={d.id} className='device-card'>
                                <div className='device-card-header'>
                                    {d.user ? (
                                        <div className='device-user'>
                                            <img
                                                src={d.user.profileImage ? getImageUrl(d.user.profileImage) : getDefaultAvatar(d.user.name)}
                                                alt={d.user.name}
                                                className='device-user-avatar'
                                                onError={(e) => { e.target.src = getDefaultAvatar(d.user.name || '?'); }}
                                            />
                                            <div className='device-user-info'>
                                                <span
                                                    className='user-link'
                                                    onClick={() => onViewUserDetail && onViewUserDetail(d.user._id)}
                                                >
                                                    {d.user.name}
                                                </span>
                                                <small dir='ltr'>{d.user.email}</small>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className='device-user'>
                                            <div className='device-user-avatar' style={{background:'#e0e0e0'}}>?</div>
                                            <span style={{color:'#999'}}>مستخدم محذوف</span>
                                        </div>
                                    )}
                                    <span className={'ban-source ' + (d.bannedBy === 'admin' ? 'admin' : 'auto')}>
                                        {d.bannedBy === 'admin' ? '👤 يدوي' : '🤖 تلقائي'}
                                    </span>
                                </div>

                                <div className='device-details'>
                                    <div className='detail-row'>
                                        <span className='detail-label'>📌 السبب:</span>
                                        <span className='detail-value'>{d.reasonDetails || d.reason}</span>
                                    </div>
                                    <div className='detail-row'>
                                        <span className='detail-label'>🔑 البصمة:</span>
                                        <code className='fingerprint'>{d.fingerprint}</code>
                                    </div>
                                    <div className='detail-row'>
                                        <span className='detail-label'>📅 تاريخ الحظر:</span>
                                        <span className='detail-value'>{formatDateTime(d.createdAt)}</span>
                                    </div>
                                    {d.rejectedAttempts > 0 && (
                                        <div className='detail-row'>
                                            <span className='detail-label'>🚫 محاولات دخول مرفوضة:</span>
                                            <span className='detail-value warning'>{d.rejectedAttempts}</span>
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
                                        onClick={() => handleUnban(d.user && d.user._id, d.id)}
                                        disabled={!d.user}
                                    >
                                        🔓 فك الحظر
                                    </button>
                                </div>
                            </div>
                        ))}
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
