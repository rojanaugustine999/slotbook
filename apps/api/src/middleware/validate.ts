import type { RequestHandler } from "express";
import type { ZodTypeAny } from "zod";

// Validates and cleans req.body with a Zod schema before the route runs.
// Unknown fields are stripped, so a client can't sneak in e.g. { "ownerId": "..." }.
// A failed parse throws a ZodError, which errorHandler turns into a 400.
export const validateBody =
  (schema: ZodTypeAny): RequestHandler =>
  (req, _res, next) => {
    req.body = schema.parse(req.body);
    next();
  };
