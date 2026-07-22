import { createSession, hashPassword, isSameOrigin, normalizeUsername, validatePassword } from "@/lib/auth";
import { audit, ensureSchema, getEnv } from "@/lib/database";

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return Response.json({ error: "Invalid request origin" }, { status: 403 });
  await ensureSchema();
  const existing = await getEnv().DB.prepare("SELECT COUNT(*) AS count FROM users WHERE role='admin'").first<{ count: number }>();
  if (Number(existing?.count || 0) > 0) return Response.json({ error: "School setup is already complete." }, { status: 409 });

  const body = await request.json() as Record<string, unknown>;
  const setupKey = String(body.setupKey || "");
  const expectedKey = getEnv().SETUP_KEY || "";
  if (!expectedKey || setupKey !== expectedKey) return Response.json({ error: "The one-time setup key is not valid." }, { status: 403 });

  const schoolName = String(body.schoolName || "").trim();
  const academicYear = String(body.academicYear || "").trim();
  const displayName = String(body.displayName || "").trim();
  const username = normalizeUsername(body.username);
  const password = String(body.password || "");
  const passwordError = validatePassword(password);
  if (!schoolName || !academicYear || !displayName || !username) return Response.json({ error: "Complete every setup field." }, { status: 400 });
  if (passwordError) return Response.json({ error: passwordError }, { status: 400 });

  const credential = await hashPassword(password);
  const now = new Date().toISOString();
  await getEnv().DB.batch([
    getEnv().DB.prepare("INSERT INTO users (username,display_name,role,password_hash,password_salt,password_iterations,must_change_password,active,created_at,updated_at) VALUES (?,?,?,?,?,?,0,1,?,?)")
      .bind(username, displayName, "admin", credential.hash, credential.salt, credential.iterations, now, now),
    getEnv().DB.prepare("INSERT INTO settings (key,value) VALUES ('school_name',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(schoolName),
    getEnv().DB.prepare("INSERT INTO settings (key,value) VALUES ('academic_year',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(academicYear),
    getEnv().DB.prepare("DELETE FROM login_attempts WHERE username=?").bind(username),
  ]);
  const admin = await getEnv().DB.prepare("SELECT id FROM users WHERE username=?").bind(username).first<{ id: number }>();
  if (!admin) return Response.json({ error: "Unable to complete setup." }, { status: 500 });
  await audit(admin.id, "setup", "school", undefined, { schoolName, academicYear });
  return Response.json({ ok: true }, { headers: { "Set-Cookie": await createSession(request, admin.id) } });
}
