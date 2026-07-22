import { isSameOrigin, requireUser } from "@/lib/auth";
import { audit, getEnv } from "@/lib/database";
import { cleanDate, cleanId, cleanText, parseClasses } from "@/lib/records";

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return Response.json({ error: "Invalid request origin" }, { status: 403 });
  const auth = await requireUser(request, ["admin", "teacher"]);
  if ("error" in auth) return auth.error;
  try {
    const body = await request.json() as Record<string, unknown>;
    const teacherId = auth.user.role === "teacher" ? auth.user.teacherId : cleanText(body.teacher_id);
    if (!teacherId) throw new Error("Choose a teacher before publishing homework.");
    const teacher = await getEnv().DB.prepare("SELECT id,subject,classes FROM teachers WHERE id=?").bind(teacherId).first<{ id: string; subject: string; classes: string }>();
    if (!teacher) throw new Error("Teacher record not found.");
    const className = cleanText(body.class_name).toUpperCase();
    if (!className) throw new Error("Class is required.");
    if (auth.user.role === "teacher" && !parseClasses(teacher.classes).includes(className)) throw new Error("You can publish homework only for your assigned classes.");
    const title = cleanText(body.title);
    const instructions = cleanText(body.instructions);
    const dueDate = cleanDate(body.due_date);
    if (!title || !instructions || !dueDate) throw new Error("Title, instructions, and due date are required.");
    const id = cleanId(body.id, "HW");
    await getEnv().DB.prepare(`INSERT INTO homework (id,class_name,subject,teacher_id,title,instructions,due_date,created_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET class_name=excluded.class_name,subject=excluded.subject,teacher_id=excluded.teacher_id,title=excluded.title,instructions=excluded.instructions,due_date=excluded.due_date`)
      .bind(id, className, cleanText(body.subject, teacher.subject), teacherId, title, instructions, dueDate, new Date().toISOString()).run();
    await audit(auth.user.id, "publish", "homework", id, { className });
    return Response.json({ ok: true, id });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Homework could not be published." }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  if (!isSameOrigin(request)) return Response.json({ error: "Invalid request origin" }, { status: 403 });
  const auth = await requireUser(request, ["admin", "teacher"]);
  if ("error" in auth) return auth.error;
  const id = new URL(request.url).searchParams.get("id") || "";
  const item = await getEnv().DB.prepare("SELECT teacher_id FROM homework WHERE id=?").bind(id).first<{ teacher_id: string }>();
  if (!item) return Response.json({ error: "Homework was not found." }, { status: 404 });
  if (auth.user.role === "teacher" && item.teacher_id !== auth.user.teacherId) return Response.json({ error: "You can remove only your own homework." }, { status: 403 });
  await getEnv().DB.prepare("DELETE FROM homework WHERE id=?").bind(id).run();
  await audit(auth.user.id, "delete", "homework", id);
  return Response.json({ ok: true });
}
