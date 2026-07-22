import { requireUser } from "@/lib/auth";
import { getEnv } from "@/lib/database";
import { classLabel, parseClasses } from "@/lib/records";

async function all<T extends Record<string, unknown> = Record<string, unknown>>(sql: string, ...bindings: unknown[]) {
  const result = await getEnv().DB.prepare(sql).bind(...bindings).all<T>();
  return result.results || [];
}

export async function GET(request: Request) {
  const auth = await requireUser(request);
  if ("error" in auth) return auth.error;
  const settingsRows = await all<{ key: string; value: string }>("SELECT key,value FROM settings");
  const settings = Object.fromEntries(settingsRows.map((item) => [item.key, item.value]));
  const audience = auth.user.role === "admin" ? null : `${auth.user.role}s`;
  const common = {
    settings,
    notices: audience
      ? await all("SELECT * FROM notices WHERE audience IN ('all',?) ORDER BY notice_date DESC,created_at DESC LIMIT 50", audience)
      : await all("SELECT * FROM notices ORDER BY notice_date DESC,created_at DESC LIMIT 50"),
    gallery: await all("SELECT * FROM gallery ORDER BY event_date DESC,created_at DESC LIMIT 50"),
  };

  if (auth.user.role === "admin") {
    const [students, teachers, installments, attendance, marks, homework, curriculum, users, audit] = await Promise.all([
      all("SELECT * FROM students ORDER BY class_name,section,roll_no,name"),
      all("SELECT * FROM teachers ORDER BY name"),
      all("SELECT * FROM fee_installments ORDER BY paid_on DESC,created_at DESC"),
      all("SELECT * FROM attendance ORDER BY attendance_date DESC"),
      all("SELECT * FROM marks ORDER BY student_id,term,subject"),
      all("SELECT h.*,t.name AS teacher_name FROM homework h LEFT JOIN teachers t ON t.id=h.teacher_id ORDER BY h.due_date DESC,h.created_at DESC"),
      all("SELECT * FROM curriculum ORDER BY class_name"),
      all("SELECT id,username,display_name,role,student_id,teacher_id,must_change_password,active,created_at FROM users ORDER BY role,display_name"),
      all("SELECT a.*,u.display_name AS user_name FROM audit_log a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.created_at DESC LIMIT 30"),
    ]);
    return Response.json({ user: auth.user, ...common, students, teachers, installments, attendance, marks, homework, curriculum, users, audit });
  }

  if (auth.user.role === "teacher") {
    if (!auth.user.teacherId) return Response.json({ error: "This account is not linked to a teacher record." }, { status: 403 });
    const teacher = await getEnv().DB.prepare("SELECT * FROM teachers WHERE id=?").bind(auth.user.teacherId).first<Record<string, unknown>>();
    if (!teacher) return Response.json({ error: "Teacher record not found." }, { status: 404 });
    const classes = parseClasses(teacher.classes);
    const placeholders = classes.map(() => "?").join(",");
    const students = classes.length ? await all(`SELECT id,admission_no,name,class_name,section,roll_no,parent_name,phone,attendance_percent FROM students WHERE (class_name || CASE WHEN section='' THEN '' ELSE '-' || section END) IN (${placeholders}) ORDER BY class_name,section,roll_no`, ...classes) : [];
    const homework = await all("SELECT * FROM homework WHERE teacher_id=? ORDER BY due_date DESC,created_at DESC", auth.user.teacherId);
    const curriculum = classes.length ? await all(`SELECT * FROM curriculum WHERE class_name IN (${placeholders}) ORDER BY class_name`, ...classes) : [];
    return Response.json({ user: auth.user, ...common, teacher: { ...teacher, classes }, students, homework, curriculum });
  }

  if (!auth.user.studentId) return Response.json({ error: "This account is not linked to a student record." }, { status: 403 });
  const student = await getEnv().DB.prepare("SELECT * FROM students WHERE id=?").bind(auth.user.studentId).first<Record<string, unknown>>();
  if (!student) return Response.json({ error: "Student record not found." }, { status: 404 });
  const label = classLabel(student.class_name, student.section);
  const [installments, attendance, marks, homework, curriculum] = await Promise.all([
    all("SELECT * FROM fee_installments WHERE student_id=? ORDER BY paid_on DESC,created_at DESC", auth.user.studentId),
    all("SELECT * FROM attendance WHERE person_type='student' AND person_id=? ORDER BY attendance_date DESC LIMIT 90", auth.user.studentId),
    all("SELECT * FROM marks WHERE student_id=? ORDER BY term,subject", auth.user.studentId),
    all("SELECT h.*,t.name AS teacher_name FROM homework h LEFT JOIN teachers t ON t.id=h.teacher_id WHERE h.class_name=? ORDER BY h.due_date DESC,h.created_at DESC", label),
    all("SELECT * FROM curriculum WHERE class_name=?", label),
  ]);
  return Response.json({ user: auth.user, ...common, student, installments, attendance, marks, homework, curriculum });
}
