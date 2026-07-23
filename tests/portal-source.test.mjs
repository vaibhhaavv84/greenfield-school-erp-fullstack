import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("portal exposes every requested role and ERP module", async () => {
  const source = await readFile(new URL("app/components/PortalApp.tsx", root), "utf8");
  for (const value of ["admin", "teacher", "student", "Excel import", "Homework diary", "Fees", "Salary", "Attendance", "Marks", "Gallery", "Curriculum"]) {
    assert.match(source, new RegExp(value, "i"));
  }
  assert.match(source, /Download blank template/);
  assert.match(source, /Replace all data/);
});

test("server routes enforce role permissions", async () => {
  const [manage, homework, dashboard] = await Promise.all([
    readFile(new URL("app/api/admin/manage/route.ts", root), "utf8"),
    readFile(new URL("app/api/homework/route.ts", root), "utf8"),
    readFile(new URL("app/api/dashboard/route.ts", root), "utf8"),
  ]);
  assert.match(manage, /requireUser\(request, \["admin", "teacher"\]\)/);
  assert.match(manage, /This administrator action is not available in the teacher portal/);
  assert.match(homework, /requireUser\(request, \["admin", "teacher"\]\)/);
  assert.match(homework, /assigned classes/);
  assert.match(dashboard, /auth\.user\.role === "admin"/);
  assert.match(dashboard, /auth\.user\.role === "teacher"/);
});

test("database has no seeded student or faculty records", async () => {
  const database = await readFile(new URL("lib/database.ts", root), "utf8");
  assert.doesNotMatch(database, /INSERT INTO students .*VALUES/i);
  assert.doesNotMatch(database, /INSERT INTO teachers .*VALUES/i);
});

test("password hashing stays within the Cloudflare Workers PBKDF2 limit", async () => {
  const [auth, database] = await Promise.all([
    readFile(new URL("lib/auth.ts", root), "utf8"),
    readFile(new URL("lib/database.ts", root), "utf8"),
  ]);
  const iterations = auth.match(/const ITERATIONS = (\d+);/);
  assert.ok(iterations, "Password iteration constant is missing");
  assert.ok(Number(iterations[1]) <= 100000, "Cloudflare Workers supports at most 100,000 PBKDF2 iterations");
  assert.match(database, /password_iterations INTEGER NOT NULL DEFAULT 100000/);
});

test("full ERP records and durable uploads are wired", async () => {
  const [database, portal, media, documents] = await Promise.all([
    readFile(new URL("lib/database.ts", root), "utf8"),
    readFile(new URL("app/components/PortalApp.tsx", root), "utf8"),
    readFile(new URL("app/api/media/route.ts", root), "utf8"),
    readFile(new URL("app/api/documents/route.ts", root), "utf8"),
  ]);
  for (const table of ["school_classes", "teacher_profiles", "fee_plans", "fee_plan_items", "student_fee_plans", "payment_receipts", "attendance_records", "exam_schedules", "exam_results", "gallery_events", "media_assets"]) {
    assert.match(database, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  }
  for (const workflow of ["Create fee plan", "Save attendance", "Schedule exam", "Original marksheet", "Create event & upload", "Edit profile & logo"]) {
    assert.match(portal, new RegExp(workflow, "i"));
  }
  assert.match(media, /bucket\.put/);
  assert.match(media, /8 \* 1024 \* 1024/);
  assert.match(documents, /type === "receipt"/);
  assert.match(documents, /type === "report-card"/);
});

test("excel import supports the expanded master data", async () => {
  const source = await readFile(new URL("app/api/admin/import/route.ts", root), "utf8");
  for (const moduleName of ["classRows", "feePlanRows", "examRows", "resultRows", "teacher_profiles"]) {
    assert.match(source, new RegExp(moduleName));
  }
});
