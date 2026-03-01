import React, { useState, useEffect } from 'react';
import { getSwipesStats, getSwipesList } from '../services/api';
import { useToast } from '../components/Toast';
import LoadingSpinner from '../components/LoadingSpinner';
import StatCard from '../components/StatCard';
import DataTable from '../components/DataTable';
import { formatDateTime } from '../utils/formatters';
import { getImageUrl, getDefaultAvatar } from '../config';
import './Swipes.css';

function Swipes() {
    const [swipes, setSwipes] = useState([]);
    const [stats, setStats] = useState({
        totalSwipes: 0,
        totalLikes: 0,
        totalDislikes: 0,
        totalSuperlikes: 0,
        swipesLast7Days: 0,
        likeRate: 0
    });
    const [loading, setLoading] = useState(true);
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [total, setTotal] = useState(0);
    const [filterType, setFilterType] = useState('');
    const { showToast } = useToast();

    useEffect(() => {
        fetchStats();
    }, []);

    useEffect(() => {
        fetchSwipes();
    }, [page, filterType]);

    const fetchStats = async () => {
        try {
            const response = await getSwipesStats();
            if (response.success) {
                setStats(response.data);
            }
        } catch (error) {
            console.error('خطأ في جلب إحصائيات Swipes:', error);
        }
    };

    const fetchSwipes = async () => {
        try {
            setLoading(true);
            const params = { page, limit: 20 };
            if (filterType) params.type = filterType;
            const response = await getSwipesList(params);
            if (response.success) {
                setSwipes(response.data.swipes || []);
                setTotalPages(response.data.totalPages || 1);
                setTotal(response.data.total || 0);
            }
        } catch (error) {
            console.error('خطأ في جلب Swipes:', error);
            showToast('فشل في جلب البيانات', 'error');
        } finally {
            setLoading(false);
        }
    };

    const renderUser = (user) => (
        <div className="swipe-user">
            <img
                src={user?.profileImage ? getImageUrl(user.profileImage) : getDefaultAvatar(user?.name)}
                alt={user?.name}
                className="swipe-avatar"
                onError={(e) => { e.target.onerror = null; e.target.src = getDefaultAvatar(user?.name); }}
            />
            <div>
                <span className="swipe-name">
                    {user?.name || 'محذوف'}
                    {user?.isPremium && <span className="premium-badge">👑</span>}
                    {user?.verification?.isVerified && <span className="verified-badge">✓</span>}
                </span>
                <small className="swipe-email">{user?.email || ''}</small>
            </div>
        </div>
    );

    const getTypeBadge = (type) => {
        switch (type) {
            case 'like':
                return <span className="type-badge like">❤️ إعجاب</span>;
            case 'dislike':
                return <span className="type-badge dislike">✖️ تمرير</span>;
            case 'superlike':
                return <span className="type-badge superlike">⚡ Super Like</span>;
            default:
                return <span className="type-badge">{type}</span>;
        }
    };

    if (loading && page === 1) {
        return <LoadingSpinner text="جاري تحميل بيانات Swipes..." />;
    }

    const columns = [
        { key: 'swiper', label: 'المستخدم', render: (s) => renderUser(s.swiper) },
        { key: 'arrow', label: '', render: (s) => <span className="swipe-arrow">{s.type === 'like' ? '❤️→' : s.type === 'superlike' ? '⚡→' : '✖️→'}</span> },
        { key: 'swiped', label: 'الهدف', render: (s) => renderUser(s.swiped) },
        { key: 'type', label: 'النوع', render: (s) => getTypeBadge(s.type) },
        { key: 'date', label: 'التاريخ', render: (s) => <span className="swipe-date">{formatDateTime(s.createdAt)}</span> }
    ];

    return (
        <div className="swipes-page">
            {/* بطاقات الإحصائيات */}
            <div className="stats-grid">
                <StatCard icon="👆" value={stats.totalSwipes} label="إجمالي Swipes" color="purple" />
                <StatCard icon="❤️" value={stats.totalLikes} label="إعجابات" color="pink" />
                <StatCard icon="✖️" value={stats.totalDislikes} label="تمريرات" color="gray" />
                <StatCard icon="⚡" value={stats.totalSuperlikes} label="Super Likes" color="violet" />
                <StatCard icon="📅" value={stats.swipesLast7Days} label="آخر 7 أيام" color="blue" />
                <StatCard icon="📊" value={`${stats.likeRate}%`} label="نسبة الإعجاب" color="green" />
            </div>

            {/* فلتر النوع */}
            <div className="filter-bar">
                <label>تصفية حسب النوع:</label>
                <select value={filterType} onChange={(e) => { setFilterType(e.target.value); setPage(1); }}>
                    <option value="">الكل</option>
                    <option value="like">إعجاب</option>
                    <option value="dislike">تمرير</option>
                    <option value="superlike">Super Like</option>
                </select>
            </div>

            {/* الجدول */}
            <DataTable
                columns={columns}
                data={swipes}
                loading={loading && page > 1}
                headerTitle={`سجل Swipes (${total})`}
                emptyIcon="👆"
                emptyMessage="لا يوجد Swipes حتى الآن"
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

export default Swipes;
