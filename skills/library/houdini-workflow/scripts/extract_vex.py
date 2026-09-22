"""Extract every VEX snippet (and key parameters) from extracted .hip tree.

Usage:
    python extract_vex.py <extracted_root> <out_dir> [subnet_path]

Args:
    extracted_root: directory produced by extract_hip.py
    out_dir:        directory where outputs are written
    subnet_path:    OPTIONAL relative path inside extracted_root to start from
                    (default: entire extracted tree)

Outputs (in out_dir):
    01_all_wrangles.md       — every VEX snippet, indexed by node path
    02_all_node_key_params.txt — non-wrangle nodes' key parameters
"""
import re
import sys
from pathlib import Path

INIT_TYPE_RE = re.compile(r"^\s*type\s*=\s*(\S+)", re.MULTILINE)

WRANGLE_TYPES = {"attribwrangle", "attribvop", "pointwrangle", "primitivewrangle"}

KEY_PARMS = {
    "attribwrangle": ["class", "group", "grouptype", "snippet"],
    "blast":         ["group", "grouptype", "negate", "removegrp"],
    "groupcreate":   ["groupname", "grouptype", "groupbase",
                      "basegroup", "geotype",
                      "boundtype", "doboundtask", "boundpointgroup"],
    "groupexpression": ["groupname", "grouptype", "snippet"],
    "facet":         ["consolidatepts", "makeplanar", "postsnap"],
    "fuse::2.0":     ["distance", "tol3d", "snaptype"],
    "scatter::2.0":  ["density", "npts", "seed", "emission_attrib"],
    "scatter":       ["density", "npts", "seed", "emission_attrib"],
    "copytopoints":  ["sourcegroup", "targetgroup"],
    "switch":        ["input"],
    "delete":        ["group", "grouptype", "negate"],
    "divide":        ["smooth", "convex", "brick", "plane"],
    "polyextrude::2.0": ["dist", "group", "grouptype", "outputfront", "outputside", "outputback"],
    "polyextrude":   ["dist", "group", "grouptype"],
    "transform":     ["t", "r", "s", "p"],
    "xform":         ["t", "r", "s", "p"],
    "color":         ["color", "colortype", "class"],
    "measure::2.0":  ["measure", "attribname", "perimeter"],
    "isooffset":     ["dist", "output", "tx", "ty", "tz"],
    "polyexpand2d":  ["off", "divs", "postcorner"],
    "peak":          ["dist"],
    "normal":        ["type", "cuspangle"],
    "primitive":     ["dotrans", "translate", "scale"],
    "ends":          ["close", "unrollu", "unrollv"],
    "resample":      ["length", "maxsegs", "minsegs"],
    "for_begin":     ["method", "blockpath", "itermethod"],
    "block_begin":   ["method", "blockpath", "itermethod"],
    "block_end":     ["itermethod", "blockpath", "method"],
    "groupcombine":  ["combinetype", "groupname"],
    "groupdelete":   ["group1"],
    "grouptransfer": ["sourcename", "destname"],
    "object_merge":  ["objpath1", "objpath2", "xformtype"],
}


def parse_init(p):
    if not p.exists():
        return "?"
    m = INIT_TYPE_RE.search(p.read_text(encoding="utf-8", errors="replace"))
    return m.group(1) if m else "?"


