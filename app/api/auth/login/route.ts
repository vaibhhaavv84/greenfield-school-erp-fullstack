import { createSession, hashPassword, isSameOrigin, normalizeUsername, verifyPassword } from "@/lib/auth";
import { audit, ensureSchema, getEnv } from "@/lib/database";

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return Response.json({ error: "Invalid request origin" }, { status: 403 });
  await ensureSchema();
  const body = await request.json() as Record<string, unknown>;
  const username = normalizeUsername(body.username);
  const password = String(body.password || "");
  const now = Date.now();
  const attempt = await getEnv().DB.prepare("SELECT failures,locked_until FROM login_attempts WHERE username=?").bind(username).first<{ failures: number; locked_until: number }>();
  if (Number(attempt?.locked_until || 0) > now) {
    return Response.json({ error: "Too many login attempts. Try again in 15 minutes." }, { status: 429 });
  }
  const account = await getEnv().DB.prepare("SELECT id,password_hash,password_salt,password_iterations,active FROM users WHERE username=?").bind(username).first<Record<string, unknown>>();
  const valid = account && Boolean(account.active) && await verifyPassword(password, String(account.password_hash), String(account.password_salt), Number(account.password_iterations));
  if (!account) await hashPassword(password, "00000000000000000000000000000000");
  if (!valid) {
    const failures = Number(attempt?.failures || 0) + 1;
    const lockedUntil = failures >= 5 ? now + 15 * 60 * 1000 : 0;
    await getEnv().DB.prepare("INSERT INTO login_attempts (username,failures,locked_until,updated_at) VALUES (?,?,?,?) ON CONFLICT(username) DO UPDATE SET failures=excluded.failures,locked_until=excluded.locked_until,updated_at=excluded.updated_at")
      .bind(username, failures >= 5 ? 0 : failures, lockedUntil, new Date().toISOString()).run();
    return Response.json({ error: lockedUntil ? "Too many login attempts. Try again in 15 minutes." : "Username or password is incorrect." }, { status: lockedUntil ? 429 : 401 });
  }
  await getEnv().DB.prepare("DELETE FROM login_attempts WHERE username=?").bind(username).run();
  await audit(Number(account.id), "login", "session");
  return Response.json({ ok: true }, { headers: { "Set-Cookie": await createSession(request, Number(account.id)) } });
}
