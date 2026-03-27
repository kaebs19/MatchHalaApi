import React from 'react';

/**
 * Reusable data table component
 * Replaces: fm-table, sl-table, premium-table, verification-table patterns
 *
 * @param {Array} columns - Array of { key, label, render(row, index) }
 * @param {Array} data - Array of data rows
 * @param {boolean} loading - Show loading state
 * @param {string} emptyIcon - Emoji for empty state
 * @param {string} emptyMessage - Message for empty state
 * @param {string} headerTitle - Optional title above table
 * @param {boolean} gradientHeader - Use gradient header style
 * @param {Function} rowClassName - Optional function(row) returning extra class for tr
 * @param {React.ReactNode} children - Optional content after table (e.g., pagination)
 */
function DataTable({
    columns = [],
    data = [],
    loading = false,
    emptyIcon = '📭',
    emptyMessage = 'لا توجد بيانات',
    headerTitle,
    gradientHeader = false,
    rowClassName,
    children
}) {
    return (
        <div className="data-table-container">
            {headerTitle && (
                <div className="data-table-header">
                    <h3>{headerTitle}</h3>
                </div>
            )}
            <div className="data-table-wrapper">
                <table className={`data-table ${gradientHeader ? 'data-table--gradient' : ''}`}>
                    <thead>
                        <tr>
                            {columns.map((col, i) => (
                                <th key={col.key || i}>{col.label}</th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {loading ? (
                            <tr>
                                <td colSpan={columns.length} style={{ textAlign: 'center', padding: '40px' }}>
                                    جاري التحميل...
                                </td>
                            </tr>
                        ) : data.length === 0 ? (
                            <tr>
                                <td colSpan={columns.length}>
                                    <div style={{ padding: '60px 20px', textAlign: 'center' }}>
                                        <span style={{ fontSize: '48px', display: 'block', marginBottom: '15px' }}>{emptyIcon}</span>
                                        <p style={{ color: '#999', fontSize: '16px' }}>{emptyMessage}</p>
                                    </div>
                                </td>
                            </tr>
                        ) : (
                            data.map((row, index) => (
                                <tr
                                    key={row._id || index}
                                    className={rowClassName ? rowClassName(row) : ''}
                                >
                                    {columns.map((col, colIndex) => (
                                        <td key={col.key || colIndex}>
                                            {col.render ? col.render(row, index) : row[col.key]}
                                        </td>
                                    ))}
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>
            {children}
        </div>
    );
}

export default DataTable;
