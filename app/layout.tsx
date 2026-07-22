import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "School ERP | Admin, Teacher and Student Portal",
  description: "A secure school ERP for student records, fees, salary, attendance, marks, homework, curriculum and notices.",
  icons: { icon: "/app-icon.svg", shortcut: "/app-icon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
