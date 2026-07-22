import { hashPassword, isSameOrigin, normalizeUsername, requireUser, validatePassword } from "@/lib/auth";
import { audit, getEnv } from "@/lib/database";
import { cleanDate, cleanId, cleanNumber, cleanText, parseClasses } from "@/lib/records";

type Payload = Record<string, unknown>;

function required(value: unknown, field: string) {
  const result = cleanText(value);
  if (!result) throw new Error(`${field} is required.`);
  return result;
}

async function recordExists(table: "students" | "teachers", id: string) {
  const row = await getEnv().DB.prepare(`SELECT id FROM ${table} WHERE id=?`).bind(id).first();
  return Boolean(row);
}

async function saveStudent(data: Payload, userId: number) {
  const db = getEnv().DB;
  const id = cleanId(data.id || data.student_id, "STU");
  const now = new Date().toISOString();
  await db.prepare(`INSERT INTO students (id,admission_no,name,class_name,section,roll_no,parent_name,phone,email,address,annual_fee,fee_paid,due_date,attendance_percent,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET admission_no=excluded.admission_no,name=excluded.name,class_name=excluded.class_name,section=excluded.section,roll_no=excluded.roll_no,parent_name=excluded.parent_name,phone=excluded.phone,email=excluded.email,address=excluded.address,annual_fee=excluded.annual_fee,fee_paid=excluded.fee_paid,due_date=excluded.due_date,attendance_percent=excluded.attendance_percent,updated_at=excluded.updated_at`)
    .bind(
      id,
      required(data.admission_no, "Admission number"),
      required(data.name, "Student name"),
      required(data.class_name, "Class").toUpperCase(),
      cleanText(data.section).toUpperCase(),
      required(data.roll_no, "Roll number"),
      required(data.parent_name, "Parent name"),
      required(data.phone, "Phone"),
      cleanText(data.email) || null,
      required(data.address, "Address"),
      Math.max(0, cleanNumber(data.annual_fee)),
      Math.max(0, cleanNumber(data.fee_paid)),
      cleanDate(data.due_date) || null,
      Math.min(100, Math.max(0, cleanNumber(data.attendance_percent))),
      now,
      now,
    ).run();
  await audit(userId, "save", "student", id, { name: cleanText(data.name) });
  return id;
}

async function saveTeacher(data: Payload, userId: number) {
  const db = getEnv().DB;
  const id = cleanId(data.id || data.teacher_id, "TCH");
  const now = new Date().toISOString();
  await db.prepare(`INSERT INTO teachers (id,employee_no,name,subject,classes,phone,email,monthly_salary,salary_paid,attendance_percent,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET employee_no=excluded.employee_no,name=excluded.name,subject=excluded.subject,classes=excluded.classes,phone=excluded.phone,email=excluded.email,monthly_salary=excluded.monthly_salary,salary_paid=excluded.salary_paid,attendance_percent=excluded.attendance_percent,updated_at=excluded.updated_at`)
    .bind(
      id,
      required(data.employee_no, "Employee number"),
      required(data.name, "Teacher name"),
      required(data.subject, "Subject"),
      JSON.stringify(parseClasses(data.classes)),
      required(data.phone, "Phone"),
      cleanText(data.email) || null,
      Math.max(0, cleanNumber(data.monthly_salary)),
      Math.max(0, cleanNumber(data.salary_paid)),
      Math.min(100, Math.max(0, cleanNumber(data.attendance_percent))),
      now,
      now,
    ).run();
  await audit(userId, "save", "teacher", id, { name: cleanText(data.name) });
  return id;
}

async function savePayment(data: Payload, userId: number) {
  const db = getEnv().DB;
  const studentId = required(data.student_id, "Student");
  if (!(await recordExists("students", studentId))) throw new Error("The selected student no longer exists.");
  const amount = cleanNumber(data.amount);
  if (amount <= 0) throw new Error("Payment amount must be greater than zero.");
  const id = cleanId(data.id, "PAY");
  await db.batch([
    db.prepare("INSERT INTO fee_installments (id,student_id,amount,paid_on,mode,reference,note,recorded_by,created_at) VALUES (?,?,?,?,?,?,?,?,?)")
      .bind(id, studentId, amount, required(cleanDate(data.paid_on), "Payment date"), required(data.mode, "Payment mode"), cleanText(data.reference) || null, cleanText(data.note) || null, userId, new Date().toISOString()),
    db.prepare("UPDATE students SET fee_paid=fee_paid+?,updated_at=? WHERE id=?").bind(amount, new Date().toISOString(), studentId),
  ]);
  await audit(userId, "record_payment", "student", studentId, { amount, paymentId: id });
  return id;
}

