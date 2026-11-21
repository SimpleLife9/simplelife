# Supabase migration baseline recovery

**Date:** 21 November 2026  
**Remote source inspected read-only:** `Simplelife_dev` / project ref `iybnjrnysiikbtokyshg` / PostgreSQL 17.12  
**Status:** FORWARD MIGRATION SOURCE RECOVERED EXACTLY / CLI REPLAY VALIDATION PENDING

## Recovery method

The six applied migration records were read from `supabase_migrations.schema_migrations` using read-only SQL. For every version, the stored `statements[1]` body was copied verbatim into its conventional versioned file under `supabase/migrations/`.

Each repository file was then fetched back from the recovery branch and compared character-for-character with the corresponding remote `statements[1]` value. All six comparisons were exact matches. No SQL was executed during this recovery.

## Recovered migration files

| Version | Name | Characters | Exact remote match |
|---|---|---:|---|
| `20261119124048` | `simplelife_personal_core_v1` | 14,710 | PASS |
| `20261119124130` | `simplelife_core_rls_and_permissions_v1` | 9,043 | PASS |
| `20261119124200` | `restrict_rls_automation_function_v1` | 85 | PASS |
| `20261119132044` | `simplelife_restrict_client_column_updates_v1` | 2,030 | PASS |
| `20261119132635` | `simplelife_core_foreign_key_indexes_v1` | 3,010 | PASS |
| `20261119133009` | `simplelife_default_acl_restrictions_v1` | 306 | PASS |

## Important rollback limitation

The remote `rollback` column was `NULL` for all six historic migrations. The recovery therefore restores only the exact forward SQL; it does not invent down-migrations or claim the old baseline is reversible.

Before applying any new Agenda migration:
1. Merge and review this source recovery.
2. Validate the local Supabase CLI configuration and run the CLI migration-list/status comparison against the linked development project in read-only mode.
3. Confirm the six local versions are recognized as already applied remotely and that no pending or divergent migration is reported.
4. Keep any database-changing `db push` or `apply_migration` behind an explicit, separately reviewed authorization gate.
5. For every new Agenda change, document a safe forward recovery and a tested rollback/compensation strategy before DDL. Do not assume the six recovered historical migrations have rollback scripts.

## Configuration

`supabase/config.toml` supplies only the local CLI project identifier and matching PostgreSQL major version. It contains no database password, access token, service-role key, API secret or environment-specific credential.

## Scope of this recovery

- No hosted schema change, migration execution, SQL write, data modification, RLS/grant update, Auth change, secret change or deployment was performed.
- The source is recovered from the exact statement history the target project says it applied; it is not a reconstructed approximation from the current catalog.
- A clean local replay has not yet been run. That is a separate validation gate, not implied by exact source comparison.
