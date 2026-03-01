import React, { useState, useEffect } from 'react';
import {
    getAllChatRooms,
    createChatRoom,
    updateChatRoom,
    deleteChatRoom,
    deleteRoomMessages,
    toggleChatRoomActive,
    toggleChatRoomLock,
    uploadRoomImage,
    getRoomMessages,
    getChatRoomStats,
    deleteMessage,
    getRoomReports,
    pinRoomMessage,
    toggleUserActive
} from '../services/api';
import { useToast } from '../components/Toast';
import LoadingSpinner from '../components/LoadingSpinner';
import EmptyState from '../components/EmptyState';
import ImageUpload from '../components/ImageUpload';
import ConfirmModal from '../components/ConfirmModal';
import { formatDateTime } from '../utils/formatters';
import { getImageUrl, getDefaultAvatar } from '../config';
import './ChatRooms.css';

function ChatRooms({ onViewUser }) {
    const [rooms, setRooms] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showModal, setShowModal] = useState(false);
    const [modalMode, setModalMode] = useState('create'); // create or edit
    const [selectedRoom, setSelectedRoom] = useState(null);
    const [formData, setFormData] = useState({
        name: '',
        image: '',
        description: '',
        accessType: 'public',
        category: ''
    });
    const [categories, setCategories] = useState([]);
    const [selectedImageFile, setSelectedImageFile] = useState(null); // للصورة المختارة
    const [searchTerm, setSearchTerm] = useState('');
    const [filterActive, setFilterActive] = useState('all'); // all, active, inactive
    const [showDetailsModal, setShowDetailsModal] = useState(false);
    const [detailsRoom, setDetailsRoom] = useState(null);
    const [roomMessages, setRoomMessages] = useState([]);
    const [roomStats, setRoomStats] = useState(null);
    const [loadingDetails, setLoadingDetails] = useState(false);
    const [messagesPage, setMessagesPage] = useState(1);
    const [totalMessagesPages, setTotalMessagesPages] = useState(1);
    const [roomReports, setRoomReports] = useState([]);
    const [loadingReports, setLoadingReports] = useState(false);
    const [showPinModal, setShowPinModal] = useState(false);
    const [pinRoom, setPinRoom] = useState(null);
    const [pinContent, setPinContent] = useState('');
    const [expandedImage, setExpandedImage] = useState(null);
    const [userActionMenu, setUserActionMenu] = useState(null);
    const [banningUser, setBanningUser] = useState(null);
    const [deleteConfirm, setDeleteConfirm] = useState({ show: false, roomId: null, roomName: '' });
    const [deleteMessagesConfirm, setDeleteMessagesConfirm] = useState({ show: false, roomId: null, roomName: '' });
    const [deleteMessageConfirm, setDeleteMessageConfirm] = useState({ show: false, messageId: null });
    const { showToast } = useToast();

    // صورة افتراضية SVG للغرف
    const defaultRoomImage = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='200' viewBox='0 0 300 200'%3E%3Cdefs%3E%3ClinearGradient id='grad' x1='0%25' y1='0%25' x2='100%25' y2='100%25'%3E%3Cstop offset='0%25' style='stop-color:%23667eea;stop-opacity:1' /%3E%3Cstop offset='100%25' style='stop-color:%23764ba2;stop-opacity:1' /%3E%3C/linearGradient%3E%3C/defs%3E%3Crect fill='url(%23grad)' width='300' height='200'/%3E%3Ctext fill='white' font-family='Arial' font-size='48' x='50%25' y='45%25' text-anchor='middle' dominant-baseline='middle'%3E🏠%3C/text%3E%3Ctext fill='white' font-family='Arial' font-size='16' x='50%25' y='65%25' text-anchor='middle' dominant-baseline='middle'%3EChat Room%3C/text%3E%3C/svg%3E";

    useEffect(() => {
        fetchRooms();
        fetchCategories();
    }, []);

    const fetchCategories = async () => {
        try {
            const response = await fetch('/api/categories?active=true');
            const data = await response.json();
            if (data.success) {
                setCategories(data.data);
            }
        } catch (error) {
            console.error('خطأ في جلب التصنيفات:', error);
        }
    };

    const fetchRooms = async () => {
        try {
            setLoading(true);
            const response = await getAllChatRooms(1, 100);
            if (response.success) {
                setRooms(response.data.rooms);
            }
        } catch (error) {
            console.error('خطأ في جلب الغرف:', error);
            showToast('فشل تحميل الغرف', 'error');
        } finally {
            setLoading(false);
        }
    };

    const handleCreate = () => {
        setModalMode('create');
        setSelectedRoom(null);
        setSelectedImageFile(null);
        setFormData({
            name: '',
            image: '',
            description: '',
            accessType: 'public',
            category: ''
        });
        setShowModal(true);
    };

    const handleEdit = (room) => {
        setModalMode('edit');
        setSelectedRoom(room);
        setSelectedImageFile(null);
        setFormData({
            name: room.name,
            image: room.image,
            description: room.description || '',
            accessType: room.accessType,
            category: room.category?._id || room.category || ''
        });
        setShowModal(true);
    };

    const handleUploadRoomImage = async (file) => {
        try {
            if (!selectedRoom || !selectedRoom._id) {
                showToast('يجب حفظ الغرفة أولاً قبل رفع الصورة', 'error');
                return;
            }

            const response = await uploadRoomImage(selectedRoom._id, file);
            if (response.success) {
                showToast('تم رفع صورة الغرفة بنجاح ✅', 'success');
                // Update the room image in state
                setFormData(prev => ({
                    ...prev,
                    image: response.data.image
                }));
                fetchRooms();
            }
        } catch (error) {
            console.error('خطأ في رفع صورة الغرفة:', error);
            showToast(error.response?.data?.message || 'فشل رفع الصورة', 'error');
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();

        if (!formData.name) {
            showToast('اسم الغرفة مطلوب', 'error');
            return;
        }

        try {
            if (modalMode === 'create') {
                // إنشاء الغرفة بدون صورة أولاً
                const createData = {
                    name: formData.name,
                    description: formData.description,
                    accessType: formData.accessType,
                    category: formData.category || null,
                    image: '' // سيتم استخدام الصورة الافتراضية
                };

                const response = await createChatRoom(createData);
                if (response.success) {
                    // إذا كان هناك صورة مختارة، ارفعها
                    if (selectedImageFile) {
                        try {
                            const uploadResponse = await uploadRoomImage(response.data._id, selectedImageFile);
                            if (uploadResponse.success) {
                                showToast('تم إنشاء الغرفة ورفع الصورة بنجاح ✅', 'success');
                            }
                        } catch (uploadError) {
                            console.error('خطأ في رفع الصورة:', uploadError);
                            showToast('تم إنشاء الغرفة لكن فشل رفع الصورة', 'warning');
                        }
                    } else {
                        showToast('تم إنشاء الغرفة بنجاح ✅', 'success');
                    }
                    fetchRooms();
                    setShowModal(false);
                    setSelectedImageFile(null);
                }
            } else {
                const response = await updateChatRoom(selectedRoom._id, formData);
                if (response.success) {
                    showToast('تم تحديث الغرفة بنجاح ✅', 'success');
                    fetchRooms();
                    setShowModal(false);
                }
            }
        } catch (error) {
            console.error('خطأ في حفظ الغرفة:', error);
            showToast(error.response?.data?.message || 'فشل حفظ الغرفة', 'error');
        }
    };

    const handleDelete = async (roomId) => {
        try {
            const response = await deleteChatRoom(roomId);
            if (response.success) {
                showToast('تم حذف الغرفة بنجاح ✅', 'success');
                fetchRooms();
            }
        } catch (error) {
            console.error('خطأ في حذف الغرفة:', error);
            showToast('فشل حذف الغرفة', 'error');
        } finally {
            setDeleteConfirm({ show: false, roomId: null, roomName: '' });
        }
    };

    const handleDeleteMessages = async (roomId) => {
        try {
            const response = await deleteRoomMessages(roomId);
            if (response.success) {
                showToast(`تم حذف ${response.deletedCount} رسالة ✅`, 'success');
                fetchRooms();
            }
        } catch (error) {
            console.error('خطأ في حذف الرسائل:', error);
            showToast('فشل حذف الرسائل', 'error');
        } finally {
            setDeleteMessagesConfirm({ show: false, roomId: null, roomName: '' });
        }
    };

    const handleToggleActive = async (roomId) => {
        try {
            const response = await toggleChatRoomActive(roomId);
            if (response.success) {
                showToast(response.message, 'success');
                fetchRooms();
            }
        } catch (error) {
            console.error('خطأ في تغيير حالة الغرفة:', error);
            showToast('فشل تغيير حالة الغرفة', 'error');
        }
    };

    const handleToggleLock = async (roomId) => {
        try {
            const response = await toggleChatRoomLock(roomId);
            if (response.success) {
                showToast(response.message, 'success');
                fetchRooms();
            }
        } catch (error) {
            console.error('خطأ في تغيير قفل الغرفة:', error);
            showToast('فشل تغيير قفل الغرفة', 'error');
        }
    };

    // فتح modal الإعلان المثبت
    const handleOpenPinModal = (room) => {
        setPinRoom(room);
        setPinContent(room.pinnedMessage?.content || '');
        setShowPinModal(true);
    };

    // تثبيت الإعلان
    const handlePinMessage = async () => {
        if (!pinRoom) return;

        try {
            const response = await pinRoomMessage(pinRoom._id, pinContent);
            if (response.success) {
                showToast(response.message, 'success');
                setShowPinModal(false);
                fetchRooms();
            }
        } catch (error) {
            console.error('خطأ في تثبيت الإعلان:', error);
            showToast('فشل تثبيت الإعلان', 'error');
        }
    };

    // عرض تفاصيل الغرفة مع المحادثات
    const handleViewDetails = async (room) => {
        setDetailsRoom(room);
        setShowDetailsModal(true);
        setLoadingDetails(true);
        setMessagesPage(1);

        try {
            // جلب الإحصائيات والرسائل
            const [statsRes, messagesRes] = await Promise.all([
                getChatRoomStats(room._id),
                getRoomMessages(room._id, 1, 50)
            ]);

            if (statsRes.success) {
                setRoomStats(statsRes.data);
            }
            if (messagesRes.success) {
                setRoomMessages(messagesRes.data.messages);
                setTotalMessagesPages(messagesRes.data.totalPages);
            }

            // جلب البلاغات
            await fetchRoomReports(room._id);
        } catch (error) {
            console.error('خطأ في جلب تفاصيل الغرفة:', error);
            showToast('فشل جلب تفاصيل الغرفة', 'error');
        } finally {
            setLoadingDetails(false);
        }
    };

    // تحميل المزيد من الرسائل
    const loadMoreMessages = async () => {
        if (messagesPage >= totalMessagesPages) return;

        try {
            const nextPage = messagesPage + 1;
            const response = await getRoomMessages(detailsRoom._id, nextPage, 50);
            if (response.success) {
                setRoomMessages(prev => [...prev, ...response.data.messages]);
                setMessagesPage(nextPage);
            }
        } catch (error) {
            console.error('خطأ في تحميل المزيد من الرسائل:', error);
        }
    };

    // حذف رسالة فردية
    const handleDeleteMessage = async (messageId) => {
        try {
            const response = await deleteMessage(messageId);
            if (response.success) {
                showToast('تم حذف الرسالة بنجاح ✅', 'success');
                setRoomMessages(prev => prev.filter(m => m._id !== messageId));
            }
        } catch (error) {
            console.error('خطأ في حذف الرسالة:', error);
            showToast('فشل حذف الرسالة', 'error');
        } finally {
            setDeleteMessageConfirm({ show: false, messageId: null });
        }
    };

    // جلب بلاغات الغرفة
    const fetchRoomReports = async (roomId) => {
        setLoadingReports(true);
        try {
            const response = await getRoomReports(roomId);
            if (response.success) {
                setRoomReports(response.data || []);
            }
        } catch (error) {
            console.error('خطأ في جلب البلاغات:', error);
            setRoomReports([]);
        } finally {
            setLoadingReports(false);
        }
    };

    // Filter and search
    const filteredRooms = rooms.filter(room => {
        const matchesSearch = room.name.toLowerCase().includes(searchTerm.toLowerCase());
        const matchesFilter =
            filterActive === 'all' ||
            (filterActive === 'active' && room.isActive) ||
            (filterActive === 'inactive' && !room.isActive);
        return matchesSearch && matchesFilter;
    });

    if (loading) {
        return <LoadingSpinner text="جاري تحميل غرف المحادثة..." />;
    }

    return (
        <div className="chat-rooms-page">
            {/* Header */}
            <div className="rooms-header">
                <div className="header-left">
                    <h1>🏠 غرف المحادثة</h1>
                    <p>إدارة غرف المحادثة العامة</p>
                </div>
                <button className="btn-create" onClick={handleCreate}>
                    ➕ إنشاء غرفة جديدة
                </button>
            </div>

            {/* Filters */}
            <div className="rooms-filters">
                <div className="search-box">
                    <input
                        type="text"
                        placeholder="ابحث عن غرفة..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                    <span className="search-icon">🔍</span>
                </div>

                <div className="filter-buttons">
                    <button
                        className={`filter-btn ${filterActive === 'all' ? 'active' : ''}`}
                        onClick={() => setFilterActive('all')}
                    >
                        الكل ({rooms.length})
                    </button>
                    <button
                        className={`filter-btn ${filterActive === 'active' ? 'active' : ''}`}
                        onClick={() => setFilterActive('active')}
                    >
                        نشطة ({rooms.filter(r => r.isActive).length})
                    </button>
                    <button
                        className={`filter-btn ${filterActive === 'inactive' ? 'active' : ''}`}
                        onClick={() => setFilterActive('inactive')}
                    >
                        معطلة ({rooms.filter(r => !r.isActive).length})
                    </button>
                </div>
            </div>

            {/* Rooms Grid */}
            {filteredRooms.length === 0 ? (
                <EmptyState
                    icon="🏠"
                    title="لا توجد غرف محادثة"
                    description="ابدأ بإنشاء غرفة محادثة جديدة"
                />
            ) : (
                <div className="rooms-grid">
                    {filteredRooms.map(room => (
                        <div key={room._id} className={`room-card ${!room.isActive ? 'inactive' : ''}`}>
                            <div className="room-image">
                                <img
                                    src={room.image && room.image.trim() !== '' ? getImageUrl(room.image) : defaultRoomImage}
                                    alt={room.name}
                                    onError={(e) => {
                                        e.target.onerror = null;
                                        e.target.src = defaultRoomImage;
                                    }}
                                    loading="lazy"
                                />
                                {room.isLocked && <span className="lock-badge">🔒</span>}
                                {!room.isActive && <span className="inactive-badge">معطلة</span>}
                            </div>

                            <div className="room-info">
                                <h3>{room.name}</h3>
                                {room.description && <p className="room-description">{room.description}</p>}

                                <div className="room-stats">
                                    <span className="stat">
                                        <span className="stat-icon">👥</span>
                                        {room.memberCount || 0} عضو
                                    </span>
                                    <span className="stat">
                                        <span className="stat-icon">💬</span>
                                        {room.messageCount || 0} رسالة
                                    </span>
                                    <span className={`stat access-${room.accessType}`}>
                                        <span className="stat-icon">{room.accessType === 'public' ? '🌐' : '🔐'}</span>
                                        {room.accessType === 'public' ? 'عامة' : 'خاصة'}
                                    </span>
                                </div>
                            </div>

                            <div className="room-actions">
                                <button
                                    className="action-btn view"
                                    onClick={() => handleViewDetails(room)}
                                    title="عرض التفاصيل والمحادثات"
                                >
                                    👁️
                                </button>
                                <button
                                    className="action-btn edit"
                                    onClick={() => handleEdit(room)}
                                    title="تعديل"
                                >
                                    ✏️
                                </button>
                                <button
                                    className={`action-btn toggle ${room.isActive ? 'active' : 'inactive'}`}
                                    onClick={() => handleToggleActive(room._id)}
                                    title={room.isActive ? 'تعطيل' : 'تفعيل'}
                                >
                                    {room.isActive ? '🟢' : '🔴'}
                                </button>
                                <button
                                    className={`action-btn lock ${room.isLocked ? 'locked' : ''}`}
                                    onClick={() => handleToggleLock(room._id)}
                                    title={room.isLocked ? 'فتح' : 'قفل'}
                                >
                                    {room.isLocked ? '🔒' : '🔓'}
                                </button>
                                <button
                                    className={`action-btn pin ${room.pinnedMessage?.content ? 'has-pin' : ''}`}
                                    onClick={() => handleOpenPinModal(room)}
                                    title="إعلان مثبت"
                                >
                                    📌
                                </button>
                                <button
                                    className="action-btn delete-messages"
                                    onClick={() => setDeleteMessagesConfirm({ show: true, roomId: room._id, roomName: room.name })}
                                    title="حذف الرسائل"
                                >
                                    🗑️💬
                                </button>
                                <button
                                    className="action-btn delete"
                                    onClick={() => setDeleteConfirm({ show: true, roomId: room._id, roomName: room.name })}
                                    title="حذف الغرفة"
                                >
                                    ❌
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Modal */}
            {showModal && (
                <div className="modal-overlay" onClick={() => setShowModal(false)}>
                    <div className="room-modal" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3>{modalMode === 'create' ? '➕ إنشاء غرفة جديدة' : '✏️ تعديل الغرفة'}</h3>
                            <button className="close-btn" onClick={() => setShowModal(false)}>✕</button>
                        </div>

                        <form onSubmit={handleSubmit} className="room-form">
                            <div className="form-group">
                                <label>اسم الغرفة *</label>
                                <input
                                    type="text"
                                    value={formData.name}
                                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                    placeholder="مثال: غرفة الدردشة العامة"
                                    maxLength={100}
                                    required
                                />
                            </div>

                            {/* رفع صورة الغرفة */}
                            {modalMode === 'create' ? (
                                <div className="form-group">
                                    <label>صورة الغرفة</label>
                                    <div className="image-upload-area" style={{
                                        border: '2px dashed #ddd',
                                        borderRadius: '12px',
                                        padding: '20px',
                                        textAlign: 'center',
                                        cursor: 'pointer',
                                        background: '#fafafa'
                                    }}>
                                        <input
                                            type="file"
                                            accept="image/*"
                                            onChange={(e) => {
                                                const file = e.target.files[0];
                                                if (file) {
                                                    setSelectedImageFile(file);
                                                    // معاينة الصورة
                                                    const reader = new FileReader();
                                                    reader.onloadend = () => {
                                                        setFormData(prev => ({ ...prev, image: reader.result }));
                                                    };
                                                    reader.readAsDataURL(file);
                                                }
                                            }}
                                            style={{ display: 'none' }}
                                            id="room-image-input"
                                        />
                                        <label htmlFor="room-image-input" style={{ cursor: 'pointer', display: 'block' }}>
                                            {selectedImageFile ? (
                                                <div>
                                                    <div className="image-preview" style={{ marginBottom: '10px' }}>
                                                        <img src={formData.image} alt="معاينة" style={{ maxWidth: '100%', maxHeight: '200px', borderRadius: '8px' }} />
                                                    </div>
                                                    <p style={{ color: '#667eea', fontSize: '14px' }}>📁 {selectedImageFile.name}</p>
                                                    <p style={{ color: '#999', fontSize: '12px' }}>انقر لتغيير الصورة</p>
                                                </div>
                                            ) : (
                                                <div>
                                                    <div style={{ fontSize: '48px', marginBottom: '15px' }}>📷</div>
                                                    <p style={{ color: '#666', fontSize: '16px', margin: '10px 0' }}>انقر لاختيار صورة</p>
                                                    <span style={{ color: '#999', fontSize: '13px' }}>JPEG, PNG, GIF, WEBP (حد أقصى 5MB)</span>
                                                </div>
                                            )}
                                        </label>
                                    </div>
                                </div>
                            ) : (
                                <ImageUpload
                                    currentImage={formData.image}
                                    onUpload={handleUploadRoomImage}
                                    title="صورة الغرفة"
                                    type="room"
                                />
                            )}

                            <div className="form-group">
                                <label>الوصف</label>
                                <textarea
                                    value={formData.description}
                                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                                    placeholder="وصف مختصر للغرفة..."
                                    maxLength={500}
                                    rows={3}
                                />
                            </div>

                            <div className="form-group">
                                <label>نوع الوصول</label>
                                <select
                                    value={formData.accessType}
                                    onChange={(e) => setFormData({ ...formData, accessType: e.target.value })}
                                >
                                    <option value="public">🌐 عامة (يمكن لأي مستخدم الدخول)</option>
                                    <option value="private">🔐 خاصة (بدعوة فقط)</option>
                                </select>
                            </div>

                            <div className="form-group">
                                <label>التصنيف</label>
                                <select
                                    value={formData.category}
                                    onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                                >
                                    <option value="">-- بدون تصنيف --</option>
                                    {categories.map(cat => (
                                        <option key={cat._id} value={cat._id}>
                                            {cat.name}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <div className="modal-actions">
                                <button type="button" className="btn-cancel" onClick={() => setShowModal(false)}>
                                    إلغاء
                                </button>
                                <button type="submit" className="btn-submit">
                                    {modalMode === 'create' ? '✅ إنشاء' : '💾 حفظ'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Room Details Modal */}
            {showDetailsModal && detailsRoom && (
                <div className="modal-overlay" onClick={() => setShowDetailsModal(false)}>
                    <div className="details-modal" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3>📊 تفاصيل الغرفة: {detailsRoom.name}</h3>
                            <button className="close-btn" onClick={() => setShowDetailsModal(false)}>✕</button>
                        </div>

                        {loadingDetails ? (
                            <div className="loading-details">
                                <LoadingSpinner text="جاري تحميل التفاصيل..." />
                            </div>
                        ) : (
                            <div className="details-content">
                                {/* إحصائيات الغرفة */}
                                <div className="room-stats-section">
                                    <h4>📈 الإحصائيات</h4>
                                    <div className="stats-grid-mini">
                                        <div className="stat-item">
                                            <span className="stat-value">{roomStats?.room?.memberCount || detailsRoom.memberCount || 0}</span>
                                            <span className="stat-label">👥 الأعضاء</span>
                                        </div>
                                        <div className="stat-item">
                                            <span className="stat-value">{roomStats?.messages?.total || detailsRoom.messageCount || 0}</span>
                                            <span className="stat-label">💬 إجمالي الرسائل</span>
                                        </div>
                                        <div className="stat-item">
                                            <span className="stat-value">{roomStats?.messages?.today || 0}</span>
                                            <span className="stat-label">📅 رسائل اليوم</span>
                                        </div>
                                        <div className="stat-item">
                                            <span className={`stat-value ${detailsRoom.isActive ? 'active' : 'inactive'}`}>
                                                {detailsRoom.isActive ? '🟢 نشطة' : '🔴 معطلة'}
                                            </span>
                                            <span className="stat-label">الحالة</span>
                                        </div>
                                        <div className="stat-item">
                                            <span className="stat-value">
                                                {detailsRoom.isLocked ? '🔒 مقفلة' : '🔓 مفتوحة'}
                                            </span>
                                            <span className="stat-label">القفل</span>
                                        </div>
                                        <div className="stat-item">
                                            <span className="stat-value">
                                                {detailsRoom.accessType === 'public' ? '🌐 عامة' : '🔐 خاصة'}
                                            </span>
                                            <span className="stat-label">نوع الوصول</span>
                                        </div>
                                    </div>
                                </div>

                                {/* قائمة المحادثات */}
                                <div className="messages-section">
                                    <h4>💬 المحادثات ({roomMessages.length} رسالة)</h4>
                                    {roomMessages.length === 0 ? (
                                        <div className="no-messages">
                                            <p>لا توجد رسائل في هذه الغرفة بعد</p>
                                        </div>
                                    ) : (
                                        <div className="messages-list">
                                            {roomMessages.map((message) => (
                                                <div key={message._id} className={`message-item ${message.hasBannedWords ? 'flagged' : ''}`}>
                                                    <div className="message-avatar" style={{cursor: 'pointer'}} onClick={(e) => {
                                                        e.stopPropagation();
                                                        if (message.sender?._id) {
                                                            setUserActionMenu({ userId: message.sender._id, userName: message.sender.name, x: e.clientX, y: e.clientY });
                                                        }
                                                    }}>
                                                        <img
                                                            src={message.sender?.profileImage ? getImageUrl(message.sender.profileImage) : getDefaultAvatar(message.sender?.name)}
                                                            alt={message.sender?.name}
                                                            onError={(e) => {
                                                                e.target.onerror = null;
                                                                e.target.src = getDefaultAvatar(message.sender?.name);
                                                            }}
                                                        />
                                                    </div>
                                                    <div className="message-content">
                                                        <div className="message-header">
                                                            <span className="sender-name" style={{cursor: 'pointer'}} onClick={(e) => {
                                                                e.stopPropagation();
                                                                if (message.sender?._id) {
                                                                    setUserActionMenu({ userId: message.sender._id, userName: message.sender.name, x: e.clientX, y: e.clientY });
                                                                }
                                                            }}>{message.sender?.name || 'مستخدم محذوف'}</span>
                                                            <span className="message-time">{formatDateTime(message.createdAt)}</span>
                                                        </div>
                                                        {message.content && <p className="message-text">{message.content}</p>}
                                                        {message.type === 'image' && message.mediaUrl && (
                                                            <div className="message-image-container">
                                                                <img
                                                                    src={getImageUrl(message.mediaUrl)}
                                                                    alt="صورة مرسلة"
                                                                    className="message-image"
                                                                    onClick={() => setExpandedImage(getImageUrl(message.mediaUrl))}
                                                                    onError={(e) => { e.target.onerror = null; e.target.style.display = 'none'; }}
                                                                />
                                                            </div>
                                                        )}
                                                        {message.type === 'video' && <span className="message-type-badge">🎥 فيديو</span>}
                                                        {message.type === 'audio' && <span className="message-type-badge">🎵 صوت</span>}
                                                        {message.type === 'file' && <span className="message-type-badge">📎 ملف</span>}
                                                        {message.hasBannedWords && message.bannedWordsFound?.length > 0 && (
                                                            <div className="banned-words-badges">
                                                                <span className="banned-label">⚠️ كلمات محظورة:</span>
                                                                {message.bannedWordsFound.map((w, i) => (
                                                                    <span key={i} className={`banned-word-badge ${w.severity}`}>{w.word}</span>
                                                                ))}
                                                            </div>
                                                        )}
                                                    </div>
                                                    <button
                                                        className="delete-message-btn"
                                                        onClick={() => setDeleteMessageConfirm({ show: true, messageId: message._id })}
                                                        title="حذف الرسالة"
                                                    >
                                                        🗑️
                                                    </button>
                                                </div>
                                            ))}

                                            {messagesPage < totalMessagesPages && (
                                                <button className="load-more-btn" onClick={loadMoreMessages}>
                                                    تحميل المزيد...
                                                </button>
                                            )}
                                        </div>
                                    )}
                                </div>

                                {/* قسم البلاغات */}
                                <div className="reports-section">
                                    <h4>🚨 البلاغات ({roomReports.length})</h4>
                                    {loadingReports ? (
                                        <div className="loading-reports">
                                            <p>جاري تحميل البلاغات...</p>
                                        </div>
                                    ) : roomReports.length === 0 ? (
                                        <div className="no-reports">
                                            <p>لا توجد بلاغات على هذه الغرفة ✅</p>
                                        </div>
                                    ) : (
                                        <div className="reports-list">
                                            {roomReports.map((report) => (
                                                <div key={report._id} className={`report-item priority-${report.priority || 'medium'}`}>
                                                    <div className="report-header">
                                                        <span className={`report-status status-${report.status}`}>
                                                            {report.status === 'pending' ? '⏳ قيد الانتظار' :
                                                             report.status === 'reviewing' ? '🔍 قيد المراجعة' :
                                                             report.status === 'resolved' ? '✅ تم الحل' :
                                                             report.status === 'dismissed' ? '❌ مرفوض' : report.status}
                                                        </span>
                                                        <span className="report-date">
                                                            {formatDateTime(report.createdAt)}
                                                        </span>
                                                    </div>
                                                    <div className="report-body">
                                                        <p className="report-reason">
                                                            <strong>السبب:</strong> {report.reason || 'غير محدد'}
                                                        </p>
                                                        {report.description && (
                                                            <p className="report-description">{report.description}</p>
                                                        )}
                                                        <p className="report-reporter">
                                                            <strong>المبلغ:</strong> {report.reporter?.name || 'مجهول'}
                                                        </p>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Modal الإعلان المثبت */}
            {showPinModal && pinRoom && (
                <div className="modal-overlay" onClick={() => setShowPinModal(false)}>
                    <div className="room-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '500px' }}>
                        <div className="modal-header">
                            <h3>📌 إعلان مثبت - {pinRoom.name}</h3>
                            <button className="close-btn" onClick={() => setShowPinModal(false)}>✕</button>
                        </div>

                        <div className="modal-body" style={{ padding: '20px' }}>
                            <div className="form-group">
                                <label>نص الإعلان</label>
                                <textarea
                                    value={pinContent}
                                    onChange={(e) => setPinContent(e.target.value)}
                                    placeholder="اكتب الإعلان الذي سيظهر لجميع أعضاء الغرفة..."
                                    rows={4}
                                    style={{
                                        width: '100%',
                                        padding: '12px',
                                        borderRadius: '8px',
                                        border: '1px solid #ddd',
                                        resize: 'vertical',
                                        fontSize: '14px'
                                    }}
                                />
                                <small style={{ color: '#666', marginTop: '8px', display: 'block' }}>
                                    اتركه فارغاً لإزالة الإعلان المثبت
                                </small>
                            </div>

                            <div className="modal-actions" style={{ display: 'flex', gap: '10px', marginTop: '20px' }}>
                                <button
                                    onClick={handlePinMessage}
                                    className="btn-primary"
                                    style={{
                                        flex: 1,
                                        padding: '12px',
                                        borderRadius: '8px',
                                        border: 'none',
                                        background: '#667eea',
                                        color: 'white',
                                        cursor: 'pointer',
                                        fontSize: '14px'
                                    }}
                                >
                                    {pinContent ? '📌 تثبيت الإعلان' : '🗑️ إزالة الإعلان'}
                                </button>
                                <button
                                    onClick={() => setShowPinModal(false)}
                                    style={{
                                        padding: '12px 24px',
                                        borderRadius: '8px',
                                        border: '1px solid #ddd',
                                        background: 'white',
                                        cursor: 'pointer',
                                        fontSize: '14px'
                                    }}
                                >
                                    إلغاء
                                </button>
                            </div>
                        </div>
                    </div>
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
                            setUserActionMenu(null);
                        }}>🚫 حظر المستخدم</button>
                    </div>
                </div>
            )}

            {/* Ban Confirmation */}
            <ConfirmModal
                isOpen={!!banningUser}
                onClose={() => setBanningUser(null)}
                onConfirm={async () => {
                    try {
                        const response = await toggleUserActive(banningUser.id);
                        if (response.success) {
                            showToast('تم حظر المستخدم بنجاح', 'success');
                        }
                    } catch (err) {
                        showToast('فشل في حظر المستخدم', 'error');
                    }
                    setBanningUser(null);
                }}
                title="🚫 تأكيد الحظر"
                message={`هل أنت متأكد من حظر المستخدم "${banningUser?.name}"؟`}
                confirmText="حظر"
                cancelText="إلغاء"
                variant="danger"
            />

            {/* Delete Room Confirmation */}
            <ConfirmModal
                isOpen={deleteConfirm.show}
                onClose={() => setDeleteConfirm({ show: false, roomId: null, roomName: '' })}
                onConfirm={() => handleDelete(deleteConfirm.roomId)}
                title="❌ حذف غرفة"
                message={`هل أنت متأكد من حذف غرفة "${deleteConfirm.roomName}"؟ سيتم حذف الغرفة نهائياً.`}
                confirmText="حذف"
                cancelText="إلغاء"
                variant="danger"
            />

            {/* Delete Room Messages Confirmation */}
            <ConfirmModal
                isOpen={deleteMessagesConfirm.show}
                onClose={() => setDeleteMessagesConfirm({ show: false, roomId: null, roomName: '' })}
                onConfirm={() => handleDeleteMessages(deleteMessagesConfirm.roomId)}
                title="🗑️ حذف رسائل الغرفة"
                message={`هل أنت متأكد من حذف جميع رسائل غرفة "${deleteMessagesConfirm.roomName}"؟ لا يمكن التراجع عن هذا الإجراء!`}
                confirmText="حذف الرسائل"
                cancelText="إلغاء"
                variant="danger"
            />

            {/* Delete Single Message Confirmation */}
            <ConfirmModal
                isOpen={deleteMessageConfirm.show}
                onClose={() => setDeleteMessageConfirm({ show: false, messageId: null })}
                onConfirm={() => handleDeleteMessage(deleteMessageConfirm.messageId)}
                title="🗑️ حذف رسالة"
                message="هل أنت متأكد من حذف هذه الرسالة؟"
                confirmText="حذف"
                cancelText="إلغاء"
                variant="danger"
            />

            {/* Image Lightbox */}
            {expandedImage && (
                <div className="modal-overlay" style={{ zIndex: 10000 }} onClick={() => setExpandedImage(null)}>
                    <div className="image-lightbox" onClick={(e) => e.stopPropagation()}>
                        <button className="lightbox-close-btn" onClick={() => setExpandedImage(null)}>✕</button>
                        <img src={expandedImage} alt="صورة مكبرة" />
                    </div>
                </div>
            )}
        </div>
    );
}

export default ChatRooms;
