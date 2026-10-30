#!/usr/bin/env python3
"""Generate the HOME candidate from the owner's original LG file; never deploy it."""
import argparse
import hashlib
import json
from pathlib import Path

ORIGINAL = 'a28d9fee1256258b56727dd3827c3925c07badbb51349a8c1a8189fdfbbb1279'
PATCHED = 'bf89d18f597ade2b226c6cacefadfd1eb578af936b846afba957d9bd0e99874e'


def transform(body, changes):
    for before, after in changes:
        if not before or body.count(before) != 1:
            raise ValueError('Unknown or ambiguous HOME code')
        body = body.replace(before, after, 1)
    return body


def generate(original):
    if hashlib.sha256(original).hexdigest() != ORIGINAL:
        raise ValueError('Unknown firmware: no patch generated')
    changes = json.loads(Path(__file__).with_name('home-changes.json').read_text())
    candidate = transform(original.decode('utf-8'), changes).encode('utf-8')
    if hashlib.sha256(candidate).hexdigest() != PATCHED:
        raise ValueError('Unexpected candidate: no patch generated')
    return candidate


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('original', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    candidate = generate(args.original.read_bytes())
    with args.output.open('xb') as output:
        output.write(candidate)
