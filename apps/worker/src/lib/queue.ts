import { Queue } from "bullmq";
import { Redis } from "ioredis";

/**
 * Lazy Redis connection.
 *
 * Realreal's worker hard-connects at import time (falling back to
 * redis://localhost:6379). That crashes the skeleton on a machine with no
 * Redis. Here the connection is only created when REDIS_URL is set, so the
 * health server can still come up on a bare laptop.
 *
 * BullMQ needs `maxRetriesPerRequest: null` on its blocking connections.
 */
export const maybeRedis: Redis | null = process.env.REDIS_URL
  ? new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: null })
  : null;

if (maybeRedis) {
  maybeRedis.on("error", (err) => {
    console.error("[queue] Redis connection error (non-fatal):", err.message);
  });
}

/**
 * The attendance queue runs the daily settlement sweep and remains the shared
 * home for future per-tenant attendance jobs. Only constructed when a Redis
 * connection exists; otherwise null so importing this module never dials a
 * non-existent broker.
 */
export const attendanceQueue: Queue | null = maybeRedis
  ? new Queue("attendance", { connection: maybeRedis })
  : null;
