import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

app.use(cors());

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

app.use("/api", router);

export default app;
