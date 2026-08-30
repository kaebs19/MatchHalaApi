import React from 'react';
import './PageLoader.css';

// واجهة انتظار الـ chunk الكسول — هيكل عظمي بدل شاشة بيضاء.
function PageLoader() {
    return (
        <div className="page-loader" aria-busy="true" aria-label="جارٍ التحميل">
            <div className="page-loader-header" />
            <div className="page-loader-cards">
                {[0, 1, 2, 3].map((i) => <div key={i} className="page-loader-card" />)}
            </div>
            <div className="page-loader-table">
                {[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="page-loader-row" />)}
            </div>
        </div>
    );
}

export default PageLoader;
