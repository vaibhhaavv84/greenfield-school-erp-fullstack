import { requireUser } from "@/lib/auth";
import { getEnv } from "@/lib/database";
import { classLabel, parseClasses } from "@/lib/records";

async function all<T extends Record<string, unknown> = Record<string, unknown>>(sql: string, ...bindings: unknown[]) {
  const result = await getEnv().DB.prepare(sql).bind(...bindings).all<T>();
  return result.results || [];
}

async function attendanceRows(where = "", ...bindings: unknown[]) {
  const modern = await all(`SELECT * FROM attendance_records ${where} ORDER BY attendance_date DESC`, ...bindings);
  const legacyWhere = where.replaceAll("attendance_records", "attendance");
  const legacy = await all(`SELECT id,person_type,person_id,attendance_date,status,note,NULL AS marked_by,NULL AS created_at,NULL AS updated_at FROM attendance ${legacyWhere} ORDER BY attendance_date DESC`, ...bindings);
  const modernKeys = new Set(modern.map((row) => `${row.person_type}:${row.person_id}:${row.attendance_date}`));
  return [...modern, ...legacy.filter((row) => !modernKeys.has(`${row.person_type}:${row.person_id}:${row.attendance_date}`))];
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
    const [students, teachers, installments, attendance, marks, homework, curriculum, users, audit, schoolClasses, feePlans, feePlanItems, studentFeePlans, exams, results, galleryEvents, media] = await Promise.all([
      all("SELECT * FROM students ORDER BY class_name,section,CAST(roll_no AS INTEGER),name"),
      all(`SELECT t.*,COALESCE(p.category,'Primary / Junior') AS category,COALESCE(p.designation,'Teacher') AS designation,
        COALESCE(p.class_teacher_classes,'[]') AS class_teacher_classes FROM teachers t LEFT JOIN teacher_profiles p ON p.teacher_id=t.id ORDER BY category,name`),
      all(`SELECT f.*,r.receipt_no,r.installment_label,s.name AS student_name,s.admission_no,s.class_name,s.section
        FROM fee_installments f LEFT JOIN payment_receipts r ON r.payment_id=f.id LEFT JOIN students s ON s.id=f.student_id ORDER BY f.paid_on DESC,f.created_at DESC`),
      attendanceRows(),
      all("SELECT * FROM marks ORDER BY student_id,term,subject"),
      all("SELECT h.*,t.name AS teacher_name FROM homework h LEFT JOIN teachers t ON t.id=h.teacher_id ORDER BY h.due_date DESC,h.created_at DESC"),
      all("SELECT * FROM curriculum ORDER BY class_name"),
      all("SELECT id,username,display_name,role,student_id,teacher_id,must_change_password,active,created_at FROM users ORDER BY role,display_name"),
      all("SELECT a.*,u.display_name AS user_name FROM audit_log a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.created_at DESC LIMIT 50"),
      all(`SELECT c.*,t.name AS class_teacher_name FROM school_classes c LEFT JOIN teachers t ON t.id=c.class_teacher_id WHERE c.active=1 ORDER BY c.level,c.class_name,c.section`),
      all("SELECT * FROM fee_plans WHERE active=1 ORDER BY class_name,section,name"),
      all("SELECT * FROM fee_plan_items ORDER BY plan_id,sequence_no"),
      all("SELECT * FROM student_fee_plans ORDER BY student_id,assigned_at DESC"),
      all("SELECT * FROM exam_schedules WHERE published=1 ORDER BY exam_date,start_time"),
      all(`SELECT r.*,s.name AS student_name,s.class_name,s.section FROM exam_results r JOIN students s ON s.id=r.student_id ORDER BY r.exam_name,s.class_name,s.section,s.name,r.subject`),
      all("SELECT * FROM gallery_events WHERE published=1 ORDER BY event_date DESC,created_at DESC"),
      all("SELECT id,owner_type,owner_id,kind,filename,mime_type,size_bytes,caption,created_at FROM media_assets ORDER BY created_at DESC"),
    ]);
    return Response.json({ user: auth.user, ...common, students, teachers, installments, attendance, marks, homework, curriculum, users, audit, schoolClasses, feePlans, feePlanItems, studentFeePlans, exams, results, galleryEvents, media });
  }

  if (auth.user.role === "teacher") {
    if (!auth.user.teacherId) return Response.json({ error: "This account is not linked to a teacher record." }, { status: 403 });
    const teacher = await getEnv().DB.prepare(`SELECT t.*,COALESCE(p.category,'Primary / Junior') AS category,COALESCE(p.designation,'Teacher') AS designation,
      COALESCE(p.class_teacher_classes,'[]') AS class_teacher_classes FROM teachers t LEFT JOIN teacher_profiles p ON p.teacher_id=t.id WHERE t.id=?`)
      .bind(auth.user.teacherId).first<Record<string, unknown>>();
    if (!teacher) return Response.json({ error: "Teacher record not found." }, { status: 404 });
    const classes = [...new Set([...parseClasses(teacher.classes), ...parseClasses(teacher.class_teacher_classes)])];
    const placeholders = classes.map(() => "?").join(",");
    const students = classes.length ? await all(`SELECT id,admission_no,name,class_name,section,roll_no,parent_name,phone,attendance_percent FROM students WHERE (class_name || CASE WHEN section='' THEN '' ELSE '-' || section END) IN (${placeholders}) ORDER BY class_name,section,CAST(roll_no AS INTEGER)`, ...classes) : [];
    const studentIds = students.map((row) => String(row.id));
    const studentPlaceholders = studentIds.map(() => "?").join(",");
    const [homework, curriculum, attendance, exams, results, marks, media, schoolClasses] = await Promise.all([
      all("SELECT * FROM homework WHERE teacher_id=? ORDER BY due_date DESC,created_at DESC", auth.user.teacherId),
      classes.length ? all(`SELECT * FROM curriculum WHERE class_name IN (${placeholders}) ORDER BY class_name`, ...classes) : [],
      studentIds.length ? attendanceRows(`WHERE person_type='student' AND person_id IN (${studentPlaceholders})`, ...studentIds) : [],
      classes.length ? all(`SELECT * FROM exam_schedules WHERE published=1 AND (class_name || CASE WHEN section='' THEN '' ELSE '-' || section END) IN (${placeholders}) ORDER BY exam_date,start_time`, ...classes) : [],
      studentIds.length ? all(`SELECT * FROM exam_results WHERE student_id IN (${studentPlaceholders}) ORDER BY exam_name,student_id,subject`, ...studentIds) : [],
      studentIds.length ? all(`SELECT * FROM marks WHERE student_id IN (${studentPlaceholders}) ORDER BY term,student_id,subject`, ...studentIds) : [],
      all("SELECT id,owner_type,owner_id,kind,filename,mime_type,size_bytes,caption,created_at FROM media_assets WHERE (owner_type='homework' AND owner_id IN (SELECT id FROM homework WHERE teacher_id=?)) OR (owner_type='marksheet' AND uploaded_by=?) ORDER BY created_at DESC", auth.user.teacherId, auth.user.id),
      classes.length ? all(`SELECT c.*,t.name AS class_teacher_name FROM school_classes c LEFT JOIN teachers t ON t.id=c.class_teacher_id WHERE (c.class_name || CASE WHEN c.section='' THEN '' ELSE '-' || c.section END) IN (${placeholders})`, ...classes) : [],
    ]);
    return Response.json({ user: auth.user, ...common, teacher: { ...teacher, classes }, students, homework, curriculum, attendance, exams, results, marks, media, schoolClasses });
  }

  if (!auth.user.studentId) return Response.json({ error: "This account is not linked to a student record." }, { status: 403 });
  const student = await getEnv().DB.prepare("SELECT * FROM students WHERE id=?").bind(auth.user.studentId).first<Record<string, unknown>>();
  if (!student) return Response.json({ error: "Student record not found." }, { status: 404 });
  const label = classLabel(student.class_name, student.section);
  const [installments, attendance, marks, homework, curriculum, feePlans, feePlanItems, exams, results, galleryEvents, media, schoolClasses] = await Promise.all([
    all(`SELECT f.*,r.receipt_no,r.installment_label FROM fee_installments f LEFT JOIN payment_receipts r ON r.payment_id=f.id WHERE f.student_id=? ORDER BY f.paid_on DESC,f.created_at DESC`, auth.user.studentId),
    attendanceRows("WHERE person_type='student' AND person_id=?", auth.user.studentId),
    all("SELECT * FROM marks WHERE student_id=? ORDER BY term,subject", auth.user.studentId),
    all("SELECT h.*,t.name AS teacher_name FROM homework h LEFT JOIN teachers t ON t.id=h.teacher_id WHERE h.class_name=? ORDER BY h.due_date DESC,h.created_at DESC", label),
    all("SELECT * FROM curriculum WHERE class_name=?", label),
    all(`SELECT p.* FROM fee_plans p JOIN student_fee_plans s ON s.plan_id=p.id WHERE s.student_id=? AND p.active=1 ORDER BY p.created_at DESC`, auth.user.studentId),
    all(`SELECT i.* FROM fee_plan_items i JOIN student_fee_plans s ON s.plan_id=i.plan_id WHERE s.student_id=? ORDER BY i.due_date`, auth.user.studentId),
    all("SELECT * FROM exam_schedules WHERE published=1 AND class_name=? AND (section='' OR section=?) ORDER BY exam_date,start_time", student.class_name, student.section),
    all("SELECT * FROM exam_results WHERE student_id=? ORDER BY exam_name,subject", auth.user.studentId),
    all("SELECT * FROM gallery_events WHERE published=1 ORDER BY event_date DESC,created_at DESC"),
    all(`SELECT id,owner_type,owner_id,kind,filename,mime_type,size_bytes,caption,created_at FROM media_assets
      WHERE (owner_type='homework' AND owner_id IN (SELECT id FROM homework WHERE class_name=?)) OR owner_type='gallery' OR (owner_type='marksheet' AND owner_id=?) ORDER BY created_at DESC`, label, auth.user.studentId),
    all(`SELECT c.*,t.name AS class_teacher_name FROM school_classes c LEFT JOIN teachers t ON t.id=c.class_teacher_id WHERE c.class_name=? AND (c.section='' OR c.section=?) LIMIT 1`, student.class_name, student.section),
  ]);
  return Response.json({ user: auth.user, ...common, student, installments, attendance, marks, homework, curriculum, feePlans, feePlanItems, exams, results, galleryEvents, media, schoolClasses });
}
