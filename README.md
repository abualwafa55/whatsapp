# Super Light Web WhatsApp API Server

> Lightweight multi-session WhatsApp gateway with campaign tooling, Prisma/MySQL persistence, and an admin dashboard. Maintained by **@abualwafa**.

## Table of Contents

1. [Overview](#overview)
2. [Features at a Glance](#features-at-a-glance)
3. [Tech Stack](#tech-stack)
4. [Repository Layout](#repository-layout)
5. [Requirements](#requirements)
6. [Getting Started](#getting-started)
7. [Environment Variables](#environment-variables)
8. [Database & Prisma](#database--prisma)
9. [Runtime Scripts](#runtime-scripts)
10. [API Surface](#api-surface)
11. [Admin Dashboard](#admin-dashboard)
12. [Testing](#testing)
13. [Deployment Notes](#deployment-notes)
14. [Troubleshooting](#troubleshooting)
15. [Contributing](#contributing)
16. [License](#license)

## Overview

This service wraps the `@whiskeysockets/baileys` library with an Express API, Prisma-backed persistence, and a browser-based dashboard. It is tailored for small teams that need to:

- Spin up multiple WhatsApp sessions with QR-code onboarding.
- Manage recipient lists and outbound campaigns (CSV upload, scheduling, retry logic).
- Secure the control panel with role-based access plus server-side rate limiting.
- Integrate the WhatsApp events pipeline with existing systems via webhooks.

## Features at a Glance

- Multi-session Baileys connector with WebSocket updates and tokenized REST access.
- Admin SPA (`/admin`) featuring login, campaigns, activities, and user management views.
- Recipient list storage, CSV import/export, and templated campaign payloads.
- Prisma/MySQL data layer covering users, sessions, session tokens, campaigns, recipients, and audit trails.
- Activity logger that records logins, session lifecycle events, and campaign actions.
- Middleware hardening (Helmet, express-rate-limit, CSRF hook, sanitize-html) plus optional master API key.
- Media handling via Multer with storage in `media/` (auto-created) and campaign media buckets.
- Legacy compatibility layer that migrates `users.enc` into the database when `TOKEN_ENCRYPTION_KEY` is provided.

## Tech Stack

- Node.js 18+ (Baileys v7 requires a modern runtime).
- Express 4, WebSocket (ws), Helmet, express-session + session-file-store.
- Prisma ORM targeting MySQL 8 (or MariaDB 10.6+ with compatible features).
- Jest + Supertest for API smoke checks.
- Front-end assets served from `admin/` (vanilla JS + Bootstrap).

## Repository Layout

```
.
├─ index.js                  # Primary server bootstrap (Express, WS, Baileys lifecycle)
├─ api_v1.js                 # REST + dashboard APIs (sessions, campaigns, recipients)
├─ legacy_api.js             # Backwards-compat endpoints
├─ campaigns.js              # Campaign CRUD + scheduler helpers
├─ campaign-sender.js        # Campaign execution engine
├─ recipient-lists.js        # Recipient list ingestion and storage
├─ users.js                  # User manager with legacy file migration
├─ activity-logger.js        # Audit logging utilities
├─ prisma/                   # Prisma schema, migrations, seed script
├─ admin/                    # Dashboard HTML, CSS, JS bundles
├─ media/                    # Uploaded files (gitignored)
├─ sessions/                 # Session-store artifacts (gitignored)
├─ tests/index.test.js       # Minimal Jest suite
└─ docs/database-migration-plan.md
```

## Requirements

- **Node.js**: 18.17.0 or newer (LTS recommended).
- **npm**: 9.x or newer.
- **Database**: MySQL 8 (or MariaDB 10.6+) reachable via `DATABASE_URL`.
- **System dependencies**: Git, OpenSSL (or similar) to generate crypto keys.

## Getting Started

1. **Install dependencies**
   ```bash
   npm install
   # or run the smarter script that retries optional deps
   npm run install:smart
   ```
2. **Create `.env`** in the project root (see [Environment Variables](#environment-variables)).
3. **Generate Prisma client**
   ```bash
   npm run prisma:generate
   ```
4. **Run migrations**
   ```bash
   npm run prisma:migrate -- --name init
   ```
5. **Seed the admin user** (default: `admin@admin.com` / `123456789`)
   ```bash
   npm run prisma:seed
   ```
6. **Start the server**
   ```bash
   npm run dev       # Nodemon watch mode
   npm start         # Production-style single process
   ```

## Environment Variables

| Variable | Description | Default |
| --- | --- | --- |
| `PORT` | HTTP port for Express | `3100`
| `NODE_ENV` | `development` or `production` | `development`
| `DATABASE_URL` | Prisma datasource string (`mysql://user:pass@host:port/db`) | —
| `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | Optional discrete DB settings for scripts/logging | —
| `TOKEN_ENCRYPTION_KEY` | 64-char hex key used for session tokens, legacy file import, and campaign secrets | Random per boot (strongly recommended to pin)
| `SESSION_SECRET` | Express-session secret | `change_this_secret`
| `ADMIN_DASHBOARD_PASSWORD` | Legacy single password for `/admin/login` fallback | —
| `MASTER_API_KEY` | Required header (`x-master-key`) for unauthenticated session creation | —
| `WEBHOOK_URL` | Default webhook for inbound events per session | empty string
| `TRUST_PROXY` | Express `trust proxy` setting (number, `loopback`, or `false`) | `loopback`
| `MAX_SESSIONS` | Upper bound for concurrently managed WhatsApp sessions | `10`
| `SESSION_TIMEOUT_HOURS` | Idle timeout before sessions are recycled | `24`
| `SESSION_STORE_PATH` | Override path for file-store sessions (defaults to `./sessions`) | —

**Generate a strong encryption key**
```bash
# 32 bytes -> 64 hex chars
openssl rand -hex 32
```
Add the value to `.env` as `TOKEN_ENCRYPTION_KEY=<output>` before launching in production.

## Database & Prisma

- Schema lives in `prisma/schema.prisma` and covers users, sessions, tokens, recipient lists, campaigns, campaign recipients, and activity logs.
- Migrations are tracked under `prisma/migrations/`. Use `npm run prisma:migrate -- --name <label>` during development and `npm run prisma:deploy` in production.
- The seed script (`prisma/seed.js`) ensures an admin user exists. Update the email/password there if you need different bootstrap credentials.
- Refer to `docs/database-migration-plan.md` for detailed guidance on moving data from encrypted files (`*.enc`) into MySQL.

## Runtime Scripts

| Script | Purpose |
| --- | --- |
| `npm start` | Launches `index.js` once (suitable for containers or dev servers).
| `npm run dev` | Nodemon watcher for rapid iteration.
| `npm run start:prod` | Loads dotenv, uses production defaults.
| `npm run start:prod:windows` / `start:prod:unix` | OS-specific helpers used by `start-production.*` wrappers.
| `npm run prisma:generate` | Regenerates the Prisma client after schema tweaks.
| `npm run prisma:migrate` | Creates local migrations (`-- --name your_label`).
| `npm run prisma:deploy` | Applies pending migrations in production.
| `npm run prisma:seed` | Seeds the admin account.
| `npm test` | Executes the Jest smoke tests in `tests/index.test.js`.

The repository also ships `ecosystem.config.js` for PM2 deployments (restart policies, heap caps, log file locations).

## API Surface

- Core endpoints are documented in `api_documentation.html` (served at `/api-documentation`). Use it for parameter references and sample payloads.
- Session management (create, inspect, delete) lives under `/api/v1/sessions` with bearer tokens generated per session.
- Campaign management endpoints (`/api/v1/campaigns`, `/api/v1/recipient-lists`, `/api/v1/campaigns/check-scheduled`, etc.) require an authenticated dashboard session.
- Webhook delivery URL defaults to `WEBHOOK_URL` but can be overridden per session via the API.
- A WebSocket endpoint (`/ws`) streams session state changes to the dashboard; clients authenticate with short-lived tokens issued at login.

## Admin Dashboard

- Static assets under `admin/` provide login, campaigns, users, and activity views.
- Login accepts either the legacy `ADMIN_DASHBOARD_PASSWORD` or user-specific credentials stored in the database.
- Successful login mints a server-side session stored via `express-session` and `session-file-store` (see `sessions/`).
- Dashboard JS (`admin/js/*.js`) consumes the same API routes, so any reverse proxy must expose both `/admin` and `/api` paths.

## Testing

- Tests live in `tests/index.test.js` and rely on Jest + Supertest.
- Run `npm test` to execute the suite. Ensure the server is not already binding the configured port; the tests spin up the Express app directly from `index.js`.
- Expand coverage by adding more Supertest calls or by mocking Prisma for unit-level checks.

## Deployment Notes

- Use PM2 with `ecosystem.config.js` or a similar process manager that respects `NODE_OPTIONS="--max-old-space-size=1024"`.
- Reverse proxies (Nginx, Caddy, Cloudflare) should forward `X-Forwarded-*` headers and set `TRUST_PROXY` accordingly.
- Persist `media/` and `sessions/` directories between restarts if you need uploaded files and active session storage.
- Rotate `MASTER_API_KEY`, `SESSION_SECRET`, and `TOKEN_ENCRYPTION_KEY` via standard secret management tooling. Restart the process after updating secrets.
- Configure automatic backups for the MySQL schema, especially the `SessionToken` and `ActivityLog` tables.

## Troubleshooting

- **Baileys import fails**: Confirm Node.js >= 18 and reinstall dependencies (`npm rebuild` may help on Windows).
- **Random encryption key warning**: Generate and persist `TOKEN_ENCRYPTION_KEY` before booting; otherwise session tokens regenerate on restart.
- **Too many requests**: Adjust the rate limiter in both `index.js` and `api_v1.js` if your deployment sits behind a noisy proxy.
- **Legacy users not visible**: Place `users.enc` alongside `users.js`, set `TOKEN_ENCRYPTION_KEY`, and restart; the file will be migrated to MySQL and renamed to `.bak`.
- **WebSocket 403**: Ensure dashboard clients include the temporary token returned at login and that proxies forward upgrade requests to `/ws`.

## Contributing

1. Fork and branch from `main`.
2. Run lint/tests (`npm test`) before opening a PR.
3. Include migration files for any Prisma schema change.
4. Document new endpoints inside `api_documentation.html` and link them from this README if they are major additions.

## License

Released under the MIT License. See `package.json` for attribution. Maintainer contact: **@abualwafa**.
