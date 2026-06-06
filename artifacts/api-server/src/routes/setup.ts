import { Router } from "express";
import type { Request, Response } from "express";
import * as db from "@workspace/db";

const router = Router();

router.get("/setup/:guildId", async (req: Request, res: Response) => {
  const guildId = String(req.params["guildId"]);
  const servers = await db.getServersByGuild(guildId);
  res.json({ servers });
});

// POST /setup/verify-email - check if email has an active subscription
router.post("/setup/verify-email", async (req: Request, res: Response) => {
  const { email } = req.body as { email?: string };
  if (!email) {
    res.status(400).json({ valid: false, error: "Email is required" });
    return;
  }

  const customer = await db.getCustomerByEmail(email.trim().toLowerCase());
  if (!customer || customer.status !== "active") {
    res.json({ valid: false });
    return;
  }

  res.json({ valid: true });
});

router.post("/setup/:guildId/server", async (req: Request, res: Response) => {
  const guildId = String(req.params["guildId"]);
  const { serverNumber, label, rconHost, rconPort, rconPassword, email } = req.body as {
    serverNumber: number;
    label: string;
    rconHost?: string;
    rconPort?: number;
    rconPassword?: string;
    email?: string;
  };

  // Verify active subscription if email provided
  if (email) {
    const customer = await db.getCustomerByEmail(email.trim().toLowerCase());
    if (!customer || customer.status !== "active") {
      res.status(403).json({ error: "No active subscription found for this email" });
      return;
    }
  }

  let customer = await db.getCustomerByEmail(email?.trim().toLowerCase() ?? `discord_${guildId}@avivbot.internal`);
  if (!customer) {
    const fallbackEmail = `discord_${guildId}@avivbot.internal`;
    await db.upsertCustomer(fallbackEmail, `discord_${guildId}`, "basic");
    customer = await db.getCustomerByEmail(fallbackEmail);
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
