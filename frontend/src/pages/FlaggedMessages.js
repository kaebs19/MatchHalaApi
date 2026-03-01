import React, { useState, useEffect } from 'react';
import { getFlaggedMessages } from '../services/api';
import { useToast } from '../components/Toast';
import LoadingSpinner from '../components/LoadingSpinner';
import StatCard from '../components/StatCard';
import DataTable from '../components/DataTable';
import { formatDateTime } from '../utils/formatters';
import { getSeverityBadge, getChatTypeBadge } from '../utils/badgeHelpers';
import { getImageUrl, getDefaultAvatar } from '../config';
import './FlaggedMessages.css';

function FlaggedMessages() {
    const [messages, setMessages] = useState([]);
    const [stats, setStats] = useState({ total: 0, high: 0, medium: 0, low: 0 });
    const [loading, setLoading] = useState(true);
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [total, setTotal] = useState(0);
    const [severityFilter, setSeverityFilter] = useState('');
    const [chatTypeFilter, setChatTypeFilter] = useState('');
    const { showToast } = useToast();

    useEffect(() => {
        fetchFlaggedMessages();
    }, [page, severityFilter, chatTypeFilter]);

    const fetchFlaggedMessages = async () => {
        try {
            setLoading(true);
            const params = { page, limit: 20 };
            if (severityFilter) params.severity = severityFilter;
            if (chatTypeFilter) params.chatType = chatTypeFilter;

            const response = await getFlaggedMessages(params);
            if (response.success) {
                setMessages(response.data.messages || []);
                setStats(response.data.stats || {});
                setTotalPages(response.data.totalPages || 1);
                setTotal(response.data.total || 0);
            }
        } catch (error) {
            console.error('خطأ في جلب الرسائل المُبلّغة:', error);
            showToast('فشل في جلب البيانات', 'error');
        } finally {
            setLoading(false);
        }
    };

    if (loading && page === 1) {
        return <LoadingSpinner text="جاري تحميل الرسائل المُبلّغة..." />;
    }

    const columns = [
        {
            key: 'sender',
            label: 'المرسل',
            render: (msg) => (
                <div className="fm-user">
                    <img
                        src={msg.sender?.profileImage ? getImageUrl(msg.sender.profileImage) : getDefaultAvatar(msg.sender?.name)}
                        alt={msg.sender?.name}
                        className="fm-avatar"
                        onError={(e) => { e.target.onerror = null; e.target.src = getDefaultAvatar(msg.sender?.name); }}
                    />
                    <div>
                        <span className="fm-name">
                            {msg.sender?.name || 'محذوف'}
                            {msg.sender?.isPremium && <span className="premium-badge">👑</span>}
                        </span>
                        <small className="fm-email">{msg.sender?.email || ''}</small>
                    </div>
                </div>
            )
        },
        {
            key: 'content',
            label: 'محتوى الرسالة',
            render: (msg) => (
                <div className="fm-content-text">
                    {msg.content?.substring(0, 80)}{msg.content?.length > 80 ? '...' : ''}
                </div>
            )
        },
        {
            key: 'bannedWords',
            label: 'الكلمات المحظورة',
            render: (msg) => (
                <div className="fm-words">
                    {msg.bannedWordsFound?.map((w, i) => (
                        <span key={i} className={`word-badge ${w.severity}`}>{w.word}</span>
                    ))}
                </div>
            )
        },
        {
            key: 'severity',
            label: 'الخطورة',
            render: (msg) => getSeverityBadge(msg.bannedWordSeverity)
        },
        {
            key: 'chatType',
            label: 'النوع',
            render: (msg) => getChatTypeBadge(msg.chatType)
        },
        {
            key: 'date',
            label: 'التاريخ',
            render: (msg) => <span className="fm-date">{formatDateTime(msg.createdAt)}</span>
        }
    ];

    return (
        <div className="flagged-messages-page">
            {/* بطاقات الإحصائيات */}
            <div className="stats-grid">
                <StatCard icon="⚠️" value={stats.total} label="إجمالي المُبلّغة" color="purple" />
                <StatCard icon="🔴" value={stats.high} label="خطورة عالية" color="red" className="high" />
                <StatCard icon="🟠" value={stats.medium} label="خطورة متوسطة" color="orange" className="medium" />
                <StatCard icon="🔵" value={stats.low} label="خطورة منخفضة" color="blue" className="low" />
            </div>

            {/* الفلاتر */}
            <div className="fm-filters">
                <div className="filter-group">
                    <label>الخطورة:</label>
                    <select value={severityFilter} onChange={(e) => { setSeverityFilter(e.target.value); setPage(1); }}>
                        <option value="">الكل</option>
                        <option value="high">عالية</option>
                        <option value="medium">متوسطة</option>
                        <option value="low">منخفضة</option>
                    </select>
                </div>
                <div className="filter-group">
                    <label>النوع:</label>
                    <select value={chatTypeFilter} onChange={(e) => { setChatTypeFilter(e.target.value); setPage(1); }}>
                        <option value="">الكل</option>
                        <option value="conversation">محادثة خاصة</option>
                        <option value="room">غرفة</option>
                    </select>
                </div>
            </div>

            {/* الجدول */}
            <DataTable
                columns={columns}
                data={messages}
                loading={loading && page > 1}
                headerTitle={`الرسائل المُبلّغة (${total})`}
                emptyIcon="✅"
                emptyMessage="لا توجد رسائل مُبلّغة"
                rowClassName={(msg) => msg.bannedWordSeverity === 'high' ? 'fm-row-high' : ''}
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

export default FlaggedMessages;
