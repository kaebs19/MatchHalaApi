import React, { useState, useEffect } from 'react';
import {
    getAllConversations,
    deleteConversation,
    toggleConversationActive,
    lockConversation,
    deleteConversationMessages
} from '../services/api';
import { useToast } from '../components/Toast';
import LoadingSpinner from '../components/LoadingSpinner';
import Pagination from '../components/Pagination';
import ConversationDetail from './ConversationDetail';
import ConversationMessages from './ConversationMessages';
import { formatDate } from '../utils/formatters';
import { getImageUrl, getDefaultAvatar } from '../config';
import './Conversations.css';

function Conversations() {
    const [conversations, setConversations] = useState([]);
    const [loading, setLoading] = useState(true);
    const [filterStatus, setFilterStatus] = useState('all');
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedConv, setSelectedConv] = useState(null);
    const [showActionsModal, setShowActionsModal] = useState(false);
    const [viewingConversationId, setViewingConversationId] = useState(null);
    const [directToMessages, setDirectToMessages] = useState(false);
    const [currentPage, setCurrentPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [totalItems, setTotalItems] = useState(0);
    const itemsPerPage = 20;
    const { showToast } = useToast();

    useEffect(() => {
        fetchConversations();
    }, [filterStatus, currentPage]);

    // Reset page when search changes
    useEffect(() => {
        setCurrentPage(1);
    }, [searchTerm]);

    const fetchConversations = async () => {
        try {
            setLoading(true);
            const filters = {};
            // فقط المحادثات الخاصة (بدون المجموعات)
            filters.type = 'private';
            if (filterStatus === 'active' || filterStatus === 'inactive') {
                filters.isActive = filterStatus === 'active';
            }
            if (filterStatus === 'flagged') {
                filters.hasFlaggedMessages = 'true';
            }

            const response = await getAllConversations(currentPage, itemsPerPage, filters);
            if (response.success) {
                setConversations(response.data.conversations);
                setTotalPages(response.data.totalPages || 1);
                setTotalItems(response.data.total || response.data.conversations.length);
            }
        } catch (err) {
            console.error('خطأ في جلب المحادثات:', err);
            showToast('فشل تحميل المحادثات', 'error');
        } finally {
            setLoading(false);
        }
    };

    const handleToggleActive = async (convId) => {
        try {
            const response = await toggleConversationActive(convId);
            if (response.success) {
                setConversations(conversations.map(c =>
                    c._id === convId ? { ...c, isActive: !c.isActive } : c
                ));
                showToast(response.message, 'success');
            }
        } catch (err) {
            showToast('فشل تحديث المحادثة', 'error');
        }
    };

    const handleLock = async (convId) => {
        try {
            const response = await lockConversation(convId);
            if (response.success) {
                showToast(response.message, 'success');
                fetchConversations();
            }
        } catch (err) {
            showToast('فشل قفل/فتح المحادثة', 'error');
        }
    };

    const handleDeleteMessages = async (convId) => {
        if (!window.confirm('هل أنت متأكد من حذف جميع رسائل هذه المحادثة؟')) return;

        try {
            const response = await deleteConversationMessages(convId);
            if (response.success) {
                showToast(response.message, 'success');
                fetchConversations();
            }
        } catch (err) {
            showToast('فشل حذف الرسائل', 'error');
        }
    };

    const handleDelete = async (convId) => {
        if (!window.confirm('هل أنت متأكد من حذف هذه المحادثة نهائياً؟')) return;

        try {
            const response = await deleteConversation(convId);
            if (response.success) {
                setConversations(conversations.filter(c => c._id !== convId));
                showToast('تم حذف المحادثة', 'success');
            }
        } catch (err) {
            showToast('فشل حذف المحادثة', 'error');
        }
    };

    const openActionsModal = (conv) => {
        setSelectedConv(conv);
        setShowActionsModal(true);
    };

    const handleViewDetails = (convId) => {
        setViewingConversationId(convId);
        setDirectToMessages(false);
    };

    const handleViewMessages = (convId) => {
        setViewingConversationId(convId);
        setDirectToMessages(true);
    };

    const handleBackFromDetails = () => {
        setViewingConversationId(null);
        setDirectToMessages(false);
        fetchConversations();
    };

    // تصفية المحادثات حسب البحث
    const filteredConversations = conversations.filter(conv => {
        if (!searchTerm) return true;
        const searchLower = searchTerm.toLowerCase();
        return (
            conv.title?.toLowerCase().includes(searchLower) ||
            conv.participants?.some(p => p.name?.toLowerCase().includes(searchLower))
        );
    });

    // ترتيب حسب الأحدث
    const sortedConversations = [...filteredConversations].sort(
        (a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)
    );

    // تنسيق الوقت النسبي
    const formatRelativeTime = (date) => {
        const now = new Date();
        const then = new Date(date);
        const diffMs = now - then;
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMs / 3600000);
        const diffDays = Math.floor(diffMs / 86400000);

        if (diffMins < 1) return 'الآن';
        if (diffMins < 60) return `منذ ${diffMins} دقيقة`;
        if (diffHours < 24) return `منذ ${diffHours} ساعة`;
        if (diffDays < 7) return `منذ ${diffDays} يوم`;
        return formatDate(date);
    };

    const handleFilterChange = (status) => {
        setFilterStatus(status);
        setCurrentPage(1);
    };

    // إذا كنا نعرض رسائل محادثة مباشرة
    if (viewingConversationId && directToMessages) {
        return <ConversationMessages conversationId={viewingConversationId} onBack={handleBackFromDetails} />;
    }

    // إذا كنا نعرض تفاصيل محادثة
    if (viewingConversationId) {
        return <ConversationDetail conversationId={viewingConversationId} onBack={handleBackFromDetails} />;
    }

    return (
        <div className="conversations-page">
            {/* Header */}
            <div className="conversations-header">
                <div className="header-title">
                    <h1>💬 المحادثات الخاصة</h1>
                    <p>إدارة محادثات المستخدمين</p>
                </div>
                <button className="refresh-btn" onClick={fetchConversations}>
                    تحديث 🔄
                </button>
            </div>

            {/* Filters Bar */}
            <div className="conversations-filters">
                <div className="search-box">
                    <input
                        type="text"
                        placeholder="🔍 البحث في المحادثات..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </div>

                <div className="filter-buttons">
                    <button
                        className={`filter-btn ${filterStatus === 'all' ? 'active' : ''}`}
                        onClick={() => handleFilterChange('all')}
                    >
                        الكل ({totalItems})
                    </button>
                    <button
                        className={`filter-btn ${filterStatus === 'active' ? 'active' : ''}`}
                        onClick={() => handleFilterChange('active')}
                    >
                        نشطة
                    </button>
                    <button
                        className={`filter-btn ${filterStatus === 'inactive' ? 'active' : ''}`}
                        onClick={() => handleFilterChange('inactive')}
                    >
                        غير نشطة
                    </button>
                    <button
                        className={`filter-btn flagged ${filterStatus === 'flagged' ? 'active' : ''}`}
                        onClick={() => handleFilterChange('flagged')}
                    >
                        🚨 مُبلّغة
                    </button>
                </div>
            </div>

            {/* Conversations List */}
            {loading ? (
                <LoadingSpinner text="جاري تحميل المحادثات..." />
            ) : sortedConversations.length === 0 ? (
                <div className="no-conversations">
                    <div className="empty-icon">💬</div>
                    <p>لا توجد محادثات</p>
                    <small>ستظهر المحادثات الخاصة بين المستخدمين هنا</small>
                </div>
            ) : (
                <>
                    <div className="conversations-list">
                        {sortedConversations.map((conv, index) => (
                            <div
                                key={conv._id}
                                className={`conversation-item ${!conv.isActive ? 'inactive' : ''}`}
                                onClick={() => handleViewDetails(conv._id)}
                            >
                                {/* رقم المحادثة */}
                                <div className="conversation-number">
                                    {(currentPage - 1) * itemsPerPage + index + 1}
                                </div>

                                {/* الصور الشخصية للمشاركين */}
                                <div className="conversation-avatars">
                                    {conv.participants?.slice(0, 2).map((p, i) => (
                                        <div
                                            key={i}
                                            className="avatar"
                                            style={{
                                                background: `linear-gradient(135deg, ${i === 0 ? '#667eea' : '#764ba2'} 0%, ${i === 0 ? '#764ba2' : '#667eea'} 100%)`,
                                                zIndex: 2 - i,
                                                marginRight: i > 0 ? '-10px' : '0'
                                            }}
                                        >
                                            <img
                                                src={p.profileImage ? getImageUrl(p.profileImage) : getDefaultAvatar(p.name)}
                                                alt={p.name}
                                                onError={(e) => {
                                                    e.target.onerror = null;
                                                    e.target.src = getDefaultAvatar(p.name);
                                                }}
                                            />
                                        </div>
                                    ))}
                                </div>

                                {/* معلومات المحادثة */}
                                <div className="conversation-info">
                                    <div className="conversation-header">
                                        <h3 className="conversation-title">
                                            {conv.participants?.map(p => p.name).join(' و ') || conv.title}
                                        </h3>
                                        <span className="conversation-time">
                                            {formatRelativeTime(conv.updatedAt)}
                                        </span>
                                    </div>

                                    <div className="conversation-preview">
                                        <p className="last-message">
                                            {conv.lastMessage?.content || 'لا توجد رسائل'}
                                        </p>
                                        <div className="conversation-badges">
                                            {conv.isLocked && <span className="badge locked">🔒</span>}
                                            {!conv.isActive && <span className="badge inactive">معطلة</span>}
                                            {conv.flaggedMessagesCount > 0 && (
                                                <span className="badge flagged">
                                                    ⚠️ {conv.flaggedMessagesCount} مخالفة
                                                </span>
                                            )}
                                            <span className="message-count">
                                                {conv.metadata?.totalMessages || 0} 💬
                                            </span>
                                        </div>
                                    </div>
                                </div>

                                {/* أزرار الإجراءات السريعة */}
                                <div className="conversation-actions" onClick={(e) => e.stopPropagation()}>
                                    <button
                                        className="action-btn view-btn"
                                        onClick={() => handleViewDetails(conv._id)}
                                        title="عرض التفاصيل"
                                    >
                                        👁️
                                    </button>
                                    <button
                                        className="action-btn messages-btn"
                                        onClick={() => handleViewMessages(conv._id)}
                                        title="عرض الرسائل"
                                    >
                                        💬
                                    </button>
                                    <button
                                        className={`action-btn ${conv.isActive ? 'active' : ''}`}
                                        onClick={() => handleToggleActive(conv._id)}
                                        title={conv.isActive ? 'تعطيل' : 'تفعيل'}
                                    >
                                        {conv.isActive ? '🟢' : '🔴'}
                                    </button>
                                    <button
                                        className={`action-btn ${conv.isLocked ? 'locked' : ''}`}
                                        onClick={() => handleLock(conv._id)}
                                        title={conv.isLocked ? 'فتح' : 'قفل'}
                                    >
                                        {conv.isLocked ? '🔒' : '🔓'}
                                    </button>
                                    <button
                                        className="action-btn more"
                                        onClick={() => openActionsModal(conv)}
                                        title="المزيد"
                                    >
                                        ⋮
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>

                    <Pagination
                        currentPage={currentPage}
                        totalPages={totalPages}
                        onPageChange={setCurrentPage}
                        itemsPerPage={itemsPerPage}
                        totalItems={totalItems}
                    />
                </>
            )}

            {/* Actions Modal */}
            {showActionsModal && selectedConv && (
                <div className="modal-overlay" onClick={() => setShowActionsModal(false)}>
                    <div className="modal-content actions-modal" onClick={(e) => e.stopPropagation()}>
                        <h3>إجراءات المحادثة</h3>
                        <p className="modal-subtitle">{selectedConv.title}</p>

                        <div className="action-list">
                            <button
                                className="action-item view"
                                onClick={() => {
                                    handleViewDetails(selectedConv._id);
                                    setShowActionsModal(false);
                                }}
                            >
                                <span className="action-icon">👁️</span>
                                <span>عرض التفاصيل</span>
                            </button>

                            <button
                                className="action-item view"
                                onClick={() => {
                                    handleViewMessages(selectedConv._id);
                                    setShowActionsModal(false);
                                }}
                            >
                                <span className="action-icon">💬</span>
                                <span>عرض الرسائل</span>
                            </button>

                            <button
                                className="action-item lock"
                                onClick={() => {
                                    handleLock(selectedConv._id);
                                    setShowActionsModal(false);
                                }}
                            >
                                <span className="action-icon">
                                    {selectedConv.isLocked ? '🔓' : '🔒'}
                                </span>
                                <span>{selectedConv.isLocked ? 'فتح القفل' : 'قفل المحادثة'}</span>
                            </button>

                            <button
                                className="action-item toggle"
                                onClick={() => {
                                    handleToggleActive(selectedConv._id);
                                    setShowActionsModal(false);
                                }}
                            >
                                <span className="action-icon">
                                    {selectedConv.isActive ? '⏸️' : '▶️'}
                                </span>
                                <span>
                                    {selectedConv.isActive ? 'إلغاء التفعيل' : 'تفعيل'}
                                </span>
                            </button>

                            <button
                                className="action-item delete-messages"
                                onClick={() => {
                                    handleDeleteMessages(selectedConv._id);
                                    setShowActionsModal(false);
                                }}
                            >
                                <span className="action-icon">🗑️</span>
                                <span>حذف جميع الرسائل</span>
                            </button>

                            <button
                                className="action-item delete"
                                onClick={() => {
                                    handleDelete(selectedConv._id);
                                    setShowActionsModal(false);
                                }}
                            >
                                <span className="action-icon">❌</span>
                                <span>حذف المحادثة نهائياً</span>
                            </button>
                        </div>

                        <button
                            className="modal-close-btn"
                            onClick={() => setShowActionsModal(false)}
                        >
                            إغلاق
                        </button>
                    </div>
                </div>
            )}

        </div>
    );
}

export default Conversations;
