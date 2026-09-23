#!/usr/bin/env python3
"""Resolve every conflict block in the given files by keeping ours then theirs.
Only for files where both sides add independent lines (CHANGELOG, ROADMAP)."""
import re, sys
for p in sys.argv[1:]:
    s = open(p).read()
    pat = re.compile(r'<<<<<<< [^\n]*\n(.*?)=======\n(.*?)>>>>>>> [^\n]*\n', re.S)
    s, n = pat.subn(lambda m: m.group(1) + m.group(2), s)
    open(p, 'w').write(s)
    print(f'{p}: {n} block(s) joined')
