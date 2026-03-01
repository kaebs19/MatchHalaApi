import React from 'react';

/**
 * Reusable filter bar with search + filter buttons
 * Replaces: rooms-filters, conversations-filters, fm-filters patterns
 *
 * @param {string} searchValue - Current search value
 * @param {Function} onSearchChange - Search change handler
 * @param {string} searchPlaceholder - Search input placeholder
 * @param {Array} filters - Array of { value, label } for filter buttons
 * @param {string} activeFilter - Currently active filter value
 * @param {Function} onFilterChange - Filter change handler
 * @param {string} className - Additional class names
 * @param {React.ReactNode} children - Additional filter elements (e.g., select dropdowns)
 */
function FilterBar({
    searchValue,
    onSearchChange,
    searchPlaceholder = 'بحث...',
    filters = [],
    activeFilter = '',
    onFilterChange,
    className = '',
    children
}) {
    return (
        <div className={`filters-bar ${className}`}>
            {onSearchChange && (
                <div className="search-box">
                    <input
                        type="text"
                        value={searchValue}
                        onChange={(e) => onSearchChange(e.target.value)}
                        placeholder={searchPlaceholder}
                    />
                    <span className="search-icon">🔍</span>
                </div>
            )}
            {filters.length > 0 && (
                <div className="filter-buttons">
                    {filters.map(filter => (
                        <button
                            key={filter.value}
                            className={`filter-btn ${activeFilter === filter.value ? 'active' : ''} ${filter.className || ''}`}
                            onClick={() => onFilterChange(filter.value)}
                        >
                            {filter.label}
                        </button>
                    ))}
                </div>
            )}
            {children}
        </div>
    );
}

export default FilterBar;
