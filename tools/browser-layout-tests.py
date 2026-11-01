"""Echte Headless-Browser: Layout, Scrollflächen und App-Aktionen.

Benötigt lokal installiertes Playwright samt Chromium/WebKit. Keine physischen
iPhone-Swipes; emulierte Viewports und Browser-Ereignisse werden separat benannt.
--working-data prüft vor dem finalen Freeze den benachbarten nativen Kurs/Looks.
"""
import argparse
import ast
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import sys
from threading import Thread
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / '.test-output' / 'browser-layout'


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


def run(working=False):
    OUT.mkdir(parents=True, exist_ok=True)
    packed = {name + '.json': json.loads((ROOT / 'data' / (name + '.json')).read_text(encoding='utf-8'))
              for name in ('course', 'net', 'code', 'ui', 'features')}
    if working:
        native = ROOT.parent / 'td-codesearch'
        packed['course.json'] = json.loads((native / 'src/tutorial/lessons.json').read_text(encoding='utf-8'))
        tree = ast.parse((native / 'src/CodeSearchExt.py').read_text(encoding='utf-8'))
        for node in tree.body:
            if isinstance(node, ast.Assign):
                for target in node.targets:
                    if isinstance(target, ast.Name) and target.id in ('CODESEARCH_LOOKS', 'SHORTCUT_GUIDE'):
                        packed['ui.json'][target.id] = ast.literal_eval(node.value)
    server = ThreadingHTTPServer(('127.0.0.1', 0), partial(QuietHandler, directory=str(ROOT)))
    Thread(target=server.serve_forever, daemon=True).start()
    results = []
    try:
        with sync_playwright() as playwright:
            for engine, width, height in [('webkit', 390, 844), ('webkit', 320, 568), ('chromium', 412, 915)]:
                name = f'{engine}-{width}x{height}'
                browser = getattr(playwright, engine).launch(headless=True)
                context = browser.new_context(viewport={'width': width, 'height': height},
                                              is_mobile=True, has_touch=True, device_scale_factor=1)
                page = context.new_page()
                page.set_default_timeout(10000)
                errors = []
                page.on('pageerror', lambda error: errors.append(str(error)))
                page.add_init_script('window.__POCKET_DATA__=' + json.dumps(packed, ensure_ascii=True)
                                     + ';localStorage.setItem("codesearch-pocket-intro","1");')
                checks = []

                def check(label, condition):
                    assert condition, name + ': ' + label
                    checks.append(label)

                try:
                    page.goto(f'http://127.0.0.1:{server.server_port}/index.html')
                    page.locator('#tour.open').wait_for()
                    body = page.locator('#tour-body')
                    sizes = body.evaluate('(el)=>({client:el.clientHeight,scroll:el.scrollHeight,overflow:getComputedStyle(el).overflowY})')
                    check('Lerntext besitzt positive nutzbare Höhe und echten vertikalen Overflow', sizes['client'] > 100 and sizes['scroll'] > sizes['client'] and sizes['overflow'] in ('auto', 'scroll'))
                    body.evaluate('(el)=>el.scrollTop=el.scrollHeight')
                    previous = body.evaluate('(el)=>el.scrollTop')
                    check('Ende des Lerntexts erreichbar', previous > 0)
                    page.locator('#tour-grip').click()
                    page.locator('#tour.mini').wait_for()
                    page.locator('#tour-grip').click()
                    page.locator('#tour.open').wait_for()
                    restored = body.evaluate('(el)=>el.scrollTop')
                    check(f'Lesestelle nach Üben/Lesen erhalten ({previous} → {restored})', abs(restored - previous) <= 2)
                    page.screenshot(path=str(OUT / (name + '-reader.png')))
                    page.locator('#tour-grip').click()
                    page.locator('#tour.mini').wait_for()
                    page.locator('#cs-input').fill('>karte StateLab')
                    page.locator('#cs-enter').click()
                    expect(page.locator('#cs-target .target-path')).to_contain_text('/StateLab')
                    context_button = page.locator('#cs [data-ctx="comp"]').bounding_box()
                    check('DIESE COMP ist ohne horizontales Suchen sichtbar', context_button['x'] >= 0 and context_button['x'] + context_button['width'] <= width)
                    page.locator('#cs-list .hit.method').first.click()
                    page.locator('#cs [data-act="code-full"]').click()
                    page.wait_for_function('document.querySelector("#cs [data-act=code-full]")?.getAttribute("aria-pressed")==="true"')
                    code = page.locator('#cs .code-viewport')
                    code_size = code.evaluate('(el)=>{el.scrollTop=el.scrollHeight;return {height:el.clientHeight,scroll:el.scrollHeight,top:el.scrollTop};}')
                    check(f'Vollcode ist eigenständig scrollbar {code_size}', code_size['height'] > 0 and code_size['scroll'] > code_size['height'] and code_size['top'] > 0)
                    slider = page.locator('#cs [data-code-zoom]')
                    old_font = code.locator('.ln').first.evaluate('(el)=>parseFloat(getComputedStyle(el).fontSize)')
                    slider.evaluate('(el)=>{el.value="150";el.dispatchEvent(new Event("input",{bubbles:true}));el.dispatchEvent(new Event("change",{bubbles:true}));}')
                    page.wait_for_function('document.querySelector("#cs [data-code-zoom]")?.value==="150"')
                    new_font = code.locator('.ln').first.evaluate('(el)=>parseFloat(getComputedStyle(el).fontSize)')
                    check('Code-Schrift wächst tatsächlich mit eigenem Regler', new_font >= old_font * 1.45)
                    slider.evaluate('(el)=>{el.value="25";el.dispatchEvent(new Event("input",{bubbles:true}));el.dispatchEvent(new Event("change",{bubbles:true}));}')
                    page.wait_for_function('document.querySelector("#cs [data-code-zoom]")?.value==="25"')
                    tiny_font = code.locator('.ln').first.evaluate('(el)=>parseFloat(getComputedStyle(el).fontSize)')
                    check('Code-Schrift erreicht tatsächlich 25 Prozent', tiny_font <= old_font * 0.26)
                    page.locator('#cs [data-act="code-zoom-reset"]').click()
                    # Echte Browser-Wheel-Events (Playwright), keine physische Maus: Bereiche scrollen getrennt.
                    # Mobile WebKit kennt kein Mausrad (Playwright) - Radpruefung nur in Chromium.
                    if engine == 'chromium':
                      code.evaluate('(el)=>{el.scrollTop=Math.floor((el.scrollHeight-el.clientHeight)/2);el.scrollLeft=0;}')
                      regions = '(el)=>{const d=document.querySelector("#cs .cs-detail");const l=document.querySelector("#cs .cs-list");return {top:el.scrollTop,left:el.scrollLeft,wide:el.scrollWidth>el.clientWidth+1,detail:d?d.scrollTop:-1,list:l?l.scrollTop:-1};}'
                      before = code.evaluate(regions)
                      # Shift+Rad als echtes WheelEvent im Browser (Handy-Emulation kennt kein physisches Rad): der
                      # Dokument-Handler scrollt nur den Bereich unter dem Zeiger waagerecht, Details/Liste bleiben.
                      code.evaluate('(el)=>{el.dispatchEvent(new WheelEvent("wheel",{deltaY:120,shiftKey:true,bubbles:true,cancelable:true}));}')
                      page.wait_for_timeout(200)
                      shifted = code.evaluate(regions)
                      check(f'Shift+Rad über Code scrollt nur den Code waagerecht {before}→{shifted}', before['wide'] and shifted['left'] > before['left'] and shifted['top'] == before['top'] and shifted['detail'] == before['detail'] and shifted['list'] == before['list'])
                      code.evaluate('(el)=>{el.dispatchEvent(new WheelEvent("wheel",{deltaY:120,shiftKey:false,bubbles:true,cancelable:true}));}')
                      page.wait_for_timeout(200)
                      plain = code.evaluate(regions)
                      check('Rad ohne Shift bleibt beim Browser (Handler verschiebt nicht waagerecht)', plain['left'] == shifted['left'])
                    check('Seitenbreite bleibt im Viewport', page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'))
                    page.locator('#cs [data-act="float-menu"]').first.click()
                    page.locator('#popup [data-menu]').filter(has_text='Diese Ansicht · Fenster daneben').click()
                    mirror = page.locator('#floats .cs-secondary')
                    mirror.wait_for()
                    check('Bedienbare Zweitansicht vorhanden', mirror.locator('[data-act="code-full"]').count() == 1)
                    floating = page.locator('[data-float]')
                    title = floating.locator('.fh .t')
                    title.click()
                    opening = floating.bounding_box()
                    shell_height = floating.locator('.fh').bounding_box()['height']
                    original = page.locator('#cs').bounding_box()
                    check('Kleine Zweitansicht öffnet kompakt', opening['height'] <= min(480, height * .6) + 1)
                    for _ in range(5):
                        page.keyboard.press('Control++')
                    expect(title).to_contain_text('150 %')
                    zoomed = floating.bounding_box()
                    check('Strg+Plus vergrößert nur den Inhalt', abs(zoomed['height'] - opening['height']) < 1 and abs(zoomed['width'] - opening['width']) < 1 and floating.locator('.fh').bounding_box()['height'] == shell_height)
                    for _ in range(5):
                        page.keyboard.press('Control+-')
                    page.wait_for_function('document.querySelector(".cs-secondary")?.style.zoom==="1"')
                    check('Fünf Plus/Minus-Schritte erreichen exakt den Startzoom', mirror.evaluate('(el)=>el.style.zoom') == '1')
                    page.keyboard.press('Control+Shift++')
                    expect(title).to_contain_text('110 %')
                    check('Shift bei echter Plus-Taste stört den Shortcut nicht', mirror.evaluate('(el)=>el.style.zoom') == '1.1')
                    page.keyboard.press('Alt+0')
                    page.wait_for_function('document.querySelector(".cs-secondary")?.style.zoom==="1"')
                    check('Zoom-Reset lässt das Original unverändert', page.locator('#cs').bounding_box() == original)
                    page.locator('[data-fsize]').click()
                    check('Große Zweitansicht passt zur Handybreite', page.locator('[data-float]').bounding_box()['width'] <= width + 1)
                    page.locator('[data-fsize]').click()
                    page.locator('.float.side').wait_for()
                    check('Groß und zurück stellt die kleine Fenstergröße wieder her', floating.bounding_box() == opening)
                    page.locator('[data-fsize]').click()
                    page.screenshot(path=str(OUT / (name + '-code.png')))
                    page.locator('[data-fclose]').click()
                    page.locator('[data-float]').wait_for(state='detached')
                    page.locator('#cs-input').fill('>karte SignalGarden/Sensor')
                    page.locator('#cs-enter').click()
                    expect(page.locator('#cs-target .target-path')).to_contain_text('/SignalGarden/Sensor')
                    page.locator('#cs [data-ctx="comp"]').click(button='right')
                    page.locator('#popup [data-menu]').filter(has_text='Parameter nach oben').click()
                    expect(page.locator('#popup .t')).to_contain_text('Vorschau')
                    check('Promotion-Vorschau erscheint über realem Browser-Menü', 'Vorschau' in page.locator('#popup .t').inner_text())
                    popup = page.locator('#popup .box').bounding_box()
                    check('Vorschau bleibt innerhalb der Handybreite', popup['width'] <= width + 1)
                    check('Kurze Bestätigung vollständig lesbar', page.locator('[data-pop="enter"]').inner_text() == 'Verbinden' and page.locator('[data-pop="enter"]').evaluate('(el)=>el.scrollWidth<=el.clientWidth'))
                    page.locator('[data-pop="enter"]').click()
                    expect(page.locator('#cs-status')).to_contain_text('6 Parameter')
                    check('Browseraktion übernimmt sechs Controls', '6 Parameter' in page.locator('#cs-status').inner_text())
                    check('Keine unbehandelten Browserfehler', not errors)
                    results.append({'viewport': name, 'browser': browser.version, 'checks': checks, 'passed': len(checks)})
                except Exception as error:
                    page.screenshot(path=str(OUT / (name + '-failure.png')), full_page=True)
                    results.append({'viewport': name, 'checks': checks, 'error': str(error), 'page_errors': errors})
                    raise
                finally:
                    context.close()
                    browser.close()
    finally:
        server.shutdown()
        report = {'working_data': working, 'physical_iphone_swipes': 'not_tested', 'results': results}
        (OUT / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    return report


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    parser = argparse.ArgumentParser()
    parser.add_argument('--working-data', action='store_true')
    options = parser.parse_args()
    print(json.dumps(run(options.working_data), ensure_ascii=False))
