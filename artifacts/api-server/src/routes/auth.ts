import { Router } from "express";
import type { Request, Response } from "express";

const router = Router();

// Basic token check middleware for dashboard API
export function requireApiKey(req: Request, res: Response, next: () => void): void {
  const key = req.headers["x-api-key"];
  const expected = process.env["DASHBOARD_API_KEY"];
  if (!expected) { next(); return; }
  if (key !== expected) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

router.get("/auth/check", (req: Request, res: Response) => {
  res.json({ ok: true });
});

export default router;
