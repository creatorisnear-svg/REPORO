import { Router, type IRouter } from "express";
import { rconManager } from "@workspace/bot";

const router: IRouter = Router();

const startTime = Date.now();

router.get("/healthz", (_req, res) => {
  res.json({ status: "ok" });
});

router.get("/health", (_req, res) => {
  const uptimeSeconds = Math.floor((Date.now() - startTime) / 1000);
  const connectedServers = rconManager.getConnectedCount();
  res.json({
    status: "ok",
    connectedServers,
    uptime: uptimeSeconds,
  });
});

export default router;
