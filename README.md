# Venn

**Venn keeps Figma in step with your design tokens on GitHub.**

Push a change to your token file, Venn shows what no longer matches Figma, and the Venn Figma plugin applies the changes you review, reads every value back, and gives you a receipt.

Live: https://venn-peach-eight.vercel.app · Sample tokens: https://github.com/mail2tarunv-cpu/penny-tokens

## How it works

1. **Connect GitHub.** Enter a public repository and the path of a W3C design-token JSON file (colour and number tokens).
2. **Connect Figma.** Paste your file link and install the plugin (`figma-plugin.zip`, then Plugins, Development, Import plugin from manifest in Figma Desktop).
3. **Pick a baseline.** Choose the commit your Figma file matches today.
4. **Push.** Venn checks GitHub every 45 seconds while open (and on demand), lists every token that changed since the last sync, and the commits that changed them. The tab title and an optional browser notification tell you when a push arrives.
5. **Apply.** In Figma, run Venn. It compares the latest commit with the file's variables, you tick what you reviewed, and it writes only those, reads them back, and undoes the whole run if any value does not match.
6. **Record.** Import the plugin's receipt on History. Venn marks Figma as synced to that commit.

## Honest boundaries

- Public repositories only. Private repositories need the GitHub App and backend (`api/`), which are not configured yet.
- Figma plugins cannot run in the background, and Figma's REST API only allows variable writes on Enterprise plans, so applying is one click in the plugin.
- Variables are matched by name (`radius/button` token ↔ `radius/button` variable) in one collection, default mode. Missing variables are reported, never created. Aliases are reported, never overwritten.
- Workspace and history live in this browser. Receipts record the plugin's read-back, not an independent audit.

## Optional backend

`api/index.js` is a serverless backend (GitHub sign-in, signed webhooks, Supabase persistence). `GET /api/status` reports `ready:false` until `.env.example` values are set and `supabase/schema.sql` is applied; every action fails closed. The web app does not depend on it.

## Develop

```sh
python3 -m http.server 8000   # then open http://localhost:8000
npm test                      # tokens, plugin, backend and browser tests (browser test needs Python Playwright)
```

Independent prototype. Not affiliated with Figma or GitHub.
