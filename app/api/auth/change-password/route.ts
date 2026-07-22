import { hashPassword, isSameOrigin, requireUser, validatePassword, verifyPassword } from "@/lib/auth";
import { audit, getEnv } from "@/lib/database";

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return Response.json({ error: "Invalid request origin" }, { status: 403 });
  const auth = await requireUser(request);
  if ("error" in auth) return auth.error;
  const body = await request.json() as Record<string, unknown>;
  const currentPassword = String(body.currentPassword || "");
  const newPassword = String(body.newPassword || "");
  const passwordError = validatePassword(newPassword);
  if (passwordError) return Response.json({ error: passwordError }, { status: 400 });
  const row = await getEnv().DB.prepare("SELECT password_hash,password_salt,password_iterations FROM users WHERE id=?").bind(auth.user.id).first<Record<string, unknown>>();
  if (!row || !await verifyPassword(currentPassword, String(row.password_hash), String(row.password_salt), Number(row.password_iterations))) {
    return Response.json({ error: "Current password is incorrect." }, { status: 400 });
  }
  const credential = await hashPassword(newPassword);
  await getEnv().DB.prepare("UPDATE users SET password_hash=?,password_salt=?,password_iterations=?,must_change_password=0,updated_at=? WHERE id=?")
    .bind(credential.hash, credential.salt, credential.iterations, new Date().toISOString(), auth.user.id).run();
  await audit(auth.user.id, "change_password", "user", String(auth.user.id));
  return Response.json({ ok: true });
}
