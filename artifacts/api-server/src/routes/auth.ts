import { Router } from "express";
import type { Request, Response } from "express";
import * as db from "@workspace/db";

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

// Dev mode status — tells the frontend whether dev login is available
router.get("/dev-mode", (_req: Request, res: Response) => {
  res.json({ devMode: process.env["NODE_ENV"] !== "production" });
});

// Dev login — only works outside production
router.get("/dev-login", async (req: Request, res: Response) => {
  if (process.env["NODE_ENV"] === "production") {
    res.status(403).send("Dev login is disabled in production.");
    return;
  }

  const DEV_KEY = process.env["DEV_KEY"] ?? "avivdev";
  const key = req.query["key"] as string | undefined;

  if (key !== DEV_KEY) {
    // Show a simple login form
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Dev Login - Aviv Bot</title>
  <link rel="stylesheet" href="/style.css" />
  <style>
    .dev-box { max-width: 400px; margin: 8rem auto; background: var(--surface); border: 1px solid var(--accent); border-radius: 16px; padding: 2rem; text-align: center; }
    .dev-box h2 { color: var(--accent); margin-bottom: 0.5rem; font-family: 'Rajdhani', sans-serif; font-size: 1.8rem; letter-spacing: 0.05em; }
    .dev-box p { color: var(--muted); font-size: 0.9rem; margin-bottom: 1.5rem; }
    .dev-input { width: 100%; box-sizing: border-box; background: var(--bg); border: 1px solid var(--surface2); color: var(--text); border-radius: 8px; padding: 0.75rem 1rem; font-size: 1rem; margin-bottom: 1rem; }
    .dev-badge { display: inline-block; background: rgba(224,122,50,0.15); color: var(--accent); border: 1px solid var(--accent); border-radius: 6px; font-size: 0.72rem; font-weight: 700; letter-spacing: 0.1em; padding: 2px 10px; margin-bottom: 1.25rem; text-transform: uppercase; }
  </style>
</head>
<body>
<div class="grid-bg"></div>
<div class="dev-box">
  <div class="dev-badge">Developer Mode</div>
  <h2>Dev Login</h2>
  <p>Enter your dev key to access the dashboard without Discord OAuth or a subscription.</p>
  <form method="GET" action="/auth/dev-login">
    <input class="dev-input" type="password" name="key" placeholder="Dev key (default: avivdev)" autofocus />
    <br/>
    <input class="dev-input" type="text" name="guild" placeholder="Discord Guild ID (optional)" />
    <button class="btn btn-accent" style="width:100%;font-size:1rem;padding:0.75rem;" type="submit">Enter Dashboard</button>
  </form>
  <p style="margin-top:1rem;"><a href="/" style="color:var(--muted);font-size:0.82rem;">Back to home</a></p>
</div>
</body>
</html>`);
    return;
  }

  // Key is valid — build a dev session
  const guildIdParam = req.query["guild"] as string | undefined;

  // Collect all known guilds from the DB to populate the selector
  let knownGuilds: { id: string; name: string }[] = [];
  try {
    const servers = await db.getAllServers();
    const seen = new Set<string>();
    for (const s of servers) {
      if (!seen.has(s.guild_id)) {
        seen.add(s.guild_id);
        knownGuilds.push({ id: s.guild_id, name: `Guild ${s.guild_id}` });
      }
    }
  } catch { /* no servers yet */ }

  // If a specific guild was requested, make sure it's in the list
  if (guildIdParam && !knownGuilds.find(g => g.id === guildIdParam)) {
    knownGuilds.push({ id: guildIdParam, name: `Guild ${guildIdParam}` });
  }

  // If no guilds at all yet, add a placeholder so the user can still see the dashboard
  if (knownGuilds.length === 0) {
    knownGuilds = [{ id: "000000000000000000", name: "No servers yet — run /setup first" }];
  }

  (req.session as unknown as Record<string, unknown>)["user"] = {
    id: "DEV_USER",
    username: "Developer",
    avatar: null,
    isDev: true,
    guilds: knownGuilds.map(g => ({
      id: g.id,
      name: g.name,
      owner: true,
      permissions: 0x8, // Administrator
    })),
  };

  res.redirect("/dashboard");
});

export default router;
