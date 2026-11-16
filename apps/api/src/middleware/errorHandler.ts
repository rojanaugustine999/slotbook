import type { ErrorRequestHandler, RequestHandler } from "express";
import { ZodError } from "zod";
import { Prisma } from "@prisma/client";
import { HttpError } from "../lib/errors.js";

type ErrorBody = { error: { code: string; message: string; details?: unknown } };

export const notFoundHandler: RequestHandler = (req, res) => {
  const body: ErrorBody = { error: { code: "NOT_FOUND", message: `No route for ${req.method} ${req.path}` } };
  res.status(404).json(body);
};

// Express 5 forwards errors thrown in (async) route handlers here automatically.
// Every error response in the app has the same shape, which keeps the frontend simple.
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  const send = (status: number, code: string, message: string, details?: unknown) => {
    const body: ErrorBody = { error: { code, message, ...(details ? { details } : {}) } };
    res.status(status).json(body);
  };

  if (err instanceof HttpError) return send(err.status, err.code, err.message);

  if (err instanceof ZodError) {
    return send(400, "VALIDATION_ERROR", "Some fields are invalid", err.flatten().fieldErrors);
  }

  // Malformed JSON body
  if (err?.type === "entity.parse.failed") return send(400, "BAD_JSON", "Request body is not valid JSON");

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") return send(409, "ALREADY_EXISTS", "A record with that value already exists");
    if (err.code === "P2025") return send(404, "NOT_FOUND", "Record not found");
  }

  if (err instanceof Prisma.PrismaClientInitializationError) {
    console.error("Database unreachable. Is Postgres running and DATABASE_URL correct?");
    return send(503, "DB_UNAVAILABLE", "Service temporarily unavailable");
  }

  // Postgres exclusion_violation from the "no_double_booking" constraint.
  if (String(err?.message ?? "").includes("no_double_booking")) {
    return send(409, "SLOT_TAKEN", "That time slot was just booked. Please pick another.");
  }

  console.error(err);
  send(500, "INTERNAL_ERROR", "Something went wrong");
};
