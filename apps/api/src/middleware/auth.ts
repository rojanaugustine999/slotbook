import type { Request, RequestHandler } from "express";
import jwt from "jsonwebtoken";
import { env } from "../lib/env.js";
import { unauthorized } from "../lib/errors.js";

// Authentication = "who are you?". This checks the access token and sets req.user.
// Authorization ("are you allowed to touch THIS business?") happens later, in services.
export const requireAuth: RequestHandler = (req, _res, next) => {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) throw unauthorized();

  let payload: string | jwt.JwtPayload;
  try {
    payload = jwt.verify(header.slice(7), env.JWT_ACCESS_SECRET);
  } catch {
    throw unauthorized("Invalid or expired token");
  }
  if (typeof payload === "string" || typeof payload.sub !== "string") throw unauthorized();

  req.user = { id: payload.sub };
  next(); // outside the try, so errors from later handlers aren't mistaken for auth errors
};

// Use inside routes that sit behind requireAuth.
export function currentUserId(req: Request): string {
  if (!req.user) throw unauthorized();
  return req.user.id;
}
