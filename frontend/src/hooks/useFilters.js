import { useState, useCallback } from 'react';

/**
 * Custom hook for filter state management with auto page reset
 * Replaces repeated filter patterns across pages
 *
 * @param {Object} initialFilters - Initial filter values (e.g., { status: '', severity: '' })
 * @param {Function} resetPage - Optional callback to reset pagination (e.g., () => setPage(1))
 * @returns {{ filters, setFilter, setFilters, resetFilters }}
 */
export function useFilters(initialFilters = {}, resetPage) {
    const [filters, setFiltersState] = useState(initialFilters);

    const setFilter = useCallback((key, value) => {
        setFiltersState(prev => ({ ...prev, [key]: value }));
        if (resetPage) resetPage();
    }, [resetPage]);

    const setFilters = useCallback((newFilters) => {
        setFiltersState(newFilters);
        if (resetPage) resetPage();
    }, [resetPage]);

    const resetFilters = useCallback(() => {
        setFiltersState(initialFilters);
        if (resetPage) resetPage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [resetPage]);

    return {
        filters,
        setFilter,
        setFilters,
        resetFilters
    };
}

export default useFilters;
