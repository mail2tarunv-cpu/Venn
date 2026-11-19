# Venn

**Venn keeps code and design aligned.**

This repository holds the focused V0 demonstration and its Figma companion plugin. It explores how a code-first design team can review a versioned component change, compare it with the matching Figma variable, and approve a guarded update.

## Run locally

Open `index.html` in a local static server, for example:

```sh
python3 -m http.server 8000
```

Visit http://localhost:8000. The published demo is at https://venn-peach-eight.vercel.app.

## Demonstration

- View the mapped Penny primary-button radius change: 2px in Figma vs. 12px in the published code snapshot.
- Expand code evidence, open Connections, and inspect locally imported Figma plugin receipts in History.
- In the separate [Penny test file](https://www.figma.com/design/nfPIHqVPJv4OJ5yOavc1ha), import `figma-plugin/manifest.json` as a Figma development plugin.
- Review the actual Figma variable value in the plugin, approve an update, and export the resulting read-back receipt.

## Current boundaries

- V0 reads a versioned public snapshot; it does not monitor GitHub webhooks or read a Figma document from the website.
- The Figma plugin must be opened and run by a user. It refuses to write if the file, variable, component binding, or expected value differs.
- Receipts are local and are not authoritative audit logs; the plugin has not yet completed a live Figma Desktop verification in this migration.
- V0 is intentionally separate from the **`automation-prototype`** branch, which preserves the experimental V8 backend, GitHub webhook logic, Supabase schema, and queue worker. V8 is not an activated hosted production service.

## Roadmap

1. GitHub App and verified webhook ingestion; durable change queue.
2. Stable code/Figma mappings, value and conflict checks, token updates with explicit safety boundaries.
3. Controlled component/variant regeneration, visual verification, rollback.
4. Authenticated team review, shared history, and permissions.

This independent prototype is not endorsed by Figma, GitHub, Playlab, or NerdWallet.
