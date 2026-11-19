# Venn — automation prototype (experimental)

**This branch preserves the experimental V8 backend and is not an activated or production-safe synchronization service.** The ready-to-demonstrate V0 app lives on [`main`](https://github.com/mail2tarunv-cpu/Venn).

Before using this experimental version, configure a dedicated GitHub App, database, Figma plugin network permissions, and an isolated test design file. Existing Design Drift protocol identifiers are retained for compatibility.

---

# Venn — Automatic-first synchronization

A code-first change tracker for keeping GitHub and Figma aligned. The interface has **Home, Changes, History, Connections**. The automation policy is **auto-apply verified allowlisted tokens; require human approval for every other change**.

**Live app:** https://YOUR_VENN_API_DEPLOYMENT/  
**Isolated Penny Figma test:** https://www.figma.com/design/nfPIHqVPJv4OJ5yOavc1ha  
**GitHub branch:** `automation-prototype` in `mail2tarunv-cpu/Venn`. No changes to `main`.

## What is implemented

- A Vercel Node API with GitHub OAuth sign-in, GitHub App installation-token requests and signed webhook verification (`push`, merged `pull_request`).
- A durable workspace/change/snapshot/event data model with a Supabase PostgreSQL schema, RLS enabled, and no direct client access to the tables.
- Webhook idempotence through a delivery-ID table, commit-level token comparisons and a deduplicated review queue.
- Token classification: only **explicitly allowlisted color/number tokens** with a mapped type, a current matching Figma snapshot (less than 24 hours old), and auto mode enabled are queued automatically. All other changes require approval.
- A Figma development plugin that can pair with one workspace, publish variable snapshots, fetch queued changes, reject stale values, apply mapped variables while open, read back the result, and report application receipts. It polls every 20 seconds while open and refreshes the snapshot periodically. It does **not** run after the plugin closes.
- A shared server audit trail for source-detected changes, approvals, application reports and conflicts when the dedicated database is configured.
- Authenticated workspace creation, policy editing, plugin key rotation, explicit change approval or dismissal, and a read-only History page.
- Public GitHub review and manually imported snapshots remain available independently of the hosted automation setup.

## Deployment status and required setup

**This repository includes the backend, but it is not active merely because the source is deployed.** The hosted Vercel app must have a dedicated database and GitHub App credentials. Without them `GET /api/status` returns `ready:false`; buttons are deliberately disabled instead of suggesting an update happened.

1. Create a **dedicated Supabase project** for Venn. Do not reuse the unrelated portfolio or Desk OS databases. Run `supabase/schema.sql` from the Supabase SQL editor. The tables are `dd_workspaces`, `dd_snapshots`, `dd_changes`, `dd_audit`, `dd_deliveries`. All have RLS enabled; only the server-side service role can access them. Keep the service role key private.
2. Register a GitHub App with webhook `https://YOUR_VENN_API_DEPLOYMENT/api/github/webhook`, with repository permissions **Metadata: read, Contents: read**, subscribed to `Push` and `Pull request` events. Enable user authorization via the app client ID/secret. Set the OAuth callback URL to `https://YOUR_VENN_API_DEPLOYMENT/api/github/callback`. Install the App only on the test repository. GitHub App creation and installation require owner interaction and cannot be silently performed by this code.
3. Add the values in `.env.example` through the **Vercel project environment variable controls**, not through chat or a committed `.env`: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_OAUTH_CLIENT_ID`, `GITHUB_OAUTH_CLIENT_SECRET`, `GITHUB_WEBHOOK_SECRET`, `SESSION_HMAC_SECRET` (random >= 32-byte secret), and `APP_ORIGIN`.
4. Redeploy Vercel, open the site, select **Connections**, sign in with GitHub, enter the App installation ID, test repo/branch/token file, and Figma file/collection. Create a workspace and choose the explicit auto token allowlist. Only repositories under the signed-in account can be registered in this version.
5. Open the **separate** Penny Figma test file. In Figma Desktop, use Plugins → Development → Import plugin from manifest and select `figma-plugin/manifest.json`. In Venn Connections, click **Pair Figma plugin**, copy the one-time key and workspace ID into the plugin, and click **Connect and sync**. The key is held only in plugin memory.
6. For the Penny demonstration, the original test Figma button radius was restored to `2`, while `sync/penny.tokens.json` proposes `12`. With `radius/button` explicitly allowed, the plugin should report and apply that pending token automatically while open. Verify the Figma variable and the History event. Do not test automatic writes on the original class design system.
7. For a complex change, review it on **Changes** and select Approve. The Figma plugin will then process that approved, mapped variable while open. Structural component regeneration is **not** implemented by this path.

## Security and correctness

- Server-side OAuth uses signed, HttpOnly, Secure cookies with short expiration. GitHub App installation credentials remain on the server. No GitHub secret is embedded in the client.
- The GitHub webhook uses the original request bytes for HMAC-SHA256 signature verification. Unverifiable deliveries fail closed. Duplicate webhook delivery IDs are ignored after successful processing.
- A plugin pairing key is generated securely, stored only as a server-side HMAC, and rotated on request. The raw key is displayed once.
- Plugin results include a Figma value read-back, and the backend checks receipt values against the pending change before marking them applied. The read-back is produced by a trusted paired plugin **but is not an independent REST verification or a cryptographic identity proof**.
- Figma updates are blocked on stale expected values. Conflicts never silently overwrite current designer work.
- OAuth app and database secrets are **not included** in this repository.

## Known limitations

- Without the required environment variables and GitHub App installation, the hosted app only provides public-repository/local review; no live automatic sync is active.
- Figma's REST variable write endpoint is Enterprise-restricted; this implementation uses the Figma plugin, so automatic updates only run while it is open. Server-side unattended Enterprise REST writes are **not implemented**.
- A complete Figma instance/component tree cannot be safely regenerated from an arbitrary React diff. Component structure, variant changes, missing mappings and ambiguous changes remain in review and need a specialized approved plugin implementation.
- The Figma plugin's new hosted queue mode has local unit tests and code-level checks, but requires a **live Figma Desktop + configured backend acceptance test** for full end-to-end verification.
- The webhook currently reconciles workspaces inline, rather than using a durable job queue. High-volume installations need queue workers and retries. Audit records are DB-backed only after Supabase configuration.
- The GitHub App registration and OAuth client must be configured by the account owner. Private-repository support depends on the App installation and permissions; this version limits workspace ownership to the logged-in personal account.

## Test commands

```
node tests/backend.test.cjs
node tests/plugin.test.cjs
node tests/auto.test.cjs
python tests/browser.test.py
```

Browser tests run against an embedded page with a simulated API response to verify layout and controls. Backend unit tests use an unconfigured service to verify fail-closed behavior; they do **not** substitute for a real webhook or database integration test.

## File layout

- `index.html`, `app.css`, `app.js`: V8 frontend
- `api/index.js`: Node serverless GitHub/Figma sync backend
- `supabase/schema.sql`: persistence and RLS schema
- `figma-plugin/`: Figma editor companion plugin and queue worker
- `vercel.json`, `.env.example`: deployment settings
- `sync/penny.tokens.json`: isolated Penny versioned test tokens
- `tests/`: automated tests

Independent portfolio experiment. Not affiliated with Figma, NerdWallet, Playlab, GitHub or the other products compared during research.
