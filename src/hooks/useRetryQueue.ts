"use client";

import { useState, useCallback, useRef, useEffect } from "react";

interface QueuedTransaction {
  id: string;
  txHash: string | null;
  status: "pending" | "submitted" | "confirmed" | "failed" | "retrying";
  retryCount: number;
  maxRetries: number;
  error: string | null;
  createdAt: number;
  nextRetryAt?: number;
}

interface UseRetryQueueReturn {
  queue: QueuedTransaction[];
  enqueue: (id: string, maxRetries?: number) => void;
  updateTxHash: (id: string, txHash: string) => void;
  markConfirmed: (id: string) => void;
  markFailed: (id: string, error: string) => void;
  retry: (id: string) => Promise<void>;
  purge: () => void;
  pendingCount: number;
}

const RETRY_DELAYS = [1000, 5000, 15000, 30000, 60000];
const STORAGE_KEY = "utility-retry-queue";

/**
 * Serialize queue for storage, excluding in-progress timers
 */
function serializeQueue(queue: QueuedTransaction[]): string {
  return JSON.stringify(queue);
}

/**
 * Deserialize queue from storage
 */
function deserializeQueue(data: string): QueuedTransaction[] {
  try {
    return JSON.parse(data);
  } catch {
    return [];
  }
}

export function useRetryQueue(): UseRetryQueueReturn {
  const [queue, setQueue] = useState<QueuedTransaction[]>([]);
  const [isHydrated, setIsHydrated] = useState(false);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Initialize from localStorage
  useEffect(() => {
    if (typeof window === "undefined") return;
    
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const deserializedQueue = deserializeQueue(stored);
        setQueue(deserializedQueue);

        // Reschedule retries for transactions that were awaiting retry
        deserializedQueue.forEach((tx) => {
          if (tx.status === "retrying" && tx.nextRetryAt) {
            const delay = Math.max(0, tx.nextRetryAt - Date.now());
            const timer = setTimeout(() => {
              setQueue((prev) =>
                prev.map((t) =>
                  t.id === tx.id
                    ? {
                        ...t,
                        retryCount: t.retryCount + 1,
                        status: "pending" as const,
                        error: null,
                        nextRetryAt: undefined,
                      }
                    : t
                )
              );
            }, delay);
            timersRef.current.set(tx.id, timer);
          }
        });
      }
    } catch (err) {
      console.error("Failed to restore retry queue from localStorage:", err);
      localStorage.removeItem(STORAGE_KEY);
    }
    
    setIsHydrated(true);
  }, []);

  // Persist queue to localStorage whenever it changes
  useEffect(() => {
    if (!isHydrated || typeof window === "undefined") return;
    
    try {
      localStorage.setItem(STORAGE_KEY, serializeQueue(queue));
    } catch (err) {
      console.error("Failed to persist retry queue to localStorage:", err);
    }
  }, [queue, isHydrated]);

  const cleanupTimer = useCallback((id: string) => {
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
  }, []);

  const enqueue = useCallback((id: string, maxRetries = 5) => {
    setQueue((prev) => {
      if (prev.find((t) => t.id === id)) return prev;
      return [
        {
          id,
          txHash: null,
          status: "pending",
          retryCount: 0,
          maxRetries,
          error: null,
          createdAt: Date.now(),
        },
        ...prev,
      ];
    });
  }, []);

  const updateTxHash = useCallback((id: string, txHash: string) => {
    setQueue((prev) =>
      prev.map((t) =>
        t.id === id ? { ...t, txHash, status: "submitted" as const } : t
      )
    );
  }, []);

  const markConfirmed = useCallback(
    (id: string) => {
      cleanupTimer(id);
      setQueue((prev) =>
        prev.map((t) =>
          t.id === id ? { ...t, status: "confirmed" as const, error: null, nextRetryAt: undefined } : t
        )
      );
    },
    [cleanupTimer]
  );

  const markFailed = useCallback(
    (id: string, error: string) => {
      setQueue((prev) => {
        const tx = prev.find((t) => t.id === id);
        if (!tx) return prev;

        // If we have retries remaining, schedule the next retry
        if (tx.retryCount < tx.maxRetries) {
          const delayIndex = Math.min(tx.retryCount, RETRY_DELAYS.length - 1);
          const delay = RETRY_DELAYS[delayIndex];
          const nextRetryAt = Date.now() + delay;

          const timer = setTimeout(() => {
            setQueue((innerPrev) =>
              innerPrev.map((t) =>
                t.id === id
                  ? {
                      ...t,
                      retryCount: t.retryCount + 1,
                      status: "pending" as const,
                      error: null,
                      nextRetryAt: undefined,
                    }
                  : t
              )
            );
          }, delay);

          timersRef.current.set(id, timer);

          // Update status to "retrying" with scheduled next retry
          return prev.map((t) =>
            t.id === id
              ? {
                  ...t,
                  status: "retrying" as const,
                  error,
                  nextRetryAt,
                }
              : t
          );
        }

        // No retries remaining - mark as permanently failed
        cleanupTimer(id);
        return prev.map((t) =>
          t.id === id
            ? {
                ...t,
                status: "failed" as const,
                error,
                nextRetryAt: undefined,
              }
            : t
        );
      });
    },
    [cleanupTimer]
  );

  const retry = useCallback(
    async (id: string) => {
      cleanupTimer(id);
      setQueue((prev) =>
        prev.map((t) =>
          t.id === id
            ? {
                ...t,
                status: "pending" as const,
                retryCount: t.retryCount + 1,
                error: null,
                nextRetryAt: undefined,
              }
            : t
        )
      );
    },
    [cleanupTimer]
  );

  const purge = useCallback(() => {
    timersRef.current.forEach((timer) => clearTimeout(timer));
    timersRef.current.clear();
    setQueue([]);
    if (typeof window !== "undefined") {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  useEffect(() => {
    return () => {
      timersRef.current.forEach((timer) => clearTimeout(timer));
      timersRef.current.clear();
    };
  }, []);

  return {
    queue,
    enqueue,
    updateTxHash,
    markConfirmed,
    markFailed,
    retry,
    purge,
    pendingCount: queue.filter(
      (t) => t.status === "pending" || t.status === "submitted"
    ).length,
  };
}
