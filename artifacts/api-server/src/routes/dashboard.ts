import { Router } from "express";
import type { Request, Response } from "express";
import * as db from "@workspace/db";
import { rconManager } from "@workspace/bot";

const router = Router();

router.get("/dashboard/:guildId", async (req: Request, res: Response) => {
  const guildId = String(req.params["guildId"]);
  const servers = await db.getServersByGuild(guildId);
  const result = servers.map(s => ({
    ...s,
    rconConnected: rconManager.isConnected(s.id),
  }));
  res.json({ servers: result });
});

router.get("/dashboard/:guildId/server/:serverNum/leaderboard", async (req: Request, res: Response) => {
  const guildId = String(req.params["guildId"]);
  const serverNum = parseInt(String(req.params["serverNum"] ?? "1"), 10);
  const server = await db.getServerByGuildAndNumber(guildId, serverNum);
  if (!server) { res.status(404).json({ error: "Server not found" }); return; }
  const top = await db.getLeaderboard(server.id, 20);
  res.json({ leaderboard: top });
});

router.get("/dashboard/:guildId/subscription", async (req: Request, res: Response) => {
  const guildId = String(req.params["guildId"]);
  const sub = await db.getSubscriptionByGuild(guildId);
  res.json({ subscription: sub ?? null });
});

export default router;
