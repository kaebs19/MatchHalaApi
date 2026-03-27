import React, { useState, useEffect } from 'react';
import { getSuperLikes } from '../services/api';
import { useToast } from '../components/Toast';
import LoadingSpinner from '../components/LoadingSpinner';
import StatCard from '../components/StatCard';
import DataTable from '../components/DataTable';
import { formatDateTime } from '../utils/formatters';
import { getConversationStatusBadge } from '../utils/badgeHelpers';
import { getImageUrl, getDefaultAvatar } from '../config';
import './SuperLikes.css';

function SuperLikes() {
    const [superLikes, setSuperLikes] = useState([]);
    const [stats, setStats] = useState({ total: 0, last7Days: 0, conversionRate: 0, conversions: 0 });
    const [loading, setLoading] = useState(true);
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [total, setTotal] = useState(0);
    const { showToast } = useToast();

    useEffect(() => {
        fetchSuperLikes();
    }, [page]);

    const fetchSuperLikes = async () => {
        try {
            setLoading(true);
            const response = await getSuperLikes({ page, limit: 20 });
            if (response.success) {
                setSuperLikes(response.data.superLikes || []);
                setStats(response.data.stats || {});
                setTotalPages(response.data.totalPages || 1);
                setTotal(response.data.total || 0);
            }
        } catch (error) {
            console.error('خطأ في جلب Super Likes:', error);
            showToast('فشل في جلب البيانات', 'error');
        } finally {
            setLoading(false);
        }
    };

    const renderUser = (user) => (
        <div className="sl-user">
            <img
                src={user?.profileImage ? getImageUrl(user.profileImage) : getDefaultAvatar(user?.name)}
                alt={user?.name}
                className="sl-avatar"
                onError={(e) => { e.target.onerror = null; e.target.src = getDefaultAvatar(user?.name); }}
            />
            <div>
                <span className="sl-name">
                    {user?.name || 'محذوف'}
                    {user?.isPremium && <span className="premium-badge">👑</span>}
                    {user?.verification?.isVerified && <span className="verified-badge">✓</span>}
                </span>
                <small className="sl-email">{user?.email || ''}</small>
            </div>
        </div>
    );

    if (loading && page === 1) {
        return <LoadingSpinner text="جاري تحميل Super Likes..." />;
    }

    const columns = [
        { key: 'sender', label: 'المرسل', render: (sl) => renderUser(sl.sender) },
        { key: 'arrow', label: '', render: () => <span className="sl-arrow">⚡→</span> },
        { key: 'receiver', label: 'المستقبل', render: (sl) => renderUser(sl.receiver) },
        { key: 'date', label: 'التاريخ', render: (sl) => <span className="sl-date">{formatDateTime(sl.createdAt)}</span> },
        { key: 'status', label: 'حالة المحادثة', render: (sl) => getConversationStatusBadge(sl.conversation) }
    ];

    return (
        <div className="super-likes-page">
            {/* بطاقات الإحصائيات */}
            <div className="stats-grid">
                <StatCard icon="⚡" value={stats.total} label="إجمالي Super Likes" color="violet" />
                <StatCard icon="📅" value={stats.last7Days} label="آخر 7 أيام" color="blue" />
                <StatCard icon="💬" value={`${stats.conversionRate}%`} label="نسبة التحويل للمحادثة" color="green" />
            </div>

            {/* الجدول */}
            <DataTable
                columns={columns}
                data={superLikes}
                loading={loading && page > 1}
                headerTitle={`سجل Super Likes (${total})`}
                emptyIcon="⚡"
                emptyMessage="لا يوجد Super Likes حتى الآن"
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

export default SuperLikes;
