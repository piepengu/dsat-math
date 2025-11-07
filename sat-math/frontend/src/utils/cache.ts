// Simple in-memory cache for API responses with TTL support

type CacheEntry<T> = {
    data: T
    timestamp: number
}

const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes
const cache = new Map<string, CacheEntry<any>>()

export function getCached<T>(key: string): T | null {
    const entry = cache.get(key)
    if (!entry) return null
    
    const age = Date.now() - entry.timestamp
    if (age > CACHE_TTL_MS) {
        cache.delete(key)
        return null
    }
    
    return entry.data as T
}

export function setCached<T>(key: string, data: T): void {
    cache.set(key, {
        data,
        timestamp: Date.now(),
    })
}

export function invalidateCache(pattern?: string): void {
    if (!pattern) {
        // Clear all cache
        cache.clear()
    } else {
        // Clear cache entries matching pattern
        for (const key of cache.keys()) {
            if (key.includes(pattern)) {
                cache.delete(key)
            }
        }
    }
}

// Cache keys
export const CACHE_KEYS = {
    stats: (userId: string) => `stats:${userId}`,
    streaks: (userId: string) => `streaks:${userId}`,
    achievements: (userId: string) => `achievements:${userId}`,
} as const

