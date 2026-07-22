"use client";

import { FormEvent, ReactNode, useEffect, useRef, useState } from "react";
import * as XLSX from "xlsx";
import {
  AlertCircle, BadgeCheck, Bell, BookMarked, BookOpenCheck, CalendarDays, Check,
  ChevronRight, CircleUserRound, ClipboardCheck, Download, Eye, EyeOff,
  FileSpreadsheet, GraduationCap, Image as ImageIcon, IndianRupee, KeyRound,
  LayoutDashboard, LockKeyhole, LogOut, Menu, Pencil, Plus, ReceiptText,
  RefreshCw, Search, Settings, ShieldCheck, School, Trash2, Upload, UserCog,
  Users, WalletCards, X,
} from "lucide-react";

type Role = "admin" | "teacher" | "student";
type Row = Record<string, unknown>;
type User = { id: number; username: string; displayName: string; role: Role; studentId: string | null; teacherId: string | null; mustChangePassword: boolean };
type AuthState = { authenticated: boolean; setupRequired: boolean; schoolName: string; academicYear: string; user: User | null };
type Dashboard = {
  user: User; settings: Record<string, string>; students?: Row[]; teachers?: Row[];
  installments?: Row[]; attendance?: Row[]; marks?: Row[]; homework?: Row[];
  curriculum?: Row[]; users?: Row[]; notices?: Row[]; gallery?: Row[]; audit?: Row[];
  student?: Row; teacher?: Row;
};
type ModalState = { kind: string; row?: Row } | null;

const SHEETS: Record<string, string[]> = {
  School: ["school_name", "academic_year"],
  Students: ["student_id", "admission_no", "name", "class_name", "section", "roll_no", "parent_name", "phone", "email", "address", "annual_fee", "fee_paid", "due_date", "attendance_percent"],
  Teachers: ["teacher_id", "employee_no", "name", "subject", "classes", "phone", "email", "monthly_salary", "salary_paid", "attendance_percent"],
  Accounts: ["role", "username", "temporary_password", "display_name", "student_id", "teacher_id"],
  Installments: ["installment_id", "student_id", "amount", "paid_on", "mode", "reference", "note"],
  Attendance: ["attendance_id", "person_type", "person_id", "attendance_date", "status", "note"],
  Marks: ["mark_id", "student_id", "term", "subject", "marks", "max_marks"],
  Homework: ["homework_id", "class_name", "subject", "teacher_id", "title", "instructions", "due_date"],
  Curriculum: ["class_name", "focus", "subjects"],
  Notices: ["notice_id", "title", "notice_date", "body", "audience"],
  Gallery: ["gallery_id", "title", "event_date", "image_url"],
};

const NAV = {
  admin: [
    ["overview", "Overview", LayoutDashboard], ["import", "Excel import", Upload],
    ["students", "Students", Users], ["fees", "Fees", WalletCards],
    ["faculty", "Faculty", GraduationCap], ["academics", "Academics", BookOpenCheck],
    ["accounts", "Login accounts", UserCog], ["notices", "Notices", Bell],
    ["settings", "Settings", Settings],
  ],
  teacher: [
    ["overview", "Overview", LayoutDashboard], ["homework", "Homework diary", BookOpenCheck],
    ["students", "My students", Users], ["salary", "Salary", WalletCards],
    ["curriculum", "Curriculum", BookMarked], ["notices", "Notices", Bell],
  ],
  student: [
    ["overview", "Overview", LayoutDashboard], ["homework", "Homework diary", BookOpenCheck],
    ["fees", "Fees", WalletCards], ["attendance", "Attendance", ClipboardCheck],
    ["marks", "Marks", BadgeCheck], ["gallery", "Gallery", ImageIcon],
    ["notices", "Notices", Bell], ["profile", "My profile", CircleUserRound],
  ],
} as const;

function text(row: Row | undefined, key: string, fallback = "") {
  const value = row?.[key];
  return value === null || value === undefined ? fallback : String(value);
}
function num(row: Row | undefined, key: string) {
  const value = Number(row?.[key] || 0);
  return Number.isFinite(value) ? value : 0;
}
function money(value: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(value);
}
function date(value: unknown) {
  if (!value) return "Not set";
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? String(value) : new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric" }).format(parsed);
}
function today() { return new Date().toISOString().slice(0, 10); }
function classes(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  const raw = String(value || "");
  try { const parsed = JSON.parse(raw); if (Array.isArray(parsed)) return parsed.map(String); } catch { /* comma-separated cells are supported */ }
  return raw.split(/[,;|]/).map((item) => item.trim()).filter(Boolean);
}
function className(row: Row | undefined) {
  const base = text(row, "class_name"); const section = text(row, "section");
  return section && !base.endsWith(`-${section}`) ? `${base}-${section}` : base;
}
async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...options, headers: { "Content-Type": "application/json", ...(options?.headers || {}) } });
  const payload = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error || "Something went wrong. Please try again.");
  return payload;
}
function values(form: HTMLFormElement) { return Object.fromEntries(new FormData(form).entries()); }

export default function PortalApp() {
  const [auth, setAuth] = useState<AuthState | null>(null);
  const [data, setData] = useState<Dashboard | null>(null);
  const [active, setActive] = useState("overview");
  const [menu, setMenu] = useState(false);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ tone: "success" | "error"; message: string } | null>(null);
  const [modal, setModal] = useState<ModalState>(null);

  async function loadData() { setData(await api<Dashboard>("/api/dashboard")); }
  async function loadAuth() {
    try {
      const next = await api<AuthState>("/api/auth/me"); setAuth(next);
      if (next.authenticated) await loadData(); else setData(null);
    } catch (error) { show("error", error instanceof Error ? error.message : "The portal could not load."); }
    finally { setLoading(false); }
  }
  useEffect(() => {
    let mounted = true;
    api<AuthState>("/api/auth/me")
      .then(async (next) => {
        if (!mounted) return;
        setAuth(next);
        if (next.authenticated) {
          const dashboard = await api<Dashboard>("/api/dashboard");
          if (mounted) setData(dashboard);
        } else {
          setData(null);
        }
      })
      .catch((error) => {
        if (mounted) setToast({ tone: "error", message: error instanceof Error ? error.message : "The portal could not load." });
      })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, []);
  function show(tone: "success" | "error", message: string) { setToast({ tone, message }); window.setTimeout(() => setToast(null), 5000); }
  async function logout() { await api("/api/auth/logout", { method: "POST", body: "{}" }); setData(null); setActive("overview"); await loadAuth(); }

  if (loading) return <Loading />;
  if (!auth) return <Fatal retry={() => { setLoading(true); void loadAuth(); }} />;
  if (auth.setupRequired) return <Setup done={loadAuth} />;
  if (!auth.authenticated || !auth.user) return <Login school={auth.schoolName} year={auth.academicYear} done={loadAuth} />;
  if (!data) return <Loading />;

  const role = auth.user.role;
  const nav = NAV[role];
  const school = data.settings.school_name || auth.schoolName;
  const year = data.settings.academic_year || auth.academicYear;
  return <div className="portal-shell">
    <aside className={`sidebar ${menu ? "is-open" : ""}`}>
      <div className="brand-lockup"><span className="brand-mark"><School size={23} /></span><span><strong>{school}</strong><small>School ERP</small></span><button className="icon-button sidebar-close" aria-label="Close navigation" onClick={() => setMenu(false)}><X size={20} /></button></div>
      <div className="role-badge"><ShieldCheck size={15} /><span>{role === "admin" ? "Main administrator" : `${role} portal`}</span></div>
      <nav className="main-nav" aria-label="Portal navigation">
        {nav.map(([id, label, Icon]) => <button key={id} className={active === id ? "active" : ""} onClick={() => { setActive(id); setMenu(false); }}><Icon size={19} /><span>{label}</span>{active === id && <ChevronRight size={16} className="nav-arrow" />}</button>)}
      </nav>
      <div className="sidebar-foot"><div className="session-chip"><CalendarDays size={16} /><span>Academic year</span><strong>{year}</strong></div><div className="signed-in"><span className="avatar">{auth.user.displayName.split(" ").map((part) => part[0]).slice(0, 2).join("").toUpperCase()}</span><span><strong>{auth.user.displayName}</strong><small>@{auth.user.username}</small></span><button className="icon-button inverse" aria-label="Sign out" title="Sign out" onClick={() => void logout()}><LogOut size={18} /></button></div></div>
    </aside>
    {menu && <button className="sidebar-scrim" aria-label="Close navigation" onClick={() => setMenu(false)} />}
    <main className="workspace">
      <header className="topbar"><button className="icon-button mobile-menu" aria-label="Open navigation" onClick={() => setMenu(true)}><Menu size={21} /></button><div><span className="eyebrow">{role === "admin" ? "School operations" : role === "teacher" ? "Teaching workspace" : "Student workspace"}</span><h1>{nav.find(([id]) => id === active)?.[1] || "Overview"}</h1></div><div className="topbar-actions"><button className="icon-button" aria-label="Refresh data" title="Refresh data" onClick={() => void loadData()}><RefreshCw size={18} /></button>{role === "admin" && <button className="primary-button desktop-action" onClick={() => setModal({ kind: "student" })}><Plus size={18} />Add student</button>}{role === "teacher" && <button className="primary-button desktop-action" onClick={() => setModal({ kind: "homework" })}><Plus size={18} />Homework</button>}</div></header>
      {toast && <div className={`toast ${toast.tone}`} role="status">{toast.tone === "success" ? <Check size={18} /> : <AlertCircle size={18} />}<span>{toast.message}</span><button aria-label="Close message" onClick={() => setToast(null)}><X size={16} /></button></div>}
      <div className="content-area">{role === "admin" && <Admin active={active} data={data} go={setActive} edit={setModal} reload={loadData} show={show} />}{role === "teacher" && <Teacher active={active} data={data} edit={setModal} reload={loadData} show={show} />}{role === "student" && <Student active={active} data={data} />}</div>
    </main>
    {auth.user.mustChangePassword && <ChangePassword done={loadAuth} />}
    {modal && <Editor modal={modal} data={data} role={role} close={() => setModal(null)} saved={async (message) => { setModal(null); await loadData(); show("success", message); }} />}
  </div>;
}

