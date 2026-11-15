"""Fails when Slither reports a finding that is not explained in slither-triage.json.

Usage: python3 slither-gate.py slither.json slither-triage.json
"""
import json
import re
import sys


def key_of(det: dict) -> str:
    first = det["description"].splitlines()[0].strip()
    first = re.sub(r"\s*\(src/[^)]*\)", "", first)  # drop "(src/File.sol#12-34)" locations
    return f'{det["check"]}: {first}'


def main() -> int:
    out = json.load(open(sys.argv[1]))
    triage = {f["key"]: f["reason"] for f in json.load(open(sys.argv[2]))["findings"]}
    dets = out.get("results", {}).get("detectors", [])
    seen = set()
    unexplained = []
    for d in dets:
        k = key_of(d)
        seen.add(k)
        if k not in triage:
            unexplained.append((d["impact"], k))
    print(f"{len(dets)} findings, {len(dets) - len(unexplained)} explained in slither-triage.json")
    stale = [k for k in triage if k not in seen]
    for k in stale:
        print(f"note: triaged finding no longer reported: {k}")
    for impact, k in unexplained:
        print(f"UNEXPLAINED [{impact}] {k}")
    return 1 if unexplained else 0


if __name__ == "__main__":
    sys.exit(main())
