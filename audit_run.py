"""Run Eucalculia's built-in feature audit suite on a build and dump non-PASS results.
usage: python3 audit_run.py <file.html> <out.json> [--mode m] [--play N]
"""
import sys, json, asyncio, pathlib, argparse
from playwright.async_api import async_playwright
STEP = open(pathlib.Path(__file__).parent / 'bot.py').read().split('STEP_JS = r"""')[1].split('"""')[0]

RUN_JS = r"""
async () => {
  const flat = {};
  const walk = (obj, prefix) => {
    if(!obj || typeof obj !== 'object') return;
    for(const [k, v] of Object.entries(obj)){
      if(!v || typeof v !== 'object') continue;
      const key = prefix ? prefix + '.' + k : k;
      if(typeof v.status === 'string'){ flat[key] = v.status; }
      if(v.results && typeof v.results === 'object') walk(v.results, key);
    }
  };
  let all = null, err = null;
  try { all = runFeatureAudit('all', {allowPublicHarness:true, allowPublicHarnessRuntime:true, force:true}); } catch(e){ err = String(e && e.stack || e).slice(0, 600); }
  if(all && all.results) walk(all.results, '');
  const extra = {};
  try {
    for(const k of Object.keys(globalThis)){
      if(/^auditV\d|^audit[A-Z]/.test(k) && typeof globalThis[k] === 'function' && k.length < 70){
        try { const r = globalThis[k](); if(r && typeof r === 'object' && typeof r.status === 'string') extra[k] = r.status; }
        catch(e){ extra[k] = 'THROW:' + String(e && e.message || e).slice(0, 120); }
      }
    }
  } catch(e){}
  const handlers = {};
  try {
    for(const [k, h] of Object.entries(globalThis.EUCA_FEATURE_AUDIT_HANDLERS || {})){
      try { const r = h.fn({}); handlers[k] = (r && typeof r === 'object' && typeof r.status === 'string') ? r.status : typeof r; }
      catch(e){ handlers[k] = 'THROW:' + String(e && e.message || e).slice(0, 120); }
    }
  } catch(e){}
  return {topStatus: all && all.status, err, flat, extra, handlers, runtimeErrors:(State.productionMonitor.runtimeErrors||[]).slice(-5)};
}
"""

async def main():
    ap = argparse.ArgumentParser(); ap.add_argument('file'); ap.add_argument('out')
    ap.add_argument('--mode', default=None); ap.add_argument('--play', type=int, default=0)
    a = ap.parse_args()
    async with async_playwright() as p:
        b = await p.chromium.launch(); page = await (await b.new_context(viewport={"width":1100,"height":860})).new_page()
        errs = []
        page.on("pageerror", lambda e: errs.append(str(e)[:300]))
        page.on("console", lambda m: errs.append('[console.error] ' + m.text[:300]) if m.type == 'error' else None)
        await page.goto(pathlib.Path(a.file).resolve().as_uri()); await page.wait_for_timeout(1500)
        if a.mode: await page.evaluate("(m)=>window.EUCA_PROGRESSION && window.EUCA_PROGRESSION.setMode(m)", a.mode)
        n = 0
        for i in range(4000):
            if n >= a.play: break
            r = await page.evaluate(STEP, {"pCorrect":0.92,"rtMs":600})
            if r.get('needKey'): await page.keyboard.press('Space')
            if r.get('action') == 'answer': n += 1
            await page.wait_for_timeout(50 if r.get('action') == 'answer' else 90)
        if a.play:
            # go back to the menu so the harness is not suppressed by the hot-path guard
            await page.evaluate("()=>{ try{ document.getElementById('pauseBtn').click(); }catch(e){} }")
            await page.wait_for_timeout(800)
        res = await page.evaluate(RUN_JS)
        res['pageErrors'] = errs[-20:]
        pathlib.Path(a.out).write_text(json.dumps(res, indent=1))
        bad = {k:v for k,v in res['flat'].items() if v not in ('PASS','PASS_REPAIRED')}
        badx = {k:v for k,v in res['extra'].items() if v not in ('PASS','PASS_REPAIRED')}
        badh = {k:v for k,v in res['handlers'].items() if v not in ('PASS','PASS_REPAIRED')}
        print('top:', res['topStatus'], 'err:', res['err'])
        print('suite non-pass:', json.dumps(bad, indent=0))
        print('global audits non-pass:', json.dumps(badx, indent=0))
        print('handler audits non-pass:', json.dumps(badh, indent=0))
        print('runtimeErrors:', json.dumps(res['runtimeErrors'])[:600])
        print('pageErrors:', res['pageErrors'])
        await b.close()
asyncio.run(main())
