import { Router } from "express";
import type { Request, Response } from "express";

const router = Router();

const DISCORD_CLIENT_ID = process.env["DISCORD_CLIENT_ID"] ?? "";
const DISCORD_CLIENT_SECRET = process.env["DISCORD_CLIENT_SECRET"] ?? "";
const DISCORD_REDIRECT_URI = process.env["DISCORD_REDIRECT_URI"] ?? "http://localhost:8080/auth/callback";

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

router.get("/discord", (_req: Request, res: Response) => {
  if (!DISCORD_CLIENT_ID) {
    res.status(503).json({ error: "Discord OAuth not configured" });
    return;
  }
  const params = new URLSearchParams({
    client_id: DISCORD_CLIENT_ID,
    redirect_uri: DISCORD_REDIRECT_URI,
    response_type: "code",
    scope: "identify guilds",
  });
  res.redirect(`https://discord.com/api/oauth2/authorize?${params}`);
});

router.get("/callback", async (req: Request, res: Response) => {
  const code = req.query["code"] as string | undefined;
  if (!code) { res.redirect("/?error=missing_code"); return; }

  try {
    const tokenRes = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: DISCORD_CLIENT_ID,
        client_secret: DISCORD_CLIENT_SECRET,
        grant_type: "authorization_code",
        code,
        redirect_uri: DISCORD_REDIRECT_URI,
      }),
    });
    if (!tokenRes.ok) { res.redirect("/?error=token_exchange_failed"); return; }
    const tokenData = await tokenRes.json() as { access_token: string };

    const userRes = await fetch("https://discord.com/api/users/@me", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const userData = await userRes.json() as { id: string; username: string; avatar: string };

    const guildsRes = await fetch("https://discord.com/api/users/@me/guilds", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const guildsData = await guildsRes.json() as { id: string; name: string; owner: boolean; permissions: number }[];

    (req.session as unknown as Record<string, unknown>)["user"] = {
      id: userData.id,
      username: userData.username,
      avatar: userData.avatar,
      guilds: guildsData,
    };

    res.redirect("/dashboard");
  } catch (err) {
    console.error("[Auth] OAuth callback error:", err);
    res.redirect("/?error=oauth_failed");
  }
});

router.get("/me", (req: Request, res: Response) => {
  const user = (req.session as unknown as Record<string, unknown>)["user"];
  if (!user) { res.status(401).json({ error: "Not authenticated" }); return; }
  res.json(user);
});

router.get("/logout", (req: Request, res: Response) => {
  req.session.destroy(() => {
    res.redirect("/");
  });
});

router.get("/check", (_req: Request, res: Response) => {
  res.json({ ok: true });
});

export default router;
