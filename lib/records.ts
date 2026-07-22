export function cleanText(value: unknown, fallback = "") {
  return String(value ?? fallback).trim();
}

export function cleanNumber(value: unknown, fallback = 0) {
  const parsed = typeof value === "number" ? value : Number(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function cleanDate(value: unknown) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const text = cleanText(value);
  if (!text) return "";
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? text : date.toISOString().slice(0, 10);
}

export function cleanId(value: unknown, prefix: string) {
  return cleanText(value) || `${prefix}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
}

export function classLabel(className: unknown, section: unknown) {
  const first = cleanText(className).toUpperCase();
  const second = cleanText(section).toUpperCase();
  if (!second || first.endsWith(`-${second}`)) return first;
  return `${first}-${second}`;
}

export function parseClasses(value: unknown) {
  if (Array.isArray(value)) return value.map((item) => cleanText(item).toUpperCase()).filter(Boolean);
  const text = cleanText(value);
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed.map((item) => cleanText(item).toUpperCase()).filter(Boolean);
  } catch {
    // Comma-separated Excel cells are the normal import format.
  }
  return text.split(/[,;|]/).map((item) => item.trim().toUpperCase()).filter(Boolean);
}

export function rows(value: unknown, limit = 5000): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, limit).filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item));
}
