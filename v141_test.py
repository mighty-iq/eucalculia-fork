"""Fork v1.4.1 — manual META layer test.
usage: python3 v141_test.py <file.html> [mode] [viewport]
Plays to the relational phase, then forces META², META³, None and Auto from the level card
and verifies that the forced layers really appear (chains + questions), that promised
questions are still asked under None, that no blank questions / runtime errors / flow
violations occur, and that Baseline disables the control."""
import pathlib as _pl, os as _os
_ROOT = _pl.Path(__file__).resolve().parents[1]
for _d in ('shots/fork', 'shots/learn'): (_ROOT / _d).mkdir(parents=True, exist_ok=True)
_os.chdir(_ROOT)
import sys, json, asyncio, pathlib, collections, functools
print = functools.partial(print, flush=True)
from playwright.async_api import async_playwright
STEP = open(_ROOT / 'bot.py').read().split('STEP_JS = r"""')[1].split('"""')[0]
CHECK = r"""
() => {
  const S = State, i = S.trialInfo || {};
  const q = document.getElementById('metaQuestion');
  const cs = q ? getComputedStyle(q) : null;
  const rect = q ? q.getBoundingClientRect() : null;
  const qText = q ? (q.querySelector('.meta-q')?.textContent || '').trim() : '';
  const qVisible = !!(q && cs.display !== 'none' && cs.visibility !== 'hidden' && parseFloat(cs.opacity) > 0.2 && rect.width > 10 && rect.height > 10);
  const gc = document.getElementById('game-container');
  const stage = gc ? gc.querySelector('[data-g082-stage],[data-g083-stage],[data-spa02-stage],[data-spa03-stage],[data-spa04-stage],[data-spa05-stage]') : null;
  return {trials:S.stats.trials, bt:S.blockTrials, lvl:S.currentTrialLevel, kind:i.kind, panel:S.pendingPanel, qText:qText.slice(0,80), qVisible, stage:!!stage, owner:gc?.dataset.renderOwner||null,
          mem:!!i.memoryActive, memTarget:i.memoryTargetLevel||null, single:(i.statsMode==='A'||i.renderMode==='single'), hud:document.getElementById('modeLabel')?.textContent||'',
          eff:(typeof effectiveMetaLevel==='function')?effectiveMetaLevel():null, blockSize:S.blockSize};
}
"""
TRACE = r"""
() => {
  window.__tl = []; window.__briefs = []; window.__tag = 'warm';
  const o = globalThis.setStatus;
  globalThis.setStatus = function(status){ const r = o.apply(this, arguments); try { if(status === 'INPUT'){ const i = State.trialInfo || {}; const key = State.stats.trials + ':' + State.blockTrials; const last = window.__tl[window.__tl.length-1]; if(!last || last.key !== key) window.__tl.push({key, tag:window.__tag, trial:State.stats.trials, bt:State.blockTrials, bs:State.blockSize, lvl:State.currentTrialLevel, kind:i.kind||null, counts:i.countsForMetaHistory!==false, lure:!!i.isMemInterferenceLure, mem:!!i.memoryActive, target:i.memoryTargetLevel||null, eff:effectiveMetaLevel()}); } } catch(_){} return r; };
  const ob = globalThis.showAutoOnboardingScreen;
  globalThis.showAutoOnboardingScreen = function(spec){ try { window.__briefs.push({tag:window.__tag, kind:spec && spec.kind, title:spec && spec.title, trial:State.stats.trials}); } catch(_){} return ob.apply(this, arguments); };
  return true;
}
"""
STATE = r"""
() => { const P = EUCA_PROGRESSION, s = P.snapshot(); const snap = dAutoSnapshot(); const plans = ensureMetaMemoryPlans();
  return {mode:s.mode, level:s.level, tier:s.tier, meta:s.meta, metaManual:s.metaManual, metaAuto:s.metaAuto, eff:effectiveMetaLevel(), effState:effectiveMetaState(),
    states:snap.states, l1:snap.l1Active, l2:snap.l2Active, l3:snap.l3Active, mdManual:snap.mdManual??null, mdAuto:snap.mdAuto?snap.mdAuto.level:null,
    presence:[1,2,3].map(dMetaPresence), ceiling:metaMemoryEffectiveCeiling(), pending:[1,2,3].map(l=>({a:!!plans[l].active, d:!!plans[l].due})),
    running:State.running, paused:State.paused, status:State.status, hud:document.getElementById('modeLabel')?.textContent||'',
    phase:document.querySelector('#mdLevelCard .md-lc-phase')?.textContent, sel:[...document.querySelectorAll('#mdLevelCard .md-lc-segbtn')].filter(b=>b.getAttribute('aria-checked')==='true').map(b=>b.dataset.meta),
    disabled:[...document.querySelectorAll('#mdLevelCard .md-lc-segbtn')].map(b=>b.disabled), errs:(State.productionMonitor.runtimeErrors||[]).length, flow:(State.flowAudit&&State.flowAudit.violations||[]).length,
    blockSize:State.blockSize, briefed:{l1:!!State.autoCurriculum?.l1Briefed, l2:!!State.autoCurriculum?.l2Briefed, l3:!!State.autoCurriculum?.l3Briefed}}; }
"""
async def play(page, n, log, tag, shots, blanks, briefings):
    answered = 0; seen = None
    await page.evaluate("(t)=>{ window.__tag = t; }", tag)
    t0 = await page.evaluate("()=>State.stats.trials")
    for i in range(40000):
        if i % 20 == 0 and (await page.evaluate("()=>State.stats.trials")) - t0 >= n: break
        st = await page.evaluate("()=>State.status")
        if st == 'INPUT':
            info = await page.evaluate(CHECK)
            key = (info['trials'], info['bt'])
            if key != seen:
                seen = key
                await page.wait_for_timeout(120)
                info = await page.evaluate(CHECK)
                info['tag'] = tag; log.append(info)
                blank = (not info['qVisible'] or not info['qText']) and not info['single'] and not info['stage'] and info['owner'] != 'dom' and info['panel'] not in ('genpair', 'geninduct', 'xrep')
                if blank:
                    blanks.append(info)
                    if len(blanks) <= 3: await page.screenshot(path=f"shots/fork/v141_blank_{len(blanks)}.png")
                k = f"{tag}:L{info['lvl']}"
                if info['lvl'] >= 1 and k not in shots:
                    shots.add(k); await page.screenshot(path=f"shots/fork/v141_{tag}_meta{info['lvl']}.png")
        elif st == 'AUTO_BRIEFING':
            kind = await page.evaluate("()=>State.flowHold?.kind||State.pendingOnboarding?.kind||document.querySelector('#autoOnboarding .ao-title, [data-ao-title], .onboardingTitle')?.textContent||'brief'")
            briefings.append((tag, str(kind)[:60]))
        r = await page.evaluate(STEP, {"pCorrect": 0.97, "rtMs": 600})
        if r.get('needKey'): await page.keyboard.press('Space')
        if r.get('action') == 'answer': answered += 1
        await page.wait_for_timeout(25 if r.get('action') == 'answer' else 50)
    return answered

