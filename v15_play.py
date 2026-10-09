"""Fork v1.5 — live checks: peek on META¹/META² with its accounting, retained-items hint,
META hold diagnostics (no long holds), block-start hold reset, block summary peek count.
usage: python3 v15_play.py <file.html> [mode] [viewport]"""
import pathlib as _pl, os as _os
_ROOT = _pl.Path(__file__).resolve().parents[1]
for _d in ('shots/fork', 'shots/learn'): (_ROOT / _d).mkdir(parents=True, exist_ok=True)
_os.chdir(_ROOT)
import sys, json, asyncio, pathlib, collections, functools
print = functools.partial(print, flush=True)
from playwright.async_api import async_playwright
STEP = open(_ROOT / 'bot.py').read().split('STEP_JS = r"""')[1].split('"""')[0]
SNAP = r"""
() => { const i = State.trialInfo || {}; const P = EUCA_PROGRESSION; const s = P.state;
  const op = i.op && i.op.id; const l1 = op && State.meta.l1Stats[op] ? {...State.meta.l1Stats[op], rt:undefined} : null;
  const w = State.dL1Window || []; const w2 = State.dL2Window || [];
  return {kind:i.kind, lvl:State.currentTrialLevel, status:State.status, op, l1, l1WinN:w.length, l1WinLast:w.length ? w[w.length-1].correct : null, l2WinN:w2.length, l2WinLast:w2.length ? w2[w2.length-1].correct : null,
    l2c:State.meta.l2Stats && State.meta.l2Stats.c, spacing:s.spacing.level, outcomes:s.spacing.outcomes.slice(), theta:s.rating.theta, peeks:JSON.parse(JSON.stringify(s.peeks)), correct:State.stats.correct, trials:State.stats.trials, bt:State.blockTrials,
    peekRow:!!document.querySelector('#metaQuestion .md-peek.visible'), peekBtns:[...document.querySelectorAll('#metaQuestion .md-peek-btn')].map(b=>b.textContent), hint:(document.querySelector('#metaQuestion .md-scope-hint.visible')||{}).textContent||'',
    pair2b:i.pair2 ? i.pair2.b : null, rawR1:i.rawR1 ?? null, phase:State.autoPhase, mem:!!i.memoryActive, lure:!!i.isMemInterferenceLure, counts:i.countsForMetaHistory !== false,
    phaseStat:(State.meta.autoPhaseStats && State.meta.autoPhaseStats.L1) ? {t:State.meta.autoPhaseStats.L1.t, c:State.meta.autoPhaseStats.L1.c} : null,
    l1Of:op => { const b = State.meta.l1Stats[op]; return b ? {t:b.t, c:b.c} : null; }}; }
"""
L1OF = "(op) => { const b = State.meta.l1Stats[op]; return b ? {t:b.t, c:b.c} : null; }"

async def step(page, p=0.97):
    r = await page.evaluate(STEP, {"pCorrect": p, "rtMs": 600})
    if r.get('needKey'): await page.keyboard.press('Space')
    await page.wait_for_timeout(25 if r.get('action') == 'answer' else 50)
    return r
