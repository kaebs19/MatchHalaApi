import React, { useState, useEffect } from 'react';
import { getMatchesStats, getMatchesList } from '../services/api';
import { useToast } from '../components/Toast';
import LoadingSpinner from '../components/LoadingSpinner';
import StatCard from '../components/StatCard';
import DataTable from '../components/DataTable';
import { formatDateTime } from '../utils/formatters';
import { getImageUrl, getDefaultAvatar } from '../config';
import './Matches.css';

function Matches() {
    const [matches, setMatches] = useState([]);
    const [stats, setStats] = useState({
        totalMatches: 0,
        activeMatches: 0,
        unmatchedCount: 0,
        matchesLast7Days: 0,
        matchesLast30Days: 0,
        matchRate: 0
    });
    const [loading, setLoading] = useState(true);
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [total, setTotal] = useState(0);
    const [filterStatus, setFilterStatus] = useState('');
    const { showToast } = useToast();

    useEffect(() => {
        fetchStats();
    }, []);

    useEffect(() => {
        fetchMatches();
    }, [page, filterStatus]);

    const fetchStats = async () => {
        try {
            const response = await getMatchesStats();
            if (response.success) {
                setStats(response.data);
            }
        } catch (error) {
            console.error('خطأ في جلب إحصائيات Matches:', error);
        }
    };

    const fetchMatches = async () => {
        try {
            setLoading(true);
            const params = { page, limit: 20 };
            if (filterStatus) params.status = filterStatus;
            const response = await getMatchesList(params);
            if (response.success) {
                setMatches(response.data.matches || []);
                setTotalPages(response.data.totalPages || 1);
                setTotal(response.data.total || 0);
            }
        } catch (error) {
            console.error('خطأ في جلب Matches:', error);
            showToast('فشل في جلب البيانات', 'error');
        } finally {
            setLoading(false);
        }
    };

    const renderUser = (user) => (
        <div className="match-user">
            <img
                src={user?.profileImage ? getImageUrl(user.profileImage) : getDefaultAvatar(user?.name)}
                alt={user?.name}
                className="match-avatar"
                onError={(e) => { e.target.onerror = null; e.target.src = getDefaultAvatar(user?.name); }}
            />
            <div>
                <span className="match-name">
                    {user?.name || 'محذوف'}
                    {user?.isPremium && <span className="premium-badge">👑</span>}
                    {user?.verification?.isVerified && <span className="verified-badge">✓</span>}
                </span>
                <small className="match-email">{user?.email || ''}</small>
            </div>
        </div>
    );

    const getStatusBadge = (match) => {
        if (match.isActive) {
            return <span className="status-badge active">نشط</span>;
        }
        return <span className="status-badge inactive">ملغي</span>;
    };

    if (loading && page === 1) {
        return <LoadingSpinner text="جاري تحميل بيانات Matches..." />;
    }

    const columns = [
        { key: 'user1', label: 'المستخدم الأول', render: (m) => renderUser(m.users?.[0]) },
        { key: 'arrow', label: '', render: () => <span className="match-arrow">💕</span> },
        { key: 'user2', label: 'المستخدم الثاني', render: (m) => renderUser(m.users?.[1]) },
        { key: 'status', label: 'الحالة', render: (m) => getStatusBadge(m) },
        { key: 'date', label: 'تاريخ التطابق', render: (m) => <span className="match-date">{formatDateTime(m.createdAt)}</span> }
    ];

    return (
        <div className="matches-page">
            {/* بانر رأس الصفحة */}
            <div className="page-header-banner">
                <span className="banner-icon">💕</span>
                <div>
                    <h2>سجل التطابقات</h2>
                    <p>متابعة جميع التطابقات بين المستخدمين</p>
                </div>
            </div>

            {/* بطاقات الإحصائيات */}
            <div className="stats-grid">
                <StatCard icon="💕" value={stats.totalMatches} label="إجمالي التطابقات" color="pink" />
                <StatCard icon="✅" value={stats.activeMatches} label="تطابقات نشطة" color="green" />
                <StatCard icon="💔" value={stats.unmatchedCount} label="تطابقات ملغاة" color="red" />
                <StatCard icon="📅" value={stats.matchesLast7Days} label="آخر 7 أيام" color="blue" />
                <StatCard icon="📆" value={stats.matchesLast30Days} label="آخر 30 يوم" color="cyan" />
                <StatCard icon="📊" value={`${stats.matchRate}%`} label="نسبة التطابق" color="purple" />
            </div>

            {/* فلتر الحالة */}
            <div className="filters-bar">
                <div className="filter-group">
                    <label>تصفية حسب الحالة:</label>
                    <select value={filterStatus} onChange={(e) => { setFilterStatus(e.target.value); setPage(1); }}>
                        <option value="">الكل</option>
                        <option value="active">نشط</option>
                        <option value="unmatched">ملغي</option>
                    </select>
                </div>
            </div>

            {/* الجدول */}
            <DataTable
                columns={columns}
                data={matches}
                loading={loading && page > 1}
                headerTitle={`سجل التطابقات (${total})`}
                emptyIcon="💕"
                emptyMessage="لا يوجد تطابقات حتى الآن"
            >
                {totalPages > 1 && (
                    <div className="simple-pagination">
                        <button className="page-btn" disabled={page === 1} onClick={() => setPage(p => p - 1)}>
                            السابق
                        </button>
                        <span className="page-info">صفحة {page} من {totalPages}</span>
                        <button className="page-btn" disabled={page === totalPages} onClick={() => setPage(p => p + 1)}>
                            التالي
                        </button>
                    </div>
                )}
            </DataTable>
        </div>
    );
}

export default Matches;
