#!/usr/bin/env python3
"""CI wall · NatSpec (OPS-A4-41, draft).

Every public or external function in src/ has NatSpec right above it:
@notice, one @param per named parameter, and @return when it returns.
Usage: check_natspec.py [files...]  (default: every .sol file under src/)
"""
from __future__ import annotations
import pathlib, re, sys

FUNC = re.compile(r"^\s*function\s+(\w+)\s*\(([^)]*)\)([^{;]*)[{;]", re.M | re.S)


def doc_above(src: str, start: int) -> str:
    """The /// or /** */ comment block directly above position `start`."""
    lines = src[:start].rstrip().split("\n")
    block = []
    for line in reversed(lines):
        s = line.strip()
        if s.startswith("///") or s.startswith("*") or s.startswith("/**") or s.endswith("*/"):
            block.append(s)
        else:
            break
    return "\n".join(reversed(block))


def params(sig: str) -> list[str]:
    out = []
    for p in [x.strip() for x in sig.split(",") if x.strip()]:
        parts = p.split()
        if len(parts) >= 2 and parts[-1] not in ("memory", "calldata", "storage", "payable"):
            out.append(parts[-1])
    return out


def check_file(path: pathlib.Path) -> list[str]:
    src = path.read_text()
    problems = []
    for m in FUNC.finditer(src):
        name, sig, tail = m.group(1), m.group(2), m.group(3)
        if not re.search(r"\b(public|external)\b", tail):
            continue
        doc = doc_above(src, m.start())
        line = src[:m.start(1)].count("\n") + 1  # the line of the name, not a blank line above
        missing = []
        if "@notice" not in doc:
            missing.append("@notice")
        for p in params(sig):
            if not re.search(rf"@param\s+{re.escape(p)}\b", doc):
                missing.append(f"@param {p}")
        if re.search(r"\breturns\b", tail) and "@return" not in doc:
            missing.append("@return")
        if missing:
            problems.append(f"{path}:{line}: function {name} is missing {', '.join(missing)}")
    return problems


def main(argv: list[str]) -> int:
    files = [pathlib.Path(a) for a in argv] or sorted(pathlib.Path("src").rglob("*.sol"))
    problems = [p for f in files for p in check_file(f)]
    for p in problems:
        print(p)  # the plain W-31 line
        path, line, rest = p.split(":", 2)
        print(f"::error file={path},line={line},title=Wall: NatSpec::{rest.strip()} (OPS-A4-41)")
    if not problems:
        print(f"NatSpec complete on {len(files)} file(s).")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