function Loading() { return <div className="loading-screen"><span className="brand-mark large"><School size={30} /></span><div className="spinner" /><p>Opening your school portal...</p></div>; }
function Fatal({ retry }: { retry: () => void }) { return <div className="auth-page"><section className="auth-card compact"><AlertCircle size={30} /><h1>Portal unavailable</h1><p>We could not connect to the school database.</p><button className="primary-button wide" onClick={retry}><RefreshCw size={18} />Try again</button></section></div>; }

function Setup({ done }: { done: () => Promise<void> }) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [show, setShow] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setBusy(true); setError(""); try { await api("/api/auth/setup", { method: "POST", body: JSON.stringify(values(event.currentTarget)) }); await done(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Setup failed."); } finally { setBusy(false); } }
  return <div className="auth-page setup-page"><AuthVisual line="One school. One trusted record." title="Your new ERP starts with a clean database." /><section className="auth-panel"><div className="auth-card"><span className="eyebrow">First-time setup</span><h1>Claim the administrator account</h1><p className="muted">This creates the only account that can import, edit, or remove school data.</p>{error && <FormError message={error} />}<form onSubmit={submit} className="form-grid"><Field label="School name" name="schoolName" placeholder="e.g. Greenfield Public School" required /><Field label="Academic year" name="academicYear" placeholder="2026-27" required /><Field label="Administrator name" name="displayName" required /><Field label="Admin username" name="username" autoComplete="username" required /><Password label="Admin password" name="password" show={show} toggle={setShow} autoComplete="new-password" /><Field label="One-time setup key" name="setupKey" type="password" required /><button className="primary-button wide" disabled={busy}>{busy ? <span className="button-spinner" /> : <ShieldCheck size={18} />}Create secure portal</button></form></div></section></div>;
}
function Login({ school, year, done }: { school: string; year: string; done: () => Promise<void> }) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [show, setShow] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setBusy(true); setError(""); try { await api("/api/auth/login", { method: "POST", body: JSON.stringify(values(event.currentTarget)) }); await done(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Login failed."); } finally { setBusy(false); } }
  return <div className="auth-page"><AuthVisual line={`${year} academic portal`} title={school} /><section className="auth-panel"><div className="auth-card"><div className="mobile-brand"><span className="brand-mark"><School size={23} /></span><strong>{school}</strong></div><span className="eyebrow">Secure school access</span><h1>Welcome back</h1><p className="muted">Use the username and password issued by your school administrator.</p>{error && <FormError message={error} />}<form onSubmit={submit} className="form-stack"><Field label="Username" name="username" autoComplete="username" required /><Password label="Password" name="password" show={show} toggle={setShow} autoComplete="current-password" /><button className="primary-button wide" disabled={busy}>{busy ? <span className="button-spinner" /> : <LockKeyhole size={18} />}Sign in</button></form><div className="login-trust"><ShieldCheck size={17} /><span>Your role controls exactly what you can see and change.</span></div></div></section></div>;
}
function AuthVisual({ line, title }: { line: string; title: string }) { return <div className="auth-visual" aria-hidden="true"><div className="auth-visual-copy"><span className="brand-mark large"><School size={30} /></span><p>{line}</p><h1>{title}</h1></div></div>; }
function ChangePassword({ done }: { done: () => Promise<void> }) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [show, setShow] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const body = values(event.currentTarget); if (body.newPassword !== body.confirmPassword) { setError("The new passwords do not match."); return; } setBusy(true); try { await api("/api/auth/change-password", { method: "POST", body: JSON.stringify(body) }); await done(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Password could not be changed."); } finally { setBusy(false); } }
  return <div className="modal-backdrop"><section className="modal-card password-modal" role="dialog" aria-modal="true"><span className="modal-icon"><KeyRound size={23} /></span><h2>Create your private password</h2><p>The administrator issued a temporary password. Replace it before opening your portal.</p>{error && <FormError message={error} />}<form onSubmit={submit} className="form-stack"><Password label="Current password" name="currentPassword" show={show} toggle={setShow} autoComplete="current-password" /><Field label="New password" name="newPassword" type={show ? "text" : "password"} required /><Field label="Confirm new password" name="confirmPassword" type={show ? "text" : "password"} required /><button className="primary-button wide" disabled={busy}>{busy ? <span className="button-spinner" /> : <Check size={18} />}Save new password</button></form></section></div>;
}
function FormError({ message }: { message: string }) { return <div className="form-alert"><AlertCircle size={17} />{message}</div>; }
function Field({ label, name, className: extra = "", ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label: string; name: string }) { return <label className={`field ${extra}`}><span>{label}</span><input name={name} {...props} /></label>; }
function Select({ label, name, children, defaultValue, required }: { label: string; name: string; children: ReactNode; defaultValue?: string; required?: boolean }) { return <label className="field"><span>{label}</span><select name={name} defaultValue={defaultValue} required={required}>{children}</select></label>; }
function Area({ label, name, defaultValue, placeholder, required }: { label: string; name: string; defaultValue?: string; placeholder?: string; required?: boolean }) { return <label className="field field-wide"><span>{label}</span><textarea name={name} defaultValue={defaultValue} placeholder={placeholder} required={required} rows={4} /></label>; }
function Password({ label, name, show, toggle, autoComplete }: { label: string; name: string; show: boolean; toggle: (value: boolean) => void; autoComplete: string }) { return <label className="field"><span>{label}</span><span className="password-input"><input name={name} type={show ? "text" : "password"} autoComplete={autoComplete} required /><button type="button" aria-label={show ? "Hide password" : "Show password"} onClick={() => toggle(!show)}>{show ? <EyeOff size={18} /> : <Eye size={18} />}</button></span></label>; }

function Metric({ icon, label, value, meta, tone }: { icon: ReactNode; label: string; value: string; meta: string; tone: string }) { return <article className="metric"><span className={`metric-icon ${tone}`}>{icon}</span><div><span>{label}</span><strong>{value}</strong><small>{meta}</small></div></article>; }
function PanelHead({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) { return <header className="panel-head"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>{action}</header>; }
function Empty({ message }: { message: string }) { return <div className="mini-empty"><FileSpreadsheet size={24} /><p>{message}</p></div>; }
function Table({ columns, empty, children }: { columns: string[]; empty: string; children: ReactNode }) { const has = Array.isArray(children) ? children.length > 0 : Boolean(children); return !has ? <Empty message={empty} /> : <div className="table-scroll"><table><thead><tr>{columns.map((item, index) => <th key={`${item}-${index}`}>{item}</th>)}</tr></thead><tbody>{children}</tbody></table></div>; }
function Toolbar({ query, setQuery, action }: { query: string; setQuery: (value: string) => void; action: ReactNode }) { return <div className="table-toolbar"><label className="search-box"><Search size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search records" aria-label="Search records" /></label>{action}</div>; }

function Admin({ active, data, go, edit, reload, show }: { active: string; data: Dashboard; go: (id: string) => void; edit: (value: ModalState) => void; reload: () => Promise<void>; show: (tone: "success" | "error", message: string) => void }) {
  const students = data.students || []; const teachers = data.teachers || [];
  if (active === "import") return <ImportPanel reload={reload} show={show} />;
  if (active === "students") return <Students rows={students} edit={edit} admin />;
  if (active === "fees") return <Fees students={students} installments={data.installments || []} edit={edit} />;
  if (active === "faculty") return <Faculty rows={teachers} edit={edit} />;
  if (active === "academics") return <Academics data={data} edit={edit} />;
  if (active === "accounts") return <Accounts data={data} edit={edit} />;
  if (active === "notices") return <Notices rows={data.notices || []} edit={edit} />;
  if (active === "settings") return <SettingsPanel data={data} edit={edit} />;
  const billed = students.reduce((sum, row) => sum + num(row, "annual_fee"), 0);
  const paid = students.reduce((sum, row) => sum + num(row, "fee_paid"), 0);
  const due = Math.max(0, billed - paid);
  const attendance = students.length ? students.reduce((sum, row) => sum + num(row, "attendance_percent"), 0) / students.length : 0;
  return <div className="view-stack"><section className="welcome-strip"><div><span className="eyebrow">Today at a glance</span><h2>Good {new Date().getHours() < 12 ? "morning" : new Date().getHours() < 17 ? "afternoon" : "evening"}, {data.user.displayName.split(" ")[0]}</h2><p>{students.length ? "Your live school records are ready for review." : "Your database is clean and ready for your school data."}</p></div><span className="welcome-date"><CalendarDays size={19} />{date(today())}</span></section>{!students.length && !teachers.length && <section className="onboarding-band"><span className="onboarding-icon"><FileSpreadsheet size={27} /></span><div><span className="eyebrow">Clean database</span><h2>Bring in your school records</h2><p>Download the workbook, fill it in Excel, and import every school module together.</p></div><div className="onboarding-actions"><button className="primary-button" onClick={() => go("import")}><Upload size={18} />Open Excel import</button><button className="secondary-button" onClick={() => edit({ kind: "student" })}><Plus size={18} />Add one student</button></div></section>}
    <section className="metric-grid"><Metric icon={<Users />} label="Students" value={String(students.length)} meta={`${new Set(students.map(className)).size} classes`} tone="green" /><Metric icon={<GraduationCap />} label="Faculty" value={String(teachers.length)} meta={`${data.users?.filter((row) => text(row, "role") === "teacher").length || 0} logins`} tone="blue" /><Metric icon={<IndianRupee />} label="Fees collected" value={money(paid)} meta={`${billed ? Math.round(paid / billed * 100) : 0}% received`} tone="gold" /><Metric icon={<WalletCards />} label="Outstanding" value={money(due)} meta={`${students.filter((row) => num(row, "annual_fee") > num(row, "fee_paid")).length} accounts`} tone="red" /></section>
    <div className="dashboard-grid"><section className="panel span-2"><PanelHead title="Fee collection" subtitle="Annual billed amount compared with received fees" action={<button className="text-button" onClick={() => go("fees")}>Open fees <ChevronRight size={16} /></button>} /><div className="collection-summary"><div className="donut" style={{ "--progress": `${billed ? Math.min(100, paid / billed * 100) : 0}%` } as React.CSSProperties}><span><strong>{billed ? Math.round(paid / billed * 100) : 0}%</strong><small>collected</small></span></div><div className="collection-lines"><div><span>Annual fees</span><strong>{money(billed)}</strong></div><div><span>Received</span><strong className="success-text">{money(paid)}</strong></div><div><span>Due</span><strong className="danger-text">{money(due)}</strong></div></div></div></section><section className="panel"><PanelHead title="Attendance" subtitle="Student average" /><div className="attendance-score"><strong>{attendance.toFixed(1)}%</strong><span>Current imported average</span><div className="progress-track"><span style={{ width: `${Math.min(100, attendance)}%` }} /></div></div></section><section className="panel span-2"><PanelHead title="Recent activity" subtitle="Latest administrator actions" />{data.audit?.length ? <div className="activity-list">{data.audit.slice(0, 6).map((row) => <div key={text(row, "id")}><span className="activity-dot" /><span><strong>{text(row, "action").replaceAll("_", " ")}</strong><small>{text(row, "entity")} {text(row, "entity_id")}</small></span><time>{date(text(row, "created_at"))}</time></div>)}</div> : <Empty message="No administrator activity yet." />}</section><section className="panel"><PanelHead title="Homework" subtitle="Published diary entries" /><div className="big-number">{data.homework?.length || 0}</div><button className="secondary-button wide" onClick={() => edit({ kind: "homework" })}><Plus size={17} />Publish homework</button></section></div>
  </div>;
}

function Students({ rows, edit, admin }: { rows: Row[]; edit: (value: ModalState) => void; admin?: boolean }) {
  const [query, setQuery] = useState(""); const filtered = rows.filter((row) => ["name", "admission_no", "class_name", "parent_name", "phone"].some((key) => text(row, key).toLowerCase().includes(query.toLowerCase())));
  return <section className="panel table-panel"><PanelHead title={admin ? "Student directory" : "My students"} subtitle={`${rows.length} school records`} /><Toolbar query={query} setQuery={setQuery} action={admin ? <button className="primary-button" onClick={() => edit({ kind: "student" })}><Plus size={18} />Add student</button> : <span />} /><Table empty="No students have been added yet." columns={["Student", "Class", "Parent", "Annual fee", "Paid", "Attendance", ...(admin ? [""] : [])]}>{filtered.map((row) => <tr key={text(row, "id")}><td data-label="Student"><strong>{text(row, "name")}</strong><small>{text(row, "admission_no")} - Roll {text(row, "roll_no")}</small></td><td data-label="Class"><span className="tag">{className(row)}</span></td><td data-label="Parent"><strong>{text(row, "parent_name")}</strong><small>{text(row, "phone")}</small></td><td data-label="Annual fee">{admin ? money(num(row, "annual_fee")) : "Private"}</td><td data-label="Paid">{admin ? money(num(row, "fee_paid")) : "Private"}</td><td data-label="Attendance">{num(row, "attendance_percent").toFixed(1)}%</td>{admin && <td data-label="Actions"><button className="icon-button" aria-label={`Edit ${text(row, "name")}`} onClick={() => edit({ kind: "student", row })}><Pencil size={17} /></button></td>}</tr>)}</Table></section>;
}

function Fees({ students, installments, edit }: { students: Row[]; installments: Row[]; edit: (value: ModalState) => void }) {
  const [query, setQuery] = useState(""); const filtered = students.filter((row) => `${text(row, "name")} ${text(row, "admission_no")}`.toLowerCase().includes(query.toLowerCase()));
  const paid = students.reduce((sum, row) => sum + num(row, "fee_paid"), 0); const billed = students.reduce((sum, row) => sum + num(row, "annual_fee"), 0);
  return <div className="view-stack"><section className="metric-grid compact-metrics"><Metric icon={<ReceiptText />} label="Annual billed" value={money(billed)} meta={`${students.length} students`} tone="blue" /><Metric icon={<IndianRupee />} label="Collected" value={money(paid)} meta={`${installments.length} receipts`} tone="green" /><Metric icon={<WalletCards />} label="Outstanding" value={money(Math.max(0, billed - paid))} meta="Offline records only" tone="red" /></section><section className="panel table-panel"><PanelHead title="Student fee ledger" subtitle="Record installments and track balances" /><Toolbar query={query} setQuery={setQuery} action={<button className="primary-button" disabled={!students.length} onClick={() => edit({ kind: "payment" })}><Plus size={18} />Record payment</button>} /><Table empty="Add or import students to start the fee ledger." columns={["Student", "Total fee", "Paid", "Balance", "Due date", ""]}>{filtered.map((row) => { const due = Math.max(0, num(row, "annual_fee") - num(row, "fee_paid")); return <tr key={text(row, "id")}><td data-label="Student"><strong>{text(row, "name")}</strong><small>{className(row)} - {text(row, "admission_no")}</small></td><td data-label="Total fee">{money(num(row, "annual_fee"))}</td><td data-label="Paid" className="success-text">{money(num(row, "fee_paid"))}</td><td data-label="Balance"><strong className={due ? "danger-text" : "success-text"}>{money(due)}</strong></td><td data-label="Due date">{date(text(row, "due_date"))}</td><td data-label="Actions"><button className="secondary-button small" onClick={() => edit({ kind: "payment", row })}><Plus size={15} />Payment</button></td></tr>; })}</Table></section><section className="panel table-panel"><PanelHead title="Recent receipts" subtitle="Latest fee installments" /><Table empty="No fee receipts recorded yet." columns={["Date", "Student ID", "Amount", "Mode", "Reference"]}>{installments.slice(0, 20).map((row) => <tr key={text(row, "id")}><td data-label="Date">{date(text(row, "paid_on"))}</td><td data-label="Student ID"><strong>{text(row, "student_id")}</strong></td><td data-label="Amount" className="success-text">{money(num(row, "amount"))}</td><td data-label="Mode">{text(row, "mode")}</td><td data-label="Reference">{text(row, "reference", "-")}</td></tr>)}</Table></section></div>;
}

function Faculty({ rows, edit }: { rows: Row[]; edit: (value: ModalState) => void }) {
  const [query, setQuery] = useState(""); const filtered = rows.filter((row) => `${text(row, "name")} ${text(row, "subject")} ${text(row, "employee_no")}`.toLowerCase().includes(query.toLowerCase()));
  return <section className="panel table-panel"><PanelHead title="Faculty directory" subtitle={`${rows.length} teacher and salary records`} /><Toolbar query={query} setQuery={setQuery} action={<button className="primary-button" onClick={() => edit({ kind: "teacher" })}><Plus size={18} />Add faculty</button>} /><Table empty="No faculty records have been added yet." columns={["Faculty member", "Subject", "Assigned classes", "Monthly salary", "Paid", "Attendance", ""]}>{filtered.map((row) => <tr key={text(row, "id")}><td data-label="Faculty"><strong>{text(row, "name")}</strong><small>{text(row, "employee_no")} - {text(row, "phone")}</small></td><td data-label="Subject">{text(row, "subject")}</td><td data-label="Classes"><div className="tag-list">{classes(row.classes).map((item) => <span className="tag" key={item}>{item}</span>)}</div></td><td data-label="Monthly salary">{money(num(row, "monthly_salary"))}</td><td data-label="Paid">{money(num(row, "salary_paid"))}</td><td data-label="Attendance">{num(row, "attendance_percent").toFixed(1)}%</td><td data-label="Actions"><button className="icon-button" aria-label={`Edit ${text(row, "name")}`} onClick={() => edit({ kind: "teacher", row })}><Pencil size={17} /></button></td></tr>)}</Table></section>;
}

function Academics({ data, edit }: { data: Dashboard; edit: (value: ModalState) => void }) {
  return <div className="view-stack">
    <div className="section-actions"><div><span className="eyebrow">Class planning</span><h2>Curriculum and homework diary</h2></div><div><button className="secondary-button" onClick={() => edit({ kind: "curriculum" })}><Plus size={17} />Curriculum</button><button className="primary-button" onClick={() => edit({ kind: "homework" })}><Plus size={17} />Homework</button></div></div>
    <section className="curriculum-grid">{data.curriculum?.length ? data.curriculum.map((row) => <article className="curriculum-card" key={text(row, "class_name")}><span className="class-tile">{text(row, "class_name")}</span><div><h3>{text(row, "focus")}</h3><p>{text(row, "subjects")}</p></div><button className="icon-button" aria-label={`Edit curriculum for ${text(row, "class_name")}`} onClick={() => edit({ kind: "curriculum", row })}><Pencil size={17} /></button></article>) : <section className="panel"><Empty message="No class curriculum imported yet." /></section>}</section>
    <section className="panel table-panel"><PanelHead title="Homework diary" subtitle={`${data.homework?.length || 0} entries`} /><Table empty="No homework has been published yet." columns={["Due", "Class", "Subject", "Homework", "Teacher"]}>{data.homework?.map((row) => <tr key={text(row, "id")}><td data-label="Due">{date(text(row, "due_date"))}</td><td data-label="Class"><span className="tag">{text(row, "class_name")}</span></td><td data-label="Subject">{text(row, "subject")}</td><td data-label="Homework"><strong>{text(row, "title")}</strong><small>{text(row, "instructions")}</small></td><td data-label="Teacher">{text(row, "teacher_name", text(row, "teacher_id"))}</td></tr>)}</Table></section>
    <section className="panel"><PanelHead title="Imported assessment records" subtitle="Marks remain controlled through the Excel workbook" /><div className="inline-stat"><BadgeCheck size={28} /><div><strong>{data.marks?.length || 0}</strong><span>subject mark entries</span></div></div></section>
  </div>;
}

function Accounts({ data, edit }: { data: Dashboard; edit: (value: ModalState) => void }) {
  const rows = data.users || [];
  return <section className="panel table-panel"><PanelHead title="Portal login accounts" subtitle="Only the main administrator can issue or reset credentials" action={<button className="primary-button" disabled={!data.students?.length && !data.teachers?.length} onClick={() => edit({ kind: "account" })}><Plus size={18} />Create login</button>} /><div className="security-note"><ShieldCheck size={19} /><div><strong>Temporary password policy</strong><p>Every new or reset account must create a private password at first sign-in.</p></div></div><Table empty="Create student or teacher records before issuing logins." columns={["Person", "Username", "Role", "Linked record", "Password status", ""]}>{rows.map((row) => <tr key={text(row, "id")}><td data-label="Person"><strong>{text(row, "display_name")}</strong></td><td data-label="Username"><code>{text(row, "username")}</code></td><td data-label="Role"><span className={`role-pill ${text(row, "role")}`}>{text(row, "role")}</span></td><td data-label="Linked record">{text(row, "student_id", text(row, "teacher_id", "Main account"))}</td><td data-label="Password status">{Number(row.must_change_password) ? <span className="status-warning">Change required</span> : <span className="status-ok">Private password</span>}</td><td data-label="Actions">{text(row, "role") !== "admin" && <button className="secondary-button small" onClick={() => edit({ kind: "account", row })}><KeyRound size={15} />Reset</button>}</td></tr>)}</Table></section>;
}

function Notices({ rows, edit }: { rows: Row[]; edit: (value: ModalState) => void }) {
  return <div className="view-stack"><div className="section-actions"><div><span className="eyebrow">School communication</span><h2>Notice board</h2></div><button className="primary-button" onClick={() => edit({ kind: "notice" })}><Plus size={18} />Publish notice</button></div>{rows.length ? <div className="notice-grid">{rows.map((row) => <article className="notice-card" key={text(row, "id")}><header><span className="role-pill">{text(row, "audience")}</span><time>{date(text(row, "notice_date"))}</time></header><h3>{text(row, "title")}</h3><p>{text(row, "body")}</p><button className="icon-button" aria-label={`Edit ${text(row, "title")}`} onClick={() => edit({ kind: "notice", row })}><Pencil size={17} /></button></article>)}</div> : <section className="panel"><Empty message="No notices have been published yet." /></section>}</div>;
}

function SettingsPanel({ data, edit }: { data: Dashboard; edit: (value: ModalState) => void }) {
  return <div className="settings-layout"><section className="panel"><PanelHead title="School profile" subtitle="Shown across every portal" /><dl className="detail-list"><div><dt>School name</dt><dd>{data.settings.school_name}</dd></div><div><dt>Academic year</dt><dd>{data.settings.academic_year}</dd></div><div><dt>Administrator</dt><dd>{data.user.displayName}</dd></div></dl><button className="secondary-button" onClick={() => edit({ kind: "settings" })}><Pencil size={17} />Edit school profile</button></section><section className="panel"><PanelHead title="Data control" subtitle="Your administrator account remains protected" /><div className="danger-zone"><span><strong>Clear all school records</strong><p>Removes students, faculty, accounts, fees, marks, attendance, homework, curriculum, notices, and gallery data.</p></span><button className="danger-button" onClick={() => edit({ kind: "clear" })}><Trash2 size={17} />Clear data</button></div></section></div>;
}

function ImportPanel({ reload, show }: { reload: () => Promise<void>; show: (tone: "success" | "error", message: string) => void }) {
  const input = useRef<HTMLInputElement>(null); const [file, setFile] = useState<File | null>(null); const [book, setBook] = useState<Record<string, Row[]> | null>(null); const [mode, setMode] = useState<"replace" | "merge">("replace"); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  function template() {
    const workbook = XLSX.utils.book_new();
    const notes = [["School ERP Excel Import"], ["Keep every sheet name and header unchanged."], ["IDs must stay unique and match across linked sheets."], ["Dates use YYYY-MM-DD. Teacher classes are comma-separated, for example 10-A,10-B."], ["Passwords need at least 8 characters with a letter and a number."], ["All data sheets contain headers only. No sample student data is included."]];
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(notes), "Instructions");
    Object.entries(SHEETS).forEach(([name, headers]) => XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([headers]), name));
    XLSX.writeFile(workbook, "school-erp-import-template.xlsx");
  }
  async function select(next?: File) {
    if (!next) return; setFile(next); setError("");
    if (next.size > 8 * 1024 * 1024) { setBook(null); setError("The workbook is larger than 8 MB. Split it into smaller imports."); return; }
    try {
      const workbook = XLSX.read(await next.arrayBuffer(), { type: "array", cellDates: true }); const parsed: Record<string, Row[]> = {};
      Object.keys(SHEETS).forEach((expected) => {
        const found = workbook.SheetNames.find((name) => name.toLowerCase() === expected.toLowerCase());
        if (!found) return;
        const rawRows = XLSX.utils.sheet_to_json<Row>(workbook.Sheets[found], { defval: "", raw: false });
        parsed[expected.toLowerCase()] = rawRows.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""), value])));
      });
      if (!Object.keys(parsed).length) throw new Error("No supported ERP sheets were found. Start with the portal template."); setBook(parsed);
    } catch (cause) { setBook(null); setError(cause instanceof Error ? cause.message : "The workbook could not be read."); }
  }
  async function submit() {
    if (!book) return; setBusy(true); setError("");
    try { const result = await api<{ counts: Record<string, number> }>("/api/admin/import", { method: "POST", body: JSON.stringify({ mode, data: book }) }); await reload(); setBook(null); setFile(null); if (input.current) input.current.value = ""; show("success", `Workbook imported: ${Object.values(result.counts).reduce((sum, value) => sum + value, 0)} records processed.`); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Import failed."); } finally { setBusy(false); }
  }
  const total = book ? Object.values(book).reduce((sum, rows) => sum + rows.length, 0) : 0;
  return <div className="import-layout"><section className="import-intro"><span className="sheet-icon"><FileSpreadsheet size={30} /></span><span className="eyebrow">One workbook, every module</span><h2>Import your school data from Excel</h2><p>The workbook feeds students, faculty, fees, attendance, marks, homework, curriculum, accounts, notices, and gallery records.</p><button className="secondary-button" onClick={template}><Download size={18} />Download blank template</button></section><section className="panel upload-panel"><PanelHead title="Upload completed workbook" subtitle="Excel .xlsx or .xls" /><button className={`drop-zone ${file ? "has-file" : ""}`} onClick={() => input.current?.click()} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); void select(event.dataTransfer.files[0]); }}>{file ? <><Check size={26} /><strong>{file.name}</strong><span>{total} populated rows found</span></> : <><Upload size={27} /><strong>Choose or drop your Excel file</strong><span>Up to 5,000 rows per sheet</span></>}</button><input ref={input} className="sr-only" type="file" accept=".xlsx,.xls" onChange={(event) => void select(event.target.files?.[0])} />{error && <FormError message={error} />}{book && <><div className="import-counts">{Object.entries(book).map(([name, rows]) => <div key={name}><span>{name}</span><strong>{rows.length}</strong></div>)}</div><fieldset className="mode-switch"><legend>Import behavior</legend><label><input type="radio" checked={mode === "replace"} onChange={() => setMode("replace")} /><span><strong>Replace all data</strong><small>Clear school records and use this workbook</small></span></label><label><input type="radio" checked={mode === "merge"} onChange={() => setMode("merge")} /><span><strong>Merge updates</strong><small>Update matching IDs and keep other records</small></span></label></fieldset><button className="primary-button wide" disabled={busy} onClick={() => void submit()}>{busy ? <span className="button-spinner" /> : <Upload size={18} />}{mode === "replace" ? "Replace data and import" : "Merge workbook data"}</button></>}</section><section className="panel sheet-guide"><PanelHead title="Workbook sheets" subtitle="Headers are prepared in the template" /><div>{Object.entries(SHEETS).map(([name, headers]) => <span key={name}><strong>{name}</strong><small>{headers.length} columns</small></span>)}</div></section></div>;
}