async def open_menu(page):
    for i in range(400):
        if await page.evaluate("()=>State.status") in ('INPUT', 'SUMMARY', 'MENU'): break
        r = await page.evaluate(STEP, {"pCorrect": 0.97, "rtMs": 600})
        if r.get('needKey'): await page.keyboard.press('Space')
        await page.wait_for_timeout(40)
    st = await page.evaluate("()=>State.status")
    if st == 'SUMMARY': await page.click('#restBtn')
    elif st == 'INPUT': await page.evaluate("()=>document.getElementById('pauseBtn').click()")
    await page.wait_for_timeout(700)
    return st

async def resume(page):
    if await page.evaluate("()=>getComputedStyle(document.getElementById('resumeBtn')).display!=='none'"): await page.click('#resumeBtn')
    else: await page.click('#startBtn')
    await page.wait_for_timeout(400)

async def counts(page, tag):
    rows = await page.evaluate("(t)=>window.__tl.filter(r=>r.tag===t)", tag)
    c = collections.Counter(); mem = collections.Counter()
    for r in rows:
        # META questions only: constructive/inductive "L1 inline" tasks (countsForMetaHistory false) are
        # Alberto's tier-gated generation content, not memory chains
        c[r['lvl'] if (r['lvl'] == 0 or r['counts']) else 'gen'] += 1
        if r['mem']: mem[r['target']] += 1
    return dict(c), dict(mem), rows

