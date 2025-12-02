# Database Migration Plan

This document outlines how to move the project from encrypted JSON files to a MySQL-backed data layer powered by Prisma.

## 1. Environment Setup
- Declare each connection attribute on its own line inside `.env` for clarity:
   ```env
   DB_HOST=localhost
   DB_PORT=3306
   DB_USER=root
   DB_PASSWORD=
   DB_NAME=whatsapp
   DATABASE_URL=mysql://root:@localhost:3306/whatsapp
   ```
   (Leave `DB_PASSWORD` blank if the root account has no password; update `DATABASE_URL` whenever any DB_* value changes.)
- Use the new npm scripts:
   - `npm run prisma:generate` to generate the Prisma client.
   - `npm run prisma:migrate -- --name init` to create the initial migration locally.
   - `npm run prisma:deploy` in production after pushing migrations.

## 2. Data Model Coverage
The Prisma schema (`prisma/schema.prisma`) currently models:
- `User` accounts with roles and status flags.
- `Session` metadata plus `SessionToken` blobs (still encrypted with `TOKEN_ENCRYPTION_KEY`).
- Recipient list management via `RecipientList` and `Recipient` tables.
- Campaign orchestration through `Campaign` and `CampaignRecipient`.
- Auditing in `ActivityLog`.

Enums mirror existing runtime statuses so application logic can map directly without refactoring constants first.

## 3. Migration Strategy
1. **Generate tables**: run `npm run prisma:migrate -- --name init` after pointing `DATABASE_URL` at your MySQL instance.
2. **Bootstrap import scripts** (one per legacy store):
   - Read each `.enc` file or directory using the existing helper classes (they already know how to decrypt).
   - Transform to the corresponding Prisma model shape.
   - Use `prisma.$transaction` to insert data in batches (e.g., 500 recipients per batch) so the process is resumable.
3. **Refactor services incrementally**:
   - Start with `users.js`: replace the in-memory `Map` with Prisma CRUD calls.
   - Update session token utilities in `index.js` to persist via `Session`/`SessionToken` models.
   - Move `recipient-lists.js`, `campaigns.js`, and `activity-logger.js` over one by one, adding integration tests as you go.
4. **Cleanup**: once a module no longer touches filesystem storage, remove its `.enc` artifacts and guard legacy code with feature flags (if rollback might be needed).

## 4. Operational Notes
- Keep `TOKEN_ENCRYPTION_KEY` stable; reuse the AES helpers to encrypt sensitive columns before writing to MySQL.
- Configure database backups and connection pooling (e.g., `poolTimeout`, `connectionLimit`) according to workload.
- Document the rollout steps (run migrations → run import → restart server) so production deploys stay repeatable.

This plan establishes the database foundation; subsequent PRs should focus on refactoring each manager to use Prisma while preserving current behavior.