function Teacher({ active, data, edit, reload, show }: { active: string; data: Dashboard; edit: (value: ModalState) => void; reload: () => Promise<void>; show: (tone: "success" | "error", message: string) => void }) {
  const teacher = data.teacher; const students = data.students || []; const homework = data.homework || [];
  async function remove(id: string) { if (!window.confirm("Remove this homework entry?")) return; try { await api(`/api/homework?id=${encodeURIComponent(id)}`, { method: "DELETE" }); await reload(); show("success", "Homework removed."); } catch (error) { show("error", error instanceof Error ? error.message : "Homework could not be removed."); } }
  if (active === "homework") return <div className="view-stack"><div className="section-actions"><div><span className="eyebrow">Daily diary</span><h2>Homework for your classes</h2></div><button className="primary-button" onClick={() => edit({ kind: "homework" })}><Plus size={18} />Publish homework</button></div><HomeworkList rows={homework} remove={remove} /></div>;
  if (active === "students") return <Students rows={students} edit={() => undefined} />;
  if (active === "salary") return <div className="view-stack"><section className="metric-grid compact-metrics"><Metric icon={<IndianRupee />} label="Monthly salary" value={money(num(teacher, "monthly_salary"))} meta="Administration record" tone="blue" /><Metric icon={<WalletCards />} label="Salary paid" value={money(num(teacher, "salary_paid"))} meta="Current imported amount" tone="green" /><Metric icon={<ClipboardCheck />} label="Attendance" value={`${num(teacher, "attendance_percent").toFixed(1)}%`} meta="Faculty attendance" tone="gold" /></section><section className="panel"><PanelHead title="Salary record" subtitle="Changes are controlled by the administrator" /><Details rows={[["Employee number", text(teacher, "employee_no")], ["Subject", text(teacher, "subject")], ["Assigned classes", classes(teacher?.classes).join(", ") || "None"]]} /></section></div>;
  if (active === "curriculum") return <ReadCurriculum rows={data.curriculum || []} />;
  if (active === "notices") return <ReadNotices rows={data.notices || []} role="teacher" />;
  return <div className="view-stack"><section className="welcome-strip"><div><span className="eyebrow">Faculty workspace</span><h2>Hello, {data.user.displayName.split(" ")[0]}</h2><p>{text(teacher, "subject")} - {classes(teacher?.classes).join(", ") || "No classes assigned"}</p></div><span className="welcome-date"><CalendarDays size={19} />{date(today())}</span></section><section className="metric-grid"><Metric icon={<Users />} label="My students" value={String(students.length)} meta={`${classes(teacher?.classes).length} assigned classes`} tone="green" /><Metric icon={<BookOpenCheck />} label="Homework" value={String(homework.length)} meta="Published entries" tone="blue" /><Metric icon={<ClipboardCheck />} label="Attendance" value={`${num(teacher, "attendance_percent").toFixed(1)}%`} meta="Faculty attendance" tone="gold" /><Metric icon={<IndianRupee />} label="Salary paid" value={money(num(teacher, "salary_paid"))} meta="Administration record" tone="red" /></section><section className="panel table-panel"><PanelHead title="Recent homework" subtitle="Your latest diary entries" action={<button className="text-button" onClick={() => edit({ kind: "homework" })}>Publish <Plus size={16} /></button>} /><Table empty="Publish your first homework entry." columns={["Due", "Class", "Subject", "Homework"]}>{homework.slice(0, 6).map((row) => <tr key={text(row, "id")}><td data-label="Due">{date(text(row, "due_date"))}</td><td data-label="Class"><span className="tag">{text(row, "class_name")}</span></td><td data-label="Subject">{text(row, "subject")}</td><td data-label="Homework"><strong>{text(row, "title")}</strong><small>{text(row, "instructions")}</small></td></tr>)}</Table></section></div>;
}

