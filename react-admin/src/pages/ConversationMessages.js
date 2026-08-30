import React, { useState, useEffect, useRef } from 'react';
import { getConversationMessages, deleteMessage, getConversationById, sendMessage, toggleUserActive, suspendUser } from '../services/api';
import { useToast } from '../components/Toast';
import LoadingSpinner from '../components/LoadingSpinner';
import AudioMessageBubble from '../components/AudioMessageBubble';
import ConversationMediaStrip from '../components/ConversationMediaStrip';
import socketService from '../services/socket';
import notificationService from '../services/notifications';
import { getImageUrl, getMessagePhotoUrl } from '../config';
import config from '../config';
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
    const [filter, setFilter] = useState('all');           // ✅ all | flagged | images | audio
    const [zoomImage, setZoomImage] = useState(null);      // ✅ {url, sender} للصور
    const [flaggedDetails, setFlaggedDetails] = useState(null); // ✅ تفاصيل المخالفة
    const messagesEndRef = useRef(null);
    const typingTimeoutRef = useRef(null);
    const typingDebounceRef = useRef(null);
    const { showToast } = useToast();

    // ─── ✅ Helpers للـ bubbles + الفلاتر ───
    const participantA = conversation?.participants?.[0];
    const participantB = conversation?.participants?.[1];
    const sideForSender = (senderId) => {
        if (!senderId) return 'right';
        if (participantA && senderId === participantA._id) return 'right';
        if (participantB && senderId === participantB._id) return 'left';
        return 'right';
    };

    const filteredMessages = React.useMemo(() => {
        // ✅ Sort ascending by createdAt — الأحدث في الأسفل (chat convention)
        const sorted = [...messages].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
        if (filter === 'all') return sorted;
        if (filter === 'flagged') return sorted.filter(m => m.hasBannedWords);
        if (filter === 'images') return sorted.filter(m => m.type === 'image');
        if (filter === 'audio') return sorted.filter(m => m.type === 'audio');
        return sorted;
    }, [messages, filter]);

    // قوائم الشريط العلوي — بترتيب زمني صاعد مثل الدردشة
    const byTime = React.useMemo(
        () => [...messages].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)),
        [messages]
    );
    const imageMessages = React.useMemo(() => byTime.filter(m => m.type === 'image' && !m.isDeleted), [byTime]);
    const audioMessages = React.useMemo(() => byTime.filter(m => m.type === 'audio' && !m.isDeleted), [byTime]);
    const flaggedMessages = React.useMemo(() => byTime.filter(m => m.hasBannedWords), [byTime]);

    const flaggedCount = flaggedMessages.length;
    const imagesCount = imageMessages.length;
    const audioCount = audioMessages.length;

    // القفز من الشريط إلى الرسالة في الدردشة + تظليل مؤقّت
    const [highlightedId, setHighlightedId] = useState(null);
    const highlightTimerRef = useRef(null);

    const jumpToMessage = (messageId) => {
        // الفلتر النشط قد يكون مُخفياً للرسالة — نعيده للكل أولاً
        setFilter('all');
        setHighlightedId(messageId);
        if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
        highlightTimerRef.current = setTimeout(() => setHighlightedId(null), 2600);
        // بعد إعادة الرسم
        setTimeout(() => {
            const el = document.getElementById(`msg-${messageId}`);
            if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 80);
    };

    useEffect(() => () => {
        if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    }, []);

    // ─── ✅ ميزة: إضافة كلمة لقائمة الكلمات المحظورة من شارة الكلمة ───
    const [addedWords, setAddedWords] = useState({});  // { word: 'pending' | 'added' | 'duplicate' }
    const [quickAddOpen, setQuickAddOpen] = useState(false);  // ✅ Modal الإضافة اليدوية
    const [quickAddText, setQuickAddText] = useState('');
    const [quickAddCategory, setQuickAddCategory] = useState('other');
    const [msgMenu, setMsgMenu] = useState(null);             // ✅ {message, x, y}
    const handleAddBannedWord = async (word, category = 'other') => {
        const trimmed = (word || '').trim().toLowerCase();
        if (!trimmed || addedWords[trimmed]) return;
        // ✅ تأكد إن الـ category من القيم الصحيحة (model enum)
        const validCategories = ['sexual', 'violence', 'hate', 'spam', 'other'];
        const safeCategory = validCategories.includes(category) ? category : 'other';
        setAddedWords(prev => ({ ...prev, [trimmed]: 'pending' }));
        try {
            const token = localStorage.getItem('token');
            const res = await fetch(config.API_URL + '/banned-words', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: 'Bearer ' + token
                },
                body: JSON.stringify({ word: trimmed, category: safeCategory, language: /[؀-ۿ]/.test(trimmed) ? 'ar' : 'en' })
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
                // الرد يغلّف المحادثة داخل data.conversation — كان يُخزَّن الغلاف
                // نفسه، فلا participants ولا عنوان: بطاقتا المشاركَين لا تظهران
                // وكل الرسائل تُرسم في جهة واحدة (sideForSender يعيد 'right' دوماً)
                setConversation(response.data?.conversation || response.data);
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

    // ─── ألوان المشاركَين (ثابتة) ───
    const sideColors = {
        right: { bg: '#dcf8c6', text: '#1f2937', accent: '#10b981' }, // أخضر فاتح (واتساب)
        left:  { bg: '#e5e7eb', text: '#111827', accent: '#6366f1' }  // رمادي فاتح
    };

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

            {/* رأس المحادثة — المشاركَان + إحصائيات */}
            {(participantA || participantB) && (
                <div className="conv-parties">
                    {[participantA, participantB].filter(Boolean).map((p, idx) => {
                        const violations = (p.warnings?.totalCount || 0) + (p.bannedWords?.violationCount || 0) + (p.externalPromo?.violations || 0);
                        const side = idx === 0 ? 'right' : 'left';
                        const accentColor = sideColors[side].accent;
                        return (
                            <div
                                key={p._id}
                                className="conv-party"
                                style={{ borderColor: accentColor }}
                                onClick={() => onViewUser && onViewUser(p._id)}
                                title="عرض الملف الشخصي"
                            >
                                <img
                                    className="conv-party-avatar"
                                    src={p.profileImage ? getImageUrl(p.profileImage) : `https://ui-avatars.com/api/?name=${encodeURIComponent(p.name || '?')}&background=${accentColor.slice(1)}&color=fff`}
                                    alt={p.name}
                                    onError={(e) => { e.target.onerror = null; e.target.src = `https://ui-avatars.com/api/?name=?&background=ccc`; }}
                                />
                                <div className="conv-party-info">
                                    <div className="conv-party-name">
                                        {p.name || 'مستخدم محذوف'}
                                        {p.isPremium && <span> ⭐</span>}
                                    </div>
                                    <div className="conv-party-badges">
                                        {violations > 0 ? (
                                            <span className={`conv-party-badge ${violations >= 5 ? 'danger' : 'warn'}`}>
                                                ⚠️ {violations} مخالفة
                                            </span>
                                        ) : (
                                            <span className="conv-party-badge ok">✓ نظيف</span>
                                        )}
                                        {p.suspension?.isSuspended && (
                                            <span className="conv-party-badge danger">🔒 موقوف</span>
                                        )}
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                    <div className="conv-stats">
                        <div><strong>{messages.length}</strong> رسالة</div>
                        {flaggedCount > 0 && <div className="stat-danger"><strong>{flaggedCount}</strong> ⚠️ مخالفة</div>}
                        {imagesCount > 0 && <div><strong>{imagesCount}</strong> 📷 صورة</div>}
                        {audioCount > 0 && <div><strong>{audioCount}</strong> 🎙️ صوتية</div>}
                    </div>
                </div>
            )}

            {/* شريط الوسائط والأدلة — صور/صوتيات/مخالفات في مكان واحد */}
            <ConversationMediaStrip
                images={imageMessages}
                audios={audioMessages}
                flagged={flaggedMessages}
                onJump={jumpToMessage}
                onZoom={setZoomImage}
            />

            {/* شرائط الفلتر + زر إضافة كلمة محظورة */}
            <div className="conv-filters">
                {[
                    { id: 'all', label: '📋 الكل', count: messages.length },
                    { id: 'flagged', label: '⚠️ مخالف', count: flaggedCount },
                    { id: 'images', label: '📷 صور', count: imagesCount },
                    { id: 'audio', label: '🎙️ صوتية', count: audioCount }
                ].map(chip => {
                    if (chip.count === 0 && chip.id !== 'all') return null;
                    return (
                        <button
                            key={chip.id}
                            className={`conv-filter-chip cf-${chip.id} ${filter === chip.id ? 'active' : ''}`}
                            onClick={() => setFilter(chip.id)}
                        >
                            {chip.label} <span className="cf-count">({chip.count})</span>
                        </button>
                    );
                })}

                {/* زر دائم لإضافة كلمة يدوياً (حتى لو الرسالة غير مكشوفة) */}
                <button
                    className="conv-addword-btn"
                    onClick={() => setQuickAddOpen(true)}
                    title="إضافة كلمة/نمط محظور يدوياً (للرسائل التي لم يلتقطها الفلتر تلقائياً)"
                >
                    ➕ إضافة كلمة محظورة
                </button>
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
                            background: 'var(--bg-card)',
                            borderRadius: 10,
                            boxShadow: '0 10px 30px rgba(0,0,0,0.18), 0 0 0 1px rgba(0,0,0,0.06)',
                            minWidth: 220,
                            overflow: 'hidden',
                            direction: 'rtl'
                        }}
                    >
                        <div style={{
                            padding: '10px 12px',
                            background: 'var(--bg-subtle)',
                            borderBottom: '1px solid var(--border-color)',
                            fontSize: 11,
                            color: 'var(--text-secondary)',
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
                                setQuickAddText(msgMenu.message.content || '');
                                setQuickAddCategory('other');
                                setQuickAddOpen(true);
                                setMsgMenu(null);
                            }}
                            style={{
                                width: '100%', textAlign: 'right',
                                padding: '11px 14px', border: 'none',
                                background: 'var(--bg-card)', cursor: 'pointer',
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
                                setSelectedMessage(msgMenu.message);
                                setShowDeleteModal(true);
                                setMsgMenu(null);
                            }}
                            style={{
                                width: '100%', textAlign: 'right',
                                padding: '11px 14px', border: 'none',
                                background: 'var(--bg-card)', cursor: 'pointer',
                                fontSize: 13, fontWeight: 600,
                                color: 'var(--text-primary)',
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
                        style={{ background: 'var(--bg-card)', borderRadius: 14, padding: 22, maxWidth: 460, width: '100%', boxShadow: '0 20px 50px rgba(0,0,0,0.3)' }}
                    >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                            <h3 style={{ margin: 0, color: '#dc2626' }}>➕ إضافة كلمة محظورة</h3>
                            <button onClick={() => setQuickAddOpen(false)} style={{ background: 'transparent', border: 'none', fontSize: 22, cursor: 'pointer' }}>✕</button>
                        </div>

                        <div style={{ marginBottom: 14, padding: 10, background: 'var(--tint-warning)', borderRadius: 8, fontSize: 12, color: 'var(--text-warning)', lineHeight: 1.6 }}>
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
                                width: '100%',
                                padding: '10px 12px',
                                border: '1.5px solid #d1d5db',
                                borderRadius: 8,
                                fontSize: 14,
                                marginBottom: 12,
                                boxSizing: 'border-box',
                                direction: 'rtl'
                            }}
                        />

                        <label style={{ display: 'block', marginBottom: 6, fontSize: 13, fontWeight: 700 }}>التصنيف:</label>
                        <select
                            value={quickAddCategory}
                            onChange={(e) => setQuickAddCategory(e.target.value)}
                            style={{
                                width: '100%', padding: '10px 12px',
                                border: '1.5px solid #d1d5db', borderRadius: 8,
                                fontSize: 14, marginBottom: 16, boxSizing: 'border-box'
                            }}
                        >
                            <option value="other">أخرى</option>
                            <option value="sexual">جنسي</option>
                            <option value="violence">عنف</option>
                            <option value="hate">كراهية</option>
                            <option value="spam">سبام / ترويج / رقم تواصل</option>
                        </select>

                        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                            <button
                                onClick={() => setQuickAddOpen(false)}
                                style={{ padding: '8px 18px', borderRadius: 8, border: '1px solid #d1d5db', background: 'var(--bg-card)', cursor: 'pointer', fontWeight: 600 }}
                            >
                                إلغاء
                            </button>
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
                                    color: 'var(--text-on-brand)', cursor: quickAddText.trim() ? 'pointer' : 'not-allowed',
                                    fontWeight: 700
                                }}
                            >
                                ➕ إضافة
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Messages Container — ✅ A: WhatsApp-style bubbles */}
            <div className="messages-container">
                {filteredMessages.length === 0 ? (
                    <div className="no-messages">
                        <p>{filter === 'all' ? 'لا توجد رسائل في هذه المحادثة 💬' : 'لا توجد نتائج لهذا الفلتر'}</p>
                    </div>
                ) : (
                    <div className="messages-list" style={{ padding: '12px 16px' }}>
                        {filteredMessages.map((message, index) => {
                            const showDate = index === 0 ||
                                formatDate(message.createdAt) !== formatDate(filteredMessages[index - 1]?.createdAt);
                            const side = sideForSender(message.sender?._id);
                            const colors = sideColors[side];
                            const prevMsg = filteredMessages[index - 1];
                            const sameSenderAsPrev = prevMsg && prevMsg.sender?._id === message.sender?._id && !showDate;
                            const isFlagged = message.hasBannedWords;

                            return (
                                <React.Fragment key={message._id}>
                                    {showDate && (
                                        <div className="date-divider">
                                            <span>{formatDate(message.createdAt)}</span>
                                        </div>
                                    )}
                                    {/* ─── صف الفقاعة ─── */}
                                    <div
                                        id={`msg-${message._id}`}
                                        className={`cm-row side-${side}${sameSenderAsPrev ? ' grouped' : ''}${highlightedId === message._id ? ' highlighted' : ''}`}
                                    >
                                        {/* الأفاتار — على أول رسالة في المجموعة فقط */}
                                        <div className="cm-avatar-slot">
                                            {!sameSenderAsPrev && (
                                                <div
                                                    className="cm-avatar"
                                                    style={{ background: colors.accent }}
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        if (message.sender?._id && onViewUser) {
                                                            onViewUser(message.sender._id);
                                                        }
                                                    }}
                                                    onContextMenu={(e) => {
                                                        e.preventDefault();
                                                        if (message.sender?._id) {
                                                            setUserActionMenu({ userId: message.sender._id, userName: message.sender.name, x: e.clientX, y: e.clientY });
                                                        }
                                                    }}
                                                    title={`${message.sender?.name || 'مستخدم'} — اضغط لعرض الملف، right-click لإجراءات`}
                                                >
                                                    {message.sender?.profileImage ? (
                                                        <img src={getImageUrl(message.sender.profileImage)} alt={message.sender.name} onError={(e) => { e.target.onerror = null; e.target.style.display = 'none'; }} />
                                                    ) : (
                                                        message.sender?.name?.charAt(0) || '؟'
                                                    )}
                                                </div>
                                            )}
                                        </div>

                                        <div className="cm-column">
                                            {!sameSenderAsPrev && (
                                                <div
                                                    className="cm-sender"
                                                    style={{ color: colors.accent }}
                                                    onClick={() => message.sender?._id && onViewUser && onViewUser(message.sender._id)}
                                                    title="عرض الملف الشخصي"
                                                >
                                                    {message.sender?.name || 'مستخدم محذوف'}
                                                </div>
                                            )}
                                            <div
                                                className={`cm-bubble${message.isDeleted ? ' deleted' : ''}${isFlagged && !message.isDeleted ? ' flagged' : ''}`}
                                                style={!message.isDeleted && !isFlagged ? { background: colors.bg, color: colors.text } : undefined}
                                                onClick={(e) => {
                                                    const tag = (e.target.tagName || '').toLowerCase();
                                                    if (tag === 'img' || tag === 'button' || tag === 'a') return;
                                                    if (message.isDeleted) return;
                                                    setMsgMenu({ message, x: e.clientX, y: e.clientY });
                                                }}
                                            >
                                                {/* ✅ C: شارة المخالفة الكبيرة */}
                                                {isFlagged && !message.isDeleted && (
                                                    <div
                                                        className="cm-flag-badge"
                                                        onClick={() => setFlaggedDetails(message)}
                                                        title="عرض تفاصيل المخالفة"
                                                    >
                                                        ⚠️ مخالف ({message.bannedWordsFound?.length || 1})
                                                    </div>
                                                )}

                                                {/* Message content */}
                                                {message.isDeleted ? (
                                                    <em className="cm-deleted-text">تم حذف هذه الرسالة</em>
                                                ) : (
                                                    <>
                                                        {message.content && <div className="cm-text">{message.content}</div>}
                                                        {/* ✅ D: صورة قابلة للتكبير */}
                                                        {message.type === 'image' && (() => {
                                                            const src = getMessagePhotoUrl(message);
                                                            if (!src) {
                                                                // صورة مؤقتة بلا أرشيف (رسائل قديمة قبل الأرشفة)
                                                                return message.isDisappearingPhoto ? (
                                                                    <span className="cm-note">⏱️ صورة مؤقتة — غير متوفرة في الأرشيف</span>
                                                                ) : null;
                                                            }
                                                            return (
                                                                <>
                                                                    {message.isExpiredPhoto && (
                                                                        <div className="cm-expired-badge">
                                                                            ⏱️ صورة مؤقتة منتهية — أرشيف الإشراف
                                                                        </div>
                                                                    )}
                                                                    <img
                                                                        src={src}
                                                                        alt="صورة"
                                                                        onClick={() => setZoomImage({ url: src, sender: message.sender })}
                                                                        className="cm-image"
                                                                        onError={(e) => { e.target.onerror = null; e.target.style.display = 'none'; }}
                                                                    />
                                                                </>
                                                            );
                                                        })()}
                                                        {message.type === 'audio' && message.mediaUrl && (
                                                            <AudioMessageBubble message={message} />
                                                        )}
                                                        {message.type !== 'text' && message.type !== 'image' && message.type !== 'audio' && (
                                                            <span className="cm-note">
                                                                {message.type === 'file' && '📎 ملف'}
                                                                {message.type === 'video' && '🎥 فيديو'}
                                                            </span>
                                                        )}
                                                    </>
                                                )}
                                            </div>
                                            {/* Time + actions */}
                                            <div className="cm-meta">
                                                <span className="cm-time">
                                                    {formatTime(message.createdAt)}
                                                </span>
                                                {!message.isDeleted && (
                                                    <button
                                                        onClick={() => {
                                                            setSelectedMessage(message);
                                                            setShowDeleteModal(true);
                                                        }}
                                                        className="cm-delete-btn"
                                                        title="حذف الرسالة"
                                                    >
                                                        🗑️
                                                    </button>
                                                )}
                                            </div>
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
                        <button className="user-action-btn" style={{background: 'var(--tint-warning)', color: 'var(--text-warning)'}} onClick={async () => {
                            try {
                                await suspendUser(userActionMenu.userId, '24h', 'تعليق من الرسائل');
                                showToast(`تم تعليق ${userActionMenu.userName} لمدة 24 ساعة`, 'success');
                            } catch { showToast('فشل التعليق', 'error'); }
                            setUserActionMenu(null);
                        }}>🔒 تعليق 24 ساعة</button>
                        <button className="user-action-btn" style={{background: 'var(--tint-warning)', color: 'var(--text-warning)'}} onClick={async () => {
                            try {
                                await suspendUser(userActionMenu.userId, '7d', 'تعليق من الرسائل');
                                showToast(`تم تعليق ${userActionMenu.userName} لمدة أسبوع`, 'success');
                            } catch { showToast('فشل التعليق', 'error'); }
                            setUserActionMenu(null);
                        }}>🔒 تعليق أسبوع</button>
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

            {/* ✅ D: Image Zoom Modal */}
            {zoomImage && (
                <div
                    onClick={() => setZoomImage(null)}
                    style={{
                        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.92)', zIndex: 9999,
                        display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'zoom-out',
                        padding: 20
                    }}
                >
                    <button
                        onClick={(e) => { e.stopPropagation(); setZoomImage(null); }}
                        style={{
                            position: 'absolute', top: 20, left: 20, background: 'var(--bg-card)', border: 'none',
                            width: 40, height: 40, borderRadius: '50%', fontSize: 20, cursor: 'pointer'
                        }}
                        title="إغلاق"
                    >✕</button>
                    <div style={{ position: 'absolute', top: 20, right: 20, display: 'flex', gap: 8 }}>
                        {zoomImage.sender?._id && onViewUser && (
                            <button
                                onClick={(e) => { e.stopPropagation(); onViewUser(zoomImage.sender._id); setZoomImage(null); }}
                                style={{
                                    background: '#6366f1', color: 'var(--text-on-brand)', border: 'none',
                                    padding: '8px 14px', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer'
                                }}
                                title="عرض ملف المرسل"
                            >👤 ملف المرسل</button>
                        )}
                        <a
                            href={zoomImage.url}
                            download
                            onClick={(e) => e.stopPropagation()}
                            style={{
                                background: 'var(--bg-card)', padding: '8px 14px', borderRadius: 8,
                                textDecoration: 'none', color: '#111', fontSize: 13, fontWeight: 700
                            }}
                            title="تنزيل الصورة"
                        >⬇️ تنزيل</a>
                    </div>
                    <img
                        src={zoomImage.url}
                        alt="معاينة"
                        onClick={(e) => e.stopPropagation()}
                        style={{ maxWidth: '95vw', maxHeight: '90vh', borderRadius: 8, cursor: 'default' }}
                    />
                </div>
            )}

            {/* ✅ C: Flagged Details Modal */}
            {flaggedDetails && (
                <div
                    onClick={() => setFlaggedDetails(null)}
                    style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 9998, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
                >
                    <div
                        onClick={(e) => e.stopPropagation()}
                        style={{ background: 'var(--bg-card)', borderRadius: 14, padding: 20, maxWidth: 480, width: '100%', boxShadow: '0 20px 50px rgba(0,0,0,0.3)' }}
                    >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                            <h3 style={{ margin: 0, color: '#dc2626' }}>⚠️ تفاصيل المخالفة</h3>
                            <button onClick={() => setFlaggedDetails(null)} style={{ background: 'transparent', border: 'none', fontSize: 22, cursor: 'pointer' }}>✕</button>
                        </div>
                        <div style={{ marginBottom: 12, padding: 10, background: '#fef3c7', borderRadius: 8, fontSize: 13 }}>
                            <strong>المرسل:</strong> {flaggedDetails.sender?.name || 'مستخدم محذوف'}<br />
                            <strong>الوقت:</strong> {formatDate(flaggedDetails.createdAt)} {formatTime(flaggedDetails.createdAt)}
                        </div>
                        <div style={{ marginBottom: 12 }}>
                            <strong style={{ display: 'block', marginBottom: 6 }}>المحتوى:</strong>
                            <div style={{ padding: 10, background: '#fee2e2', borderRadius: 8, fontSize: 13, lineHeight: 1.5, border: '1px solid #fca5a5' }}>
                                {flaggedDetails.content || '(فارغ)'}
                            </div>
                        </div>
                        {flaggedDetails.bannedWordsFound?.length > 0 && (
                            <div style={{ marginBottom: 12 }}>
                                <strong style={{ display: 'block', marginBottom: 6 }}>الكلمات المكتشفة:</strong>
                                <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 8 }}>
                                    اضغط على ➕ لإضافة الكلمة لقائمة المحظورات الموحّدة (تطبَّق على كل المستخدمين)
                                </div>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                    {flaggedDetails.bannedWordsFound.map((w, i) => {
                                        const wordKey = (w.word || '').trim().toLowerCase();
                                        const status = addedWords[wordKey];
                                        return (
                                            <div key={i} style={{
                                                display: 'inline-flex', alignItems: 'center', gap: 4,
                                                background: w.severity === 'high' ? '#dc2626' : (w.severity === 'medium' ? '#f59e0b' : '#9ca3af'),
                                                color: 'var(--text-on-brand)', padding: '3px 4px 3px 10px', borderRadius: 6, fontSize: 12, fontWeight: 700
                                            }}>
                                                <span>{w.word} {w.severity && `(${w.severity})`}</span>
                                                <button
                                                    onClick={() => handleAddBannedWord(w.word, w.category || 'other')}
                                                    disabled={!!status}
                                                    title={
                                                        status === 'added' ? 'تمت الإضافة بنجاح'
                                                        : status === 'duplicate' ? 'موجودة مسبقاً'
                                                        : status === 'pending' ? 'جاري الإضافة...'
                                                        : 'إضافة لقائمة الكلمات المحظورة'
                                                    }
                                                    style={{
                                                        background: status === 'added' ? '#10b981' : (status === 'duplicate' ? '#6b7280' : '#fff'),
                                                        color: status === 'added' || status === 'duplicate' ? '#fff' : '#374151',
                                                        border: 'none', borderRadius: 4,
                                                        width: 22, height: 22,
                                                        fontSize: 13, fontWeight: 700,
                                                        cursor: status ? 'default' : 'pointer',
                                                        display: 'flex', alignItems: 'center', justifyContent: 'center'
                                                    }}
                                                >
                                                    {status === 'pending' ? '⏳'
                                                     : status === 'added' ? '✓'
                                                     : status === 'duplicate' ? '✓'
                                                     : '➕'}
                                                </button>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}
                        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
                            <button
                                onClick={() => setFlaggedDetails(null)}
                                style={{ padding: '8px 18px', borderRadius: 8, border: '1px solid #d1d5db', background: 'var(--bg-card)', cursor: 'pointer', fontWeight: 600 }}
                            >
                                إغلاق
                            </button>
                            {flaggedDetails.sender?._id && (
                                <button
                                    onClick={() => {
                                        if (onViewUser) onViewUser(flaggedDetails.sender._id);
                                        setFlaggedDetails(null);
                                    }}
                                    style={{ padding: '8px 18px', borderRadius: 8, border: 'none', background: '#6366f1', color: 'var(--text-on-brand)', cursor: 'pointer', fontWeight: 700 }}
                                >
                                    👤 ملف المرسل
                                </button>
                            )}
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
