import { useState, useCallback } from 'react';

/**
 * Custom hook for pagination state management
 * Replaces 10+ identical useState patterns across pages
 *
 * @param {number} initialPage - Starting page (default: 1)
 * @param {number} initialLimit - Items per page (default: 20)
 * @returns {{ page, setPage, totalPages, setTotalPages, total, setTotal, limit, nextPage, prevPage, resetPage }}
 */
export function usePagination(initialPage = 1, initialLimit = 20) {
    const [page, setPage] = useState(initialPage);
    const [totalPages, setTotalPages] = useState(1);
    const [total, setTotal] = useState(0);
    const limit = initialLimit;

    const nextPage = useCallback(() => {
        setPage(prev => Math.min(prev + 1, totalPages));
    }, [totalPages]);

    const prevPage = useCallback(() => {
        setPage(prev => Math.max(prev - 1, 1));
    }, []);

    const resetPage = useCallback(() => {
        setPage(1);
    }, []);

    return {
        page,
        setPage,
        totalPages,
        setTotalPages,
        total,
        setTotal,
        limit,
        nextPage,
        prevPage,
        resetPage
    };
}

export default usePagination;