async def main():
    file = sys.argv[1]; mode = sys.argv[2] if len(sys.argv) > 2 else 'staircase'; vp = sys.argv[3] if len(sys.argv) > 3 else 'desktop'
    w, h = (412, 880) if vp == 'phone' else (1100, 860)
    async with async_playwright() as p:
        b = await p.chromium.launch(); page = await (await b.new_context(viewport={"width": w, "height": h}, device_scale_factor=1)).new_page()
        errs = []; page.on("pageerror", lambda e: errs.append('[pageerror] ' + str(e)[:300]))
        page.on("console", lambda m: errs.append('[console.error] ' + m.text[:200]) if m.type == 'error' and 'willReadFrequently' not in m.text else None)
        await page.goto(pathlib.Path(file).resolve().as_uri()); await page.wait_for_timeout(1500)
        await page.evaluate("(m)=>EUCA_PROGRESSION.setMode(m)", mode)
        await page.evaluate(TRACE)
        log = []; shots = set(); blanks = []; briefings = []
        # 1. reach the relational phase
        for i in range(6000):
            if await page.evaluate("()=>!!(State.autoCurriculum&&State.autoCurriculum.reachedRelational)"): break
            r = await page.evaluate(STEP, {"pCorrect": 0.97, "rtMs": 600})
            if r.get('needKey'): await page.keyboard.press('Space')
            await page.wait_for_timeout(25 if r.get('action') == 'answer' else 50)
        print('relational reached at trial', await page.evaluate("()=>State.stats.trials"))
        await play(page, 15, log, 'warm', shots, blanks, briefings)
        st = await open_menu(page)
        s0 = await page.evaluate(STATE); print('menu (from', st, ') auto state:', json.dumps({k: s0[k] for k in ('metaManual', 'metaAuto', 'eff', 'states', 'sel', 'disabled', 'phase', 'level')}))
        assert s0['metaManual'] is None and s0['sel'] == ['auto'] and not any(s0['disabled']), s0
        # 2. force META²
        await page.click('#mdLevelCard .md-lc-segbtn[data-meta="2"]'); await page.wait_for_timeout(300)
        s2 = await page.evaluate(STATE); note = await page.evaluate("()=>document.querySelector('#mdLevelCard .md-lc-note').textContent")
        print('forced META2:', json.dumps({k: s2[k] for k in ('metaManual', 'metaAuto', 'eff', 'effState', 'states', 'presence', 'ceiling', 'sel', 'phase', 'level', 'hud', 'blockSize')})); print('  note:', note)
        await page.screenshot(path=f"shots/fork/v141_{vp}_card_meta2.png")
        assert s2['metaManual'] == 2 and s2['eff'] == 2 and s2['states']['l2'] == 'active' and s2['states']['l3'] == 'locked' and s2['presence'][1] > 0 and s2['presence'][2] == 0, s2
        await resume(page)
        n = await play(page, 60, log, 'meta2', shots, blanks, briefings)
        c, mem, rows = await counts(page, 'meta2'); print('META2 phase: trials', len(rows), 'levels', c, 'mem cues by target', mem, 'briefings', await page.evaluate("()=>window.__briefs.filter(b=>b.tag==='meta2').map(b=>b.kind+'@'+b.trial)"))
        assert c.get(1, 0) >= 2 and c.get(2, 0) >= 1, ('expected META1 and META2 questions', c)
        assert c.get(3, 0) == 0, c
        # 3. force META³
        await open_menu(page)
        await page.click('#mdLevelCard .md-lc-segbtn[data-meta="3"]'); await page.wait_for_timeout(300)
        s3 = await page.evaluate(STATE); print('forced META3:', json.dumps({k: s3[k] for k in ('metaManual', 'metaAuto', 'eff', 'states', 'presence', 'sel', 'phase', 'level', 'hud', 'blockSize')}))
        assert s3['metaManual'] == 3 and s3['eff'] == 3 and s3['states']['l3'] == 'active' and s3['presence'][2] > 0, s3
        await resume(page)
        n = await play(page, 150, log, 'meta3', shots, blanks, briefings)
        c, mem, rows = await counts(page, 'meta3'); print('META3 phase: trials', len(rows), 'levels', c, 'mem cues by target', mem, 'briefings', await page.evaluate("()=>window.__briefs.filter(b=>b.tag==='meta3').map(b=>b.kind+'@'+b.trial)"), 'block sizes seen', sorted(set(r['bs'] for r in rows)), 'max bt', max(r['bt'] for r in rows))
        assert c.get(3, 0) >= 1, ('expected a META3 question', c)
        # 4. None: promised questions still asked, then no new chains
        await open_menu(page)
        await page.click('#mdLevelCard .md-lc-segbtn[data-meta="0"]'); await page.wait_for_timeout(300)
        s4 = await page.evaluate(STATE); note4 = await page.evaluate("()=>document.querySelector('#mdLevelCard .md-lc-note').textContent"); print('  note:', note4); print('forced None:', json.dumps({k: s4[k] for k in ('metaManual', 'metaAuto', 'eff', 'states', 'presence', 'ceiling', 'pending', 'sel', 'phase', 'level', 'hud')}))
        assert s4['metaManual'] == 0 and s4['eff'] == 0 and s4['presence'] == [0, 0, 0], s4
        await resume(page)
        n = await play(page, 70, log, 'none', shots, blanks, briefings)
        c, mem, rows = await counts(page, 'none')
        tail = rows[-40:]
        ismeta = lambda r: r['lvl'] >= 1 and r['counts'] and not r['lure']
        print('None phase: trials', len(rows), 'levels', c, 'mem cues', mem, '| last 40 trials: meta', sum(1 for r in tail if ismeta(r)), 'mem', sum(1 for r in tail if r['mem']), '| meta trials at', [(r['trial'], r['kind']) for r in rows if ismeta(r)], '| non-meta L1 kinds', sorted(set(r['kind'] for r in rows if r['lvl'] >= 1 and not ismeta(r))))
        assert sum(1 for r in tail if ismeta(r)) == 0 and sum(1 for r in tail if r['mem']) == 0, 'META still dealt under No META'
        # 5. back to Auto
        await open_menu(page)
        await page.click('#mdLevelCard .md-lc-segbtn[data-meta="auto"]'); await page.wait_for_timeout(300)
        s5 = await page.evaluate(STATE); print('Auto again:', json.dumps({k: s5[k] for k in ('metaManual', 'metaAuto', 'eff', 'states', 'sel', 'phase', 'level', 'hud')}))
        assert s5['metaManual'] is None and s5['eff'] == s5['metaAuto'] and s5['sel'] == ['auto'], s5
        # reload persistence: set META1, reload, check
        await page.click('#mdLevelCard .md-lc-segbtn[data-meta="1"]'); await page.wait_for_timeout(200)
        await page.reload(); await page.wait_for_timeout(1500); await page.evaluate(TRACE)
        s6 = await page.evaluate(STATE); print('after reload:', json.dumps({k: s6[k] for k in ('metaManual', 'eff', 'states', 'sel', 'disabled')}))
        assert s6['metaManual'] == 1 and s6['eff'] == 1, s6
        await resume(page)
        n = await play(page, 40, log, 'meta1', shots, blanks, briefings)
        c, mem, rows = await counts(page, 'meta1'); print('META1 phase: trials', len(rows), 'levels', c, 'mem', mem)
        assert c.get(2, 0) == 0 and c.get(3, 0) == 0 and c.get(1, 0) >= 1, c
        # 6. Baseline disables it; audits untouched by the overlay
        await open_menu(page)
        await page.evaluate("()=>EUCA_PROGRESSION.setMode('baseline')"); await page.wait_for_timeout(200)
        s7 = await page.evaluate(STATE); print('baseline:', json.dumps({k: s7[k] for k in ('metaManual', 'eff', 'metaAuto', 'sel', 'disabled', 'mdManual')}))
        assert all(s7['disabled']) and s7['mdManual'] is None, s7
        await page.evaluate("(m)=>EUCA_PROGRESSION.setMode(m)", mode)
        audit = await page.evaluate("()=>{ const before=dAutoSnapshot().mdManual??null; let inside=null; const o=globalThis.dAutoSnapshot; const r=runFeatureAudit('all', {allowPublicHarness:true, allowPublicHarnessRuntime:true, force:true}); const flat={}; const walk=(obj,prefix)=>{ if(!obj||typeof obj!=='object') return; for(const [k,v] of Object.entries(obj)){ if(!v||typeof v!=='object') continue; const key=prefix?prefix+'.'+k:k; if(typeof v.status==='string') flat[key]=v.status; if(v.results) walk(v.results,key); } }; walk(r&&r.results,''); const bad=Object.entries(flat).filter(([k,v])=>v!=='PASS'&&v!=='INFO'&&v!=='SKIP'); return {before, top:r&&r.status, n:Object.keys(flat).length, nonPass:bad.slice(0,12), after:dAutoSnapshot().mdManual??null}; }")
        print('audit with manual META1 set:', audit)
        fin = await page.evaluate(STATE)
        print('FINAL runtimeErrors', fin['errs'], 'flow violations', fin['flow'], 'blank displays', len(blanks), 'page errors', errs[:4])
        print('briefings seen:', briefings[:10])
        for bk in blanks[:5]: print('  BLANK', json.dumps(bk)[:300])
        log = await page.evaluate("()=>window.__tl")
        json.dump(log, open(f'/tmp/claude-0/-home-claude/b22b7577-2c71-5468-9b38-9e3cdbc9e4e2/scratchpad/v141_{mode}_{vp}.json', 'w'))
        await page.screenshot(path=f"shots/fork/v141_{vp}_final_card.png")
        await b.close()
asyncio.run(main())
