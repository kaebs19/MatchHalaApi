import React from 'react';
import './Pagination.css';

function Pagination({ currentPage, totalPages, onPageChange, itemsPerPage, totalItems }) {
    // حساب نطاق العناصر المعروضة
    const startItem = (currentPage - 1) * itemsPerPage + 1;
    const endItem = Math.min(currentPage * itemsPerPage, totalItems);

    // توليد أرقام الصفحات المعروضة
    const getPageNumbers = () => {
        const pages = [];
        const maxPagesToShow = 5;

        if (totalPages <= maxPagesToShow) {
            // عرض جميع الصفحات إذا كانت قليلة
            for (let i = 1; i <= totalPages; i++) {
                pages.push(i);
            }
        } else {
            // عرض صفحات مختارة مع ...
            if (currentPage <= 3) {
                // في البداية
                for (let i = 1; i <= 4; i++) {
                    pages.push(i);
                }
                pages.push('...');
                pages.push(totalPages);
            } else if (currentPage >= totalPages - 2) {
                // في النهاية
                pages.push(1);
                pages.push('...');
                for (let i = totalPages - 3; i <= totalPages; i++) {
                    pages.push(i);
                }
            } else {
                // في الوسط
                pages.push(1);
                pages.push('...');
                pages.push(currentPage - 1);
                pages.push(currentPage);
                pages.push(currentPage + 1);
                pages.push('...');
                pages.push(totalPages);
            }
        }

        return pages;
    };

    const handlePrevious = () => {
        if (currentPage > 1) {
            onPageChange(currentPage - 1);
        }
    };

    const handleNext = () => {
        if (currentPage < totalPages) {
            onPageChange(currentPage + 1);
        }
    };

    const handlePageClick = (page) => {
        if (page !== '...' && page !== currentPage) {
            onPageChange(page);
        }
    };

    if (totalPages <= 1) {
        return null; // لا حاجة للـ pagination إذا كانت صفحة واحدة
    }

    return (
        <div className="pagination-container">
            <div className="pagination-info">
                عرض {startItem} - {endItem} من {totalItems}
            </div>

            <div className="pagination-controls">
                <button
                    className="pagination-btn"
                    onClick={handlePrevious}
                    disabled={currentPage === 1}
                >
                    السابق
                </button>

                <div className="pagination-pages">
                    {getPageNumbers().map((page, index) => (
                        <button
                            key={index}
                            className={`pagination-page ${page === currentPage ? 'active' : ''} ${page === '...' ? 'dots' : ''}`}
                            onClick={() => handlePageClick(page)}
                            disabled={page === '...'}
                        >
                            {page}
                        </button>
                    ))}
                </div>

                <button
                    className="pagination-btn"
                    onClick={handleNext}
                    disabled={currentPage === totalPages}
                >
                    التالي
                </button>
            </div>
        </div>
    );
}

export default Pagination;
