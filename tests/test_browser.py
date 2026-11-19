import json, pathlib, time
from playwright.sync_api import sync_playwright
base='inline'
out=pathlib.Path(__file__).resolve().parents[1]
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True, executable_path='/usr/bin/chromium', args=['--no-sandbox'])
 for width,height in [(1440,900),(1024,768),(390,844)]:
  page=browser.new_page(viewport={'width':width,'height':height},device_scale_factor=1)
  errors=[]
  page.on('pageerror',lambda e:errors.append(str(e)))
  html=(out/'index.html').read_text()
  css=(out/'app.css').read_text()
  js=(out/'app.js').read_text()
  html=html.replace('<link rel="stylesheet" href="app.css" />','<style>'+css+'</style>').replace('<script src="app.js" defer></script>','<script>'+js+'</script>')
  page.evaluate('''() => { const m=new Map();Object.defineProperty(window,'localStorage',{configurable:true,value:{getItem:(k)=>m.get(k)||null,setItem:(k,v)=>m.set(k,v),removeItem:(k)=>m.delete(k)}});window.history.replaceState=()=>{}; }''')
  page.evaluate('window.fetch=async ()=>({ok:true,json:async ()=>('+ (out/'source.json').read_text() +')})')
  page.set_content(html,wait_until='domcontentloaded')
  page.wait_for_timeout(350)
  assert page.locator('#summaryState').inner_text()=='Review needed',page.locator('#summaryState').inner_text()
  assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), f'overflow {width}'
  page.screenshot(path=str(out/f'preview-{width}.png'),full_page=True)
  if width<=540:
   page.locator('#menuButton').click()
   assert page.locator('#shell').get_attribute('class').find('menu-open')>=0
   page.locator('.sidebar [data-page="changes"]').click()
  else:
   page.locator('#goChanges').click()
  assert page.locator('#page-changes').is_visible()
  assert page.locator('#page-home').is_hidden()
  assert page.locator('.specimen.before').evaluate('(x)=>getComputedStyle(x).borderTopLeftRadius')=='2px'
  assert page.locator('.specimen.after').evaluate('(x)=>getComputedStyle(x).borderTopLeftRadius')=='12px'
  page.locator('#openSyncInstructions').click()
  assert page.locator('#syncModal').is_visible()
  assert page.locator('a[href="figma-plugin.zip"]').count()==2
  page.locator('#closeModal').click()
  assert page.locator('#syncModal').is_hidden()
  if width<=540:
   page.locator('#menuButton').click()
   page.locator('.sidebar [data-page="history"]').click()
  else: page.locator('.sidebar [data-page="history"]').click()
  assert page.locator('#historyList').inner_text().find('No update recorded yet')>=0
  receipt={'schema':'design-drift/penny-receipt-v1','fileKey':'nfPIHqVPJv4OJ5yOavc1ha','collection':'Penny / Test tokens','tokenName':'radius/button','before':2,'after':12,'readBack':12,'actor':'Test designer','appliedAt':'2026-11-18T22:00:00.000Z'}
  page.locator('#receiptFile').set_input_files({'name':'receipt.json','mimeType':'application/json','buffer':json.dumps(receipt).encode()})
  assert page.locator('#historyList').inner_text().find('Test designer')>=0
  assert not errors,errors
  print('PASS',width,'no overflow, navigation, modal, specimen, receipt, errors')
  page.close()
 browser.close()