function HomeworkList({ rows, remove }: { rows: Row[]; remove?: (id: string) => Promise<void> }) {
  return rows.length ? <section className="homework-list">{rows.map((row) => { const due = new Date(text(row, "due_date")); return <article className="homework-card" key={text(row, "id")}><div className="homework-date"><span>{Number.isNaN(due.getTime()) ? "-" : due.getDate()}</span><small>{Number.isNaN(due.getTime()) ? "" : due.toLocaleString("en-IN", { month: "short" })}</small></div><div><span className="tag">{text(row, "class_name", text(row, "subject"))}</span><h3>{text(row, "title")}</h3><p>{text(row, "instructions")}</p><small>{text(row, "subject")} - Due {date(text(row, "due_date"))}</small></div>{remove && <button className="icon-button danger-icon" aria-label="Remove homework" onClick={() => void remove(text(row, "id"))}><Trash2 size={17} /></button>}</article>; })}</section> : <section className="panel"><Empty message="There is no homework yet." /></section>;
}

function Student({ active, data }: { active: string; data: Dashboard }) {
  const student = data.student; const installments = data.installments || []; const attendance = data.attendance || []; const marks = data.marks || []; const homework = data.homework || [];
  const total = num(student, "annual_fee"); const paid = num(student, "fee_paid"); const due = Math.max(0, total - paid);
  if (active === "homework") return <HomeworkList rows={homework} />;
  if (active === "fees") return <div className="view-stack"><section className="fee-hero"><div><span>Outstanding balance</span><strong>{money(due)}</strong><p>Due date: {date(text(student, "due_date"))}</p></div><div className="fee-bar"><span style={{ width: `${total ? Math.min(100, paid / total * 100) : 0}%` }} /></div><dl><div><dt>Total annual fee</dt><dd>{money(total)}</dd></div><div><dt>Paid so far</dt><dd>{money(paid)}</dd></div></dl></section><section className="panel table-panel"><PanelHead title="Payment history" subtitle="Receipts recorded by the school office" /><Table empty="No fee installment is recorded yet." columns={["Paid on", "Amount", "Mode", "Reference", "Note"]}>{installments.map((row) => <tr key={text(row, "id")}><td data-label="Paid on">{date(text(row, "paid_on"))}</td><td data-label="Amount" className="success-text"><strong>{money(num(row, "amount"))}</strong></td><td data-label="Mode">{text(row, "mode")}</td><td data-label="Reference">{text(row, "reference", "-")}</td><td data-label="Note">{text(row, "note", "-")}</td></tr>)}</Table></section></div>;
  if (active === "attendance") return <div className="view-stack"><section className="metric-grid compact-metrics"><Metric icon={<ClipboardCheck />} label="Overall attendance" value={`${num(student, "attendance_percent").toFixed(1)}%`} meta="School record" tone="green" /><Metric icon={<Check />} label="Present entries" value={String(attendance.filter((row) => text(row, "status") === "present").length)} meta="Imported attendance" tone="blue" /><Metric icon={<CalendarDays />} label="Total entries" value={String(attendance.length)} meta="Latest records" tone="gold" /></section><section className="panel table-panel"><PanelHead title="Attendance history" subtitle="Most recent daily entries" /><Table empty="No detailed attendance has been imported yet." columns={["Date", "Status", "Note"]}>{attendance.map((row) => <tr key={text(row, "id")}><td data-label="Date">{date(text(row, "attendance_date"))}</td><td data-label="Status"><span className={`attendance-pill ${text(row, "status")}`}>{text(row, "status")}</span></td><td data-label="Note">{text(row, "note", "-")}</td></tr>)}</Table></section></div>;
  if (active === "marks") return <Marks rows={marks} />;
  if (active === "gallery") return <Gallery rows={data.gallery || []} />;
  if (active === "notices") return <ReadNotices rows={data.notices || []} role="student" />;
  if (active === "profile") return <Profile student={student} user={data.user} />;
  return <div className="view-stack"><section className="student-welcome"><div><span className="eyebrow">{className(student)} - Roll {text(student, "roll_no")}</span><h2>Hello, {text(student, "name").split(" ")[0]}</h2><p>Your school day, homework, fees, and results are together here.</p></div><span className="student-avatar">{text(student, "name").split(" ").map((part) => part[0]).slice(0, 2).join("")}</span></section><section className="metric-grid"><Metric icon={<ClipboardCheck />} label="Attendance" value={`${num(student, "attendance_percent").toFixed(1)}%`} meta="Overall attendance" tone="green" /><Metric icon={<BookOpenCheck />} label="Homework" value={String(homework.length)} meta="Diary entries" tone="blue" /><Metric icon={<IndianRupee />} label="Fees paid" value={money(paid)} meta={`${total ? Math.round(paid / total * 100) : 0}% of annual fee`} tone="gold" /><Metric icon={<WalletCards />} label="Fees due" value={money(due)} meta={`Due ${date(text(student, "due_date"))}`} tone="red" /></section><div className="dashboard-grid"><section className="panel span-2"><PanelHead title="Homework diary" subtitle="Your latest class work" /><div className="student-homework">{homework.slice(0, 4).map((row) => <div key={text(row, "id")}><span className="subject-mark">{text(row, "subject").slice(0, 2).toUpperCase()}</span><span><strong>{text(row, "title")}</strong><small>{text(row, "subject")} - Due {date(text(row, "due_date"))}</small></span></div>)}{!homework.length && <Empty message="No homework assigned yet." />}</div></section><section className="panel"><PanelHead title="Fee progress" subtitle="Annual account" /><div className="attendance-score"><strong>{total ? Math.round(paid / total * 100) : 0}%</strong><span>{money(due)} remaining</span><div className="progress-track"><span style={{ width: `${total ? Math.min(100, paid / total * 100) : 0}%` }} /></div></div></section></div></div>;
}

