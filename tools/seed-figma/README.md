# Venn test seed (Figma development plugin)

Builds an **older version** of the Penny 2.0 tokens in the separate Penny test file, so the Venn plugin has
realistic mistakes to find: hard-coded colours where code uses aliases, stale values, wrong Dark mode values,
missing variables, and one Figma-only variable. It also adds Light and Dark frames of UI bound to those
variables, so a fix is visible.

It only runs in the Penny test file (`nfPIHqVPJv4OJ5yOavc1ha`) and refuses to run if the "Penny 2.0"
collection or page already exists. Import `manifest.json` in Figma Desktop under Plugins, Development.
