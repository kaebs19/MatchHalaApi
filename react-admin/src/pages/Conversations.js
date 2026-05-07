import React, { useState, useEffect, useCallback } from 'react';
import {
    getAllConversations,
    getConversationsStats,
    deleteConversation,
    toggleConversationActive,
    lockConversation,
    deleteConversationMessages,
    getConversationMessages,
    getConversationById,
    deleteMessage,
    sendMessage,
    suspendUser,
    toggleUserActive
} from '../services/api';
import { useToast } from '../components/Toast';
import LoadingSpinner from '../components/LoadingSpinner';
import Pagination from '../components/Pagination';
import socketService from '../services/socket';
import { getImageUrl, getDefaultAvatar } from '../config';
import config from '../config';
import './Conversations.css';

function Conversations({ onViewUserDetail }) {
    // State - القائمة
    const [conversations, setConversations] = useState([]);
    const [loading, setLoading] = useState(true);
    const [stats, setStats] = useState(null);
    const [filterStatus, setFilterStatus] = useState('all');
    const [searchTerm, setSearchTerm] = useState('');
    const [searchDebounce, setSearchDebounce] = useState('');
    const [sortBy, setSortBy] = useState('updatedAt');
    const [currentPage, setCurrentPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [totalItems, setTotalItems] = useState(0);
    const itemsPerPage = 25;

    // State - المحادثة المفتوحة (split view)
    const [selectedConv, setSelectedConv] = useState(null);
    const [selectedConvData, setSelectedConvData] = useState(null);
    const [messages, setMessages] = useState([]);
    const [messagesLoading, setMessagesLoading] = useState(false);
    const [msgPage, setMsgPage] = useState(1);
    const [msgTotalPages, setMsgTotalPages] = useState(1);
    const [msgSearch, setMsgSearch] = useState('');
    const [newMessage, setNewMessage] = useState('');
    const [sending, setSending] = useState(false);
    const [imageViewer, setImageViewer] = useState(null);    // {url, sender}
    const [addedWords, setAddedWords] = useState({});        // ✅ {word: 'pending'|'added'|'duplicate'}
    const [quickAddOpen, setQuickAddOpen] = useState(false);
    const [quickAddText, setQuickAddText] = useState('');
    const [quickAddCategory, setQuickAddCategory] = useState('other');
    const [msgMenu, setMsgMenu] = useState(null);            // ✅ {message, x, y}

    // State - الإجراءات
    const [showActionsModal, setShowActionsModal] = useState(false);
    const [actionConv, setActionConv] = useState(null);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(null);

    const { showToast } = useToast();

    // ─── ✅ إضافة كلمة لقائمة الكلمات المحظورة الموحّدة ───
    const handleAddBannedWord = async (word, category = 'other') => {
        const trimmed = (word || '').trim().toLowerCase();
        if (!trimmed || addedWords[trimmed]) return;
        setAddedWords(prev => ({ ...prev, [trimmed]: 'pending' }));
        try {
            const token = localStorage.getItem('token');
            const res = await fetch(config.API_URL + '/bannedWords', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
                body: JSON.stringify({ word: trimmed, category, language: /[؀-ۿ]/.test(trimmed) ? 'ar' : 'en' })
            });
            const data = await res.json();
            if (data.success) {
                const status = (data.results?.duplicates || 0) > 0 ? 'duplicate' : 'added';
                setAddedWords(prev => ({ ...prev, [trimmed]: status }));
                showToast(status === 'added' ? `تم إضافة "${trimmed}" للقائمة المحظورة` : `"${trimmed}" موجودة مسبقاً`, status === 'added' ? 'success' : 'info');
            } else {
                setAddedWords(prev => { const n = { ...prev }; delete n[trimmed]; return n; });
                showToast(data.message || 'فشل الإضافة', 'error');
            }
        } catch (err) {
            console.error('Add banned word error:', err);
            setAddedWords(prev => { const n = { ...prev }; delete n[trimmed]; return n; });
            showToast('فشل الإضافة', 'error');
        }
    };

    // Debounce search
    useEffect(() => {
        const timer = setTimeout(() => setSearchDebounce(searchTerm), 400);
        return () => clearTimeout(timer);
    }, [searchTerm]);

    useEffect(() => {
        setCurrentPage(1);
    }, [searchDebounce, filterStatus, sortBy]);

    useEffect(() => {
        fetchConversations();
    }, [filterStatus, currentPage, searchDebounce, sortBy]);

    useEffect(() => {
        fetchStats();
    }, []);

    const fetchStats = async () => {
        try {
            const response = await getConversationsStats();
            if (response.success) setStats(response.data);
        } catch (err) {
            console.error('خطأ في جلب الإحصائيات:', err);
        }
    };

    const fetchConversations = async () => {
        try {
            setLoading(true);
            const filters = { type: 'private' };
            if (filterStatus === 'active') filters.isActive = 'true';
            if (filterStatus === 'inactive') filters.isActive = 'false';
            if (filterStatus === 'flagged') filters.hasFlaggedMessages = 'true';
            if (filterStatus === 'images') filters.hasImages = 'true';
            if (filterStatus === 'pending') filters.status = 'pending';
            if (filterStatus === 'locked') filters.isLocked = 'true';
            if (searchDebounce) filters.search = searchDebounce;
            filters.sortBy = sortBy;

            const response = await getAllConversations(currentPage, itemsPerPage, filters);
            if (response.success) {
                setConversations(response.data.conversations);
                setTotalPages(response.data.totalPages || 1);
                setTotalItems(response.data.total || 0);
            }
        } catch (err) {
            console.error('خطأ في جلب المحادثات:', err);
            showToast('فشل تحميل المحادثات', 'error');
        } finally {
            setLoading(false);
        }
    };

    // فتح محادثة في الـ split view
    const openConversation = async (conv) => {
        setSelectedConv(conv);
        setMsgPage(1);
        setMsgSearch('');
        setMessagesLoading(true);

        try {
            const [convRes, msgRes] = await Promise.all([
                getConversationById(conv._id),
                getConversationMessages(conv._id, 1, 50)
            ]);
            if (convRes.success) setSelectedConvData(convRes.data);
            if (msgRes.success) {
                setMessages(msgRes.data.messages);
                setMsgTotalPages(msgRes.data.totalPages);
            }
        } catch (err) {
            showToast('فشل تحميل المحادثة', 'error');
        } finally {
            setMessagesLoading(false);
        }

        // Socket.IO
        if (!socketService.isConnected()) socketService.connect();
        socketService.joinConversation(conv._id);
        socketService.onNewMessage((data) => {
            if (data.message.conversation === conv._id) {
                setMessages(prev => {
                    if (prev.some(m => m._id === data.message._id)) return prev;
                    return [data.message, ...prev];
                });
            }
        });
    };

    const closeConversation = () => {
        if (selectedConv) {
            socketService.leaveConversation(selectedConv._id);
            socketService.offNewMessage();
        }
        setSelectedConv(null);
        setSelectedConvData(null);
        setMessages([]);
    };

    // تحميل صفحة رسائل
    const loadMessages = async (page, search) => {
        if (!selectedConv) return;
        setMessagesLoading(true);
        try {
            const res = await getConversationMessages(selectedConv._id, page, 50, search);
            if (res.success) {
                setMessages(res.data.messages);
                setMsgTotalPages(res.data.totalPages);
                setMsgPage(page);
            }
        } catch (err) {
            showToast('فشل تحميل الرسائل', 'error');
        } finally {
            setMessagesLoading(false);
        }
    };

    // إرسال رسالة
    const handleSend = async (e) => {
        e.preventDefault();
        if (!newMessage.trim() || sending || !selectedConv) return;
        const content = newMessage;
        setNewMessage('');
        setSending(true);
        try {
            const res = await sendMessage(selectedConv._id, content, 'text');
            if (!res.success) {
                setNewMessage(content);
                showToast(res.message || 'فشل الإرسال', 'error');
            }
        } catch {
            setNewMessage(content);
            showToast('فشل الإرسال', 'error');
        } finally {
            setSending(false);
        }
    };

    // حذف رسالة
    const handleDeleteMsg = async (msgId) => {
        try {
            const res = await deleteMessage(msgId);
            if (res.success) {
                setMessages(msgs => msgs.map(m => m._id === msgId ? { ...m, isDeleted: true } : m));
                showToast('تم حذف الرسالة', 'success');
            }
        } catch {
            showToast('فشل حذف الرسالة', 'error');
        }
    };

    // إجراءات المحادثة
    const handleToggleActive = async (convId) => {
        try {
            const res = await toggleConversationActive(convId);
            if (res.success) {
                showToast(res.message, 'success');
                fetchConversations();
            }
        } catch { showToast('فشل التحديث', 'error'); }
    };

    const handleLock = async (convId) => {
        try {
            const res = await lockConversation(convId);
            if (res.success) { showToast(res.message, 'success'); fetchConversations(); }
        } catch { showToast('فشل القفل', 'error'); }
    };

    const handleDeleteMessages = async (convId) => {
        try {
            const res = await deleteConversationMessages(convId);
            if (res.success) {
                showToast(res.message, 'success');
                fetchConversations();
                if (selectedConv?._id === convId) {
                    setMessages(msgs => msgs.map(m => ({ ...m, isDeleted: true })));
                }
            }
        } catch { showToast('فشل حذف الرسائل', 'error'); }
    };

    const handleDeleteConv = async (convId) => {
        try {
            const res = await deleteConversation(convId);
            if (res.success) {
                showToast('تم حذف المحادثة', 'success');
                setConversations(c => c.filter(x => x._id !== convId));
                if (selectedConv?._id === convId) closeConversation();
                setShowDeleteConfirm(null);
                fetchStats();
            }
        } catch { showToast('فشل الحذف', 'error'); }
    };

    // تنسيق الوقت
    const formatRelativeTime = (date) => {
        const diffMs = Date.now() - new Date(date);
        const mins = Math.floor(diffMs / 60000);
        const hours = Math.floor(diffMs / 3600000);
        const days = Math.floor(diffMs / 86400000);
        if (mins < 1) return 'الآن';
        if (mins < 60) return `${mins} د`;
        if (hours < 24) return `${hours} س`;
        if (days < 7) return `${days} ي`;
        return new Date(date).toLocaleDateString('ar-SA');
    };

    const formatTime = (date) => new Date(date).toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' });

    const formatDate = (date) => {
        const d = new Date(date);
        const today = new Date();
        if (d.toDateString() === today.toDateString()) return 'اليوم';
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        if (d.toDateString() === yesterday.toDateString()) return 'أمس';
        return d.toLocaleDateString('ar-SA');
    };

    const handleViewUser = (userId) => {
        if (onViewUserDetail) onViewUserDetail(userId);
    };

    return (
        <div className={`conv-page ${selectedConv ? 'split-active' : ''}`}>
            {/* الجزء الأيسر — قائمة المحادثات */}
            <div className="conv-sidebar">
                {/* إحصائيات */}
                {stats && (
                    <div className="conv-stats-bar">
                        <div className="conv-stat" data-color="blue">
                            <span className="conv-stat-num">{stats.totalConversations}</span>
                            <span className="conv-stat-label">محادثة</span>
                        </div>
                        <div className="conv-stat" data-color="green">
                            <span className="conv-stat-num">{stats.totalMessages}</span>
                            <span className="conv-stat-label">رسالة</span>
                        </div>
                        <div className="conv-stat" data-color="purple">
                            <span className="conv-stat-num">{stats.todayMessages}</span>
                            <span className="conv-stat-label">اليوم</span>
                        </div>
                        <div className="conv-stat" data-color="red">
                            <span className="conv-stat-num">{stats.flaggedMessagesCount}</span>
                            <span className="conv-stat-label">محظورة</span>
                        </div>
                        <div className="conv-stat" data-color="orange">
                            <span className="conv-stat-num">{stats.pendingConversations}</span>
                            <span className="conv-stat-label">معلقة</span>
                        </div>
                    </div>
                )}

                {/* بحث + فلاتر */}
                <div className="conv-toolbar">
                    <div className="conv-search-row">
                        <input
                            type="text"
                            className="conv-search"
                            placeholder="بحث بالاسم أو البريد..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                        <select className="conv-sort" value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
                            <option value="updatedAt">الأحدث</option>
                            <option value="oldest">الأقدم</option>
                            <option value="messages">الأكثر رسائل</option>
                        </select>
                    </div>
                    <div className="conv-filters">
                        {[
                            { key: 'all', label: 'الكل', count: totalItems },
                            { key: 'active', label: 'نشطة' },
                            { key: 'inactive', label: 'معطلة' },
                            { key: 'flagged', label: 'مخالفات' },
                            { key: 'images', label: '📷 صور' },
                            { key: 'pending', label: 'معلقة' },
                            { key: 'locked', label: 'مقفلة' },
                        ].map(f => (
                            <button
                                key={f.key}
                                className={`conv-filter-btn ${filterStatus === f.key ? 'active' : ''} ${f.key === 'flagged' ? 'danger' : ''}`}
                                onClick={() => { setFilterStatus(f.key); setCurrentPage(1); }}
                            >
                                {f.label}{f.count !== undefined ? ` (${f.count})` : ''}
                            </button>
                        ))}
                    </div>
                </div>

                {/* القائمة */}
                {loading ? (
                    <div className="conv-loading"><LoadingSpinner text="جاري التحميل..." /></div>
                ) : conversations.length === 0 ? (
                    <div className="conv-empty">
                        <div className="conv-empty-icon">💬</div>
                        <p>لا توجد محادثات</p>
                    </div>
                ) : (
                    <div className="conv-list">
                        {conversations.map((conv) => {
                            const p1 = conv.participants?.[0];
                            const p2 = conv.participants?.[1];
                            const isActive = selectedConv?._id === conv._id;

                            return (
                                <div
                                    key={conv._id}
                                    className={`conv-item ${isActive ? 'selected' : ''} ${!conv.isActive ? 'disabled' : ''}`}
                                    onClick={() => openConversation(conv)}
                                >
                                    <div className="conv-item-avatars">
                                        {[p1, p2].filter(Boolean).map((p, i) => (
                                            <img
                                                key={i}
                                                className={`conv-avatar ${i === 1 ? 'second' : ''}`}
                                                src={p.profileImage ? getImageUrl(p.profileImage) : getDefaultAvatar(p.name)}
                                                alt={p.name}
                                                onError={(e) => { e.target.onerror = null; e.target.src = getDefaultAvatar(p.name); }}
                                            />
                                        ))}
                                        {p1?.isOnline && <span className="conv-online-dot" />}
                                    </div>

                                    <div className="conv-item-body">
                                        <div className="conv-item-top">
                                            <span className="conv-item-names">
                                                {conv.participants?.map(p => p.name).join(' — ') || 'محادثة'}
                                            </span>
                                            <span className="conv-item-time">{formatRelativeTime(conv.updatedAt)}</span>
                                        </div>
                                        <div className="conv-item-bottom">
                                            <span className="conv-item-preview">
                                                {conv.lastMessage?.sender?.name && <strong>{conv.lastMessage.sender.name}: </strong>}
                                                {conv.lastMessage?.type === 'image' ? '📷 صورة' :
                                                 conv.lastMessage?.content || 'لا توجد رسائل'}
                                            </span>
                                        </div>
                                        <div className="conv-item-badges">
                                            {conv.messagesCount > 0 && <span className="conv-badge msg">{conv.messagesCount} رسالة</span>}
                                            {conv.imagesCount > 0 && <span className="conv-badge img">📷 {conv.imagesCount}</span>}
                                            {conv.flaggedMessagesCount > 0 && <span className="conv-badge flag">{conv.flaggedMessagesCount} مخالفة</span>}
                                            {conv.isLocked && <span className="conv-badge lock">مقفلة</span>}
                                            {!conv.isActive && <span className="conv-badge off">معطلة</span>}
                                            {conv.status === 'pending' && <span className="conv-badge pending">معلقة</span>}
                                        </div>
                                    </div>

                                    <button className="conv-item-more" onClick={(e) => {
                                        e.stopPropagation();
                                        setActionConv(conv);
                                        setShowActionsModal(true);
                                    }}>
                                        ⋮
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                )}

                {totalPages > 1 && (
                    <div className="conv-pagination">
                        <Pagination
                            currentPage={currentPage}
                            totalPages={totalPages}
                            onPageChange={setCurrentPage}
                            itemsPerPage={itemsPerPage}
                            totalItems={totalItems}
                        />
                    </div>
                )}
            </div>

            {/* الجزء الأيمن — عرض المحادثة */}
            <div className={`conv-chat ${selectedConv ? 'open' : ''}`}>
                {!selectedConv ? (
                    <div className="conv-chat-empty">
                        <div className="conv-chat-empty-icon">💬</div>
                        <h3>اختر محادثة لعرضها</h3>
                        <p>اضغط على أي محادثة من القائمة لمعاينة الرسائل</p>
                    </div>
                ) : (
                    <>
                        {/* Header المحادثة */}
                        <div className="conv-chat-header">
                            <button className="conv-chat-back" onClick={closeConversation}>✕</button>
                            <div className="conv-chat-header-info">
                                <div className="conv-chat-header-avatars">
                                    {selectedConv.participants?.slice(0, 2).map((p, i) => (
                                        <img
                                            key={i}
                                            className={`conv-chat-avatar ${i === 1 ? 'second' : ''}`}
                                            src={p.profileImage ? getImageUrl(p.profileImage) : getDefaultAvatar(p.name)}
                                            alt={p.name}
                                            onError={(e) => { e.target.onerror = null; e.target.src = getDefaultAvatar(p.name); }}
                                            onClick={() => handleViewUser(p._id)}
                                            style={{ cursor: 'pointer' }}
                                        />
                                    ))}
                                </div>
                                <div className="conv-chat-header-text">
                                    <h3>{selectedConv.participants?.map(p => p.name).join(' — ')}</h3>
                                    <span className="conv-chat-header-meta">
                                        {selectedConvData?.stats?.totalMessages || 0} رسالة
                                        {selectedConvData?.stats?.imageMessages > 0 && ` | ${selectedConvData.stats.imageMessages} صورة`}
                                        {selectedConvData?.stats?.flaggedMessages > 0 && ` | ${selectedConvData.stats.flaggedMessages} مخالفة`}
                                    </span>
                                </div>
                            </div>
                            <div className="conv-chat-header-actions">
                                <input
                                    type="text"
                                    className="conv-chat-search"
                                    placeholder="بحث في الرسائل..."
                                    value={msgSearch}
                                    onChange={(e) => setMsgSearch(e.target.value)}
                                    onKeyDown={(e) => e.key === 'Enter' && loadMessages(1, msgSearch)}
                                />
                                <div className="conv-chat-quick-actions">
                                    {selectedConv.participants?.map((p, i) => (
                                        <button key={i} className="conv-chat-user-btn" onClick={() => handleViewUser(p._id)} title={`عرض ${p.name}`}>
                                            👤 {p.name?.split(' ')[0]}
                                        </button>
                                    ))}
                                    <button className="conv-chat-action-btn" onClick={() => handleToggleActive(selectedConv._id)} title="تفعيل/تعطيل">
                                        {selectedConv.isActive ? '⏸️' : '▶️'}
                                    </button>
                                    <button className="conv-chat-action-btn" onClick={() => handleLock(selectedConv._id)} title="قفل/فتح">
                                        {selectedConv.isLocked ? '🔓' : '🔒'}
                                    </button>
                                    <button
                                        className="conv-chat-action-btn"
                                        onClick={() => setQuickAddOpen(true)}
                                        title="إضافة كلمة محظورة يدوياً"
                                        style={{ background: '#fee2e2', color: '#991b1b', border: '1.5px dashed #dc2626' }}
                                    >
                                        ➕ كلمة محظورة
                                    </button>
                                    <button className="conv-chat-action-btn danger" onClick={() => setShowDeleteConfirm(selectedConv._id)} title="حذف">
                                        🗑️
                                    </button>
                                </div>
                            </div>
                        </div>

                        {/* الرسائل */}
                        <div className="conv-chat-messages">
                            {messagesLoading ? (
                                <div className="conv-chat-loading"><LoadingSpinner text="جاري تحميل الرسائل..." /></div>
                            ) : messages.length === 0 ? (
                                <div className="conv-chat-no-msg">
                                    <p>لا توجد رسائل</p>
                                </div>
                            ) : (
                                <>
                                    {msgTotalPages > 1 && (
                                        <div className="conv-msg-pagination">
                                            <button disabled={msgPage >= msgTotalPages} onClick={() => loadMessages(msgPage + 1, msgSearch)}>رسائل أقدم</button>
                                            <span>صفحة {msgPage} من {msgTotalPages}</span>
                                            <button disabled={msgPage <= 1} onClick={() => loadMessages(msgPage - 1, msgSearch)}>رسائل أحدث</button>
                                        </div>
                                    )}
                                    {messages.map((msg, idx) => {
                                        const showDate = idx === 0 ||
                                            formatDate(msg.createdAt) !== formatDate(messages[idx - 1]?.createdAt);
                                        const senderName = msg.sender?.name || 'مستخدم محذوف';
                                        const isP1 = msg.sender?._id === selectedConv.participants?.[0]?._id;

                                        return (
                                            <React.Fragment key={msg._id}>
                                                {showDate && (
                                                    <div className="conv-msg-date">
                                                        <span>{formatDate(msg.createdAt)}</span>
                                                    </div>
                                                )}
                                                <div className={`conv-msg ${isP1 ? 'right' : 'left'} ${msg.isDeleted ? 'deleted' : ''} ${msg.hasBannedWords ? 'flagged' : ''}`}>
                                                    <img
                                                        className="conv-msg-avatar"
                                                        src={msg.sender?.profileImage ? getImageUrl(msg.sender.profileImage) : getDefaultAvatar(senderName)}
                                                        alt={senderName}
                                                        onError={(e) => { e.target.onerror = null; e.target.src = getDefaultAvatar(senderName); }}
                                                        onClick={() => msg.sender?._id && handleViewUser(msg.sender._id)}
                                                    />
                                                    <div
                                                        className="conv-msg-bubble"
                                                        onClick={(e) => {
                                                            // ✅ ضغط على الرسالة → popover خيارات
                                                            // (تجاهل لو click على img أو button داخل الرسالة)
                                                            const tag = (e.target.tagName || '').toLowerCase();
                                                            if (tag === 'img' || tag === 'button' || tag === 'a') return;
                                                            if (msg.isDeleted) return;
                                                            setMsgMenu({
                                                                message: msg,
                                                                x: e.clientX,
                                                                y: e.clientY
                                                            });
                                                        }}
                                                        style={{ cursor: msg.isDeleted ? 'default' : 'pointer' }}
                                                    >
                                                        <div className="conv-msg-top">
                                                            <span className="conv-msg-sender" onClick={() => msg.sender?._id && handleViewUser(msg.sender._id)}>
                                                                {senderName}
                                                            </span>
                                                            <span className="conv-msg-time">{formatTime(msg.createdAt)}</span>
                                                        </div>

                                                        {/* Reply */}
                                                        {msg.replyTo && (
                                                            <div className="conv-msg-reply">
                                                                <span className="conv-msg-reply-name">{msg.replyTo.senderName || 'رد على'}</span>
                                                                <span className="conv-msg-reply-text">{msg.replyTo.content || '...'}</span>
                                                            </div>
                                                        )}

                                                        {msg.isDeleted ? (
                                                            <p className="conv-msg-deleted">تم حذف هذه الرسالة</p>
                                                        ) : (
                                                            <>
                                                                {msg.content && <p className="conv-msg-text">{msg.content}</p>}
                                                                {msg.type === 'image' && msg.mediaUrl && (
                                                                    <div className="conv-msg-image-wrap">
                                                                        <img
                                                                            src={getImageUrl(msg.mediaUrl)}
                                                                            alt="صورة"
                                                                            className="conv-msg-image"
                                                                            onClick={() => setImageViewer({ url: getImageUrl(msg.mediaUrl), sender: msg.sender })}
                                                                            onError={(e) => { e.target.style.display = 'none'; }}
                                                                        />
                                                                    </div>
                                                                )}
                                                                {msg.type === 'audio' && <span className="conv-msg-type-badge">🎵 مقطع صوتي</span>}
                                                                {msg.type === 'video' && <span className="conv-msg-type-badge">🎥 فيديو</span>}
                                                                {msg.type === 'file' && <span className="conv-msg-type-badge">📎 ملف</span>}
                                                            </>
                                                        )}

                                                        {/* Reactions */}
                                                        {msg.reactions?.length > 0 && (
                                                            <div className="conv-msg-reactions">
                                                                {Object.entries(msg.reactions.reduce((acc, r) => {
                                                                    acc[r.emoji] = (acc[r.emoji] || 0) + 1;
                                                                    return acc;
                                                                }, {})).map(([emoji, count]) => (
                                                                    <span key={emoji} className="conv-msg-reaction">{emoji} {count > 1 ? count : ''}</span>
                                                                ))}
                                                            </div>
                                                        )}

                                                        {/* ✅ Banned words — مع زر إضافة لقائمة المحظورات الموحّدة */}
                                                        {msg.hasBannedWords && msg.bannedWordsFound?.length > 0 && (
                                                            <div className="conv-msg-banned" style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                                                                {msg.bannedWordsFound.map((w, i) => {
                                                                    const wordKey = (w.word || '').trim().toLowerCase();
                                                                    const status = addedWords[wordKey];
                                                                    const sev = w.severity;
                                                                    const bg = sev === 'high' ? '#dc2626' : (sev === 'medium' ? '#f59e0b' : '#9ca3af');
                                                                    return (
                                                                        <span
                                                                            key={i}
                                                                            style={{
                                                                                display: 'inline-flex', alignItems: 'center', gap: 3,
                                                                                background: bg, color: '#fff',
                                                                                padding: '2px 4px 2px 8px', borderRadius: 5,
                                                                                fontSize: 11, fontWeight: 700
                                                                            }}
                                                                        >
                                                                            <span>{w.word}</span>
                                                                            <button
                                                                                onClick={(e) => { e.stopPropagation(); handleAddBannedWord(w.word, w.category || 'other'); }}
                                                                                disabled={!!status}
                                                                                title={
                                                                                    status === 'added' ? 'تمت الإضافة'
                                                                                    : status === 'duplicate' ? 'موجودة مسبقاً'
                                                                                    : status === 'pending' ? 'جاري...'
                                                                                    : 'إضافة لقائمة الكلمات المحظورة'
                                                                                }
                                                                                style={{
                                                                                    background: status === 'added' ? '#10b981' : (status === 'duplicate' ? '#6b7280' : '#fff'),
                                                                                    color: status ? '#fff' : '#374151',
                                                                                    border: 'none', borderRadius: 3,
                                                                                    width: 18, height: 18,
                                                                                    fontSize: 11, fontWeight: 700,
                                                                                    cursor: status ? 'default' : 'pointer',
                                                                                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                                                                    lineHeight: 1
                                                                                }}
                                                                            >
                                                                                {status === 'pending' ? '⏳' : status === 'added' || status === 'duplicate' ? '✓' : '➕'}
                                                                            </button>
                                                                        </span>
                                                                    );
                                                                })}
                                                            </div>
                                                        )}

                                                        {/* Status */}
                                                        {!msg.isDeleted && (
                                                            <div className="conv-msg-status">
                                                                {msg.isRead ? <span className="read-status read">✓✓</span> :
                                                                 msg.isDelivered ? <span className="read-status delivered">✓✓</span> :
                                                                 <span className="read-status sent">✓</span>}
                                                            </div>
                                                        )}
                                                    </div>

                                                    {!msg.isDeleted && (
                                                        <button
                                                            className="conv-msg-delete"
                                                            onClick={() => handleDeleteMsg(msg._id)}
                                                            title="حذف"
                                                        >🗑️</button>
                                                    )}
                                                </div>
                                            </React.Fragment>
                                        );
                                    })}
                                </>
                            )}
                        </div>

                        {/* إرسال رسالة */}
                        <form className="conv-chat-input" onSubmit={handleSend}>
                            <input
                                type="text"
                                placeholder="اكتب رسالة كأدمن..."
                                value={newMessage}
                                onChange={(e) => setNewMessage(e.target.value)}
                                disabled={sending}
                            />
                            <button type="submit" disabled={!newMessage.trim() || sending}>
                                {sending ? '...' : '📤'}
                            </button>
                        </form>
                    </>
                )}
            </div>

            {/* ✅ Message Context Menu — ضغط على رسالة → خيارات */}
            {msgMenu && (
                <div
                    onClick={() => setMsgMenu(null)}
                    style={{ position: 'fixed', inset: 0, zIndex: 9997, background: 'transparent' }}
                >
                    <div
                        onClick={(e) => e.stopPropagation()}
                        style={{
                            position: 'fixed',
                            top: Math.min(msgMenu.y + 5, window.innerHeight - 160),
                            left: Math.min(msgMenu.x, window.innerWidth - 240),
                            background: '#fff',
                            borderRadius: 10,
                            boxShadow: '0 10px 30px rgba(0,0,0,0.18), 0 0 0 1px rgba(0,0,0,0.06)',
                            minWidth: 220,
                            overflow: 'hidden',
                            direction: 'rtl'
                        }}
                    >
                        <div style={{
                            padding: '10px 12px',
                            background: '#f9fafb',
                            borderBottom: '1px solid #e5e7eb',
                            fontSize: 11,
                            color: '#6b7280',
                            fontWeight: 600,
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            maxWidth: 240
                        }}>
                            {(msgMenu.message.content || '(بدون نص)').slice(0, 50)}
                            {msgMenu.message.content?.length > 50 && '...'}
                        </div>
                        <button
                            onClick={() => {
                                // فتح Quick Add مع نص الرسالة prefilled
                                setQuickAddText(msgMenu.message.content || '');
                                setQuickAddCategory('other');
                                setQuickAddOpen(true);
                                setMsgMenu(null);
                            }}
                            style={{
                                width: '100%', textAlign: 'right',
                                padding: '11px 14px', border: 'none',
                                background: '#fff', cursor: 'pointer',
                                fontSize: 13, fontWeight: 600,
                                color: '#dc2626',
                                display: 'flex', gap: 8, alignItems: 'center',
                                borderBottom: '1px solid #f3f4f6'
                            }}
                            onMouseEnter={(e) => e.currentTarget.style.background = '#fee2e2'}
                            onMouseLeave={(e) => e.currentTarget.style.background = '#fff'}
                        >
                            <span>➕</span><span>إضافة كلمة محظورة</span>
                        </button>
                        <button
                            onClick={() => {
                                if (window.confirm('حذف هذه الرسالة؟')) {
                                    handleDeleteMsg(msgMenu.message._id);
                                }
                                setMsgMenu(null);
                            }}
                            style={{
                                width: '100%', textAlign: 'right',
                                padding: '11px 14px', border: 'none',
                                background: '#fff', cursor: 'pointer',
                                fontSize: 13, fontWeight: 600,
                                color: '#374151',
                                display: 'flex', gap: 8, alignItems: 'center'
                            }}
                            onMouseEnter={(e) => e.currentTarget.style.background = '#f3f4f6'}
                            onMouseLeave={(e) => e.currentTarget.style.background = '#fff'}
                        >
                            <span>🗑️</span><span>حذف الرسالة</span>
                        </button>
                    </div>
                </div>
            )}

            {/* ✅ Quick Add Modal — لإضافة كلمة محظورة يدوياً */}
            {quickAddOpen && (
                <div
                    onClick={() => setQuickAddOpen(false)}
                    style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 9998, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
                >
                    <div
                        onClick={(e) => e.stopPropagation()}
                        style={{ background: '#fff', borderRadius: 14, padding: 22, maxWidth: 460, width: '100%', boxShadow: '0 20px 50px rgba(0,0,0,0.3)' }}
                    >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                            <h3 style={{ margin: 0, color: '#dc2626' }}>➕ إضافة كلمة محظورة</h3>
                            <button onClick={() => setQuickAddOpen(false)} style={{ background: 'transparent', border: 'none', fontSize: 22, cursor: 'pointer' }}>✕</button>
                        </div>
                        <div style={{ marginBottom: 14, padding: 10, background: '#fef3c7', borderRadius: 8, fontSize: 12, color: '#78350f', lineHeight: 1.6 }}>
                            <strong>نصيحة:</strong> انسخ النمط الذي تريد حظره من الرسالة (مثلاً "ت ل ج" أو "س ن ا ب") والصقه هنا. الكلمة ستُطبَّق على جميع المستخدمين فوراً.
                        </div>
                        <label style={{ display: 'block', marginBottom: 6, fontSize: 13, fontWeight: 700 }}>الكلمة / النمط:</label>
                        <input
                            type="text"
                            value={quickAddText}
                            onChange={(e) => setQuickAddText(e.target.value)}
                            placeholder="مثلاً: ت ل ج"
                            autoFocus
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && quickAddText.trim()) {
                                    e.preventDefault();
                                    handleAddBannedWord(quickAddText, quickAddCategory);
                                    setQuickAddText('');
                                    setQuickAddOpen(false);
                                }
                            }}
                            style={{
                                width: '100%', padding: '10px 12px',
                                border: '1.5px solid #d1d5db', borderRadius: 8,
                                fontSize: 14, marginBottom: 12, boxSizing: 'border-box', direction: 'rtl'
                            }}
                        />
                        <label style={{ display: 'block', marginBottom: 6, fontSize: 13, fontWeight: 700 }}>التصنيف:</label>
                        <select
                            value={quickAddCategory}
                            onChange={(e) => setQuickAddCategory(e.target.value)}
                            style={{ width: '100%', padding: '10px 12px', border: '1.5px solid #d1d5db', borderRadius: 8, fontSize: 14, marginBottom: 16, boxSizing: 'border-box' }}
                        >
                            <option value="other">أخرى</option>
                            <option value="external_promo">ترويج خارجي</option>
                            <option value="sexual">جنسي</option>
                            <option value="insult">شتيمة</option>
                            <option value="hate">كراهية</option>
                            <option value="violence">عنف</option>
                            <option value="phone">رقم تواصل</option>
                        </select>
                        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                            <button onClick={() => setQuickAddOpen(false)} style={{ padding: '8px 18px', borderRadius: 8, border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer', fontWeight: 600 }}>إلغاء</button>
                            <button
                                disabled={!quickAddText.trim()}
                                onClick={() => {
                                    handleAddBannedWord(quickAddText, quickAddCategory);
                                    setQuickAddText('');
                                    setQuickAddOpen(false);
                                }}
                                style={{
                                    padding: '8px 22px', borderRadius: 8, border: 'none',
                                    background: quickAddText.trim() ? '#dc2626' : '#fca5a5',
                                    color: '#fff', cursor: quickAddText.trim() ? 'pointer' : 'not-allowed',
                                    fontWeight: 700
                                }}
                            >➕ إضافة</button>
                        </div>
                    </div>
                </div>
            )}

            {/* ✅ Image Viewer مع تنزيل + ملف المرسل */}
            {imageViewer && (
                <div
                    onClick={() => setImageViewer(null)}
                    style={{
                        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.92)', zIndex: 9999,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        cursor: 'zoom-out', padding: 20
                    }}
                >
                    <button
                        onClick={(e) => { e.stopPropagation(); setImageViewer(null); }}
                        style={{
                            position: 'absolute', top: 20, left: 20, background: '#fff', border: 'none',
                            width: 40, height: 40, borderRadius: '50%', fontSize: 20, cursor: 'pointer'
                        }}
                        title="إغلاق"
                    >✕</button>
                    <div style={{ position: 'absolute', top: 20, right: 20, display: 'flex', gap: 8 }}>
                        {imageViewer.sender?._id && onViewUserDetail && (
                            <button
                                onClick={(e) => { e.stopPropagation(); onViewUserDetail(imageViewer.sender._id); setImageViewer(null); }}
                                style={{
                                    background: '#6366f1', color: '#fff', border: 'none',
                                    padding: '8px 14px', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer'
                                }}
                                title="عرض ملف المرسل"
                            >👤 ملف المرسل</button>
                        )}
                        <a
                            href={imageViewer.url}
                            download
                            onClick={(e) => e.stopPropagation()}
                            style={{
                                background: '#fff', padding: '8px 14px', borderRadius: 8,
                                textDecoration: 'none', color: '#111', fontSize: 13, fontWeight: 700
                            }}
                            title="تنزيل الصورة"
                        >⬇️ تنزيل</a>
                    </div>
                    <img
                        src={imageViewer.url}
                        alt="معاينة"
                        onClick={(e) => e.stopPropagation()}
                        style={{ maxWidth: '95vw', maxHeight: '90vh', borderRadius: 8, cursor: 'default' }}
                    />
                </div>
            )}

            {/* Actions Modal */}
            {showActionsModal && actionConv && (
                <div className="conv-modal-overlay" onClick={() => setShowActionsModal(false)}>
                    <div className="conv-modal" onClick={(e) => e.stopPropagation()}>
                        <h3>إجراءات المحادثة</h3>
                        <p className="conv-modal-sub">{actionConv.participants?.map(p => p.name).join(' — ')}</p>
                        <div className="conv-modal-actions">
                            <button onClick={() => { openConversation(actionConv); setShowActionsModal(false); }}>
                                <span>💬</span> عرض الرسائل
                            </button>
                            <button onClick={() => { handleToggleActive(actionConv._id); setShowActionsModal(false); }}>
                                <span>{actionConv.isActive ? '⏸️' : '▶️'}</span> {actionConv.isActive ? 'تعطيل' : 'تفعيل'}
                            </button>
                            <button onClick={() => { handleLock(actionConv._id); setShowActionsModal(false); }}>
                                <span>{actionConv.isLocked ? '🔓' : '🔒'}</span> {actionConv.isLocked ? 'فتح القفل' : 'قفل'}
                            </button>
                            <button className="warning" onClick={() => {
                                if (window.confirm('حذف جميع الرسائل؟')) {
                                    handleDeleteMessages(actionConv._id);
                                    setShowActionsModal(false);
                                }
                            }}>
                                <span>🧹</span> حذف جميع الرسائل
                            </button>
                            <button className="danger" onClick={() => { setShowDeleteConfirm(actionConv._id); setShowActionsModal(false); }}>
                                <span>❌</span> حذف المحادثة نهائياً
                            </button>
                        </div>

                        {/* User Actions */}
                        {actionConv.participants?.length > 0 && (
                            <div className="conv-modal-users-section">
                                <h4 style={{margin: '16px 0 8px', fontSize: '14px', color: '#7f8c8d'}}>إجراءات المستخدمين</h4>
                                {actionConv.participants.map((p, i) => (
                                    <div key={i} className="conv-modal-user-row">
                                        <span className="conv-modal-user-name">{p.name}</span>
                                        <div className="conv-modal-user-btns">
                                            <button className="conv-modal-user-btn" onClick={() => { handleViewUser(p._id); setShowActionsModal(false); }} title="عرض">
                                                👤
                                            </button>
                                            <button className="conv-modal-user-btn warn" onClick={async () => {
                                                try {
                                                    await suspendUser(p._id, '24h', 'تعليق من المحادثات');
                                                    showToast(`تم تعليق ${p.name} لمدة 24 ساعة`, 'success');
                                                } catch { showToast('فشل التعليق', 'error'); }
                                                setShowActionsModal(false);
                                            }} title="تعليق 24h">
                                                🔒
                                            </button>
                                            <button className="conv-modal-user-btn danger" onClick={async () => {
                                                if (!window.confirm(`تعطيل حساب ${p.name}؟`)) return;
                                                try {
                                                    await toggleUserActive(p._id);
                                                    showToast(`تم تعطيل ${p.name}`, 'success');
                                                } catch { showToast('فشل التعطيل', 'error'); }
                                                setShowActionsModal(false);
                                            }} title="تعطيل">
                                                🚫
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}

                        <button className="conv-modal-close" onClick={() => setShowActionsModal(false)}>إغلاق</button>
                    </div>
                </div>
            )}

            {/* Delete Confirm */}
            {showDeleteConfirm && (
                <div className="conv-modal-overlay" onClick={() => setShowDeleteConfirm(null)}>
                    <div className="conv-modal conv-modal-danger" onClick={(e) => e.stopPropagation()}>
                        <h3>تأكيد الحذف</h3>
                        <p>هل أنت متأكد من حذف هذه المحادثة نهائياً؟ سيتم حذف جميع الرسائل.</p>
                        <div className="conv-modal-btns">
                            <button className="conv-btn-cancel" onClick={() => setShowDeleteConfirm(null)}>إلغاء</button>
                            <button className="conv-btn-danger" onClick={() => handleDeleteConv(showDeleteConfirm)}>حذف نهائياً</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

export default Conversations;
