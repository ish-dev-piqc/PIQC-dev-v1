# Local isolated Supabase — setup runbook

**Goal:** a full Supabase stack on localhost carrying the same schema as prod, used as the
proving ground for `fable/narrative-first`, with no path back to production or GitHub.

**Audience:** founder + Ishika. Written against this Mac's actual state (no Docker, no
Homebrew, no Supabase CLI, no system node).

---

## 0. Security preconditions — do these first

1. **Rotate the production `service_role` key** (Supabase dashboard → Settings → API →
   Service Role → Rotate). It was transmitted in plaintext through chat. Update any
   legitimate consumer afterwards (edge function secrets, CI).
2. **The production service role key is not used anywhere in this runbook.** Local
   Supabase issues its own. If you ever find a prod key in a local `.env`, the isolation
   is broken — that is the single most likely way this setup leaks.
3. **Schema only, never data.** Nothing here copies rows out of production. Prod holds
   real study data; a local copy of it would be a PHI incident, not a convenience.

---

## 1. Prerequisites (manual install — one time)

### Docker Desktop — required

Local Supabase is ~10 Docker containers (Postgres, GoTrue, PostgREST, Realtime, Storage,
Studio, Kong). Without Docker there is no local stack.

Download for Apple Silicon: https://www.docker.com/products/docker-desktop/
Install, launch it, and confirm the whale icon shows "running" before continuing.

```bash
docker info >/dev/null 2>&1 && echo "docker OK" || echo "docker NOT running"
```

Give Docker at least **8 GB RAM** in Settings → Resources. The stack is heavy.

### Supabase CLI — no Homebrew or npm needed

This machine has neither, so install the release binary directly:

```bash
mkdir -p ~/.local/bin && \
curl -L https://github.com/supabase/cli/releases/latest/download/supabase_darwin_arm64.tar.gz \
  -o /tmp/supabase.tar.gz && \
tar -xzf /tmp/supabase.tar.gz -C ~/.local/bin supabase && \
chmod +x ~/.local/bin/supabase && \
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.zshrc && \
export PATH="$HOME/.local/bin:$PATH" && supabase --version
```

macOS may quarantine the binary. If it refuses to run:

```bash
xattr -d com.apple.quarantine ~/.local/bin/supabase
```

### Node — only needed to run the React UI

Studio (schema visualization) needs no node. Running the actual VEW screen does, and this
Mac has no node on PATH. Existing workaround, unchanged:

```bash
cp /Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node /tmp/node && \
codesign --force --sign - /tmp/node && /tmp/node --version
```

If that path 404s, locate it with
`find /Applications -maxdepth 6 -name node -type f`.

---

## 2. Which branch to run from

The divergence migration and the patched ingest function live on `fable/narrative-first`,
not on main. Work from the worktree:

```bash
cd /Users/sixonelabsllc/Desktop/vendor-piqc/.claude/worktrees/narrative-first
```

`supabase/config.toml` is already committed, so **do not run `supabase init`** — it would
overwrite it.

---

## 3. Start the stack

```bash
supabase start
```

First run pulls several GB of images. When it finishes it prints your local credentials:

```
API URL:          http://127.0.0.1:54321
DB URL:           postgresql://postgres:postgres@127.0.0.1:54322/postgres
Studio URL:       http://127.0.0.1:54323
anon key:         eyJhbGciOi...
service_role key: eyJhbGciOi...
```

Reprint them any time with `supabase status`.

**These local keys are safe to have on disk.** They are the same fixed demo JWTs on every
Supabase developer's machine, and they only sign tokens for your local Postgres. They are
not secrets and are not related to the production keys.

---

## 4. Get the schema in — two paths, prefer A

### Path A — rebuild from the migrations in git (recommended)

The repo holds 165 migrations. If prod was built from them, they *are* the schema, and
replaying them locally reproduces it with **zero contact with production**:

```bash
supabase db reset
```

This drops the local database, replays every migration in `supabase/migrations/` in order,
and runs `supabase/seed.sql` if present. It touches nothing remote.

This is the better answer to "replicate the prod schema": no credentials, no network path
to prod, and it doubles as a test that the migration history is actually coherent.

It also applies the branch's new `20260726000000_protocol_divergences.sql` automatically —
no separate step.

### Path B — pull from prod, to check for drift

Only if you suspect prod has changes never captured as migrations (hand-applied SQL,
dashboard edits). This is **read-only against prod** but does require credentials:

