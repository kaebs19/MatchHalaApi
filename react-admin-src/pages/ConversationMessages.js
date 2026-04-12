import React, { useState, useEffect, useRef } from 'react';
import { getConversationMessages, deleteMessage, getConversationById, sendMessage, toggleUserActive } from '../services/api';
import { useToast } from '../components/Toast';
import LoadingSpinner from '../components/LoadingSpinner';
import socketService from '../services/socket';
import notificationService from '../services/notifications';
import { getImageUrl } from '../config';
import { formatDate } from '../utils/formatters';
import './ConversationMessages.css';

function ConversationMessages({ conversationId, onBack, onViewUser }) {
    const [messages, setMessages] = useState([]);
    const [conversation, setConversation] = useState(null);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [selectedMessage, setSelectedMessage] = useState(null);
    const [showDeleteModal, setShowDeleteModal] = useState(false);
    const [typingUser, setTypingUser] = useState(null);
    const [onlineCount, setOnlineCount] = useState(0);
    const [newMessage, setNewMessage] = useState('');
    const [sending, setSending] = useState(false);
    const [userActionMenu, setUserActionMenu] = useState(null);
    const [showBanConfirm, setShowBanConfirm] = useState(false);
    const [banningUser, setBanningUser] = useState(null);
    const messagesEndRef = useRef(null);
    const typingTimeoutRef = useRef(null);
    const typingDebounceRef = useRef(null);
    const { showToast } = useToast();

    // Socket.IO: الاتصال والانضمام للمحادثة
    useEffect(() => {
        // الاتصال بـ Socket.IO إذا لم يكن متصلاً
        if (!socketService.isConnected()) {
            socketService.connect();
        }

        // طلب إذن الإشعارات
        notificationService.requestPermission();

        // الانضمام للمحادثة
        socketService.joinConversation(conversationId);

        // الاستماع للرسائل الجديدة
        socketService.onNewMessage((data) => {
            console.log('📩 رسالة جديدة:', data.message);

            // إضافة الرسالة الجديدة فقط إذا كانت من نفس المحادثة
            if (data.message.conversation === conversationId) {
                setMessages(prevMessages => {
                    // التحقق من عدم وجود الرسالة بالفعل
                    const exists = prevMessages.some(msg => msg._id === data.message._id);
                    if (!exists) {
                        return [data.message, ...prevMessages];
                    }
                    return prevMessages;
                });
                showToast('رسالة جديدة 📩', 'success');

                // إرسال إشعار نظام إذا كانت النافذة غير نشطة
                if (document.hidden && notificationService.hasPermission()) {
                    notificationService.notifyNewMessage(
                        data.message.sender?.name || 'مستخدم',
                        data.message.content,
                        conversation?.title || 'محادثة'
                    );
                }

                scrollToBottom();
            }
        });

        // الاستماع لحدث "يكتب الآن"
        socketService.onTyping((data) => {
            if (data.isTyping) {
                setTypingUser(data.userName);
                // إخفاء المؤشر بعد 3 ثوانٍ
                if (typingTimeoutRef.current) {
                    clearTimeout(typingTimeoutRef.current);
                }
                typingTimeoutRef.current = setTimeout(() => {
                    setTypingUser(null);
                }, 3000);
            } else {
                setTypingUser(null);
                if (typingTimeoutRef.current) {
                    clearTimeout(typingTimeoutRef.current);
                }
            }
        });

        // الاستماع لعدد المستخدمين المتصلين
        socketService.onUsersOnline((data) => {
            setOnlineCount(data.count);
            console.log(`👥 عدد المتصلين: ${data.count}`);
        });

        // تنظيف: مغادرة المحادثة عند الخروج
        return () => {
            socketService.leaveConversation(conversationId);
            socketService.offNewMessage();
            socketService.offTyping();
            socketService.offUsersOnline();
            if (typingTimeoutRef.current) {
                clearTimeout(typingTimeoutRef.current);
            }
        };
    }, [conversationId, conversation]);

    useEffect(() => {
        fetchMessages();
        fetchConversationInfo();
    }, [conversationId, page, search]);

    const fetchConversationInfo = async () => {
        try {
            const response = await getConversationById(conversationId);
            if (response.success) {
                setConversation(response.data);
            }
        } catch (err) {
            console.error('خطأ في جلب معلومات المحادثة:', err);
        }
    };

    const fetchMessages = async () => {
        try {
            setLoading(true);
            const response = await getConversationMessages(conversationId, page, 50, search);
            if (response.success) {
                setMessages(response.data.messages);
                setTotalPages(response.data.totalPages);
            }
        } catch (err) {
            console.error('خطأ في جلب الرسائل:', err);
            showToast('فشل تحميل الرسائل', 'error');
        } finally {
            setLoading(false);
        }
    };

    const handleDeleteMessage = async () => {
        if (!selectedMessage) return;

        try {
            const response = await deleteMessage(selectedMessage._id);
            if (response.success) {
                setMessages(messages.map(msg =>
                    msg._id === selectedMessage._id
                        ? { ...msg, isDeleted: true }
                        : msg
                ));
                showToast('تم حذف الرسالة', 'success');
                setShowDeleteModal(false);
                setSelectedMessage(null);
            }
        } catch (err) {
            showToast('فشل حذف الرسالة', 'error');
        }
    };

    const handleSearch = (e) => {
        setSearch(e.target.value);
        setPage(1);
    };

    const formatTime = (date) => {
        return new Date(date).toLocaleTimeString('ar-SA', {
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    // معالج الكتابة في الـ input
    const handleMessageInput = (e) => {
        const value = e.target.value;
        setNewMessage(value);

        // إرسال حدث "يكتب الآن"
        if (value.trim()) {
            const userName = localStorage.getItem('userName') || 'Admin';
            socketService.emitTyping(conversationId, userName);

            // إيقاف الحدث بعد 3 ثوانٍ
            if (typingDebounceRef.current) {
                clearTimeout(typingDebounceRef.current);
            }
            typingDebounceRef.current = setTimeout(() => {
                socketService.emitStopTyping(conversationId);
            }, 3000);
        } else {
            socketService.emitStopTyping(conversationId);
        }
    };

    // إرسال رسالة جديدة
    const handleSendMessage = async (e) => {
        e.preventDefault();

        if (!newMessage.trim() || sending) return;

        const messageContent = newMessage;

        try {
            setSending(true);
            socketService.emitStopTyping(conversationId);

            // تفريغ الـ input فوراً لتحسين UX
            setNewMessage('');

            // إرسال الرسالة للـ API
            // سيتم بث الرسالة تلقائياً عبر Socket.IO من Backend
            const response = await sendMessage(conversationId, messageContent, 'text');

            if (response.success) {
                showToast('تم إرسال الرسالة ✅', 'success');
                scrollToBottom();
            } else {
                // في حالة الفشل، نعيد النص للـ input
                setNewMessage(messageContent);
                showToast(response.message || 'فشل إرسال الرسالة', 'error');
            }

        } catch (error) {
            console.error('خطأ في إرسال الرسالة:', error);
            // نعيد النص للـ input
            setNewMessage(messageContent);
            showToast('فشل إرسال الرسالة', 'error');
        } finally {
            setSending(false);
        }
    };

    useEffect(() => {
        if (!loading) {
            scrollToBottom();
        }
    }, [messages, loading]);

    if (loading && page === 1) {
        return <LoadingSpinner text="جاري تحميل الرسائل..." />;
    }

    return (
        <div className="conversation-messages-page">
            {/* Header */}
            <div className="messages-header">
                <button onClick={onBack} className="back-btn">← رجوع</button>
                <div className="conversation-info">
                    <h2>{conversation?.title || 'المحادثة'}</h2>
                    <div className="header-stats">
                        <p>{messages.length} رسالة</p>
                        {onlineCount > 0 && (
                            <p className="online-count">
                                <span className="online-dot"></span>
                                {onlineCount} متصل
                            </p>
                        )}
                    </div>
                </div>
                <div className="search-box">
                    <input
                        type="text"
                        placeholder="🔍 بحث في الرسائل..."
                        value={search}
                        onChange={handleSearch}
                        className="search-input"
                    />
                </div>
            </div>

            {/* Messages Container */}
            <div className="messages-container">
                {messages.length === 0 ? (
                    <div className="no-messages">
                        <p>لا توجد رسائل في هذه المحادثة 💬</p>
                    </div>
                ) : (
                    <div className="messages-list">
                        {messages.map((message, index) => {
                            const showDate = index === 0 ||
                                formatDate(message.createdAt) !== formatDate(messages[index - 1]?.createdAt);

                            return (
                                <React.Fragment key={message._id}>
                                    {showDate && (
                                        <div className="date-divider">
                                            <span>{formatDate(message.createdAt)}</span>
                                        </div>
                                    )}
                                    <div className={`message-bubble ${message.isDeleted ? 'deleted' : ''} ${message.hasBannedWords ? 'flagged' : ''}`}>
                                        <div className="message-header">
                                            <div className="sender-info" style={{cursor: 'pointer'}} onClick={(e) => {
                                                e.stopPropagation();
                                                if (message.sender?._id) {
                                                    setUserActionMenu({ userId: message.sender._id, userName: message.sender.name, x: e.clientX, y: e.clientY });
                                                }
                                            }}>
                                                <div className="sender-avatar">
                                                    {message.sender?.name?.charAt(0) || '؟'}
                                                </div>
                                                <span className="sender-name">
                                                    {message.sender?.name || 'مستخدم محذوف'}
                                                </span>
                                            </div>
                                            <div className="message-actions">
                                                <span className="message-time">
                                                    {formatTime(message.createdAt)}
                                                </span>
                                                {!message.isDeleted && (
                                                    <button
                                                        className="delete-msg-btn"
                                                        onClick={() => {
                                                            setSelectedMessage(message);
                                                            setShowDeleteModal(true);
                                                        }}
                                                        title="حذف الرسالة"
                                                    >
                                                        🗑️
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                        <div className="message-content">
                                            {message.isDeleted ? (
                                                <p className="deleted-text">
                                                    <em>تم حذف هذه الرسالة</em>
                                                </p>
                                            ) : (
                                                <>
                                                    {message.content && <p>{message.content}</p>}
                                                    {message.type === 'image' && message.mediaUrl && (
                                                        <div className="message-image-container">
                                                            <img
                                                                src={getImageUrl(message.mediaUrl)}
                                                                alt="صورة"
                                                                className="message-image"
                                                                onError={(e) => { e.target.onerror = null; e.target.style.display = 'none'; }}
                                                            />
                                                        </div>
                                                    )}
                                                </>
                                            )}
                                            {message.type !== 'text' && message.type !== 'image' && !message.isDeleted && (
                                                <span className="message-type-badge">
                                                    {message.type === 'file' && '📎 ملف'}
                                                    {message.type === 'audio' && '🎵 صوت'}
                                                    {message.type === 'video' && '🎥 فيديو'}
                                                </span>
                                            )}
                                            {message.hasBannedWords && message.bannedWordsFound?.length > 0 && (
                                                <div className="banned-words-badges">
                                                    <span className="banned-label">⚠️ كلمات محظورة:</span>
                                                    {message.bannedWordsFound.map((w, i) => (
                                                        <span key={i} className={`banned-word-badge ${w.severity}`}>{w.word}</span>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </React.Fragment>
                            );
                        })}

                        {/* مؤشر "يكتب الآن" */}
                        {typingUser && (
                            <div className="typing-indicator">
                                <div className="typing-avatar">{typingUser.charAt(0)}</div>
                                <div className="typing-bubble">
                                    <span className="typing-text">{typingUser} يكتب</span>
                                    <div className="typing-dots">
                                        <span></span>
                                        <span></span>
                                        <span></span>
                                    </div>
                                </div>
                            </div>
                        )}

                        <div ref={messagesEndRef} />
                    </div>
                )}
            </div>

            {/* Message Input - واجهة الإرسال */}
            <form className="message-input-container" onSubmit={handleSendMessage}>
                <input
                    type="text"
                    className="message-input"
                    placeholder="اكتب رسالتك هنا..."
                    value={newMessage}
                    onChange={handleMessageInput}
                    disabled={sending}
                />
                <button
                    type="submit"
                    className="send-btn"
                    disabled={!newMessage.trim() || sending}
                >
                    {sending ? '⏳' : '📤'}
                </button>
            </form>

            {/* Pagination */}
            {totalPages > 1 && (
                <div className="messages-pagination">
                    <button
                        onClick={() => setPage(p => Math.max(1, p - 1))}
                        disabled={page === 1}
                        className="pagination-btn"
                    >
                        السابق
                    </button>
                    <span className="page-info">
                        صفحة {page} من {totalPages}
                    </span>
                    <button
                        onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                        disabled={page === totalPages}
                        className="pagination-btn"
                    >
                        التالي
                    </button>
                </div>
            )}

            {/* User Action Menu */}
            {userActionMenu && (
                <div className="user-action-overlay" onClick={() => setUserActionMenu(null)}>
                    <div className="user-action-menu"
                         style={{ top: Math.min(userActionMenu.y, window.innerHeight - 150), left: Math.min(userActionMenu.x, window.innerWidth - 220) }}
                         onClick={(e) => e.stopPropagation()}>
                        <div className="user-action-header">{userActionMenu.userName}</div>
                        <button className="user-action-btn view" onClick={() => {
                            if (onViewUser) onViewUser(userActionMenu.userId);
                            setUserActionMenu(null);
                        }}>👤 عرض الملف الشخصي</button>
                        <button className="user-action-btn ban" onClick={() => {
                            setBanningUser({ id: userActionMenu.userId, name: userActionMenu.userName });
                            setShowBanConfirm(true);
                            setUserActionMenu(null);
                        }}>🚫 حظر المستخدم</button>
                    </div>
                </div>
            )}

            {/* Ban Confirmation Modal */}
            {showBanConfirm && banningUser && (
                <div className="ban-modal-overlay" onClick={() => { setShowBanConfirm(false); setBanningUser(null); }}>
                    <div className="ban-modal" onClick={(e) => e.stopPropagation()}>
                        <h3>🚫 تأكيد الحظر</h3>
                        <p>هل أنت متأكد من حظر المستخدم "{banningUser.name}"؟</p>
                        <div className="ban-modal-actions">
                            <button className="ban-cancel-btn" onClick={() => { setShowBanConfirm(false); setBanningUser(null); }}>إلغاء</button>
                            <button className="ban-confirm-btn" onClick={async () => {
                                try {
                                    const response = await toggleUserActive(banningUser.id);
                                    if (response.success) {
                                        showToast('تم حظر المستخدم بنجاح', 'success');
                                    }
                                } catch (err) {
                                    showToast('فشل في حظر المستخدم', 'error');
                                }
                                setShowBanConfirm(false);
                                setBanningUser(null);
                            }}>حظر</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Delete Confirmation Modal */}
            {showDeleteModal && selectedMessage && (
                <div className="modal-overlay" onClick={() => setShowDeleteModal(false)}>
                    <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                        <h3>تأكيد الحذف</h3>
                        <p>هل أنت متأكد من حذف هذه الرسالة؟</p>
                        <div className="message-preview">
                            <strong>المرسل:</strong> {selectedMessage.sender?.name}<br />
                            <strong>المحتوى:</strong> {selectedMessage.content}
                        </div>
                        <div className="modal-actions">
                            <button
                                className="btn-cancel"
                                onClick={() => {
                                    setShowDeleteModal(false);
                                    setSelectedMessage(null);
                                }}
                            >
                                إلغاء
                            </button>
                            <button
                                className="btn-confirm-delete"
                                onClick={handleDeleteMessage}
                            >
                                حذف
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

export default ConversationMessages;
