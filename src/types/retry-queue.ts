/**
 * Transaction type definitions for the retry queue system
 */

export interface QueuedTransaction {
  id: string;
  txHash: string | null;
  status: "pending" | "submitted" | "confirmed" | "failed" | "retrying";
  retryCount: number;
  maxRetries: number;
  error: string | null;
  createdAt: number;
  nextRetryAt?: number;
}

export interface UseRetryQueueReturn {
  queue: QueuedTransaction[];
  enqueue: (id: string, maxRetries?: number) => void;
  updateTxHash: (id: string, txHash: string) => void;
  markConfirmed: (id: string) => void;
  markFailed: (id: string, error: string) => void;
  retry: (id: string) => Promise<void>;
  purge: () => void;
  pendingCount: number;
}
