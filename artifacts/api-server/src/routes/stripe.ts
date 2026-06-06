import { Router } from "express";
import type { Request, Response } from "express";
import Stripe from "stripe";
import * as db from "@workspace/db";

const router = Router();

let stripe: Stripe | null = null;

function getStripe(): Stripe {
  if (!stripe) {
    const key = process.env["STRIPE_SECRET_KEY"];
    if (!key) throw new Error("STRIPE_SECRET_KEY not set");
    stripe = new Stripe(key, { apiVersion: "2025-02-24.acacia" });
  }
  return stripe;
}

router.post("/stripe/checkout", async (req: Request, res: Response) => {
  const { planId, guildId, discordUserId } = req.body as Record<string, string>;

  const plans: Record<string, { priceId: string; name: string }> = {
    basic: { priceId: process.env["STRIPE_PRICE_BASIC"] ?? "", name: "Basic" },
    pro: { priceId: process.env["STRIPE_PRICE_PRO"] ?? "", name: "Pro" },
    enterprise: { priceId: process.env["STRIPE_PRICE_ENTERPRISE"] ?? "", name: "Enterprise" },
  };

  const plan = plans[planId];
  if (!plan) {
    res.status(400).json({ error: "Invalid plan" });
    return;
  }

  try {
    const s = getStripe();
    const domain = process.env["REPLIT_DOMAINS"];
    const baseUrl = `https://${typeof domain === "string" ? domain.split(",")[0] : "localhost"}`;

    const session = await s.checkout.sessions.create({
      mode: "subscription",
      payment_method_types: ["card"],
      line_items: [{ price: plan.priceId, quantity: 1 }],
      metadata: { guildId, discordUserId, planId },
      success_url: `${baseUrl}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/pricing`,
    });

    res.json({ url: session.url });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.post("/stripe/webhook", async (req: Request, res: Response) => {
  const sig = req.headers["stripe-signature"];
  const secret = process.env["STRIPE_WEBHOOK_SECRET"];

  if (!secret) { res.status(500).send("Webhook secret not set"); return; }
  if (!sig) { res.status(400).send("Missing stripe-signature"); return; }

  let event: Stripe.Event;
  try {
    const s = getStripe();
    event = s.webhooks.constructEvent(req.body as Buffer, Array.isArray(sig) ? sig[0]! : sig, secret);
  } catch (err) {
    res.status(400).send(`Webhook Error: ${String(err)}`);
    return;
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const { guildId, discordUserId, planId } = session.metadata ?? {};
    if (guildId && discordUserId && planId) {
      await db.upsertSubscription(guildId, discordUserId, planId, session.subscription as string, "active");
    }
  }

  if (event.type === "customer.subscription.deleted") {
    const sub = event.data.object as Stripe.Subscription;
    await db.cancelSubscription(sub.id);
  }

  res.json({ received: true });
});

router.get("/stripe/status/:guildId", async (req: Request, res: Response) => {
  const guildId = String(req.params["guildId"]);
  const sub = await db.getSubscriptionByGuild(guildId);
  if (!sub) { res.json({ active: false }); return; }
  res.json({ active: sub.status === "active", plan: sub.plan, subscriptionId: sub.stripe_subscription_id });
});

export default router;
