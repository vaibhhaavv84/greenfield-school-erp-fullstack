import { isSameOrigin, requireUser } from "@/lib/auth";
import { audit, getEnv } from "@/lib/database";
import { cleanText, parseClasses } from "@/lib/records";

const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);
const MAX_FILE_SIZE = 8 * 1024 * 1024;

async function canManageTeacherOwner(teacherId: string | null, ownerType: string, ownerId: string) {
  if (!teacherId) return false;
  const db = getEnv().DB;
  if (ownerType === "homework") {
    const row = await db.prepare("SELECT teacher_id FROM homework WHERE id=?").bind(ownerId).first<{ teacher_id: string }>();
    return row?.teacher_id === teacherId;
  }
  if (ownerType === "marksheet") {
    const teacher = await db.prepare("SELECT classes FROM teachers WHERE id=?").bind(teacherId).first<{ classes: string }>();
    const student = await db.prepare("SELECT class_name,section FROM students WHERE id=?").bind(ownerId).first<{ class_name: string; section: string }>();
    const label = student ? `${student.class_name}${student.section ? `-${student.section}` : ""}` : "";
    return Boolean(student && parseClasses(teacher?.classes).includes(label));
  }
  return false;
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return Response.json({ error: "Invalid request origin" }, { status: 403 });
  const auth = await requireUser(request, ["admin", "teacher"]);
  if ("error" in auth) return auth.error;
  const bucket = getEnv().MEDIA;
  if (!bucket) return Response.json({ error: "File storage is not connected yet." }, { status: 503 });
  try {
    const form = await request.formData();
    const ownerType = cleanText(form.get("ownerType")).toLowerCase();
    const ownerId = cleanText(form.get("ownerId"));
    const kind = cleanText(form.get("kind"), "image").toLowerCase();
    if (!["homework", "gallery", "logo", "marksheet"].includes(ownerType) || !ownerId) throw new Error("Upload destination is invalid.");
    if (auth.user.role === "teacher" && !(await canManageTeacherOwner(auth.user.teacherId, ownerType, ownerId))) throw new Error("You cannot upload files to this record.");
    const files = form.getAll("files").filter((item): item is File => item instanceof File && item.size > 0);
    if (!files.length) throw new Error("Choose at least one image or PDF.");
    if (files.length > 12) throw new Error("Upload up to 12 files at a time.");
    const db = getEnv().DB;
    const uploaded: Array<Record<string, unknown>> = [];
    for (const file of files) {
      if (!ALLOWED_TYPES.has(file.type)) throw new Error(`${file.name} must be JPG, PNG, WebP, or PDF.`);
      if (file.size > MAX_FILE_SIZE) throw new Error(`${file.name} is larger than 8 MB.`);
      const id = crypto.randomUUID();
      const extension = file.name.split(".").pop()?.replace(/[^a-z0-9]/gi, "").toLowerCase() || "bin";
      const objectKey = `${ownerType}/${ownerId}/${id}.${extension}`;
      await bucket.put(objectKey, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });
      const now = new Date().toISOString();
      await db.prepare("INSERT INTO media_assets (id,owner_type,owner_id,kind,object_key,filename,mime_type,size_bytes,caption,uploaded_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
        .bind(id, ownerType, ownerId, kind, objectKey, file.name, file.type, file.size, cleanText(form.get("caption")) || null, auth.user.id, now).run();
      uploaded.push({ id, owner_type: ownerType, owner_id: ownerId, kind, filename: file.name, mime_type: file.type, url: `/api/media?id=${id}` });
    }
    if (ownerType === "logo") {
      const latest = uploaded.at(-1);
      if (latest) await db.prepare("INSERT INTO settings (key,value) VALUES ('logo_asset_id',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(String(latest.id)).run();
    }
    await audit(auth.user.id, "upload", ownerType, ownerId, { count: uploaded.length });
    return Response.json({ ok: true, assets: uploaded });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Files could not be uploaded." }, { status: 400 });
  }
}

export async function GET(request: Request) {
  const auth = await requireUser(request);
  if ("error" in auth) return auth.error;
  const bucket = getEnv().MEDIA;
  if (!bucket) return Response.json({ error: "File storage is not connected." }, { status: 503 });
  const url = new URL(request.url);
  const id = cleanText(url.searchParams.get("id"));
  const row = await getEnv().DB.prepare("SELECT * FROM media_assets WHERE id=?").bind(id).first<Record<string, unknown>>();
  if (!row) return Response.json({ error: "File was not found." }, { status: 404 });
  if (auth.user.role === "student" && row.owner_type === "marksheet" && row.owner_id !== auth.user.studentId) {
    return Response.json({ error: "This file belongs to another student." }, { status: 403 });
  }
  const object = await bucket.get(String(row.object_key));
  if (!object) return Response.json({ error: "Stored file was not found." }, { status: 404 });
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("Cache-Control", "private, max-age=300");
  if (url.searchParams.get("download") === "1") headers.set("Content-Disposition", `attachment; filename="${String(row.filename).replaceAll('"', "")}"`);
  return new Response(object.body, { headers });
}

export async function DELETE(request: Request) {
  if (!isSameOrigin(request)) return Response.json({ error: "Invalid request origin" }, { status: 403 });
  const auth = await requireUser(request, ["admin", "teacher"]);
  if ("error" in auth) return auth.error;
  const id = cleanText(new URL(request.url).searchParams.get("id"));
  const row = await getEnv().DB.prepare("SELECT * FROM media_assets WHERE id=?").bind(id).first<Record<string, unknown>>();
  if (!row) return Response.json({ error: "File was not found." }, { status: 404 });
  if (auth.user.role === "teacher" && !(await canManageTeacherOwner(auth.user.teacherId, String(row.owner_type), String(row.owner_id)))) {
    return Response.json({ error: "You cannot remove this file." }, { status: 403 });
  }
  if (getEnv().MEDIA) await getEnv().MEDIA!.delete(String(row.object_key));
  await getEnv().DB.prepare("DELETE FROM media_assets WHERE id=?").bind(id).run();
  await audit(auth.user.id, "delete", "media", id);
  return Response.json({ ok: true });
}
