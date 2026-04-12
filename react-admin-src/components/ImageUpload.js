import React, { useState, useRef } from 'react';
import { getImageUrl } from '../config';
import './ImageUpload.css';

function ImageUpload({ currentImage, onUpload, title = "رفع صورة", type = "profile" }) {
    const [preview, setPreview] = useState(currentImage);
    const [uploading, setUploading] = useState(false);
    const [dragOver, setDragOver] = useState(false);
    const fileInputRef = useRef(null);

    const handleFileChange = async (e) => {
        const file = e.target.files[0];
        if (file) {
            await processFile(file);
        }
    };

    const processFile = async (file) => {
        // التحقق من نوع الملف
        if (!file.type.startsWith('image/')) {
            alert('يرجى اختيار ملف صورة');
            return;
        }

        // التحقق من حجم الملف (5MB)
        if (file.size > 5 * 1024 * 1024) {
            alert('حجم الصورة يجب أن يكون أقل من 5MB');
            return;
        }

        // عرض معاينة
        const reader = new FileReader();
        reader.onloadend = () => {
            setPreview(reader.result);
        };
        reader.readAsDataURL(file);

        // رفع الملف
        setUploading(true);
        try {
            await onUpload(file);
        } catch (error) {
            console.error('خطأ في رفع الصورة:', error);
            setPreview(currentImage); // العودة للصورة الأصلية
        } finally {
            setUploading(false);
        }
    };

    const handleDragOver = (e) => {
        e.preventDefault();
        setDragOver(true);
    };

    const handleDragLeave = (e) => {
        e.preventDefault();
        setDragOver(false);
    };

    const handleDrop = async (e) => {
        e.preventDefault();
        setDragOver(false);

        const file = e.dataTransfer.files[0];
        if (file) {
            await processFile(file);
        }
    };

    const handleClick = () => {
        fileInputRef.current?.click();
    };

    const getFullImageUrl = (img) => {
        if (!img) return null;
        if (img.startsWith('data:')) return img; // Base64 preview
        return getImageUrl(img);
    };

    return (
        <div className="image-upload-container">
            <h3>{title}</h3>

            <div
                className={`image-upload-area ${dragOver ? 'drag-over' : ''} ${type}`}
                onClick={handleClick}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
            >
                {preview ? (
                    <div className="image-preview">
                        <img
                            src={getFullImageUrl(preview)}
                            alt="Preview"
                            onError={(e) => {
                                e.target.onerror = null;
                                e.target.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='150' height='150' viewBox='0 0 150 150'%3E%3Crect fill='%23667eea' width='150' height='150'/%3E%3Ctext fill='white' font-family='Arial' font-size='40' x='50%25' y='50%25' text-anchor='middle' dominant-baseline='middle'%3E📷%3C/text%3E%3C/svg%3E";
                            }}
                        />
                        {uploading && (
                            <div className="upload-overlay">
                                <div className="spinner"></div>
                                <p>جاري الرفع...</p>
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="upload-placeholder">
                        <div className="upload-icon">📷</div>
                        <p>اضغط أو اسحب الصورة هنا</p>
                        <span>PNG, JPG, GIF, WEBP - حتى 5MB</span>
                    </div>
                )}

                <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleFileChange}
                    style={{ display: 'none' }}
                />
            </div>

            {!uploading && (
                <button
                    type="button"
                    className="upload-btn"
                    onClick={handleClick}
                >
                    {preview ? 'تغيير الصورة' : 'اختيار صورة'}
                </button>
            )}
        </div>
    );
}

export default ImageUpload;
