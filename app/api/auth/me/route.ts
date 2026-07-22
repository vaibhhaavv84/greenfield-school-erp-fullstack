import { getSessionUser } from "@/lib/auth";
import { ensureSchema, getEnv } from "@/lib/database";

export async function GET(request: Request) {
  await ensureSchema();
  const [admin, settings, user] = await Promise.all([
    getEnv().DB.prepare("SELECT COUNT(*) AS count FROM users WHERE role='admin' AND active=1").first<{ count: number }>(),
    getEnv().DB.prepare("SELECT key,value FROM settings WHERE key IN ('school_name','academic_year')").all<{ key: string; value: string }>(),
    getSessionUser(request),
  ]);
  const values = Object.fromEntries((settings.results || []).map((item) => [item.key, item.value]));
  return Response.json({
    authenticated: Boolean(user),
    setupRequired: Number(admin?.count || 0) === 0,
    schoolName: values.school_name || "Your School ERP",
    academicYear: values.academic_year || "2026-27",
    user,
  });
}
