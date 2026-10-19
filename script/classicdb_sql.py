# -*- coding: utf-8 -*-
"""Small reader for mysqldump files (the cMaNGOS classic-db Full_DB .sql.gz).
   tables(path, wanted) -> {table: (columns, rows)}  rows are tuples of str/int/float/None."""
import gzip, re

def _open(path):
    return gzip.open(path, "rt", encoding="utf-8", errors="replace") if path.endswith(".gz") else open(path, encoding="utf-8", errors="replace")

def _values(s, i):
    """parse '(..),(..);' starting at s[i]; yields tuples"""
    n = len(s)
    while i < n:
        while i < n and s[i] in " ,\n\r\t": i += 1
        if i >= n or s[i] == ";": return
        assert s[i] == "(", s[i:i + 40]
        i += 1; row = []
        while True:
            c = s[i]
            if c == "'":
                i += 1; buf = []
                while True:
                    c = s[i]
                    if c == "\\":
                        nx = s[i + 1]; buf.append({"n": "\n", "r": "\r", "t": "\t", "0": "\0"}.get(nx, nx)); i += 2
                    elif c == "'":
                        if s[i + 1] == "'": buf.append("'"); i += 2
                        else: i += 1; break
                    else: buf.append(c); i += 1
                row.append("".join(buf))
            else:
                j = i
                while s[j] not in ",)": j += 1
                tok = s[i:j].strip(); i = j
                if tok == "NULL": row.append(None)
                else:
                    try: row.append(int(tok))
                    except ValueError:
                        try: row.append(float(tok))
                        except ValueError: row.append(tok)
            c = s[i]
            if c == ",": i += 1; continue
            if c == ")": i += 1; break
        yield tuple(row)

def tables(path, wanted):
    wanted = set(wanted); cols = {}; out = {t: ([], []) for t in wanted}; cur = None
    with _open(path) as f:
        for line in f:
            m = re.match(r"CREATE TABLE `(\w+)`", line)
            if m:
                cur = m.group(1) if m.group(1) in wanted else None
                if cur: cols[cur] = []
                continue
            if cur and line.startswith("  `"):
                cols[cur].append(line.split("`")[1]); continue
            if line.startswith("INSERT INTO `"):
                t = line.split("`")[1]
                if t not in wanted: continue
                k = line.index("VALUES") + 6
                out[t][1].extend(_values(line, k))
    for t in wanted: out[t] = (cols.get(t, []), out[t][1])
    return out

def dicts(tbl):
    cols, rows = tbl
    return [dict(zip(cols, r)) for r in rows]


class DumpCursor(object):
    """Enough of a pymysql DictCursor over tables read with tables(), so the scripts written for the database also run
    from the dump: SHOW TABLES LIKE, SHOW COLUMNS FROM, SELECT * FROM t [WHERE `col` IN (...)]."""
    def __init__(self, tabs):
        self.t = tabs
        self._res = []

    def execute(self, sql, params=None):
        s = sql.strip()
        if re.match(r"SHOW TABLES LIKE", s, re.I):
            name = params[0] if params else s.split()[-1].strip("'\"")
            self._res = [{"t": name}] if name in self.t and self.t[name][0] else []
            return
        m = re.match(r"SHOW COLUMNS FROM `?(\w+)`?", s, re.I)
        if m:
            self._res = [{"Field": c} for c in self.t[m.group(1)][0]]
            return
        m = re.match(r"SELECT \* FROM `?(\w+)`?(?:\s+WHERE `(\w+)` IN \((.*)\))?\s*$", s, re.I | re.S)
        if m:
            cols, rows = self.t[m.group(1)]
            if m.group(2):
                k = cols.index(m.group(2)); want = set(params or [])
                rows = [r for r in rows if r[k] in want]
            self._res = [dict(zip(cols, r)) for r in rows]
            return
        raise ValueError("DumpCursor cannot run: " + s[:80])

    def fetchall(self):
        return self._res

    def fetchone(self):
        return self._res[0] if self._res else None