def parse_parm_file(p):
    """Return dict of name -> raw value (string with quotes preserved)."""
    if not p.exists():
        return {}
    txt = p.read_text(encoding="utf-8", errors="replace")
    lines = txt.splitlines()
    result = {}
    i = 0

    def balanced_terminator(s):
        in_q = False
        depth = 0
        esc = False
        for ch in s:
            if esc:
                esc = False
                continue
            if ch == '\\':
                esc = True
                continue
            if ch == '"':
                in_q = not in_q
            if not in_q:
                if ch == '(':
                    depth += 1
                elif ch == ')':
                    if depth == 0:
                        return True
                    depth -= 1
        return False

    while i < len(lines):
        line = lines[i]
        m = re.match(r'^(\S+)\s*\[[^\]]*\]\s*\(\s*(.*)$', line)
        if not m:
            i += 1
            continue
        name = m.group(1)
        rest = m.group(2)
        buf = rest
        while not balanced_terminator(buf):
            i += 1
            if i >= len(lines):
                break
            buf += "\n" + lines[i]
        in_q = False
        esc = False
        depth = 0
        close_idx = -1
        for idx, ch in enumerate(buf):
            if esc:
                esc = False
                continue
            if ch == '\\':
                esc = True
                continue
            if ch == '"':
                in_q = not in_q
            if not in_q:
                if ch == '(':
                    depth += 1
                elif ch == ')':
                    if depth == 0:
                        close_idx = idx
                        break
                    depth -= 1
        val = buf[:close_idx].strip() if close_idx >= 0 else buf.strip()
        if val.startswith('"') and val.endswith('"'):
            val = val[1:-1]
        result[name] = val
        i += 1
    return result


def list_node_dirs(directory):
    if not directory.is_dir():
        return []
    nodes = []
    seen = set()
    for child in sorted(directory.iterdir()):
        n = child.name
        if n.startswith("__") and ("postit" in n or "stickynote" in n or "dot" in n):
            continue
        if "." in n:
            base, ext = n.rsplit(".", 1)
            if ext in ("def", "init", "parm", "userdata", "spareparmdef", "net", "order", "inp"):
                if base in seen:
                    continue
                seen.add(base)
                nodes.append(base)
        else:
            if n in seen:
                continue
            seen.add(n)
            nodes.append(n)
    return nodes


def walk(directory, path_prefix=""):
    """Yield (full_path, type, parm_path) for every node."""
    for name in list_node_dirs(directory):
        full = f"{path_prefix}/{name}" if path_prefix else name
        init_p = directory / f"{name}.init"
        parm_p = directory / f"{name}.parm"
        sub_d = directory / name
        ntype = parse_init(init_p)
        yield (full, ntype, parm_p)
        if sub_d.is_dir():
            yield from walk(sub_d, full)


def short(val, max_len=120):
    if val is None:
        return ""
    s = str(val).replace("\n", " ⏎ ")
    if len(s) > max_len:
        return s[:max_len] + " …"
    return s


def find_default_subnet(extracted_root):
    """Cover every network; do not silently inspect only the first geometry."""
    return extracted_root


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)
    extracted_root = Path(sys.argv[1])
    out_dir = Path(sys.argv[2])
    out_dir.mkdir(parents=True, exist_ok=True)
    if len(sys.argv) > 3:
        base = extracted_root / sys.argv[3]
    else:
        base = find_default_subnet(extracted_root)

    out_vex = out_dir / "01_all_wrangles.md"
    out_keypm = out_dir / "02_all_node_key_params.txt"
    n_vex = 0
    with out_vex.open("w", encoding="utf-8") as fv, out_keypm.open("w", encoding="utf-8") as fk:
        fv.write(f"# All Wrangle (VEX) snippets — {base.name}\n\n")
        fk.write(f"# Key parameters per node — {base.name}\n\n")
        for path, ntype, parm in walk(base):
            parms = parse_parm_file(parm)
            if ntype in WRANGLE_TYPES:
                snippet = parms.get("snippet", "")
                klass = parms.get("class", "")
                grp = parms.get("group", "")
                if snippet.strip():
                    n_vex += 1
                    fv.write(f"## `{path}`  ({ntype}, class={klass!r}, group={grp!r})\n\n")
                    fv.write("```c\n")
                    fv.write(snippet)
                    fv.write("\n```\n\n")
            keys = KEY_PARMS.get(ntype, [])
            kept = {k: parms[k] for k in keys if k in parms and parms[k] not in ("", '""')}
            if kept:
                fk.write(f"{path}  ({ntype})\n")
                for k, v in kept.items():
                    fk.write(f"    {k} = {short(v)}\n")
                fk.write("\n")
    print(f"Wrote {n_vex} VEX snippets to {out_vex}")
    print(f"Wrote key params to {out_keypm}")
