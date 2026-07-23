import { requireUser } from "@/lib/auth";
import { getEnv } from "@/lib/database";
import { simplePdf } from "@/lib/pdf";

function money(value: unknown) {
  return `INR ${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(Number(value || 0))}`;
}

function response(bytes: Uint8Array, filename: string) {
  return new Response(bytes, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename.replace(/[^a-z0-9._-]/gi, "-")}"`,
      "Cache-Control": "private, no-store",
    },
  });
}

export async function GET(request: Request) {
  const auth = await requireUser(request);
  if ("error" in auth) return auth.error;
  const url = new URL(request.url);
  const type = url.searchParams.get("type");
  const db = getEnv().DB;
  const settingsRows = (await db.prepare("SELECT key,value FROM settings").all<{ key: string; value: string }>()).results || [];
  const settings = Object.fromEntries(settingsRows.map((row) => [row.key, row.value]));

  if (type === "receipt") {
    const id = url.searchParams.get("id") || "";
    const row = await db.prepare(`SELECT f.*,r.receipt_no,r.installment_label,s.name,s.admission_no,s.class_name,s.section,s.annual_fee,s.fee_paid
      FROM fee_installments f JOIN students s ON s.id=f.student_id LEFT JOIN payment_receipts r ON r.payment_id=f.id WHERE f.id=?`)
      .bind(id).first<Record<string, unknown>>();
    if (!row) return Response.json({ error: "Receipt was not found." }, { status: 404 });
    if (auth.user.role === "student" && row.student_id !== auth.user.studentId) return Response.json({ error: "This receipt belongs to another student." }, { status: 403 });
    if (auth.user.role === "teacher") return Response.json({ error: "Fee receipts are private." }, { status: 403 });
    const receiptNo = String(row.receipt_no || row.id);
    const classLabel = `${row.class_name}${row.section ? `-${row.section}` : ""}`;
    const balance = Math.max(0, Number(row.annual_fee || 0) - Number(row.fee_paid || 0));
    return response(simplePdf(`${settings.school_name || "School"} - Fee Receipt`, [
      `Receipt number: ${receiptNo}`,
      `Payment date: ${row.paid_on}`,
      `Student: ${row.name}`,
      `Admission number: ${row.admission_no}`,
      `Class: ${classLabel}`,
      `Installment: ${row.installment_label || "Fee payment"}`,
      `Amount received: ${money(row.amount)}`,
      `Payment mode: ${row.mode}`,
      `Reference: ${row.reference || "-"}`,
      `Current total paid: ${money(row.fee_paid)}`,
      `Current balance due: ${money(balance)}`,
      "",
      "This is a computer-generated receipt.",
      settings.address ? `School address: ${settings.address}` : "",
      settings.phone ? `School phone: ${settings.phone}` : "",
    ]), `receipt-${receiptNo}.pdf`);
  }

  if (type === "report-card") {
    const studentId = url.searchParams.get("studentId") || auth.user.studentId || "";
    const examName = url.searchParams.get("exam") || "";
    if (auth.user.role === "student" && studentId !== auth.user.studentId) return Response.json({ error: "This report belongs to another student." }, { status: 403 });
    const student = await db.prepare("SELECT * FROM students WHERE id=?").bind(studentId).first<Record<string, unknown>>();
    if (!student) return Response.json({ error: "Student record was not found." }, { status: 404 });
    if (auth.user.role === "teacher") {
      const teacher = await db.prepare("SELECT classes FROM teachers WHERE id=?").bind(auth.user.teacherId).first<{ classes: string }>();
      const assigned = JSON.parse(teacher?.classes || "[]") as string[];
      const label = `${student.class_name}${student.section ? `-${student.section}` : ""}`;
      if (!assigned.includes(label)) return Response.json({ error: "This student is outside your assigned classes." }, { status: 403 });
    }
    let results = (await db.prepare("SELECT * FROM exam_results WHERE student_id=? AND (?='' OR exam_name=?) ORDER BY exam_name,subject")
      .bind(studentId, examName, examName).all<Record<string, unknown>>()).results || [];
    if (!results.length) {
      const legacy = (await db.prepare("SELECT id,student_id,term AS exam_name,subject,marks,max_marks,NULL AS grade,NULL AS remarks FROM marks WHERE student_id=? AND (?='' OR term=?) ORDER BY term,subject")
        .bind(studentId, examName, examName).all<Record<string, unknown>>()).results || [];
      results = legacy;
    }
    if (!results.length) return Response.json({ error: "No published marks are available for this report." }, { status: 404 });
    const total = results.reduce((sum, row) => sum + Number(row.marks || 0), 0);
    const maximum = results.reduce((sum, row) => sum + Number(row.max_marks || 0), 0);
    const lines = [
      `Student: ${student.name}`,
      `Admission number: ${student.admission_no}`,
      `Class: ${student.class_name}${student.section ? `-${student.section}` : ""}`,
      `Examination: ${examName || "All published examinations"}`,
      "",
      ...results.map((row) => `${row.subject}: ${row.marks}/${row.max_marks}${row.grade ? `  Grade ${row.grade}` : ""}`),
      "",
      `Total: ${total}/${maximum}`,
      `Percentage: ${maximum ? (total / maximum * 100).toFixed(1) : "0.0"}%`,
      "",
      "This is a computer-generated academic report.",
    ];
    return response(simplePdf(`${settings.school_name || "School"} - Student Report`, lines), `report-${student.admission_no}-${examName || "all"}.pdf`);
  }

  return Response.json({ error: "Document type is invalid." }, { status: 400 });
}
