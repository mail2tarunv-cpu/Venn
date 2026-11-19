"""Browser test for the Venn web app.

Serves the repository over local HTTP and drives the real UI with GitHub mocked, so the test is repeatable:
onboarding, change detection, a new push arriving, receipt import, bad receipts, and three screen widths.
Browser lookup: CHROMIUM_PATH, common system paths, then Playwright's bundled Chromium.
"""
import base64, functools, http.server, json, os, pathlib, shutil, tempfile, threading
from playwright.sync_api import sync_playwright

root = pathlib.Path(__file__).resolve().parents[1]
shots = pathlib.Path(tempfile.mkdtemp(prefix="venn-shots-"))
REPO, PATH = "mail2tarunv-cpu/penny-tokens", "penny.tokens.json"
BASE_SHA, HEAD_SHA, NEW_SHA = "1" * 40, "2" * 40, "3" * 40


def tokens(radius, spacing=12):
    return {"radius": {"button": {"$type": "number", "$value": radius}},
            "spacing": {"component": {"$type": "number", "$value": spacing}},
            "action": {"primary": {"$type": "color", "$value": "#008254"}}}


FILES = {BASE_SHA: tokens(2), HEAD_SHA: tokens(12), NEW_SHA: tokens(12, 16)}


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Quiet, directory=str(root)))
threading.Thread(target=server.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{server.server_port}/"


def commit(sha, msg):
    return {"sha": sha, "html_url": f"https://github.com/{REPO}/commit/{sha}",
            "commit": {"message": msg, "author": {"name": "Tester", "date": "2026-11-18T22:00:00Z"}}}


def find_browser():
    for c in [os.environ.get("CHROMIUM_PATH"), "/usr/bin/chromium",
              "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", shutil.which("chromium"), shutil.which("google-chrome")]:
        if c and os.path.exists(c):
            return c


def wire(page, state):
    def commits(route):
        route.fulfill(status=200, content_type="application/json", headers={"Access-Control-Allow-Origin": "*"},
                      body=json.dumps(state["commits"]))

    def raw(route):
        sha = route.request.url.split(f"{REPO}/")[1].split("/")[0]
        route.fulfill(status=200, content_type="text/plain", headers={"Access-Control-Allow-Origin": "*"}, body=json.dumps(FILES[sha]))

    page.route("https://api.github.com/**", commits)
    page.route("https://raw.githubusercontent.com/**", raw)


def nav(page, name, narrow):
    if narrow:
        page.locator("#menuButton").click()
    page.locator(f'.nav-link[data-page="{name}"]').click()
    assert page.locator(f"#page-{name}").is_visible()


with sync_playwright() as p:
    exe = find_browser()
    browser = p.chromium.launch(headless=True, **({"executable_path": exe} if exe else {}))
    for width, height in [(1440, 900), (1024, 768), (375, 812)]:
        narrow = width <= 820
        page = browser.new_page(viewport={"width": width, "height": height})
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        state = {"commits": [commit(HEAD_SHA, "Round primary buttons"), commit(BASE_SHA, "Add Penny design tokens")]}
        wire(page, state)
        page.goto(base, wait_until="networkidle")

        # Intro: three screens on first visit. Next walks through them, Skip goes straight to GitHub.
        assert page.locator("#intro").is_visible() and page.locator("#onboarding").is_hidden()
        assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth"), f"intro overflow {width}"
        page.screenshot(path=str(shots / f"intro-{width}.png"))
        if width == 1440:
            page.locator("#introNext").click()
            page.locator("#introNext").click()
            assert page.locator("#introNext").inner_text() == "Connect GitHub"
            page.locator("#introNext").click()
        else:
            page.locator("#skipIntro").click()

        # Onboarding: bad input is explained, the sample works end to end, in two steps.
        assert page.locator("#onboarding").is_visible() and page.locator("#intro").is_hidden()
        page.locator("#repoInput").fill("not a repo")
        page.locator("#repoNext").click()
        assert "owner/name" in page.locator("#repoError").inner_text()
        page.locator("#useSample").click()
        page.locator('.step[data-step="2"]').wait_for(state="visible")
        page.locator("#figmaInput").fill("https://example.com/x")
        page.locator("#figmaNext").click()
        assert "Figma file link" in page.locator("#figmaError").inner_text()
        page.locator("#figmaInput").fill("https://www.figma.com/design/nfPIHqVPJv4OJ5yOavc1ha")
        assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth"), f"onboarding overflow {width}"
        page.locator("#figmaNext").click()

        # Overview: a banner says what happened, one token to review, starting from the commit before the latest.
        page.locator(".banner").wait_for()
        assert "1 token changed since Figma was last updated" in page.locator(".banner h2").inner_text()
        assert "assumed" in page.locator(".sync-note").inner_text(), "the starting point is labelled as an assumption"
        assert page.locator(".change").count() == 1
        assert "radius/button" in page.locator(".change").inner_text()
        assert "Changed" in page.locator(".group-row").first.inner_text(), "changes are grouped by kind"
        assert page.title() == "(1) Venn"
        assert page.locator(".commit-row").count() == 1, "one push waiting"
        # A push opens to show what it changed.
        assert page.locator(".push-detail").first.is_hidden()
        page.locator(".commit-row").first.click()
        assert "radius/button" in page.locator(".push-detail").first.inner_text()
        assert page.evaluate("getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()").lower() == "#008254", "accent follows the team's primary colour"
        assert page.locator("#topAvatar").count() == 0, "no account avatar without an account"
        assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth"), f"changes overflow {width}"
        page.screenshot(path=str(shots / f"changes-{width}.png"), full_page=True)

        # Tokens page: changed tokens first, drawn as specimens; All shows every token.
        nav(page, "tokens", narrow)
        page.locator(".tok").first.wait_for()
        assert page.locator("#page-tokens .tok").count() == 1
        page.locator('[data-filter="all"]').click()
        assert page.locator("#page-tokens .tok").count() == 3
        page.locator('[data-filter="changed"]').click()
        assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth"), f"tokens overflow {width}"
        page.screenshot(path=str(shots / f"tokens-{width}.png"), full_page=True)
        nav(page, "changes", narrow)

        # Apply modal opens and closes with Escape.
        page.locator("#applyButton").click()
        assert page.locator("#applyModal").is_visible()
        assert page.locator("#openFigma").get_attribute("href").startswith("https://www.figma.com/design/")
        page.keyboard.press("Escape")
        assert page.locator("#applyModal").is_hidden()

        # A new push arrives: Venn picks it up and shows both differences.
        state["commits"] = [commit(NEW_SHA, "Loosen component spacing")] + state["commits"]
        page.locator("#checkNow").click()
        page.wait_for_function("document.querySelectorAll('.change').length === 2")
        assert page.locator(".commit-row").count() == 2

        # History: file import still works for edge cases; the plugin's link is the normal path.
        nav(page, "history", narrow)
        assert "Nothing applied yet" in page.locator("#historyList").inner_text()
        assert "Record in Venn" in page.locator("#historyList").inner_text()
        receipt = {"schema": "venn/receipt-v2", "sourceRepo": REPO, "sourcePath": PATH, "sourceSha": NEW_SHA,
                   "appliedAt": "2026-11-18T23:00:00.000Z", "actor": "Test designer", "changes": [
                       {"name": "radius/button", "type": "number", "before": 2, "after": 12, "readBack": 12},
                       {"name": "spacing/component", "type": "number", "before": 12, "after": 16, "readBack": 16}]}
        upload = lambda body: page.locator("#receiptFile").set_input_files(
            {"name": "r.json", "mimeType": "application/json", "buffer": json.dumps(body).encode()})
        upload({**receipt, "remainingDifferences": 1})
        page.wait_for_function("document.querySelector('#toast').innerText.includes('left for later')")
        assert page.locator("#navCount").inner_text() == "2"
        upload({**receipt, "sourceRepo": "someone/else"})
        page.wait_for_function("document.querySelector('#toast').innerText.includes('different repository')")
        # "Record in Venn": the plugin opens the site with the receipt in the link.
        encoded = base64.urlsafe_b64encode(json.dumps(receipt).encode()).decode().rstrip("=")
        # A fresh page load, exactly like the plugin opening a new browser tab.
        page.goto(base + "?from=plugin#receipt=" + encoded, wait_until="networkidle")
        page.wait_for_function("document.querySelector('#toast').innerText.includes('Update recorded')")
        assert "#receipt=" not in page.url
        nav(page, "history", narrow)
        assert "Test designer" in page.locator("#historyList").inner_text()
        nav(page, "changes", narrow)
        assert "Figma matches your code" in page.locator("#changesBody").inner_text()
        assert page.title() == "Venn"

        # Connections, and state survives a reload.
        nav(page, "connections", narrow)
        assert REPO in page.locator("#connectionRows").inner_text()
        page.reload(wait_until="networkidle")
        assert page.locator("#app").is_visible() and page.locator("#onboarding").is_hidden()

        assert not errors, errors
        print("PASS", width, "intro, onboarding, overview, tokens, new push, record link, receipts, connections, reload, no overflow")
        page.close()
    browser.close()
server.shutdown()
print("screenshots:", shots)
