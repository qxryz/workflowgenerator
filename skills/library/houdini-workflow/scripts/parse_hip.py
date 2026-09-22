"""Parse extracted Houdini .hip directory: dump SOP topology with input edges.

Usage:
    python parse_hip.py <extracted_root> <output_file> [subnet_path]

Args:
    extracted_root: directory produced by extract_hip.py (contains obj/, etc.)
    output_file:    path to write topology dump (text)
    subnet_path:    OPTIONAL relative path inside extracted_root to start dumping
                    from (default: entire extracted tree). Example: "obj/box1"

Output format:
    indented tree of node_name (node_type) <- [0]input1, [1]input2, ...
"""
import re
import sys
from pathlib import Path

INPUTS_RE = re.compile(r"inputsNamed3\s*\{(.*?)\}", re.DOTALL)
INPUT_LINE_RE = re.compile(r'^\s*(\d+)\s+(\S+)\s+(\d+)\s+(\d+)\s+"([^"]+)"')


def get_node_type(init_path):
    if not init_path.exists():
        return None
    text = init_path.read_text(encoding="utf-8", errors="replace")
    m = re.search(r"^\s*type\s*=\s*(\S+)", text, re.MULTILINE)
    return m.group(1) if m else "?"


def read_def_inputs(def_path):
    if not def_path.exists():
        return []
    txt = def_path.read_text(encoding="utf-8", errors="replace")
    m = INPUTS_RE.search(txt)
    if not m:
        return []
    inputs = []
    for line in m.group(1).splitlines():
        m2 = INPUT_LINE_RE.match(line)
        if m2:
            idx = int(m2.group(1))
            src = m2.group(2)
            inputs.append((idx, src))
    return inputs


def list_nodes_in(directory):
    """Return list of (node_name, def_path, init_path, has_subnet_dir)"""
    if not directory.is_dir():
        return []
    nodes = []
    seen = set()
    for child in sorted(directory.iterdir()):
        n = child.name
        if n.startswith("_") and ("postit" in n or "stickynote" in n or "dot" in n):
            continue
        if "." in n:
            base, ext = n.rsplit(".", 1)
            if ext in ("def", "init", "parm", "inp", "userdata", "spareparmdef", "net", "order"):
                if base in seen:
                    continue
                seen.add(base)
                def_path = directory / f"{base}.def"
                init_path = directory / f"{base}.init"
                subnet_dir = directory / base
                nodes.append((base, def_path, init_path, subnet_dir.is_dir()))
        else:
            if n in seen:
                continue
            seen.add(n)
            def_path = directory / f"{n}.def"
            init_path = directory / f"{n}.init"
            nodes.append((n, def_path, init_path, True))
    return nodes


def dump_tree(directory, prefix="", depth=0, max_depth=999, file=sys.stdout):
    nodes = list_nodes_in(directory)
    for name, def_p, init_p, has_sub in nodes:
        node_type = get_node_type(init_p) or "?"
        inputs = read_def_inputs(def_p)
        in_str = ""
        if inputs:
            in_str = "  <- " + ", ".join(f"[{i}]{src}" for i, src in inputs)
        print(f"{prefix}{name}  ({node_type}){in_str}", file=file)
        if has_sub and depth < max_depth:
            sub = directory / name
            dump_tree(sub, prefix + "  ", depth+1, max_depth, file)


def find_default_subnet(extracted_root):
    """Cover every network; do not silently inspect only the first geometry."""
    return extracted_root


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)
    extracted_root = Path(sys.argv[1])
    out_path = Path(sys.argv[2])
    if len(sys.argv) > 3:
        root = extracted_root / sys.argv[3]
    else:
        root = find_default_subnet(extracted_root)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w", encoding="utf-8") as f:
        print(f"# SOP topology (root: {root})\n", file=f)
        dump_tree(root, file=f)
    print(f"Wrote {out_path}")
