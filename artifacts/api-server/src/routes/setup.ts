import { Router } from "express";
import type { Request, Response } from "express";
import * as db from "@workspace/db";

const router = Router();

router.get("/setup/:guildId", async (req: Request, res: Response) => {
  const guildId = String(req.params["guildId"]);
  const servers = await db.getServersByGuild(guildId);
  res.json({ servers });
});

router.post("/setup/:guildId/server", async (req: Request, res: Response) => {
  const guildId = String(req.params["guildId"]);
  const { serverNumber, label, rconHost, rconPort, rconPassword } = req.body as {
    serverNumber: number;
    label: string;
    rconHost?: string;
    rconPort?: number;
    rconPassword?: string;
  };

  const email = `discord_${guildId}@avivbot.internal`;
  let customer = await db.getCustomerByEmail(email);
  if (!customer) {
    await db.upsertCustomer(email, `discord_${guildId}`, "basic");
    customer = await db.getCustomerByEmail(email);
  }

  const id = await db.insertServer({
    customerId: customer!.id,
    guildId,
    rconHost: rconHost ?? "",
    rconPort: rconPort ?? 28016,
    rconPassword: rconPassword ?? "",
    label: label ?? `Server ${serverNumber}`,
    serverNumber: serverNumber ?? 1,
  });
  res.json({ id });
});

export default router;
