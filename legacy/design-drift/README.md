# Design Drift

An independent product experiment exploring how code-first teams can identify and reconcile changes between GitHub and Figma.

**Live web interface:** https://design-drift-tarun.vercel.app/

**Figma test file:** https://www.figma.com/design/nfPIHqVPJv4OJ5yOavc1ha

**GitHub source:** https://github.com/mail2tarunv-cpu/tarun-portfolio/tree/experiment/design-drift/experiments/design-drift

## What you can do

- Review one accurately mapped change in a Penny-derived component: button radius, 2px → 12px.
- Inspect representative sample changes from a separate educational UI, or import a public GitHub PR to get rule-based suggestions.
- Add relevant changes to a Figma update checklist; export the checklist as Markdown.
- Explore a working education-builder interface with form inputs and component state comparisons (not a live AI application).
- Compare tokens in a **separate, safely isolated Figma test file** with a public GitHub JSON snapshot using the development Figma plugin. Explicitly approve token updates.
- Propose token values from the Figma test file back to GitHub as a *new branch and pull request* using a user-authorized fine-grained GitHub token entered inside Figma. No automatic merging.

## Test: GitHub → Figma

1. Open the isolated [Figma test file](https://www.figma.com/design/nfPIHqVPJv4OJ5yOavc1ha). Do not test against the original shared Penny library.
2. Download `Design-Drift-Figma-Plugin.zip` and extract it, or use source in `figma-plugin/`.
3. In Figma desktop, open **Plugins → Development → Import plugin from manifest...** and select `figma-plugin/manifest.json`.
4. Run **Design Drift Sync — Development** in the test file.
5. Click **Compare versions**. The current test baseline is `radius/button = 2` and the committed GitHub snapshot proposes `12`.
6. Review the difference and click **Apply reviewed updates**. The plugin updates the mapped Figma variable, and the bound button responds.

This GitHub → Figma value change was verified separately via connected Figma tools. The downloadable plugin's compare/apply implementation was validated in a local mock environment and needs a final real Figma Desktop test.

## Test: Figma → GitHub

1. Change a mapped token within the separate test Figma file.
2. In the development plugin, enter a fine-grained GitHub token with **Contents: Read and write** and **Pull requests: Read and write**, scoped only to this repository. Do not paste credentials into a chat or public website.
3. Select **Create pull request**. The plugin should compare the local token collection with the base snapshot, create a new branch, and open a PR for review.
4. The plugin does not save the token or merge a PR.

The reverse path passes a mocked GitHub API test. It has not yet been exercised against GitHub from a live Figma desktop plugin.

## Source files

- `index.html`: static Design Drift web workspace, no build system needed
- `sync/penny.tokens.json`: versioned Penny-derived token subset and mappings
- `examples/penny-button.css`: matching illustrative code token implementation
- `examples/learning-builder.html`: independent education-builder example
- `figma-plugin/`: a development plugin for reading and writing selected Figma test variables and proposing GitHub PRs

## Boundaries and architecture

This is **not** a full clone of the original Penny system. It contains a selected, variable-bound component and an independent learning-builder frame, copied into a new file so the original class project is untouched.

- The web page itself cannot access or edit the authenticated Figma file. The companion Figma plugin is required for actual Figma variable edits.
- Only a predefined set of six variables in the `Penny / Test tokens` collection is supported.
- No Storybook ingestion, arbitrary component regeneration, private repository integration, OAuth, screenshot diff service, webhook daemon, or conflict auto-resolution.
- The GitHub importer in the web page analyzes **public PR patches heuristically** and can miss CSS changes, classify irrelevant changes, or have incomplete patches.
- The educator-builder preview is illustrative, not a production AI service and not Playlab's actual product.
- The web checklist is stored only during the active session and does not mutate Figma.
- The development plugin's two directions require human confirmation, and GitHub write operations create reviewable PRs rather than direct merges.

This is an independent portfolio experiment, not affiliated with Playlab, NerdWallet, Figma, GitHub, story.to.design, Chromatic, or Tokens Studio.