function Marks({ rows }: { rows: Row[] }) {
  const terms = [...new Set(rows.map((row) => text(row, "term")))];
  return <div className="view-stack">{terms.length ? terms.map((term) => { const termRows = rows.filter((row) => text(row, "term") === term); const scored = termRows.reduce((sum, row) => sum + num(row, "marks"), 0); const maximum = termRows.reduce((sum, row) => sum + num(row, "max_marks"), 0); return <section className="panel table-panel" key={term}><PanelHead title={term} subtitle={`${maximum ? (scored / maximum * 100).toFixed(1) : 0}% overall`} /><Table empty="No marks in this term." columns={["Subject", "Marks", "Maximum", "Percentage"]}>{termRows.map((row) => <tr key={text(row, "id")}><td data-label="Subject"><strong>{text(row, "subject")}</strong></td><td data-label="Marks">{num(row, "marks")}</td><td data-label="Maximum">{num(row, "max_marks")}</td><td data-label="Percentage"><span className="score-pill">{num(row, "max_marks") ? Math.round(num(row, "marks") / num(row, "max_marks") * 100) : 0}%</span></td></tr>)}</Table></section>; }) : <section className="panel"><Empty message="No marks have been imported for your account yet." /></section>}</div>;
}

// Gallery URLs come from school records, so their image hosts are not known at build time.
// eslint-disable-next-line @next/next/no-img-element
function Gallery({ rows }: { rows: Row[] }) { return rows.length ? <section className="gallery-grid">{rows.map((row) => <article className="gallery-card" key={text(row, "id")}><div className="gallery-image">{text(row, "image_url") ? <img src={text(row, "image_url")} alt={text(row, "title")} /> : <ImageIcon size={31} />}</div><div><h3>{text(row, "title")}</h3><p>{date(text(row, "event_date"))}</p></div></article>)}</section> : <section className="panel"><Empty message="School function photos will appear here." /></section>; }
function ReadNotices({ rows, role }: { rows: Row[]; role: "student" | "teacher" }) { const visible = rows.filter((row) => ["all", `${role}s`].includes(text(row, "audience"))); return visible.length ? <div className="notice-grid">{visible.map((row) => <article className="notice-card readonly" key={text(row, "id")}><header><span className="role-pill">{text(row, "audience")}</span><time>{date(text(row, "notice_date"))}</time></header><h3>{text(row, "title")}</h3><p>{text(row, "body")}</p></article>)}</div> : <section className="panel"><Empty message="There are no notices for you right now." /></section>; }
function ReadCurriculum({ rows }: { rows: Row[] }) { return rows.length ? <section className="curriculum-grid">{rows.map((row) => <article className="curriculum-card" key={text(row, "class_name")}><span className="class-tile">{text(row, "class_name")}</span><div><h3>{text(row, "focus")}</h3><p>{text(row, "subjects")}</p></div></article>)}</section> : <section className="panel"><Empty message="No curriculum has been assigned yet." /></section>; }
function Details({ rows }: { rows: [string, string][] }) { return <dl className="detail-list">{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>; }
function Profile({ student, user }: { student?: Row; user: User }) { return <div className="profile-layout"><section className="profile-summary"><span className="student-avatar large-avatar">{text(student, "name").split(" ").map((part) => part[0]).slice(0, 2).join("")}</span><h2>{text(student, "name")}</h2><p>{className(student)} - Roll {text(student, "roll_no")}</p><span className="role-pill student">Active student</span></section><section className="panel"><PanelHead title="Personal details" subtitle="Contact the school office to request corrections" /><Details rows={[["Admission number", text(student, "admission_no")], ["Login username", user.username], ["Parent / guardian", text(student, "parent_name")], ["Phone", text(student, "phone")], ["Email", text(student, "email", "Not provided")], ["Address", text(student, "address")]]} /></section></div>; }

function Editor({ modal, data, role, close, saved }: { modal: NonNullable<ModalState>; data: Dashboard; role: Role; close: () => void; saved: (message: string) => Promise<void> }) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const titles: Record<string, string> = { student: modal.row ? "Edit student" : "Add student", teacher: modal.row ? "Edit faculty" : "Add faculty", payment: "Record fee payment", account: modal.row ? "Reset login password" : "Create login account", notice: modal.row ? "Edit notice" : "Publish notice", curriculum: modal.row ? "Edit curriculum" : "Add curriculum", homework: "Publish homework", settings: "Edit school profile", clear: "Clear school data" };
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const dataValues = values(event.currentTarget);
      if (modal.kind === "homework") await api("/api/homework", { method: "POST", body: JSON.stringify(dataValues) });
      else await api("/api/admin/manage", { method: "POST", body: JSON.stringify({ action: modal.kind === "settings" ? "settings" : modal.kind === "clear" ? "clear_all" : "save", entity: modal.kind, data: dataValues, confirmation: dataValues.confirmation }) });
      await saved(modal.kind === "homework" ? "Homework published." : modal.kind === "payment" ? "Payment recorded." : modal.kind === "clear" ? "All school records were cleared." : "Changes saved.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Changes could not be saved."); }
    finally { setBusy(false); }
  }
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}><section className="modal-card editor-modal" role="dialog" aria-modal="true"><header className="modal-head"><div><span className="eyebrow">{role === "admin" ? "Administrator action" : "Teacher action"}</span><h2>{titles[modal.kind]}</h2></div><button className="icon-button" aria-label="Close" onClick={close}><X size={20} /></button></header>{error && <FormError message={error} />}<form onSubmit={submit} className="form-grid modal-form">
    {modal.kind === "student" && <StudentFields row={modal.row} />}
    {modal.kind === "teacher" && <TeacherFields row={modal.row} />}
    {modal.kind === "payment" && <PaymentFields row={modal.row} rows={data.students || []} />}
    {modal.kind === "account" && <AccountFields row={modal.row} data={data} />}
    {modal.kind === "notice" && <NoticeFields row={modal.row} />}
    {modal.kind === "curriculum" && <CurriculumFields row={modal.row} />}
    {modal.kind === "homework" && <HomeworkFields role={role} data={data} />}
    {modal.kind === "settings" && <><Field label="School name" name="school_name" defaultValue={data.settings.school_name} required /><Field label="Academic year" name="academic_year" defaultValue={data.settings.academic_year} required /></>}
    {modal.kind === "clear" && <><div className="danger-confirm field-wide"><AlertCircle size={22} /><div><strong>This cannot be undone</strong><p>The administrator login and school profile remain. Every other school record and login is removed.</p></div></div><Field label="Type DELETE SCHOOL DATA" name="confirmation" autoComplete="off" required className="field-wide" /></>}
    <div className="modal-actions"><button type="button" className="secondary-button" onClick={close}>Cancel</button><button className={modal.kind === "clear" ? "danger-button" : "primary-button"} disabled={busy}>{busy ? <span className="button-spinner" /> : modal.kind === "clear" ? <Trash2 size={17} /> : <Check size={17} />}{modal.kind === "clear" ? "Clear all records" : "Save"}</button></div>
  </form></section></div>;
}

