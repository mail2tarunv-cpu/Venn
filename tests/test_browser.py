"""Browser test for the Venn V0 review screen.

Serves the repository over local HTTP (so source.json loads as it does in
production) and drives it at desktop, tablet and phone widths.

Browser lookup: CHROMIUM_PATH, then common system paths, then Playwright's own
bundled Chromium (`python -m playwright install chromium`).
"""
import functools
import http.server
import json
import os
import pathlib
import shutil
import tempfile
import threading

from playwright.sync_api import sync_playwright

root = pathlib.Path(__file__).resolve().parents[1]
shots = pathlib.Path(tempfile.mkdtemp(prefix="venn-shots-"))
source = json.loads((root / "source.json").read_text())
change = source["changes"][0]

class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


handler = functools.partial(QuietHandler, directory=str(root))
server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
threading.Thread(target=server.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{server.server_port}/"


def find_browser():
    candidates = [
        os.environ.get("CHROMIUM_PATH"),
        "/usr/bin/chromium",
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        shutil.which("chromium"),
        shutil.which("google-chrome"),
    ]
    return next((c for c in candidates if c and os.path.exists(c)), None)


def go(page, name, narrow):
    if narrow:
        page.locator("#menuButton").click()
        assert "menu-open" in page.locator("#shell").get_attribute("class")
    page.locator(f'.sidebar [data-page="{name}"]').click()
    assert page.locator(f"#page-{name}").is_visible()


with sync_playwright() as p:
    exe = find_browser()
    browser = p.chromium.launch(headless=True, **({"executable_path": exe} if exe else {}))
    for width, height in [(1440, 900), (1024, 768), (390, 844)]:
        narrow = width <= 540
        page = browser.new_page(viewport={"width": width, "height": height})
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(base, wait_until="networkidle")

        # Opens directly on the one review screen.
        assert page.locator("#page-changes").is_visible()
        assert page.locator("#page-history").is_hidden()
        assert page.locator("#sourceCheck").inner_text() != "Unavailable"
        assert not page.locator("#openSyncInstructions").is_disabled()
        assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth"), f"overflow {width}"
        page.screenshot(path=str(shots / f"changes-{width}.png"), full_page=True)

        # Before / after specimens reflect source.json, not hardcoded values.
        before = page.locator(".specimen.before").evaluate("x => getComputedStyle(x).borderTopLeftRadius")
        after = page.locator(".specimen.after").evaluate("x => getComputedStyle(x).borderTopLeftRadius")
        assert before == f"{change['expectedBaseline']}px", before
        assert after == f"{change['proposed']}px", after

        # Apply modal opens, links the plugin, closes with Escape.
        page.locator("#openSyncInstructions").click()
        assert page.locator("#syncModal").is_visible()
        assert page.locator('a[href="figma-plugin.zip"]').count() == 2
        page.keyboard.press("Escape")
        assert page.locator("#syncModal").is_hidden()

        # History starts empty, accepts a valid receipt, rejects a bad one.
        go(page, "history", narrow)
        assert "No update recorded yet" in page.locator("#historyList").inner_text()
        receipt = {
            "schema": "design-drift/penny-receipt-v1",
            "fileKey": source["target"]["figmaFileKey"],
            "collection": source["target"]["collection"],
            "tokenName": change["name"],
            "before": change["expectedBaseline"],
            "after": change["proposed"],
            "readBack": change["proposed"],
            "actor": "Test designer",
            "appliedAt": "2026-11-18T22:00:00.000Z",
        }
        upload = lambda body: page.locator("#receiptFile").set_input_files(
            {"name": "receipt.json", "mimeType": "application/json", "buffer": json.dumps(body).encode()}
        )
        upload({**receipt, "readBack": 7})
        page.wait_for_timeout(150)
        assert "Test designer" not in page.locator("#historyList").inner_text()
        upload(receipt)
        page.wait_for_function("document.querySelector('#historyList').innerText.includes('Test designer')")

        go(page, "setup", narrow)
        assert not errors, errors
        print("PASS", width, "review screen, specimens, modal, history, receipt validation, no errors")
        page.close()
    browser.close()

server.shutdown()
