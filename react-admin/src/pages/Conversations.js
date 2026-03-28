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
    sendMessage
} from '../services/api';
import { useToast } from '../components/Toast';
import LoadingSpinner from '../components/LoadingSpinner';
import Pagination from '../components/Pagination';
import socketService from '../services/socket';
import { getImageUrl, getDefaultAvatar } from '../config';
import './Conversations.css';

function Conversations() {
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
    const [imageViewer, setImageViewer] = useState(null);

    // State - الإجراءات
    const [showActionsModal, setShowActionsModal] = useState(false);
    const [actionConv, setActionConv] = useState(null);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(null);

    const { showToast } = useToast();

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
        window.dispatchEvent(new CustomEvent('navigate', { detail: { page: 'user-detail', userId } }));
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
                                                    <div className="conv-msg-bubble">
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
                                                                            onClick={() => setImageViewer(getImageUrl(msg.mediaUrl))}
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

                                                        {/* Banned words */}
                                                        {msg.hasBannedWords && msg.bannedWordsFound?.length > 0 && (
                                                            <div className="conv-msg-banned">
                                                                {msg.bannedWordsFound.map((w, i) => (
                                                                    <span key={i} className="conv-msg-banned-word">{w.word}</span>
                                                                ))}
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

            {/* Image Viewer */}
            {imageViewer && (
                <div className="conv-image-viewer" onClick={() => setImageViewer(null)}>
                    <img src={imageViewer} alt="صورة" onClick={(e) => e.stopPropagation()} />
                    <button className="conv-image-close" onClick={() => setImageViewer(null)}>✕</button>
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