```bash
supabase login                                    # opens browser, issues an access token
supabase link --project-ref ygfcjwgsjmathinqkppq  # prompts for the DB password
supabase db pull                                  # writes a NEW migration capturing drift
```

`db pull` reads `information_schema` and writes a migration file locally. It does not
modify prod.

Then **immediately sever the link** so no later command can target prod:

```bash
supabase unlink
```

Inspect whatever `db pull` generated before keeping it. If it's empty, git and prod agree
and Path A was sufficient. If it isn't, that diff is itself a finding worth telling
Ishika about.

> ⛔ **Never run `supabase db push` while linked.** That is the one command that writes
> your local migrations *into production*. If you never link, you can never push. That is
> the argument for Path A.

---

## 5. Point the app at local

Create `.env.local` in the worktree:

```bash
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_ANON_KEY=<the anon key from `supabase status`>
```

Use the **anon** key, not the local service role key — the app must exercise RLS exactly
as it does in production. Using service role locally would mask any RLS bug and give you a
false pass.

`.env.*` is already gitignored (`.gitignore:24`), so this file will not be committed.

---

## 6. Edge functions — the part narrative-first actually needs

The recovery logic lives in the ingest edge function; re-ingest is what proves it.

```bash
supabase functions serve --env-file ./supabase/functions/.env.local
```

That env file holds the third-party keys ingest calls out to (Reducto, OpenAI). Create it
locally, never commit it:

```bash
REDUCTO_API_KEY=...
OPENAI_API_KEY=...
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_SERVICE_ROLE_KEY=<LOCAL service role key from `supabase status`>
```

Note the last line is the **local** service role key. Edge functions legitimately need
service role to write across tenants — locally that means the local key, never the prod
one.

⚠️ **This is where the Reducto cost question bites.** Re-ingesting a protocol re-runs the
paid parse. Confirm with Ishika whether cached Reducto output can be replayed before
running this against more than one or two protocols.

---

## 7. Visualize

**Studio — schema, tables, rows, SQL:** http://127.0.0.1:54323

Use it to confirm `protocol_divergences` exists after the reset, to inspect
`extracted_fields._narrative_recovery` after an ingest, and to run ad-hoc SQL against
local without any risk.

**The app — the actual VEW worksheet:**

```bash
ln -sfn /Users/sixonelabsllc/Desktop/vendor-piqc/node_modules \
        /Users/sixonelabsllc/Desktop/vendor-piqc/.claude/worktrees/narrative-first/node_modules

/tmp/node node_modules/vite/bin/vite.js --host 127.0.0.1
```

Then open the printed localhost URL. The worktree has no `node_modules` of its own; the
symlink borrows the main checkout's and is gitignored.

---

## 8. `.gitignore` — what to add

Already covered at `.gitignore:23-26`: `.env`, `.env.*`, `supabase/.temp/`.

Append the rest:

```gitignore
# Local Supabase state — never commit
supabase/.branches/
supabase/.temp/
supabase/functions/.env.local
supabase/functions/**/.env.local

# Local DB dumps / snapshots
*.dump
*.sql.gz
supabase/dumps/
```

**Do not** add a blanket `*.sql` or `supabase/**` rule — `supabase/migrations/*.sql` is
tracked source and must stay tracked.

Verify before committing anything:

```bash
git status --porcelain && git check-ignore -v .env.local supabase/functions/.env.local
```

---

## 9. Isolation checklist — run through this once

- [ ] Prod `service_role` key rotated after the chat disclosure.
- [ ] No production key appears in any `.env*` file: `grep -rn "service_role" --include=".env*" .`
- [ ] `supabase unlink` run, if Path B was used. Confirm with `supabase projects list`
      (no project marked linked).
- [ ] `supabase db push` never run. Check your shell history: `history | grep "db push"`.
- [ ] `VITE_SUPABASE_URL` points at `127.0.0.1`, never a `*.supabase.co` host.
- [ ] `git status` clean of `.env*`, dumps, and `.branches/`.
- [ ] No production **data** copied locally — schema only.

---

## 10. Teardown

```bash
supabase stop                 # stops containers, keeps local data
supabase stop --no-backup     # stops and discards the local database entirely
```

Nothing in this setup survives into prod or GitHub. Discarding and rebuilding from
`supabase db reset` is cheap by design — if local state ever gets confusing, throw it away
rather than debugging it.
