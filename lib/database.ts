import { env } from "cloudflare:workers";

type SchoolEnv = {
  DB: D1Database;
  SETUP_KEY?: string;
};

export function getEnv(): SchoolEnv {
  return env as unknown as SchoolEnv;
}

let schemaPromise: Promise<void> | null = null;

const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','teacher','student')), password_hash TEXT NOT NULL, password_salt TEXT NOT NULL, password_iterations INTEGER NOT NULL DEFAULT 210000, student_id TEXT, teacher_id TEXT, must_change_password INTEGER NOT NULL DEFAULT 1, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL, expires_at INTEGER NOT NULL, created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS login_attempts (username TEXT PRIMARY KEY, failures INTEGER NOT NULL DEFAULT 0, locked_until INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS students (id TEXT PRIMARY KEY, admission_no TEXT NOT NULL UNIQUE, name TEXT NOT NULL, class_name TEXT NOT NULL, section TEXT NOT NULL, roll_no TEXT NOT NULL, parent_name TEXT NOT NULL, phone TEXT NOT NULL, email TEXT, address TEXT NOT NULL, annual_fee REAL NOT NULL DEFAULT 0, fee_paid REAL NOT NULL DEFAULT 0, due_date TEXT, attendance_percent REAL NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS teachers (id TEXT PRIMARY KEY, employee_no TEXT NOT NULL UNIQUE, name TEXT NOT NULL, subject TEXT NOT NULL, classes TEXT NOT NULL DEFAULT '[]', phone TEXT NOT NULL, email TEXT, monthly_salary REAL NOT NULL DEFAULT 0, salary_paid REAL NOT NULL DEFAULT 0, attendance_percent REAL NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS fee_installments (id TEXT PRIMARY KEY, student_id TEXT NOT NULL, amount REAL NOT NULL, paid_on TEXT NOT NULL, mode TEXT NOT NULL, reference TEXT, note TEXT, recorded_by INTEGER, created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS attendance (id TEXT PRIMARY KEY, person_type TEXT NOT NULL CHECK(person_type IN ('student','teacher')), person_id TEXT NOT NULL, attendance_date TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('present','absent','late','leave')), note TEXT)`,
  `CREATE TABLE IF NOT EXISTS marks (id TEXT PRIMARY KEY, student_id TEXT NOT NULL, term TEXT NOT NULL, subject TEXT NOT NULL, marks REAL NOT NULL, max_marks REAL NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS homework (id TEXT PRIMARY KEY, class_name TEXT NOT NULL, subject TEXT NOT NULL, teacher_id TEXT NOT NULL, title TEXT NOT NULL, instructions TEXT NOT NULL, due_date TEXT NOT NULL, created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS curriculum (class_name TEXT PRIMARY KEY, focus TEXT NOT NULL, subjects TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS notices (id TEXT PRIMARY KEY, title TEXT NOT NULL, notice_date TEXT NOT NULL, body TEXT NOT NULL, audience TEXT NOT NULL DEFAULT 'all', created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS gallery (id TEXT PRIMARY KEY, title TEXT NOT NULL, event_date TEXT NOT NULL, image_url TEXT, created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS audit_log (id TEXT PRIMARY KEY, user_id INTEGER, action TEXT NOT NULL, entity TEXT NOT NULL, entity_id TEXT, details TEXT, created_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id)`,
  `CREATE INDEX IF NOT EXISTS students_class_idx ON students(class_name, section)`,
  `CREATE INDEX IF NOT EXISTS homework_class_idx ON homework(class_name, due_date)`,
  `CREATE INDEX IF NOT EXISTS marks_student_idx ON marks(student_id)`,
  `CREATE INDEX IF NOT EXISTS attendance_person_idx ON attendance(person_type, person_id, attendance_date)`,
  `CREATE INDEX IF NOT EXISTS installments_student_idx ON fee_installments(student_id, paid_on)`,
];

export async function ensureSchema(): Promise<void> {
  if (!schemaPromise) {
    const db = getEnv().DB;
    schemaPromise = db.batch(schemaStatements.map((sql) => db.prepare(sql))).then(() => undefined).catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  await schemaPromise;
}

export async function audit(userId: number | null, action: string, entity: string, entityId?: string, details?: unknown) {
  await getEnv().DB.prepare("INSERT INTO audit_log (id,user_id,action,entity,entity_id,details,created_at) VALUES (?,?,?,?,?,?,?)")
    .bind(crypto.randomUUID(), userId, action, entity, entityId ?? null, details ? JSON.stringify(details) : null, new Date().toISOString())
    .run();
}

export async function runInChunks(statements: D1PreparedStatement[], size = 75) {
  const db = getEnv().DB;
  for (let index = 0; index < statements.length; index += size) {
    await db.batch(statements.slice(index, index + size));
  }
}
