import { ensureSchema, getEnv } from "@/lib/database";

export type Role = "admin" | "teacher" | "student";

export type SessionUser = {
  id: number;
  username: string;
  displayName: string;
  role: Role;
  studentId: string | null;
  teacherId: string | null;
  mustChangePassword: boolean;
};

const encoder = new TextEncoder();
// Cloudflare Workers currently caps Web Crypto PBKDF2 at 100,000 iterations.
const ITERATIONS = 100000;
const COOKIE_NAME = "greenfield_session";

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function randomHex(size: number) {
  const bytes = new Uint8Array(size);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

async function sha256(value: string) {
  return bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))));
}

export async function hashPassword(password: string, salt = randomHex(16), iterations = ITERATIONS) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: encoder.encode(salt), iterations }, key, 256);
  return { hash: bytesToHex(new Uint8Array(bits)), salt, iterations };
}

export async function verifyPassword(password: string, hash: string, salt: string, iterations: number) {
  const candidate = await hashPassword(password, salt, iterations);
  if (candidate.hash.length !== hash.length) return false;
  let difference = 0;
  for (let index = 0; index < hash.length; index += 1) difference |= hash.charCodeAt(index) ^ candidate.hash.charCodeAt(index);
  return difference === 0;
}

function readCookie(request: Request, name: string) {
  const cookie = request.headers.get("cookie") || "";
  for (const part of cookie.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

export function sessionCookie(request: Request, token: string, expiresAt: number) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.max(0, Math.floor((expiresAt - Date.now()) / 1000))}${secure}`;
}

export function clearSessionCookie(request: Request) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`;
}

export async function createSession(request: Request, userId: number) {
  const token = randomHex(32);
  const tokenHash = await sha256(token);
  const now = Date.now();
  const expiresAt = now + 7 * 24 * 60 * 60 * 1000;
  await getEnv().DB.batch([
    getEnv().DB.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(now),
    getEnv().DB.prepare("INSERT INTO sessions (token_hash,user_id,expires_at,created_at) VALUES (?,?,?,?)").bind(tokenHash, userId, expiresAt, new Date().toISOString()),
  ]);
  return sessionCookie(request, token, expiresAt);
}

export async function getSessionUser(request: Request): Promise<SessionUser | null> {
  await ensureSchema();
  const token = readCookie(request, COOKIE_NAME);
  if (!token) return null;
  const tokenHash = await sha256(token);
  const row = await getEnv().DB.prepare(`SELECT u.id,u.username,u.display_name,u.role,u.student_id,u.teacher_id,u.must_change_password FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.active=1`).bind(tokenHash, Date.now()).first<Record<string, unknown>>();
  if (!row) return null;
  return {
    id: Number(row.id),
    username: String(row.username),
    displayName: String(row.display_name),
    role: String(row.role) as Role,
    studentId: row.student_id ? String(row.student_id) : null,
    teacherId: row.teacher_id ? String(row.teacher_id) : null,
    mustChangePassword: Boolean(row.must_change_password),
  };
}

export async function requireUser(request: Request, roles?: Role[]) {
  const user = await getSessionUser(request);
  if (!user) return { error: Response.json({ error: "Authentication required" }, { status: 401 }) } as const;
  if (roles && !roles.includes(user.role)) return { error: Response.json({ error: "You do not have permission for this action" }, { status: 403 }) } as const;
  return { user } as const;
}

export async function deleteCurrentSession(request: Request) {
  const token = readCookie(request, COOKIE_NAME);
  if (token) await getEnv().DB.prepare("DELETE FROM sessions WHERE token_hash=?").bind(await sha256(token)).run();
}

export function normalizeUsername(value: unknown) {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, ".");
}

export function validatePassword(password: string) {
  if (password.length < 8) return "Password must contain at least 8 characters.";
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return "Password must contain a letter and a number.";
  return null;
}

export function isSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  return origin === new URL(request.url).origin;
}
