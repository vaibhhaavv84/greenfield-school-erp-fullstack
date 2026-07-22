# School ERP Platform

A server-backed ERP for one school with separate administrator, teacher, and student accounts.

## Included

- Clean D1 database with no demo students or faculty
- One-time main administrator setup
- Password-protected role accounts with forced password change
- Excel template and replace/merge import
- Student records, fee installments, attendance, marks, profile, gallery, and notices
- Faculty records, salary ledger, assigned classes, and curriculum
- Teacher-only homework publishing
- Responsive desktop and mobile web interface

## Local development

1. Copy `.env.example` to `.dev.vars` and set a private `SETUP_KEY`.
2. Run `pnpm install`.
3. Run `pnpm dev`.
4. Open the local URL and use the setup key once to create the main administrator.

The administrator can download the blank Excel workbook from **Excel import**, populate it, and upload it in **Replace all data** mode. Student and teacher usernames and temporary passwords are created from the `Accounts` sheet or the **Login accounts** screen.

## Deployment

This project needs a server runtime and D1 database. GitHub Pages can store the source but cannot securely run the login/database layer. Deploy through OpenAI Sites and set `SETUP_KEY` as a server environment variable.
