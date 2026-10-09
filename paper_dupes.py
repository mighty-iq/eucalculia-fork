"""Measure how often G08 paper_full_unfold items contain perceptually near-duplicate candidates
(Alberto's own G083 metric: Hausdorff >= 0.14 and >= 2 points moved)."""
import pathlib as _pl, os as _os
_ROOT = _pl.Path(__file__).resolve().parents[1]
for _d in ('shots/fork', 'shots/learn'): (_ROOT / _d).mkdir(parents=True, exist_ok=True)
_os.chdir(_ROOT)
import sys, json, asyncio, pathlib
from playwright.async_api import async_playwright
JS = r"""
(N) => {
  const api = globalThis.EUCALCULIA_G08_VISUAL_PREDICT;
  const nd = (p, pts) => Math.min(...pts.map(q => Math.hypot(p.x-q.x, p.y-q.y)));
  const sep = (a, b) => { const da = a.map(p => nd(p, b)), db = b.map(p => nd(p, a)); return {h:Math.max(...da, ...db), changed:da.filter(v => v >= 0.139).length + db.filter(v => v >= 0.139).length}; };
  const distinct = (a, b) => { const m = sep(a, b); return m.h >= 0.14 && m.changed >= 2; };
  const allDistinct = item => { const c = item.candidates; for(let i=0;i<4;i++) for(let j=i+1;j<4;j++) if(!distinct(c[i].state, c[j].state)) return false; return true; };
  const minH = item => { const c = item.candidates; let m = 9; for(let i=0;i<4;i++) for(let j=i+1;j<4;j++) m = Math.min(m, sep(c[i].state, c[j].state).h); return m; };
  let built = 0, bad = 0, badCorrect = 0; const hs = []; const byPlan = {}; const retries = [];
  for(let s = 1; s <= N; s++){
    const item = api.build({variant:"paper_full_unfold", seed:s});
    if(!item) continue; built++;
    const ok = allDistinct(item); hs.push(+minH(item).toFixed(3));
    byPlan[item.planId] = byPlan[item.planId] || {n:0, bad:0}; byPlan[item.planId].n++;
    if(!ok){ bad++; byPlan[item.planId].bad++;
      // does the correct candidate have a near twin?
      const c = item.candidates, k = item.correctIndex; if(c.some((row, i) => i !== k && !distinct(row.state, c[k].state))) badCorrect++;
      // how many extra seeds until a distinct one?
      let tries = 0; for(let t = 1; t <= 30; t++){ const it2 = api.build({variant:"paper_full_unfold", seed:(s*7919 + t*104729) >>> 0}); tries = t; if(it2 && api.geometryValid(it2) && api.verify(it2, it2.correctIndex) && allDistinct(it2)) break; }
      retries.push(tries);
    }
  }
  hs.sort((a,b)=>a-b);
  const q = p => hs[Math.floor(p*(hs.length-1))];
  return {built, bad, badCorrect, frac:+(bad/built).toFixed(3), minHQuantiles:{p05:q(0.05), p10:q(0.1), p25:q(0.25), p50:q(0.5)}, below:{h04:hs.filter(h=>h<0.04).length, h08:hs.filter(h=>h<0.08).length, h14:hs.filter(h=>h<0.14).length}, byPlan, retries:{max:Math.max(...retries, 0), mean:+(retries.reduce((a,b)=>a+b,0)/Math.max(1,retries.length)).toFixed(2), hist:retries.reduce((a,r)=>(a[r]=(a[r]||0)+1,a),{})}};
}
"""
async def main():
    file = sys.argv[1]; n = int(sys.argv[2]) if len(sys.argv) > 2 else 300
    async with async_playwright() as p:
        b = await p.chromium.launch(); page = await (await b.new_context(viewport={"width":1100,"height":860})).new_page()
        await page.goto(pathlib.Path(file).resolve().as_uri()); await page.wait_for_timeout(1500)
        out = await page.evaluate(JS, n)
        print(json.dumps(out, indent=1))
        await b.close()
asyncio.run(main())
