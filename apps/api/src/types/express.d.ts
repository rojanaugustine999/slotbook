// Adds `req.user` to Express's Request type. Set by the requireAuth middleware.
declare global {
  namespace Express {
    interface Request {
      user?: { id: string };
    }
  }
}

export {};