async function saveAccount(data: Payload, userId: number) {
  const db = getEnv().DB;
  const role = cleanText(data.role).toLowerCase();
  if (role !== "student" && role !== "teacher") throw new Error("Account role must be student or teacher.");
  const username = normalizeUsername(data.username);
  if (!username) throw new Error("Username is required.");
  const linkedId = required(role === "student" ? data.student_id : data.teacher_id, `${role === "student" ? "Student" : "Teacher"} record`);
  if (!(await recordExists(role === "student" ? "students" : "teachers", linkedId))) throw new Error(`The linked ${role} record does not exist.`);

  const existing = await db.prepare("SELECT id FROM users WHERE username=?").bind(username).first<{ id: number }>();
  const password = cleanText(data.password || data.temporary_password);
  if (!existing && !password) throw new Error("A temporary password is required for a new account.");
  if (password) {
    const passwordError = validatePassword(password);
    if (passwordError) throw new Error(passwordError);
  }
  const duplicateLink = await db.prepare(`SELECT id FROM users WHERE role=? AND ${role === "student" ? "student_id" : "teacher_id"}=? AND username!=?`).bind(role, linkedId, username).first();
  if (duplicateLink) throw new Error(`That ${role} already has a login account.`);

  const now = new Date().toISOString();
  if (existing) {
    if (password) {
      const credential = await hashPassword(password);
      await db.prepare(`UPDATE users SET display_name=?,role=?,student_id=?,teacher_id=?,password_hash=?,password_salt=?,password_iterations=?,must_change_password=1,active=1,updated_at=? WHERE username=?`)
        .bind(required(data.display_name, "Display name"), role, role === "student" ? linkedId : null, role === "teacher" ? linkedId : null, credential.hash, credential.salt, credential.iterations, now, username).run();
      await db.prepare("DELETE FROM sessions WHERE user_id=?").bind(existing.id).run();
    } else {
      await db.prepare("UPDATE users SET display_name=?,role=?,student_id=?,teacher_id=?,active=1,updated_at=? WHERE username=?")
        .bind(required(data.display_name, "Display name"), role, role === "student" ? linkedId : null, role === "teacher" ? linkedId : null, now, username).run();
    }
  } else {
    const credential = await hashPassword(password);
    await db.prepare("INSERT INTO users (username,display_name,role,password_hash,password_salt,password_iterations,student_id,teacher_id,must_change_password,active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,1,1,?,?)")
      .bind(username, required(data.display_name, "Display name"), role, credential.hash, credential.salt, credential.iterations, role === "student" ? linkedId : null, role === "teacher" ? linkedId : null, now, now).run();
  }
  await audit(userId, existing ? "update_account" : "create_account", "user", username, { role, linkedId, passwordReset: Boolean(password && existing) });
  await db.prepare("DELETE FROM login_attempts WHERE username=?").bind(username).run();
  return username;
}

async function saveNotice(data: Payload, userId: number) {
  const id = cleanId(data.id, "NOT");
  const audience = cleanText(data.audience, "all").toLowerCase();
  if (!["all", "students", "teachers"].includes(audience)) throw new Error("Notice audience is invalid.");
  await getEnv().DB.prepare(`INSERT INTO notices (id,title,notice_date,body,audience,created_at) VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,notice_date=excluded.notice_date,body=excluded.body,audience=excluded.audience`)
    .bind(id, required(data.title, "Notice title"), required(cleanDate(data.notice_date), "Notice date"), required(data.body, "Notice details"), audience, new Date().toISOString()).run();
  await audit(userId, "save", "notice", id);
  return id;
}

async function saveCurriculum(data: Payload, userId: number) {
  const className = required(data.class_name, "Class").toUpperCase();
  await getEnv().DB.prepare("INSERT INTO curriculum (class_name,focus,subjects) VALUES (?,?,?) ON CONFLICT(class_name) DO UPDATE SET focus=excluded.focus,subjects=excluded.subjects")
    .bind(className, required(data.focus, "Curriculum focus"), required(data.subjects, "Subjects")).run();
  await audit(userId, "save", "curriculum", className);
  return className;
}

