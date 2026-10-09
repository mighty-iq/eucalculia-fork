"""Compare two audit_run.py dumps (e.g. the untouched base vs a fork build).
usage: python3 tests/audit_diff.py tests/"audit_base (untouched v7.1.22).json" out/fork.json"""
import sys, json
base = json.load(open(sys.argv[1])); fork = json.load(open(sys.argv[2]))
print('top', base['topStatus'], '->', fork['topStatus'], '| err', base['err'], '->', fork['err'])
diffs = [(k, base['flat'].get(k), fork['flat'].get(k)) for k in sorted(set(base['flat']) | set(fork['flat'])) if base['flat'].get(k) != fork['flat'].get(k)]
print('feature-audit diffs:', len(diffs)); [print('  ', d) for d in diffs]
for sec in ('extra', 'handlers'):
    b, f = base.get(sec) or {}, fork.get(sec) or {}
    dd = [(k, b.get(k), f.get(k)) for k in sorted(set(b) | set(f)) if json.dumps(b.get(k), sort_keys=True) != json.dumps(f.get(k), sort_keys=True)]
    print(sec, 'diffs:', len(dd)); [print('  ', str(d)[:300]) for d in dd]
print('runtimeErrors', fork.get('runtimeErrors'), 'pageErrors', fork.get('pageErrors'))
print('known timing/sampling noise when the whole suite runs at once: mask_symbol_cloud, auditChoiceSemanticEntropy, auditSpatialFamily_*, auditV6828VisibleCandidateInduction, auditV6824 mid-session — each passes when run alone')
