import { useState, useEffect, useCallback } from 'react';

/**
 * Custom hook for data fetching with loading/error states
 * Replaces the repeated pattern across 18+ pages
 *
 * @param {Function} fetchFn - Async function that returns data
 * @param {Array} deps - Dependencies array for useEffect
 * @param {Object} options - { initialData, autoFetch, onSuccess, onError }
 * @returns {{ data, setData, loading, error, refetch }}
 */
export function useDataFetch(fetchFn, deps = [], options = {}) {
    const {
        initialData = null,
        autoFetch = true,
        onSuccess,
        onError
    } = options;

    const [data, setData] = useState(initialData);
    const [loading, setLoading] = useState(autoFetch);
    const [error, setError] = useState('');

    const refetch = useCallback(async () => {
        try {
            setLoading(true);
            setError('');
            const result = await fetchFn();
            setData(result);
            if (onSuccess) onSuccess(result);
            return result;
        } catch (err) {
            const message = err.message || 'حدث خطأ';
            setError(message);
            if (onError) onError(err);
        } finally {
            setLoading(false);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, deps);

    useEffect(() => {
        if (autoFetch) {
            refetch();
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [refetch]);

    return { data, setData, loading, error, refetch };
}

export default useDataFetch;
