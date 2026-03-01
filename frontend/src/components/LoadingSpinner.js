import React from 'react';
import './LoadingSpinner.css';

function LoadingSpinner({ size = 'medium', text = 'جاري التحميل...' }) {
    return (
        <div className={`loading-spinner-container ${size}`}>
            <div className="spinner"></div>
            {text && <p className="loading-text">{text}</p>}
        </div>
    );
}

export default LoadingSpinner;
