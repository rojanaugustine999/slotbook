// Throw these anywhere in a route or service. The error handler middleware
// turns them into a consistent JSON response:
//   { "error": { "code": "NOT_FOUND", "message": "Business not found" } }
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export const badRequest = (message = "Bad request") => new HttpError(400, "BAD_REQUEST", message);
export const unauthorized = (message = "Not signed in") => new HttpError(401, "UNAUTHORIZED", message);
export const forbidden = (message = "Not allowed") => new HttpError(403, "FORBIDDEN", message);
export const notFound = (message = "Not found") => new HttpError(404, "NOT_FOUND", message);
export const conflict = (message = "Conflict") => new HttpError(409, "CONFLICT", message);
export const tooManyRequests = (message = "Too many requests. Please slow down.") => new HttpError(429, "RATE_LIMITED", message);
