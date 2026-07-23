import { hashPassword, isSameOrigin, normalizeUsername, requireUser, validatePassword } from "@/lib/auth";
import { audit, getEnv, runInChunks } from "@/lib/database";
import { cleanDate, cleanId, cleanNumber, cleanText, parseClasses, rows } from "@/lib/records";

type ImportData = Record<string, unknown>;

function required(value: unknown, field: string, sheet: string) {
  const text = cleanText(value);
  if (!text) throw new Error(`${sheet}: ${field} is required.`);
  return text;
}

function assertUnique(rowsToCheck: Record<string, unknown>[], field: string, sheet: string) {
  const seen = new Set<string>();
  for (const row of rowsToCheck) {
    const value = cleanText(row[field]).toLowerCase();
    if (!value) continue;
    if (seen.has(value)) throw new Error(`${sheet}: duplicate ${field} value "${cleanText(row[field])}".`);
    seen.add(value);
  }
}

function validateRows(data: {
  students: Record<string, unknown>[]; teachers: Record<string, unknown>[]; accounts: Record<string, unknown>[];
  installments: Record<string, unknown>[]; attendance: Record<string, unknown>[]; marks: Record<string, unknown>[];
  homework: Record<string, unknown>[]; curriculum: Record<string, unknown>[]; notices: Record<string, unknown>[];
  gallery: Record<string, unknown>[]; classes: Record<string, unknown>[]; feePlans: Record<string, unknown>[];
  exams: Record<string, unknown>[]; results: Record<string, unknown>[];
}, mode: "replace" | "merge") {
  assertUnique(data.students, "student_id", "Students");
  assertUnique(data.students, "admission_no", "Students");
  assertUnique(data.teachers, "teacher_id", "Teachers");
  assertUnique(data.teachers, "employee_no", "Teachers");
  assertUnique(data.accounts, "username", "Accounts");
  const studentIds = new Set(data.students.map((row) => cleanText(row.student_id)).filter(Boolean));
  const teacherIds = new Set(data.teachers.map((row) => cleanText(row.teacher_id)).filter(Boolean));

  for (const row of data.students) {
    required(row.admission_no, "admission_no", "Students"); required(row.name, "name", "Students");
    required(row.class_name, "class_name", "Students"); required(row.roll_no, "roll_no", "Students");
    required(row.parent_name, "parent_name", "Students"); required(row.phone, "phone", "Students"); required(row.address, "address", "Students");
    if (cleanNumber(row.annual_fee) < 0 || cleanNumber(row.fee_paid) < 0) throw new Error("Students: fee amounts cannot be negative.");
    const attendancePercent = cleanNumber(row.attendance_percent);
    if (attendancePercent < 0 || attendancePercent > 100) throw new Error("Students: attendance_percent must be between 0 and 100.");
  }
  for (const row of data.teachers) {
    required(row.employee_no, "employee_no", "Teachers"); required(row.name, "name", "Teachers");
    required(row.subject, "subject", "Teachers"); required(row.phone, "phone", "Teachers");
    if (cleanNumber(row.monthly_salary) < 0 || cleanNumber(row.salary_paid) < 0) throw new Error("Teachers: salary amounts cannot be negative.");
    const attendancePercent = cleanNumber(row.attendance_percent);
    if (attendancePercent < 0 || attendancePercent > 100) throw new Error("Teachers: attendance_percent must be between 0 and 100.");
  }
  for (const row of data.accounts) {
    const role = cleanText(row.role).toLowerCase();
    if (role !== "student" && role !== "teacher") throw new Error("Accounts: role must be student or teacher.");
    const username = normalizeUsername(row.username);
    const passwordError = validatePassword(cleanText(row.temporary_password));
    if (!username || passwordError) throw new Error(`Accounts: ${username || "username"} - ${passwordError || "username is required."}`);
    required(row.display_name, "display_name", "Accounts");
    const linkedId = required(role === "student" ? row.student_id : row.teacher_id, `${role}_id`, "Accounts");
    if (mode === "replace" && !(role === "student" ? studentIds : teacherIds).has(linkedId)) throw new Error(`Accounts: linked ${role} ID "${linkedId}" is not present in this workbook.`);
  }
  for (const row of data.installments) {
    const linkedId = required(row.student_id, "student_id", "Installments");
    if (mode === "replace" && !studentIds.has(linkedId)) throw new Error(`Installments: student ID "${linkedId}" is not present in this workbook.`);
    if (cleanNumber(row.amount) <= 0) throw new Error("Installments: amount must be greater than zero.");
    required(cleanDate(row.paid_on), "paid_on", "Installments"); required(row.mode, "mode", "Installments");
  }
  for (const row of data.attendance) {
    const type = cleanText(row.person_type).toLowerCase(); const status = cleanText(row.status).toLowerCase();
    if (!["student", "teacher"].includes(type) || !["present", "absent", "late", "half_day", "leave"].includes(status)) throw new Error("Attendance: person_type or status is invalid.");
    required(row.person_id, "person_id", "Attendance"); required(cleanDate(row.attendance_date), "attendance_date", "Attendance");
  }
  for (const row of data.marks) {
    const linkedId = required(row.student_id, "student_id", "Marks");
    if (mode === "replace" && !studentIds.has(linkedId)) throw new Error(`Marks: student ID "${linkedId}" is not present in this workbook.`);
    const score = cleanNumber(row.marks); const maximum = cleanNumber(row.max_marks);
    if (maximum <= 0 || score < 0 || score > maximum) throw new Error("Marks: marks must be between 0 and max_marks.");
    required(row.term, "term", "Marks"); required(row.subject, "subject", "Marks");
  }
  for (const row of data.homework) {
    const linkedId = required(row.teacher_id, "teacher_id", "Homework");
    if (mode === "replace" && !teacherIds.has(linkedId)) throw new Error(`Homework: teacher ID "${linkedId}" is not present in this workbook.`);
    required(row.class_name, "class_name", "Homework"); required(row.subject, "subject", "Homework");
    required(row.title, "title", "Homework"); required(row.instructions, "instructions", "Homework"); required(cleanDate(row.due_date), "due_date", "Homework");
  }
  for (const row of data.curriculum) { required(row.class_name, "class_name", "Curriculum"); required(row.focus, "focus", "Curriculum"); required(row.subjects, "subjects", "Curriculum"); }
  for (const row of data.notices) {
    required(row.title, "title", "Notices"); required(cleanDate(row.notice_date), "notice_date", "Notices"); required(row.body, "body", "Notices");
    if (!["all", "students", "teachers"].includes(cleanText(row.audience, "all").toLowerCase())) throw new Error("Notices: audience must be all, students, or teachers.");
  }
  for (const row of data.gallery) { required(row.title, "title", "Gallery"); required(cleanDate(row.event_date), "event_date", "Gallery"); }
  for (const row of data.classes) { required(row.class_name, "class_name", "Classes"); required(row.level, "level", "Classes"); }
  for (const row of data.feePlans) { required(row.name, "name", "FeePlans"); required(row.class_name, "class_name", "FeePlans"); if (cleanNumber(row.total_amount) <= 0) throw new Error("FeePlans: total_amount must be greater than zero."); }
  for (const row of data.exams) { required(row.exam_name, "exam_name", "Exams"); required(row.class_name, "class_name", "Exams"); required(row.subject, "subject", "Exams"); required(cleanDate(row.exam_date), "exam_date", "Exams"); }
  for (const row of data.results) { required(row.exam_name, "exam_name", "Results"); required(row.student_id, "student_id", "Results"); const score = cleanNumber(row.marks); const max = cleanNumber(row.max_marks); if (max <= 0 || score < 0 || score > max) throw new Error("Results: marks must be between 0 and max_marks."); }
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return Response.json({ error: "Invalid request origin" }, { status: 403 });
  const auth = await requireUser(request, ["admin"]);
  if ("error" in auth) return auth.error;
  try {
    const body = await request.json() as { mode?: string; data?: ImportData };
    const data = body.data || {};
    const mode = body.mode === "merge" ? "merge" : "replace";
    const db = getEnv().DB;
    const now = new Date().toISOString();
    const studentRows = rows(data.students);
    const teacherRows = rows(data.teachers);
    const accountRows = rows(data.accounts);
    const installmentRows = rows(data.installments);
    const attendanceRows = rows(data.attendance);
    const markRows = rows(data.marks);
    const homeworkRows = rows(data.homework);
    const curriculumRows = rows(data.curriculum);
    const noticeRows = rows(data.notices);
    const galleryRows = rows(data.gallery);
    const classRows = rows(data.classes);
    const feePlanRows = rows(data.feeplans);
    const examRows = rows(data.exams);
    const resultRows = rows(data.results);

    validateRows({ students: studentRows, teachers: teacherRows, accounts: accountRows, installments: installmentRows, attendance: attendanceRows, marks: markRows, homework: homeworkRows, curriculum: curriculumRows, notices: noticeRows, gallery: galleryRows, classes: classRows, feePlans: feePlanRows, exams: examRows, results: resultRows }, mode);

    if (mode === "replace") {
      await db.batch([
        db.prepare("DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE role!='admin')"),
        db.prepare("DELETE FROM users WHERE role!='admin'"),
        db.prepare("DELETE FROM login_attempts WHERE username NOT IN (SELECT username FROM users WHERE role='admin')"),
        db.prepare("DELETE FROM fee_installments"), db.prepare("DELETE FROM attendance"), db.prepare("DELETE FROM marks"),
        db.prepare("DELETE FROM homework"), db.prepare("DELETE FROM curriculum"), db.prepare("DELETE FROM notices"),
        db.prepare("DELETE FROM gallery"), db.prepare("DELETE FROM students"), db.prepare("DELETE FROM teachers"),
        db.prepare("DELETE FROM gallery_events"), db.prepare("DELETE FROM exam_results"), db.prepare("DELETE FROM exam_schedules"),
        db.prepare("DELETE FROM attendance_records"), db.prepare("DELETE FROM payment_receipts"), db.prepare("DELETE FROM student_fee_plans"),
        db.prepare("DELETE FROM fee_plan_items"), db.prepare("DELETE FROM fee_plans"), db.prepare("DELETE FROM teacher_profiles"), db.prepare("DELETE FROM school_classes"),
      ]);
    }

    const statements: D1PreparedStatement[] = [];
    for (const row of studentRows) {
      const id = cleanId(row.student_id, "STU");
      const className = required(row.class_name, "class_name", "Students").toUpperCase();
      const section = cleanText(row.section).toUpperCase();
      statements.push(db.prepare(`INSERT INTO students (id,admission_no,name,class_name,section,roll_no,parent_name,phone,email,address,annual_fee,fee_paid,due_date,attendance_percent,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET admission_no=excluded.admission_no,name=excluded.name,class_name=excluded.class_name,section=excluded.section,roll_no=excluded.roll_no,parent_name=excluded.parent_name,phone=excluded.phone,email=excluded.email,address=excluded.address,annual_fee=excluded.annual_fee,fee_paid=excluded.fee_paid,due_date=excluded.due_date,attendance_percent=excluded.attendance_percent,updated_at=excluded.updated_at`)
        .bind(id, required(row.admission_no, "admission_no", "Students"), required(row.name, "name", "Students"), className, section, required(row.roll_no, "roll_no", "Students"), required(row.parent_name, "parent_name", "Students"), required(row.phone, "phone", "Students"), cleanText(row.email) || null, required(row.address, "address", "Students"), cleanNumber(row.annual_fee), cleanNumber(row.fee_paid), cleanDate(row.due_date) || null, cleanNumber(row.attendance_percent), now, now));
    }
    for (const row of teacherRows) {
      const id = cleanId(row.teacher_id, "TCH");
      statements.push(db.prepare(`INSERT INTO teachers (id,employee_no,name,subject,classes,phone,email,monthly_salary,salary_paid,attendance_percent,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET employee_no=excluded.employee_no,name=excluded.name,subject=excluded.subject,classes=excluded.classes,phone=excluded.phone,email=excluded.email,monthly_salary=excluded.monthly_salary,salary_paid=excluded.salary_paid,attendance_percent=excluded.attendance_percent,updated_at=excluded.updated_at`)
        .bind(id, required(row.employee_no, "employee_no", "Teachers"), required(row.name, "name", "Teachers"), required(row.subject, "subject", "Teachers"), JSON.stringify(parseClasses(row.classes)), required(row.phone, "phone", "Teachers"), cleanText(row.email) || null, cleanNumber(row.monthly_salary), cleanNumber(row.salary_paid), cleanNumber(row.attendance_percent), now, now));
      statements.push(db.prepare(`INSERT INTO teacher_profiles (teacher_id,category,designation,class_teacher_classes,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(teacher_id) DO UPDATE SET category=excluded.category,designation=excluded.designation,class_teacher_classes=excluded.class_teacher_classes,updated_at=excluded.updated_at`)
        .bind(id, cleanText(row.category, "Primary / Junior"), cleanText(row.designation, "Teacher"), JSON.stringify(parseClasses(row.class_teacher_classes)), now));
    }
    for (const row of installmentRows) {
      statements.push(db.prepare(`INSERT INTO fee_installments (id,student_id,amount,paid_on,mode,reference,note,recorded_by,created_at) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET student_id=excluded.student_id,amount=excluded.amount,paid_on=excluded.paid_on,mode=excluded.mode,reference=excluded.reference,note=excluded.note`)
        .bind(cleanId(row.installment_id, "PAY"), required(row.student_id, "student_id", "Installments"), cleanNumber(row.amount), required(cleanDate(row.paid_on), "paid_on", "Installments"), required(row.mode, "mode", "Installments"), cleanText(row.reference) || null, cleanText(row.note) || null, auth.user.id, now));
    }
    for (const row of attendanceRows) {
      const type = cleanText(row.person_type).toLowerCase();
      const status = cleanText(row.status).toLowerCase();
      if (!['student','teacher'].includes(type) || !['present','absent','late','half_day','leave'].includes(status)) throw new Error("Attendance: person_type or status is invalid.");
      statements.push(db.prepare(`INSERT INTO attendance_records (id,person_type,person_id,attendance_date,status,note,marked_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(person_type,person_id,attendance_date) DO UPDATE SET status=excluded.status,note=excluded.note,marked_by=excluded.marked_by,updated_at=excluded.updated_at`)
        .bind(cleanId(row.attendance_id, "ATT"), type, required(row.person_id, "zóNy¶‰žËkºwµç@¢V&Æ—6†VC¢–çFVvW"‚'V&Æ—6†VB"Â²ÖöFS¢&&ööÆVâ"Ò’ææ÷DçVÆÂ‚’æFVfVÇB‡G'VR’À¢7&VFVDC¢FW‡B‚&7&VFVEöB"’ææ÷DçVÆÂ‚’À¢WFFVDC¢FW‡B‚'WFFVEöB"’ææ÷DçVÆÂ‚’À§Ò“° ¦W‡÷'B6öç7BÖVF–76WG2Ò7Æ—FUF&ÆR‚&ÖVF–ö76WG2"Â°¢–C¢FW‡B‚&–B"’ç&–Ö'”¶W’‚’À¢÷væW%G—S¢FW‡B‚&÷væW%÷G—R"’ææ÷DçVÆÂ‚’À¢÷væW$–C¢FW‡B‚&÷væW%ö–B"’ææ÷DçVÆÂ‚’À¢¶–æC¢FW‡B‚&¶–æB"’ææ÷DçVÆÂ‚’À¢ö&¦V7D¶W“¢FW‡B‚&ö&¦V7Eö¶W’"’ææ÷DçVÆÂ‚’À¢f–ÆVæÖS¢FW‡B‚&f–ÆVæÖR"’ææ÷DçVÆÂ‚’À¢Ö–ÖUG—S¢FW‡B‚&Ö–ÖU÷G—R"’ææ÷DçVÆÂ‚’À¢6—¦T'—FW3¢–çFVvW"‚'6—¦Uö'—FW2"’ææ÷DçVÆÂ‚’À¢6F–öã¢FW‡B‚&6F–öâ"’À¢WÆöFVD'“¢–çFVvW"‚'WÆöFVEö'’"’À¢7&VFVDC¢FW‡B‚&7&VFVEöB"’ææ÷DçVÆÂ‚’À§Ò“° 