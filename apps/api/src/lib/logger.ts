import { pino, type DestinationStream, type Logger } from "pino";
import { env } from "./env.js";

// ─── Why not console.log? ────────────────────────────────────────────────────
// console.log prints free text: "user 42 logged in". You can read it, but a
// computer can't search it. A structured logger prints one JSON object per line:
//   {"level":30,"time":1764920000000,"msg":"request completed","res":{"statusCode":201},"responseTime":12}
// so a log tool can answer "show every 500 from the last hour" or "which request
// was slow?". It also has LEVELS (info, warn, error), so you can keep production
// quiet and turn on more detail only when hunting a bug.
// ──────────────────────────────────────────────────────────────────────────────

// Anything logged under these paths is replaced with "[redacted]". The request
// logger already leaves headers out entirely; this is a second layer, in case
// someone later logs a whole request object by accident.
const redact = {
  paths: ["req.headers.authorization", "req.headers.cookie", 'res.headers["set-cookie"]', "*.password", "*.passwordHash", "*.refreshToken", "*.accessToken"],
  censor: "[redacted]",
};

/**
 * Builds a logger. In normal use you want the shared `logger` below. Tests call
 * this with their own `stream` so they can read what was logged.
 */
export function createLogger(options: { level?: string; stream?: DestinationStream } = {}): Logger {
  const config = { level: options.level ?? env.LOG_LEVEL, redact };

  if (options.stream) return pino(config, options.stream);

  // While developing, print colourful one-line logs instead of raw JSON.
  // In production keep raw JSON: that is what log tools read.
  if (env.NODE_ENV === "development") {
    return pino({
      ...config,
      transport: { target: "pino-pretty", options: { colorize: true, translateTime: "HH:MM:ss", ignore: "pid,hostname" } },
    });
  }

  return pino(config);
}

export const logger = createLogger();