async def main():
    file = sys.argv[1]; mode = sys.argv[2] if len(sys.argv) > 2 else 'staircase'; vp = sys.argv[3] if len(sys.argv) > 3 else 'desktop'
    w, h = (412, 880) if vp == 'phone' else (1100, 860)
    async with async_playwright() as p:
        b = await p.chromium.launch(); page = await (await b.new_context(viewport={"width": w, "height": h}, device_scale_factor=1)).new_page()
        errs = []; page.on("pageerror", lambda e: errs.append('[pageerror] ' + str(e)[:300]))
        page.on("console", lambda m: errs.append('[console.error] ' + m.text[:200]) if m.type == 'error' and 'willReadFrequently' not in m.text else None)
        await page.goto(pathlib.Path(file).resolve().as_uri()); await page.wait_for_timeout(1500)
        await page.evaluate("(m)=>EUCA_PROGRESSION.setMode(m)", mode)
        for i in range(6000):
            if await page.evaluate("()=>!!(State.autoCurriculum&&State.autoCurriculum.reachedRelational)"): break
            await step(page)
        print('relational at trial', await page.evaluate("()=>State.stats.trials"))
        done = {'meta1': False, 'meta2': False, 'meta1_nopeek': False}; shots = set(); results = {}
        seen = None
        for i in range(60000):
            if all(done.values()): break
            if (await page.evaluate("()=>State.stats.trials")) > 520: break
            st = await page.evaluate("()=>State.status")
            if st == 'INPUT':
                key = await page.evaluate("()=>State.stats.trials+':'+State.blockTrials")
                if key != seen:
                    seen = key
                    s0 = await page.evaluate(SNAP)
                    if s0['kind'] == 'meta1' and s0['counts'] and not s0['lure'] and not done['meta1']:
                        await page.wait_for_timeout(150); s0 = await page.evaluate(SNAP)
                        print('META1 trial:', json.dumps({k: s0[k] for k in ('peekRow', 'peekBtns', 'hint', 'pair2b', 'op', 'l1', 'l1WinN', 'spacing', 'outcomes', 'theta', 'phaseStat')}, ensure_ascii=False)[:600])
                        assert s0['peekRow'] and len(s0['peekBtns']) == 4, s0
                        await page.screenshot(path=f"shots/fork/v15_{vp}_meta1_peekrow.png")
                        await page.click('#metaQuestion .md-peek-btn[data-slot="p2b"]'); await page.wait_for_timeout(200)
                        s1 = await page.evaluate(SNAP)
                        print('  after peek:', s1['peekBtns'], 'pair2.b =', s1['pair2b'])
                        assert any(bt.startswith('Pair 2 RIGHT') and bt.endswith('= ' + str(s1['pair2b'])) for bt in s1['peekBtns']), s1['peekBtns']
                        await page.screenshot(path=f"shots/fork/v15_{vp}_meta1_peeked.png")
                        # answer correctly
                        r = await page.evaluate(STEP, {"pCorrect": 1.0, "rtMs": 600}); await page.wait_for_timeout(400)
                        s2 = await page.evaluate(SNAP); l1after = await page.evaluate(L1OF, s0['op'])
                        print('  answered', r.get('correct'), '→ l1Stats[op]', s0['l1'], '→', l1after, '| dL1Window last', s2['l1WinLast'], '| outcomes', s2['outcomes'], '| theta', round(s0['theta']), '→', round(s2['theta']), '| peeks', s2['peeks'], '| stats.correct', s0['correct'], '→', s2['correct'], '| L1 phase stats', s0['phaseStat'], '→', s2['phaseStat'])
                        results['meta1'] = {'before': s0, 'after': s2, 'correct': r.get('correct')}
                        if r.get('correct'):
                            assert (l1after or {}).get('c', 0) == (s0['l1'] or {}).get('c', 0) and (l1after or {}).get('t', 0) == (s0['l1'] or {}).get('t', 0) + 1, 'lifetime META¹ credit should not grow on a peeked answer'
                            assert s2['l1WinLast'] is False, 'readiness window should record a miss'
                            assert s2['outcomes'] and s2['outcomes'][-1] is False, 'spacing should record a miss'
                            assert s2['peeks']['n'] == 1 and s2['peeks']['correct'] == 1, s2['peeks']
                            assert s2['correct'] == s0['correct'] + 1, 'visible accuracy keeps the real answer'
                            if s2['phaseStat'] and s0['phaseStat'] and s0['phaseStat']['t'] is not None: assert s2['phaseStat']['c'] == s0['phaseStat']['c'], 'phase stats should not credit a peeked answer'
                            if mode == 'rating': assert s2['theta'] <= s0['theta'] + 0.01, 'a peeked correct answer must not earn rating'
                        done['meta1'] = True
                        continue
                    if s0['kind'] == 'meta1' and s0['counts'] and not s0['lure'] and done['meta1'] and not done['meta1_nopeek']:
                        # a normal (un-peeked) META¹ afterwards keeps crediting
                        r = await page.evaluate(STEP, {"pCorrect": 1.0, "rtMs": 600}); await page.wait_for_timeout(400)
                        s2 = await page.evaluate(SNAP); l1after = await page.evaluate(L1OF, s0['op'])
                        if r.get('correct'):
                            print('  un-peeked META1: l1Stats[op]', s0['l1'], '→', l1after, 'outcomes', s2['outcomes'], 'peeks', s2['peeks']['n'], 'L1 phase', s0['phaseStat'], '→', s2['phaseStat'])
                            assert l1after['c'] == ((s0['l1'] or {}).get('c', 0)) + 1 and s2['peeks']['n'] == 1
                            assert s2['phaseStat']['c'] == s0['phaseStat']['c'] + 1
                            done['meta1_nopeek'] = True
                        continue
                    if s0['kind'] == 'meta2' and not done['meta2']:
                        await page.wait_for_timeout(150); s0 = await page.evaluate(SNAP)
                        print('META2 trial:', json.dumps({k: s0[k] for k in ('peekRow', 'peekBtns', 'hint', 'rawR1', 'l2c', 'l2WinN')}, ensure_ascii=False)[:500])
                        assert s0['peekRow'] and s0['peekBtns'][:2] == ['Answer 1', 'Answer 2'], s0['peekBtns']
                        assert 'trials ago' in s0['hint'] or 'just now' in s0['hint'], s0['hint']
                        await page.screenshot(path=f"shots/fork/v15_{vp}_meta2_hint.png")
                        await page.click('#metaQuestion .md-peek-btn[data-slot="a1"]'); await page.wait_for_timeout(150)
                        s1 = await page.evaluate(SNAP); print('  after peek:', s1['peekBtns'][:2])
                        assert s1['peekBtns'][0] == 'Answer 1 = ' + str(s1['rawR1']), s1['peekBtns']
                        r = await page.evaluate(STEP, {"pCorrect": 1.0, "rtMs": 600}); await page.wait_for_timeout(400)
                        s2 = await page.evaluate(SNAP)
                        print('  answered', r.get('correct'), '→ l2Stats.c', s0['l2c'], '→', s2['l2c'], 'dL2Window last', s2['l2WinLast'], 'peeks', s2['peeks'])
                        if r.get('correct'): assert s2['l2c'] == s0['l2c'] and s2['l2WinLast'] is False
                        done['meta2'] = True
                        continue
            await step(page)
        print('done:', done)
        # block summary line mentions peeks (wait for a SUMMARY)
        for i in range(4000):
            if await page.evaluate("()=>State.status") == 'SUMMARY': break
            await step(page)
        line = await page.evaluate("()=>(document.getElementById('mdSummaryLine')||{}).textContent||''")
        seal = await page.evaluate("()=>({crest:!!document.getElementById('summaryCrest'), sealClass:!!(document.getElementById('summaryCrest')&&document.getElementById('summaryCrest').classList.contains('md-seal')), ring:!!document.querySelector('#summaryCrest .md-seal-ring'), logos:document.querySelectorAll('#summaryCard img').length})")
        print('summary line:', line[:200], '| seal', seal)
        await page.screenshot(path=f"shots/fork/v15_{vp}_summary_seal.png")
        # hold reset on block start: fake a held plan, start a new block
        await page.click('#restBtn'); await page.wait_for_timeout(500)
        res = await page.evaluate("()=>{ const P=ensureMetaMemoryPlans(); const p=P[1]; const was={due:p.due}; p.due=true; p._mdDueTrial=State.stats.trials+30; const before=EUCA_PROGRESSION.snapshot().deferred; resetBlock(); const after=EUCA_PROGRESSION.snapshot().deferred; const until=p._mdDueTrial; p.due=was.due; return {before, after, until, trials:State.stats.trials}; }")
        print('hold reset at block start:', res); assert res['before'] == 1 and res['after'] == 0 and res['until'] <= res['trials'], res
        # META delivery log: holds
        log = await page.evaluate("()=>EUCA_PROGRESSION.metaLog")
        due = {}; gaps = collections.defaultdict(list)
        for e in log:
            if e['event'] == 'due': due[e['level']] = e['trial']
            elif e['event'] == 'dealt' and e['level'] in due: gaps[e['level']].append(e['trial'] - due.pop(e['level']))
        print('META delivery gaps (trials from due to dealt):', {k: v for k, v in gaps.items()}, '| spacing now', await page.evaluate("()=>EUCA_PROGRESSION.snapshot().spacing"))
        for lv, g in gaps.items():
            if lv >= 2: assert max(g) <= 3, f'META{lv} waited {max(g)} trials'
            else: assert max(g) <= 7, f'META1 waited {max(g)} trials'
        fin = await page.evaluate("()=>({errs:(State.productionMonitor.runtimeErrors||[]).length, flow:(State.flowAudit&&State.flowAudit.violations||[]).length, trials:State.stats.trials})")
        print('FINAL', fin, 'page errors', errs[:4])
        await b.close()
asyncio.run(main())
