# Venn: user research audit (19 Nov 2026)

**Method.** I walked every screen as two first-time users:
- **Linda**, a design lead using the sample.
- **A designer bringing their own GitHub repo and Figma file.**

**What I captured.**
- 45 screenshots in this folder: desktop at 1440 px, phone at 390 px, and the plugin in light and dark, including its first run.
- The site ran against the real `penny-tokens` repo.
- The plugin was fed a real check result. Its commit line shows `aaaaaaa` because that test result uses a placeholder commit ID, not a real one.

Each finding below has evidence and a proposed fix. Severity means how much it hurts someone trying Venn for the first time.

**Status.** Fixed on 19 Nov: 1, 2, 5, 9, plus part of 4 and 20. The screenshots show the fixed versions.

---

## Critical: these break trust or block a real user

### 1. The website's "Figma" column is a guess, but it reads as fact (FIXED)
The site never reads Figma. It assumes Figma matches an older commit.
- **Evidence:** the Overview said 23 changes, but when the plugin actually read Figma it changed 21, with different starting values. For example, `radius/card` was shown as new in code, but it was already in Figma at 12.
- **Fix made:**
  - The column is now "Last synced", and the banner says "since the last sync".
  - The banner now says either "Comparing with e4414b7, assumed to be what Figma has. Change" or, after a receipt, "confirmed by the plugin".
  - The Recent pushes statuses now say "Not synced" and "Last synced".
  - The change map flag and the component preview now say "Last synced".

### 2. The plugin ignores the repo you connected on the site (FIXED)
The plugin used to start on the Penny sample, so a user with their own repo would see Penny's tokens compared with their file.
- **Fix made:**
  - On first run, the plugin shows "Connect your tokens" with empty repo and file fields and a "Use the Penny sample" link (35, 36).
  - Nothing is fetched until the user saves.
  - Repo and file are checked before anything is sent.
  - The header shows a settings (gear) icon instead of a dropdown arrow.
  - Opening settings hides the list and turns Apply off (finding 20).
  - There's a new plugin test for all of this.

### 3. Getting the plugin running is the steepest step, and it comes too early (open)
Setup step 2 asks for a zip download, unzipping, Figma Desktop, and "Import plugin from manifest", all before the user has seen any value (06).
- **Fix:** make step 2 just the Figma link, and move the plugin install to the moment the user presses "Apply in Figma". Longer term, publish the plugin privately to an organisation or to Figma Community.

### 4. Nobody knows which commit their Figma matches (partly fixed)
The setting all the numbers depend on sits third on the Connections page.
- **Fixed:** the Overview banner now names the commit it's comparing with and links to "Change". A receipt from the plugin marks it as confirmed.
- **Still open:** the plugin could tell the site what Figma actually has before anything is applied.

---

## High: confusing, or the wrong thing gets emphasis

### 5. Orange means two different things (FIXED)
Orange meant "colour token" on the Tokens page and "needs review" everywhere else. Colour tokens are now graphite, number tokens stay cobalt, and orange only means drift (11).

### 6. The change map is hard to read, and hides recent pushes on a phone (open)
Each cell is a grid of 18 dots with no meaning per dot. On a phone, only the three oldest pushes fit (27).
- **Fix:** one square per cell with an old → new tooltip, the newest push first, and a list instead of the map on phones.

### 7. The phone tables hide the column that matters (open)
On a phone, "What changed" cuts off **Code**, and Recent pushes cuts off commit messages (25).
- **Fix:** below about 600 px, show each row as a two-line card.

### 8. History repeats the same information on every row (open)
One apply is shown as 21 rows, with the commit and author repeated on each, and the author cut short to "Tarun V" (15).
- **Fix:** one summary row per apply that opens to the full list.

### 9. The History empty state describes the old flow (FIXED)
It now reads "Apply changes with the Venn plugin in Figma, then press Record in Venn. They will show up here." (12)

---

## Medium: polish (all open)

10. **Intro slide 1's mark is hard to read (01).** The circles overlap so much that it looks like an eclipse. Spread them further apart.
11. **The intro shows a different plugin from the real one.** Slide 3 shows a black Apply button; the real plugin's button is blue.
12. **The primary buttons don't look the same.** Some are a dark gradient and some are flat black (01 vs 02, 04 vs 05).
13. **"Changed in" repeats the same commit on every row** when one push changed everything (07).
14. **The "Earlier" status pill** in Recent pushes could be clearer, for example "Before sync".
15. **The sidebar repo card's up/down chevron** suggests you can switch workspaces, but it only opens Connections.
16. **Setup step 1 starts with a limitation** ("Private repositories need… not available yet"). Say "Public repositories only for now" instead.
17. **Users have to know their exact token file path.** Venn could suggest token files from the repo's file list.
18. **Plugin names get cut off when a mode tag is shown** (37). Shorten from the left and keep the full name in the tooltip.
19. **The plugin and the site write aliases differently:** `{blue/600}` in the plugin, `{color/blue/600}` on the site.
20. **The plugin's settings opened above a live list.** Fixed as part of 2.
21. **The plugin's success screen says the same thing three times (42).** Keep the green banner and the Record button.

---

## What works well and should stay
- The two-step setup with the sample one click away, and inline errors that explain what to type.
- The Overview's single banner with one primary action.
- **The plugin's default view:**
  - Short rows that look like Figma's own UI.
  - A real "from → to" value on each row.
  - Changes that are ticked on purpose.
  - Extra variables kept and never deleted.
  - The Apply button shows the count.
- "Record in Venn" turns the dashboard green in one click (14).
- The safety behaviour: values read back after writing, full undo, and guards against a new commit or a designer's edit made after the check.

## Next, in order
1. 3 (install the plugin when Apply is pressed)
2. 7 (phone tables)
3. 8 (grouped History)
4. 6 (a simpler change map)
5. 17 (detect the token file)
6. Publish the plugin privately
7. The polish items
