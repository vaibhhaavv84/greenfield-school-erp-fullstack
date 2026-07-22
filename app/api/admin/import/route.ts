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
  gallery: Record<string, unknown>[];
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
    if (!["student", "teacher"].includes(type) || !["present", "absent", "late", "leave"].includes(status)) throw new Error("Attendance: person_type or status is invalid.");
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

    validateRows({ students: studentRows, teachers: teacherRows, accounts: accountRows, installments: installmentRows, attendance: attendanceRows, marks: markRows, homework: homeworkRows, curriculum: curriculumRows, notices: noticeRows, gallery: galleryRows }, mode);

    if (mode === "replace") {
      await db.batch([
        db.prepare("DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE role!='admin')"),
        db.prepare("DELETE FROM users WHERE role!='admin'"),
        db.prepare("DELETE FROM login_attempts WHERE username NOT IN (SELECT username FROM users WHERE role='admin')"),
        db.prepare("DELETE FROM fee_installments"), db.prepare("DELETE FROM attendance"), db.prepare("DELETE FROM marks"),
        db.prepare("DELETE FROM homework"), db.prepare("DELETE FROM curriculum"), db.prepare("DELETE FROM notices"),
        db.prepare("DELETE FROM gallery"), db.prepare("DELETE FROM students"), db.prepare("DELETE FROM teachers"),
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
    }
    for (const row of installmentRows) {
      statements.push(db.prepare(`INSERT INTO fee_installments (id,student_id,amount,paid_on,mode,reference,note,recorded_by,created_at) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET student_id=excluded.student_id,amount=excluded.amount,paid_on=excluded.paid_on,mode=excluded.mode,reference=excluded.reference,note=excluded.note`)
        .bind(cleanId(row.installment_id, "PAY"), required(row.student_id, "student_id", "Installments"), cleanNumber(row.amount), required(cleanDate(row.paid_on), "paid_on", "Installments"), required(row.mode, "mode", "Installments"), cleanText(row.reference) || null, cleanText(row.note) || null, auth.user.id, now));
    }
    for (const row of attendanceRows) {
      const type = cleanText(row.person_type).toLowerCase();
      const status = cleanText(row.status).toLowerCase();
      if (!['student','teacher'].includes(type) || !['present','absent','late','leave'].includes(status)) throw new Error("Attendance: person_type or status is invalid.");
      statements.push(db.prepare(`INSERT INTO attendance (id,person_type,person_id,attendance_date,status,note) VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET person_type=excluded.person_type,person_id=excluded.person_id,attendance_date=excluded.attendance_date,status=excluded.status,note=excluded.note`)
        .bind(cleanId(row.attendance_id, "ATT"), type, required(row.person_id, "person_id", "Attendance"), required(cleanDate(row.attendance_date), "attendance_date", "Attendance"), status, cleanText(row.note) || null));
    }
    for (const row of markRows) {
      const max = cleanNumber(row.max_marks);
      const score = cleanNumber(row.marks);
      if (max <= 0 || score < 0 || score > max) throw new Error("Marks: marks must be between 0 and max_marks.");
      statements.push(db.prepare(`INSERT INTO marks (id,student_id,term,subject,marks,max_marks) VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET student_id=excluded.student_id,term=excluded.term,subject=excluded.subject,marks=excluded.marks,max_marks=excluded.max_marks`)
        .bind(cleanId(row.mark_id, "MRK"), required(row.student_id, "student_id", "Marks"), required(row.term, "term", "Marks"), required(row.subject, "subject", "Marks"), score, max));
    }
    for (const row of homeworkRows) {
      statements.push(db.prepare(`INSERT INTO homework (id,class_name,subject,teacher_id,title,instructions,due_date,created_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET class_name=excluded.class_name,subject=excluded.subject,teacher_id=excluded.teacher_id,title=excluded.title,instructions=excluded.instructions,due_date=excluded.due_date`)
        .bind(cleanId(row.homework_id, "HW"), required(row.class_name, "class_name", "Homework").toUpperCase(), required(row.subject, "subject", "Homework"), required(row.teacher_id, "teacher_id", "Homework"), required(row.title, "title", "Homework"), required(row.instructions, "instructions", "Homework"), required(cleanDate(row.due_date), "due_date", "Homework"), now));
    }
    for (const row of curriculumRows) {
      statements.push(db.prepare(`INSERT INTO curriculum (class_name,focus,subjects) VALUES (?,?,?) ON CONFLICT(class_name) DO UPDATE SET focus=excluded.focus,subjects=excluded.subjects`)
        .bind(required(row.class_name, "class_name", "Curriculum").toUpperCase(), required(row.focus, "focus", "Curriculum"), required(row.subjects, "subjects", "Curriculum")));
    }
    for (const row of noticeRows) {
      statements.push(db.prepare(`INSERT INTO notices (id,title,notice_date,body,audience,created_at) VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,notice_date=excluded.notice_date,body=excluded.body,audience=excluded.audience`)
        .bind(cleanId(row.notice_id, "NOT"), required(row.title, "title", "Notices"), required(cleanDate(row.notice_date), "notice_date", "Notices"), required(row.body, "body", "Notices"), cleanText(row.audience, "all").toLowerCase(), now));
    }
    for (const row of galleryRows) {
      statements.push(db.prepare(`INSERT INTO gallery (id,title,event_date,image_url,created_at) VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,event_date=excluded.event_date,image_url=excluded.image_url`)
        .bind(cleanId(row.gallery_id, "GAL"), required(row.title, "title", "Gallery"), required(cleanDate(row.event_date), "event_date", "Gallery"), cleanText(row.image_url) || null, now));
    }
    await runInChunks(statements);

    for (const row of accountRows) {
      const role = cleanText(row.role).toLowerCase();
      if (role !== "student" && role !== "teacher") throw new Error("Accounts: role must be student or teacher.");
      const username = normalizeUsername(row.username);
      const temporaryPassword = cleanText(row.temporary_password);
      const passwordError = validatePassword(temporaryPassword);
      if (!username || passwordError) throw new Error(`Accounts: ${username || "username"} - ${passwordError || "username is required."}`);
      const studentId = role === "student" ? required(row.student_id, "student_id", "Accounts") : null;
      const teacherId = role === "teacher" ? required(row.teacher_id, "teacher_id", "Accounts") : null;
      const credential = await hashPassword(temporaryPassword);
      await db.prepare(`INSERT INTO users (username,display_name,role,password_hash,password_salt,password_iterations,student_id,teacher_id,must_change_password,active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,1,1,?,?) ON CONFLICT(username) DO UPDATE SET display_name=excluded.display_name,role=excluded.role,password_hash=excluded.password_hash,password_salt=excluded.password_salt,password_iterations=excluded.password_iterations,student_id=excluded.student_id,teacher_id=excluded.teacher_id,must_change_password=1,active=1,updated_at=excluded.updated_at`)
        .bind(username, required(row.display_name, "display_name", "Accounts"), role, credential.hash, credential.salt, credential.iterations, studentId, teacherId, now, now).run();
    }

    const schoolRows = rows(data.school, 10);
    if (schoolRows[0]) {
      const schoolName = cleanText(schoolRows[0].school_name);
      const academicYear = cleanText(schoolRows[0].academic_year);
      const settingStatements = [];
      if (schoolName) settingStatements.push(db.prepare("INSERT INTO settings (key,value) VALUES ('school_name',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(schoolName));
      if (academicYear) settingStatements.push(db.prepare("INSERT INTO settings (key,value) VALUES ('academic_year',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(academicYear));
      if (settingStatements.length) await db.batch(settingStatements);
    }
    if (installmentRows.length) await db.prepare("UPDATE students SET fee_paid=COALESCE((SELECT SUM(amount) FROM fee_installments WHERE student_id=students.id),fee_paid)").run();
    const counts = { students: studentRows.length, teachers: teacherRows.length, accounts: accountRows.length, installments: installmentRows.length, attendance: attendanceRows.length, marks: markRows.length, homework: homeworkRows.length, curriculum: curriculumRows.length, notices: noticeRows.length, gallery: galleryRows.length };
    await audit(auth.user.id, "excel_import", "school_data", undefined, { mode, counts });
    return Response.json({ ok: true, mode, counts });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "The workbook could not be imported." }, { status: 400 });
  }
}
