import json, sys, math
a = json.load(open(sys.argv[1])); b = json.load(open(sys.argv[2]))
diffs = []
def cmp(x, y, path):
    if isinstance(x, dict) and isinstance(y, dict):
        for k in sorted(set(x) | set(y)):
            if k not in x: diffs.append((path + '.' + k, '<assente>', y[k]))
            elif k not in y: diffs.append((path + '.' + k, x[k], '<assente>'))
            else: cmp(x[k], y[k], path + '.' + k)
    elif isinstance(x, list) and isinstance(y, list):
        if len(x) != len(y): diffs.append((path, f'len {len(x)}', f'len {len(y)}')); return
        for i, (p, q) in enumerate(zip(x, y)): cmp(p, q, f'{path}[{i}]')
    elif isinstance(x, (int, float)) and isinstance(y, (int, float)) and not isinstance(x, bool):
        if not (x == y or abs(x - y) <= 1e-6 * max(1, abs(x), abs(y))): diffs.append((path, x, y))
    elif x != y: diffs.append((path, x, y))
snaps = [k for k in a if k.startswith('s') and k != 'scripts']
for k in snaps: cmp(a[k], b[k], k)
cmp(a['log'], b['log'], 'log'); cmp(a['errors'], b['errors'], 'errors')
n = 0
for k in snaps:
    d = [x for x in diffs if x[0].startswith(k + '.') or x[0] == k]
    print(f'{k:8s} differenze: {len(d)}')
print('log      differenze:', len([x for x in diffs if x[0].startswith('log')]))
for p, x, y in diffs[:25]: print(' ', p, '|', str(x)[:90], '|', str(y)[:90])
print('TOTALE differenze:', len(diffs))