function StudentFields({ row }: { row?: Row }) {
  return <><input type="hidden" name="id" defaultValue={text(row, "id")} /><Field label="Student name" name="name" defaultValue={text(row, "name")} required /><Field label="Admission number" name="admission_no" defaultValue={text(row, "admission_no")} required /><Field label="Class" name="class_name" defaultValue={text(row, "class_name")} placeholder="10" required /><Field label="Section" name="section" defaultValue={text(row, "section")} placeholder="A" /><Field label="Roll number" name="roll_no" defaultValue={text(row, "roll_no")} required /><Field label="Parent / guardian" name="parent_name" defaultValue={text(row, "parent_name")} required /><Field label="Phone" name="phone" defaultValue={text(row, "phone")} inputMode="tel" required /><Field label="Email" name="email" type="email" defaultValue={text(row, "email")} /><Field label="Annual fee" name="annual_fee" type="number" min="0" defaultValue={text(row, "annual_fee", "0")} required /><Field label="Fees paid" name="fee_paid" type="number" min="0" defaultValue={text(row, "fee_paid", "0")} required /><Field label="Fee due date" name="due_date" type="date" defaultValue={text(row, "due_date")} /><Field label="Attendance %" name="attendance_percent" type="number" min="0" max="100" step="0.1" defaultValue={text(row, "attendance_percent", "0")} /><Area label="Address" name="address" defaultValue={text(row, "address")} required /></>;
}
function TeacherFields({ row }: { row?: Row }) {
  return <><input type="hidden" name="id" defaultValue={text(row, "id")} /><Field label="Faculty name" name="name" defaultValue={text(row, "name")} required /><Field label="Employee number" name="employee_no" defaultValue={text(row, "employee_no")} required /><Field label="Main subject" name="subject" defaultValue={text(row, "subject")} required /><Field label="Assigned classes" name="classes" defaultValue={classes(row?.classes).join(",")} placeholder="8-A, 9-A, 10-B" required /><Field label="Phone" name="phone" defaultValue={text(row, "phone")} required /><Field label="Email" name="email" type="email" defaultValue={text(row, "email")} /><Field label="Monthly salary" name="monthly_salary" type="number" min="0" defaultValue={text(row, "monthly_salary", "0")} /><Field label="Salary paid" name="salary_paid" type="number" min="0" defaultValue={text(row, "salary_paid", "0")} /><Field label="Attendance %" name="attendance_percent" type="number" min="0" max="100" step="0.1" defaultValue={text(row, "attendance_percent", "0")} /></>;
}
function PaymentFields({ row, rows }: { row?: Row; rows: Row[] }) {
  return <><Select label="Student" name="student_id" defaultValue={text(row, "id")} required><option value="">Choose student</option>{rows.map((item) => <option value={text(item, "id")} key={text(item, "id")}>{text(item, "name")} - {text(item, "admission_no")}</option>)}</Select><Field label="Amount received" name="amount" type="number" min="1" required /><Field label="Payment date" name="paid_on" type="date" defaultValue={today()} required /><Select label="Payment mode" name="mode" defaultValue="Cash" required><option>Cash</option><option>UPI</option><option>Bank transfer</option><option>Cheque</option><option>Other</option></Select><Field label="Receipt / reference" name="reference" /><Area label="Note" name="note" /></>;
}
function AccountFields({ row, data }: { row?: Row; data: Dashboard }) {
  return <><Select label="Account role" name="role" defaultValue={text(row, "role", "student")} required><option value="student">Student</option><option value="teacher">Teacher</option></Select><Field label="Display name" name="display_name" defaultValue={text(row, "display_name")} required /><Field label="Username" name="username" defaultValue={text(row, "username")} readOnly={Boolean(row)} required /><Field label={row ? "New temporary password" : "Temporary password"} name="password" type="password" placeholder="At least 8 characters" required /><Select label="Link student record" name="student_id" defaultValue={text(row, "student_id")}><option value="">Not a student account</option>{data.students?.map((item) => <option value={text(item, "id")} key={text(item, "id")}>{text(item, "name")} - {text(item, "admission_no")}</option>)}</Select><Select label="Link teacher record" name="teacher_id" defaultValue={text(row, "teacher_id")}><option value="">Not a teacher account</option>{data.teachers?.map((item) => <option value={text(item, "id")} key={text(item, "id")}>{text(item, "name")} - {text(item, "employee_no")}</option>)}</Select><div className="field-hint field-wide"><KeyRound size={17} />The person must replace this temporary password at first login.</div></>;
}
function NoticeFields({ row }: { row?: Row }) { return <><input type="hidden" name="id" defaultValue={text(row, "id")} /><Field label="Notice title" name="title" defaultValue={text(row, "title")} required /><Field label="Notice date" name="notice_date" type="date" defaultValue={text(row, "notice_date", today())} required /><Select label="Audience" name="audience" defaultValue={text(row, "audience", "all")} required><option value="all">Everyone</option><option value="students">Students</option><option value="teachers">Teachers</option></Select><Area label="Notice details" name="body" defaultValue={text(row, "body")} required /></>; }
function CurriculumFields({ row }: { row?: Row }) { return <><Field label="Class" name="class_name" defaultValue={text(row, "class_name")} readOnly={Boolean(row)} placeholder="10-A" required /><Field label="Curriculum focus" name="focus" defaultValue={text(row, "focus")} placeholder="Board preparation and core skills" required /><Area label="Subjects" name="subjects" defaultValue={text(row, "subjects")} placeholder="English, Mathematics, Science..." required /></>; }
function HomeworkFields({ role, data }: { role: Role; data: Dashboard }) {
  const options = role === "teacher" ? classes(data.teacher?.classes) : [...new Set((data.students || []).map(className))];
  return <><Select label="Class" name="class_name" required><option value="">Choose class</option>{options.map((item) => <option key={item}>{item}</option>)}</Select>{role === "admin" && <Select label="Teacher" name="teacher_id" required><option value="">Choose teacher</option>{data.teachers?.map((item) => <option value={text(item, "id")} key={text(item, "id")}>{text(item, "name")} - {text(item, "subject")}</option>)}</Select>}<Field label="Subject" name="subject" defaultValue={role === "teacher" ? text(data.teacher, "subject") : ""} required /><Field label="Due date" name="due_date" type="date" defaultValue={today()} required /><Field label="Homework title" name="title" className="field-wide" required /><Area label="Instructions" name="instructions" required /></>;
}
