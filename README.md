# Venn

**Venn keeps Figma in step with your design tokens on GitHub.**

Push a change to your token file, Venn shows what no longer matches Figma, and the Venn Figma plugin applies the changes you review, reads every value back, and gives you a receipt.

Live: https://venn-peach-eight.vercel.app · Sample tokens: https://github.com/mail2tarunv-cpu/penny-tokens

## How it works

1. **Intro.** Three short screens explain the loop. Skip goes straight to setup.
2. **Connect GitHub.** A public repository and the path of its token file.
3. **Connect Figma.** Paste your file link and install the plugin (`figma-plugin.zip`, then Plugins, Development, Import plugin from manifest in Figma Desktop).
4. **Watch.** Venn checks GitHub about every 45 seconds while open. The Overview says how many tokens changed since Figma was last updated, lists them grouped as changed, new and removed with a before/after specimen for each, and lists every push, each opening to show what it changed. The Tokens page shows every token as a swatch or shape, with changed ones ringed in amber. The accent colour follows your primary colour token.
5. **Apply in Figma.** The plugin groups the differences under the push that made them and shows each as a tile (colours split old and new, radii as the shape), with a before/after preview of a button and card built from the file's variables. Tick what to update and press Apply. It writes values and real variable aliases, creates missing variables you tick, reads every value back, and undoes the whole run if anything does not match.
6. **Record in Venn.** One click opens the site with the update, and the dashboard turns green.

A 54-second walkthrough is in `demo/venn-walkthrough.mp4`.

## Token files Venn reads

- W3C design tokens (`$value`, `$type`), including 2025.10 colour objects
- Style Dictionary and Tokens Studio (`value`, `type`), including Tokens Studio sets (also under `values`) and `$themes`, where each theme becomes a Figma mode
- Colours as hex, 8-digit hex with full opacity, `rgb()`; dimensions as numbers, `px` or `rem`
- Aliases like `{color.blue.600}`, and mode values in `$extensions.modes`
- Figma variables are matched by name, ignoring case, spaces and `.` versus `/`

Checked against real public files: `NangoHQ/nango` (435 values, Light and Dark) and `highlight/highlight` (127 colours).

## Honest boundaries

- Public repositories only. Private repositories need the GitHub App and backend (`api/`), which are not configured yet.
- Figma plugins cannot run in the background, and Figma's REST API only allows variable writes on Enterprise plans, so applying is one click in the plugin.
- Colour and number tokens only. Typography, shadows and transparent colours are skipped, not misread.
- One variable collection per run, chosen in the plugin. Variables that exist only in Figma are reported, never deleted.
- Workspace and history live in this browser. Receipts record the plugin's read-back, not an independent audit.

## Optional backend

`api/index.js` is a serverless backend (GitHub sign-in, signed webhooks, Supabase persistence). `GET /api/status` reports `ready:false` until `.env.example` values are set and `supabase/schema.sql` is applied; every action fails closed. The web app does not depend on it.

## Develop

```sh
python3 -m http.server 8000   # then open http://localhost:8000
npm test                      # tokens, plugin, backend and browser tests (browser test needs Python Playwright)
npm run build:plugin          # copies the token parser into the plugin and rebuilds figma-plugin.zip
```

Independent prototype. Not affiliated with Figma or GitHub.

## Deploy

The site is static. With the Vercel CLI, from this folder:

```sh
vercel link --yes --project venn
vercel deploy --prod --yes
```

On a different Vercel account, import this GitHub repository as a new project (framework: Other, no build command). If the site moves to a new address, update `VENN_SITE` in `figma-plugin/code.js` and run `npm run build:plugin`, so "Record in Venn" opens the new address. Nothing else changes: the plugin itself only talks to GitHub.
