import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import session from "express-session";
import path from "node:path";
import { fileURLToPath } from "node:url";
import router from "./routes/index.js";
import authRouter from "./routes/auth.js";
import { logger } from "./lib/logger.js";

const app: Express = express();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

app.use(
  pinoHttp({
    logger,
    // Suppress health check pings from access logs - they fire every 15s and add noise
    customSuccessMessage(req, res) {
      const url = req.url?.split("?")[0] ?? "";
      if (url === "/health" || url === "/healthz" || url === "/api/healthz") {
        return "";
      }
      return `${req.method} ${url} ${res.statusCode}`;
    },
    autoLogging: {
      ignore(req) {
        const url = req.url?.split("?")[0] ?? "";
        return url === "/health" || url === "/healthz" || url === "/api/healthz";
      },
    },
    serializers: {
      req(req) {
        return { id: req.id, method: req.method, url: req.url?.split("?")[0] };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
    },
  }),
);

app.use(cors());

// Session middleware for Discord OAuth
app.use(session({
  secret: process.env["SESSION_SECRET"] ?? "aviv-bot-default-secret-change-me",
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env["NODE_ENV"] === "production",
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  },
}));

// Raw body for Stripe webhooks must come before json()
app.use("/api/stripe/webhook", express.raw({ type: "application/json" }));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static HTML website
const publicDir = path.join(__dirname, "public");
app.use(express.static(publicDir));

// Page routes
app.get("/pricing", (_req, res) => res.sendFile(path.join(publicDir, "pricing.html")));
app.get("/docs", (_req, res) => res.sendFile(path.join(publicDir, "docs.html")));
app.get("/status", (_req, res) => res.sendFile(path.join(publicDir, "status.html")));
app.get("/success", (_req, res) => res.sendFile(path.join(publicDir, "setup.html")));
app.get("/setup-wizard", (_req, res) => res.sendFile(path.join(publicDir, "setup-wizard.html")));
app.get("/dashboard", (_req, res) => res.sendFile(path.join(publicDir, "dashboard.html")));
app.get("/privacy", (_req, res) => res.sendFile(path.join(publicDir, "privacy.html")));
app.get("/terms", (_req, res) => res.sendFile(path.join(publicDir, "terms.html")));

// Top-level health endpoints so Koyeb and uptime monitors can reach them
// without the /api prefix
app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});
app.get("/healthz", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/auth", authRouter);
app.use("/api", router);

export default app;
