import { Router } from "express";
import type { Request, Response } from "express";

const router = Router();

const DISCORD_CLIENT_ID = process.env["DISCORD_CLIENT_ID"] ?? "";
const DISCORD_CLIENT_SECRET = process.env["DISCORD_CLIENT_SECRET"] ?? "";
const DISCORD_REDIRECT_URI = process.env["DISCORD_REDIRECT_URI"] ?? "http://localhost:5000/auth/callback";

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

// GET /auth/discord - redirect to Discord OAuth
router.get("/auth/discord", (_req: Request, res: Response) => {
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

// GET /auth/callback - exchange code for token
router.get("/auth/callback", async (req: Request, res: Response) => {
  const code = req.query["code"] as string | undefined;
  if (!code) {
    res.redirect("/?error=missing_code");
    return;
  }

  try {
    // Exchange code for access token
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

    if (!tokenRes.ok) {
      res.redirect("/?error=token_exchange_failed");
      return;
    }

    const tokenData = await tokenRes.json() as { access_token: string; token_type: string };

    // Fetch user info
    const userRes = await fetch("https://discord.com/api/users/@me", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const userData = await userRes.json() as { id: string; username: string; avatar: string };

    // Fetch guilds
    const guildsRes = await fetch("https://discord.com/api/users/@me/guilds", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const guildsData = await guildsRes.json() as unknown[];

    // Store in session
    const session = (req as Request & { session: Record<string, unknown> }).session;
    if (session) {
      session["discordUserId"] = userData.id;
      session["discordUsername"] = userData.username;
      session["discordAvatar"] = userData.avatar;
      session["guilds"] = guildsData;
      session["accessToken"] = tokenData.access_token;
    }

    res.redirect("/dashboard");
  } catch (err) {
    console.error("[Auth] OAuth callback error:", err);
    res.redirect("/?error=oauth_failed");
  }
});

// GET /auth/me - return current logged-in user
router.get("/auth/me", (req: Request, res: Response) => {
  const session = (req as Request & { session: Record<string, unknown> }).session;
  if (!session?.["discordUserId"]) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  res.json({
    id: session["discordUserId"],
    username: session["discordUsername"],
    avatar: session["discordAvatar"],
    guilds: session["guilds"] ?? [],
  });
});

// GET /auth/logout - clear session
router.get("/auth/logout", (req: Request, res: Response) => {
  const reqWithSession = req as Request & { session: { destroy: (cb: (err: unknown) => void) => void } };
  if (reqWithSession.session?.destroy) {
    reqWithSession.session.destroy(() => {
      res.redirect("/");
    });
  } else {
    res.redirect("/");
  }
});

router.get("/auth/check", (_req: Request, res: Response) => {
  res.json({ ok: true });
});

export default router;
