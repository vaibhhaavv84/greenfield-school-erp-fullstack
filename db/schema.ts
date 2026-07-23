import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  username: text("username").notNull().unique(),
  displayName: text("display_name").notNull(),
  role: text("role", { enum: ["admin", "teacher", "student"] }).notNull(),
  passwordHash: text("password_hash").notNull(),
  passwordSalt: text("password_salt").notNull(),
  passwordIterations: integer("password_iterations").notNull().default(100000),
  studentId: text("student_id"),
  teacherId: text("teacher_id"),
  mustChangePassword: integer("must_change_password", { mode: "boolean" }).notNull().default(true),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const sessions = sqliteTable("sessions", {
  tokenHash: text("token_hash").primaryKey(),
  userId: integer("user_id").notNull(),
  expiresAt: integer("expires_at").notNull(),
  createdAt: text("created_at").notNull(),
});

export const loginAttempts = sqliteTable("login_attempts", {
  username: text("username").primaryKey(),
  failures: integer("failures").notNull().default(0),
  lockedUntil: integer("locked_until").notNull().default(0),
  updatedAt: text("updated_at").notNull(),
});

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const students = sqliteTable("students", {
  id: text("id").primaryKey(),
  admissionNo: text("admission_no").notNull().unique(),
  name: text("name").notNull(),
  className: text("class_name").notNull(),
  section: text("section").notNull(),
  rollNo: text("roll_no").notNull(),
  parentName: text("parent_name").notNull(),
  phone: text("phone").notNull(),
  email: text("email"),
  address: text("address").notNull(),
  annualFee: real("annual_fee").notNull().default(0),
  feePaid: real("fee_paid").notNull().default(0),
  dueDate: text("due_date"),
  attendancePercent: real("attendance_percent").notNull().default(0),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const teachers = sqliteTable("teachers", {
  id: text("id").primaryKey(),
  employeeNo: text("employee_no").notNull().unique(),
  name: text("name").notNull(),
  subject: text("subject").notNull(),
  classes: text("classes").notNull().default("[]"),
  phone: text("phone").notNull(),
  email: text("email"),
  monthlySalary: real("monthly_salary").notNull().default(0),
  salaryPaid: real("salary_paid").notNull().default(0),
  attendancePercent: real("attendance_percent").notNull().default(0),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const feeInstallments = sqliteTable("fee_installments", {
  id: text("id").primaryKey(),
  studentId: text("student_id").notNull(),
  amount: real("amount").notNull(),
  paidOn: text("paid_on").notNull(),
  mode: text("mode").notNull(),
  reference: text("reference"),
  note: text("note"),
  recordedBy: integer("recorded_by"),
  createdAt: text("created_at").notNull(),
});

export const attendance = sqliteTable("attendance", {
  id: text("id").primaryKey(),
  personType: text("person_type", { enum: ["student", "teacher"] }).notNull(),
  personId: text("person_id").notNull(),
  attendanceDate: text("attendance_date").notNull(),
  status: text("status", { enum: ["present", "absent", "late", "leave"] }).notNull(),
  note: text("note"),
});

export const marks = sqliteTable("marks", {
  id: text("id").primaryKey(),
  studentId: text("student_id").notNull(),
  term: text("term").notNull(),
  subject: text("subject").notNull(),
  marks: real("marks").notNull(),
  maxMarks: real("max_marks").notNull(),
});

export const homework = sqliteTable("homework", {
  id: text("id").primaryKey(),
  className: text("class_name").notNull(),
  subject: text("subject").notNull(),
  teacherId: text("teacher_id").notNull(),
  title: text("title").notNull(),
  instructions: text("instructions").notNull(),
  dueDate: text("due_date").notNull(),
  createdAt: text("created_at").notNull(),
});

export const curriculum = sqliteTable("curriculum", {
  className: text("class_name").primaryKey(),
  focus: text("focus").notNull(),
  subjects: text("subjects").notNull(),
});

export const notices = sqliteTable("notices", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  noticeDate: text("notice_date").notNull(),
  body: text("body").notNull(),
  audience: text("audience").notNull().default("all"),
  createdAt: text("created_at").notNull(),
});

export const gallery = sqliteTable("gallery", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  eventDate: text("event_date").notNull(),
  imageUrl: text("image_url"),
  createdAt: text("created_at").notNull(),
});

export const auditLog = sqliteTable("audit_log", {
  id: text("id").primaryKey(),
  userId: integer("user_id"),
  action: text("action").notNull(),
  entity: text("entity").notNull(),
  entityId: text("entity_id"),
  details: text("details"),
  createdAt: text("created_at").notNull(),
});

export const schoolClasses = sqliteTable("school_classes", {
  id: text("id").primaryKey(),
  className: text("class_name").notNull(),
  section: text("section").notNull(),
  level: text("level").notNull(),
  classTeacherId: text("class_teacher_id"),
  subjects: text("subjects").notNull().default("[]"),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const teacherProfiles = sqliteTable("teacher_profiles", {
  teacherId: text("teacher_id").primaryKey(),
  category: text("category").notNull().default("Primary / Junior"),
  designation: text("designation").notNull().default("Teacher"),
  classTeacherClasses: text("class_teacher_classes").notNull().default("[]"),
  updatedAt: text("updated_at").notNull(),
});

export const feePlans = sqliteTable("fee_plans", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  academicYear: text("academic_year").notNull(),
  className: text("class_name").notNull(),
  section: text("section").notNull().default(""),
  totalAmount: real("total_amount").notNull(),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const feePlanItems = sqliteTable("fee_plan_items", {
  id: text("id").primaryKey(),
  planId: text("plan_id").notNull(),
  sequenceNo: integer("sequence_no").notNull(),
  label: text("label").notNull(),
  amount: real("amount").notNull(),
  dueDate: text("due_date").notNull(),
});

export const studentFeePlans = sqliteTable("student_fee_plans", {
  id: text("id").primaryKey(),
  studentId: text("student_id").notNull(),
  planId: text("plan_id").notNull(),
  assignedAmount: real("assigned_amount").notNull(),
  assignedAt: text("assigned_at").notNull(),
});

export const paymentReceipts = sqliteTable("payment_receipts", {
  paymentId: text("payment_id").primaryKey(),
  receiptNo: text("receipt_no").notNull().unique(),
  installmentLabel: text("installment_label"),
  createdAt: text("created_at").notNull(),
});

export const attendanceRecords = sqliteTable("attendance_records", {
  id: text("id").primaryKey(),
  personType: text("person_type", { enum: ["student", "teacher"] }).notNull(),
  personId: text("person_id").notNull(),
  attendanceDate: text("attendance_date").notNull(),
  status: text("status", { enum: ["present", "absent", "late", "half_day", "leave"] }).notNull(),
  note: text("note"),
  markedBy: integer("marked_by"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const examSchedules = sqliteTable("exam_schedules", {
  id: text("id").primaryKey(),
  examName: text("exam_name").notNull(),
  className: text("class_name").notNull(),
  section: text("section").notNull().default(""),
  subject: text("subject").notNull(),
  examDate: text("exam_date").notNull(),
  startTime: text("start_time").notNull(),
  endTime: text("end_time"),
  room: text("room"),
  syllabus: text("syllabus").notNull(),
  maxMarks: real("max_marks").notNull().default(100),
  published: integer("published", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const examResults = sqliteTable("exam_results", {
  id: text("id").primaryKey(),
  examId: text("exam_id"),
  examName: text("exam_name").notNull(),
  studentId: text("student_id").notNull(),
  subject: text("subject").notNull(),
  marks: real("marks").notNull(),
  maxMarks: real("max_marks").notNull(),
  grade: text("grade"),
  remarks: text("remarks"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const galleryEvents = sqliteTable("gallery_events", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  eventDate: text("event_date").notNull(),
  category: text("category").notNull().default("School event"),
  description: text("description"),
  published: integer("published", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const mediaAssets = sqliteTable("media_assets", {
  id: text("id").primaryKey(),
  ownerType: text("owner_type").notNull(),
  ownerId: text("owner_id").notNull(),
  kind: text("kind").notNull(),
  objectKey: text("object_key").notNull(),
  filename: text("filename").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  caption: text("caption"),
  uploadedBy: integer("uploaded_by"),
  createdAt: text("created_at").notNull(),
});
