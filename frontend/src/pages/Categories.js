import React, { useState, useEffect, useCallback } from 'react';
import { useToast } from '../components/Toast';
import api from '../services/api';
import ConfirmModal from '../components/ConfirmModal';
import './Categories.css';

function Categories() {
    const { showToast } = useToast();
    const [categories, setCategories] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showModal, setShowModal] = useState(false);
    const [editingCategory, setEditingCategory] = useState(null);
    const [formData, setFormData] = useState({
        name: '',
        icon: 'folder',
        color: '#007AFF',
        description: '',
        isActive: true
    });
    const [submitting, setSubmitting] = useState(false);
    const [deleteConfirm, setDeleteConfirm] = useState({ show: false, id: null });

    const iconOptions = [
        { value: 'folder', label: '📁 مجلد' },
        { value: 'sports', label: '⚽ رياضة' },
        { value: 'music', label: '🎵 موسيقى' },
        { value: 'games', label: '🎮 ألعاب' },
        { value: 'tech', label: '💻 تقنية' },
        { value: 'news', label: '📰 أخبار' },
        { value: 'education', label: '📚 تعليم' },
        { value: 'entertainment', label: '🎬 ترفيه' },
        { value: 'food', label: '🍔 طعام' },
        { value: 'travel', label: '✈️ سفر' },
        { value: 'health', label: '💊 صحة' },
        { value: 'business', label: '💼 أعمال' },
        { value: 'art', label: '🎨 فن' },
        { value: 'science', label: '🔬 علوم' },
        { value: 'chat', label: '💬 دردشة' }
    ];

    const colorOptions = [
        '#007AFF', '#FF3B30', '#FF9500', '#FFCC00',
        '#34C759', '#5AC8FA', '#AF52DE', '#FF2D55',
        '#8E8E93', '#5856D6', '#00C7BE', '#32ADE6'
    ];

    const fetchCategories = useCallback(async () => {
        setLoading(true);
        try {
            const response = await api.get('/categories');
            if (response.data.success) {
                setCategories(response.data.data);
            }
        } catch (error) {
            showToast('فشل في جلب التصنيفات', 'error');
        } finally {
            setLoading(false);
        }
    }, [showToast]);

    useEffect(() => {
        fetchCategories();
    }, [fetchCategories]);

    const handleInputChange = (e) => {
        const { name, value, type, checked } = e.target;
        setFormData(prev => ({
            ...prev,
            [name]: type === 'checkbox' ? checked : value
        }));
    };

    const openAddModal = () => {
        setEditingCategory(null);
        setFormData({
            name: '',
            icon: 'folder',
            color: '#007AFF',
            description: '',
            isActive: true
        });
        setShowModal(true);
    };

    const openEditModal = (category) => {
        setEditingCategory(category);
        setFormData({
            name: category.name,
            icon: category.icon || 'folder',
            color: category.color || '#007AFF',
            description: category.description || '',
            isActive: category.isActive
        });
        setShowModal(true);
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!formData.name.trim()) {
            showToast('اسم التصنيف مطلوب', 'error');
            return;
        }

        setSubmitting(true);
        try {
            if (editingCategory) {
                await api.put(`/categories/${editingCategory._id}`, formData);
                showToast('تم تحديث التصنيف بنجاح', 'success');
            } else {
                await api.post('/categories', formData);
                showToast('تم إضافة التصنيف بنجاح', 'success');
            }
            setShowModal(false);
            fetchCategories();
        } catch (error) {
            showToast(error.response?.data?.message || 'حدث خطأ', 'error');
        } finally {
            setSubmitting(false);
        }
    };

    const handleDelete = async () => {
        if (!deleteConfirm.id) return;
        try {
            await api.delete(`/categories/${deleteConfirm.id}`);
            showToast('تم حذف التصنيف بنجاح', 'success');
            fetchCategories();
        } catch (error) {
            showToast(error.response?.data?.message || 'فشل في حذف التصنيف', 'error');
        } finally {
            setDeleteConfirm({ show: false, id: null });
        }
    };

    const handleToggle = async (id) => {
        try {
            await api.put(`/categories/${id}/toggle`);
            showToast('تم تغيير حالة التصنيف', 'success');
            fetchCategories();
        } catch (error) {
            showToast('فشل في تغيير الحالة', 'error');
        }
    };

    const getIconEmoji = (iconName) => {
        const icon = iconOptions.find(i => i.value === iconName);
        return icon ? icon.label.split(' ')[0] : '📁';
    };

    if (loading) {
        return (
            <div className="categories-page">
                <div className="loading-container">
                    <div className="loading-spinner"></div>
                    <p>جاري تحميل التصنيفات...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="categories-page">
            {/* Header */}
            <div className="page-header">
                <div className="header-info">
                    <h1>📁 إدارة التصنيفات</h1>
                    <p>إدارة تصنيفات غرف المحادثة</p>
                </div>
                <div className="header-stats">
                    <div className="stat-box">
                        <span className="stat-number">{categories.length}</span>
                        <span className="stat-label">إجمالي</span>
                    </div>
                    <div className="stat-box active">
                        <span className="stat-number">{categories.filter(c => c.isActive).length}</span>
                        <span className="stat-label">نشط</span>
                    </div>
                </div>
                <button className="btn-add" onClick={openAddModal}>
                    ➕ إضافة تصنيف
                </button>
            </div>

            {/* Categories Grid */}
            {categories.length === 0 ? (
                <div className="empty-state">
                    <span className="empty-icon">📁</span>
                    <h3>لا توجد تصنيفات</h3>
                    <p>قم بإضافة تصنيف جديد للبدء</p>
                </div>
            ) : (
                <div className="categories-grid">
                    {categories.map((category, index) => (
                        <div
                            key={category._id}
                            className={`category-card ${!category.isActive ? 'inactive' : ''}`}
                            style={{ borderColor: category.color }}
                        >
                            <div className="category-header" style={{ backgroundColor: category.color + '20' }}>
                                <span className="category-icon" style={{ backgroundColor: category.color }}>
                                    {getIconEmoji(category.icon)}
                                </span>
                                <span className="category-order">#{index + 1}</span>
                            </div>
                            <div className="category-body">
                                <h3>{category.name}</h3>
                                {category.description && (
                                    <p className="category-desc">{category.description}</p>
                                )}
                                <div className="category-meta">
                                    <span className="rooms-count">
                                        🏠 {category.roomsCount || 0} غرفة
                                    </span>
                                    <span className={`status-badge ${category.isActive ? 'active' : 'inactive'}`}>
                                        {category.isActive ? 'نشط' : 'معطل'}
                                    </span>
                                </div>
                            </div>
                            <div className="category-actions">
                                <button
                                    className="btn-icon edit"
                                    onClick={() => openEditModal(category)}
                                    title="تعديل"
                                >
                                    ✏️
                                </button>
                                <button
                                    className="btn-icon toggle"
                                    onClick={() => handleToggle(category._id)}
                                    title={category.isActive ? 'تعطيل' : 'تفعيل'}
                                >
                                    {category.isActive ? '🔴' : '🟢'}
                                </button>
                                <button
                                    className="btn-icon delete"
                                    onClick={() => setDeleteConfirm({ show: true, id: category._id })}
                                    title="حذف"
                                >
                                    🗑️
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Delete Confirm */}
            <ConfirmModal
                isOpen={deleteConfirm.show}
                onClose={() => setDeleteConfirm({ show: false, id: null })}
                onConfirm={handleDelete}
                title="تأكيد الحذف"
                message="هل أنت متأكد من حذف هذا التصنيف؟"
                confirmText="حذف"
                cancelText="إلغاء"
                variant="danger"
            />

            {/* Modal */}
            {showModal && (
                <div className="modal-overlay" onClick={() => setShowModal(false)}>
                    <div className="modal-content" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>{editingCategory ? '✏️ تعديل التصنيف' : '➕ إضافة تصنيف جديد'}</h2>
                            <button className="close-btn" onClick={() => setShowModal(false)}>✕</button>
                        </div>
                        <form onSubmit={handleSubmit}>
                            <div className="form-group">
                                <label>اسم التصنيف *</label>
                                <input
                                    type="text"
                                    name="name"
                                    value={formData.name}
                                    onChange={handleInputChange}
                                    placeholder="مثال: رياضة"
                                    required
                                />
                            </div>

                            <div className="form-group">
                                <label>الأيقونة</label>
                                <div className="icon-grid">
                                    {iconOptions.map(icon => (
                                        <button
                                            key={icon.value}
                                            type="button"
                                            className={`icon-option ${formData.icon === icon.value ? 'selected' : ''}`}
                                            onClick={() => setFormData(prev => ({ ...prev, icon: icon.value }))}
                                            title={icon.label}
                                        >
                                            {icon.label.split(' ')[0]}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div className="form-group">
                                <label>اللون</label>
                                <div className="color-grid">
                                    {colorOptions.map(color => (
                                        <button
                                            key={color}
                                            type="button"
                                            className={`color-option ${formData.color === color ? 'selected' : ''}`}
                                            style={{ backgroundColor: color }}
                                            onClick={() => setFormData(prev => ({ ...prev, color }))}
                                        />
                                    ))}
                                </div>
                            </div>

                            <div className="form-group">
                                <label>الوصف (اختياري)</label>
                                <textarea
                                    name="description"
                                    value={formData.description}
                                    onChange={handleInputChange}
                                    placeholder="وصف مختصر للتصنيف..."
                                    rows="3"
                                />
                            </div>

                            <div className="form-group checkbox-group">
                                <label>
                                    <input
                                        type="checkbox"
                                        name="isActive"
                                        checked={formData.isActive}
                                        onChange={handleInputChange}
                                    />
                                    <span>تصنيف نشط</span>
                                </label>
                            </div>

                            <div className="modal-actions">
                                <button type="button" className="btn-cancel" onClick={() => setShowModal(false)}>
                                    إلغاء
                                </button>
                                <button type="submit" className="btn-submit" disabled={submitting}>
                                    {submitting ? 'جاري الحفظ...' : (editingCategory ? 'تحديث' : 'إضافة')}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}

export default Categories;