async function deleteEntity(entity: string, id: string, userId: number) {
  const db = getEnv().DB;
  if (!id) throw new Error("Record ID is required.");
  if (entity === "student") {
    await db.batch([
      db.prepare("DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE student_id=?)").bind(id),
      db.prepare("DELETE FROM users WHERE student_id=?").bind(id),
      db.prepare("DELETE FROM fee_installments WHERE student_id=?").bind(id),
      db.prepare("DELETE FROM attendance WHERE person_type='student' AND person_id=?").bind(id),
      db.prepare("DELETE FROM marks WHERE student_id=?").bind(id),
      db.prepare("DELETE FROM students WHERE id=?").bind(id),
    ]);
  } else if (entity === "teacher") {
    await db.batch([
      db.prepare("DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE teacher_id=?)").bind(id),
      db.prepare("DELETE FROM users WHERE teacher_id=?").bind(id),
      db.prepare("DELETE FROM homework WHERE teacher_id=?").bind(id),
      db.prepare("DELETE FROM attendance WHERE person_type='teacher' AND person_id=?").bind(id),
      db.prepare("DELETE FROM teachers WHERE id=?").bind(id),
    ]);
  } else if (entity === "account") {
    const numericId = Number(id);
    if (!Number.isInteger(numericId)) throw new Error("Account ID is invalid.");
    const target = await db.prepare("SELECT role FROM users WHERE id=?").bind(numericId).first<{ role: string }>();
    if (!target || target.role === "admin") throw new Error("The main administrator account cannot be deleted.");
    await db.batch([db.prepare("DELETE FROM sessions WHERE user_id=?").bind(numericId), db.prepare("DELETE FROM users WHERE id=?").bind(numericId)]);
  } else if (entity === "notice") {
    await db.prepare("DELETE FROM notices WHERE id=?").bind(id).run();
  } else if (entity === "curriculum") {
    await db.prepare("DELETE FROM curriculum WHERE class_name=?").bind(id).run();
  } else if (entity === "payment") {
    const payment = await db.prepare("SELECT student_id,amount FROM fee_installments WHERE id=?").bind(id).first<{ student_id: string; amount: number }>();
    if (payment) await db.batch([
      db.prepare("DELETE FROM fee_installments WHERE id=?").bind(id),
      db.prepare("UPDATE students SET fee_paid=MAX(0,fee_paid-?),updated_at=? WHERE id=?").bind(payment.amount, new Date().toISOString(), payment.student_id),
    ]);
  } else {
    throw new Error("This record type cannot be deleted here.");
  }
  await audit(userId, "delete", entity, id);
}

async function clearSchoolData(userId: number) {
  const db = getEnv().DB;
  await db.batch([
    db.prepare("DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE role!='admin')"),
    db.prepare("DELETE FROM users WHERE role!='admin'"),
    db.prepare("DELETE FROM login_attempts WHERE username NOT IN (SELECT username FROM users WHERE role='admin')"),
    db.prepare("DELETE FROM fee_installments"),
    db.prepare("DELETE FROM attendance"),
    db.prepare("DELETE FROM marks"),
    db.prepare("DELETE FROM homework"),
    db.prepare("DELETE FROM curriculum"),
    db.prepare("DELETE FROM notices"),
    db.prepare("DELETE FROM gallery"),
    db.prepare("DELETE FROM students"),
    db.prepare("DELETE FROM teachers"),
    db.prepare("DELETE FROM audit_log"),
  ]);
  await audit(userId, "clear_all", "school_data");
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return Response.json({ error: "Invalid request origin" }, { status: 403 });
  const auth = await requireUser(request, ["admin"]);
  if ("error" in auth) return auth.error;
  try {
    const body = await request.json() as { action?: string; entity?: string; data?: Payload; id?: string; confirmation?: string };
    const action = cleanText(body.action);
    const entity = cleanText(body.entity);
    const data = body.data || {};
    let id = "";
    if (action === "save" && entity === "student") id = await saveStudent(data, auth.user.id);
    else if (action === "save" && entity === "teacher") id = await saveTeacher(data, auth.user.id);
    else if (action === "save" && entity === "payment") id = await savePayment(data, auth.user.id);
    else if (action === "save" && entity === "account") id = await saveAccount(data, auth.user.id);
    else if (action === "save" && entity === "notice") id = await saveNotice(data, auth.user.id);
    else if (action === "save" && entity === "curriculum") id = await saveCurriculum(data, auth.user.id);
    else if (action === "settings") {
      const schoolName = required(data.school_name, "School name");
      const academicYear = required(data.academic_year, "Academic year");
      await getEnv().DB.batch([
        getEnv().DB.prepare("INSERT INTO settings (key,value) VALUES ('school_name',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(schoolName),
        getEnv().DB.prepare("INSERT INTO settings (key,value) VALUES ('academic_year',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(academicYear),
      ]);
      await audit(auth.user.id, "update", "settings", undefined, { schoolName, academicYear });
    } else if (action === "delete") await deleteEntity(entity, cleanText(body.id), auth.user.id);
    else if (action === "clear_all") {
      if (body.confirmation !== "DELETE SCHOOL DATA") throw new Error("Type DELETE SCHOOL DATA to confirm.");
      await clearSchoolData(auth.user.id);
    } else throw new Error("The requested action is not supported.");
    return Response.json({ ok: true, id: id || undefined });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The record could not be saved.";
    const friendly = message.includes("UNIQUE constraint failed") ? "That admission, employee, or username value is already in use." : message;
    return Response.json({ error: friendly }, { status: 400 });
  }
}
