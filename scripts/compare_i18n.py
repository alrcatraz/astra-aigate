#!/usr/bin/env python3
import json

def flatten(d, prefix=''):
    items = {}
    for k, v in d.items():
        path = f'{prefix}.{k}' if prefix else k
        if isinstance(v, dict):
            items.update(flatten(v, path))
        else:
            items[path] = str(v)
    return items

en_path = 'src/i18n/messages/en.json'
langs = [
    ('zh-CN', 'src/i18n/messages/zh-CN.json'),
    ('zh-TW', 'src/i18n/messages/zh-TW.json'),
]

with open(en_path) as f:
    en = flatten(json.load(f))
en_keys = set(en.keys())
print(f'en.json total keys: {len(en_keys)}')

for name, path in langs:
    with open(path) as f:
        target = flatten(json.load(f))
    target_keys = set(target.keys())
    missing = en_keys - target_keys
    extra = target_keys - en_keys

    print(f'\n{"="*60}')
    print(f'{name}.json total keys: {len(target_keys)}')
    print(f'Missing: {len(missing)} | Extra: {len(extra)}')
    
    if missing:
        print(f'\n--- Missing in {name}.json ---')
        for k in sorted(missing):
            v = en[k]
            v_trunc = v[:120] + '...' if len(v) > 120 else v
            print(f'  {k}')
            print(f'    en: {v_trunc}')
    
    if extra:
        print(f'\n--- Extra keys only in {name}.json ---')
        for k in sorted(extra):
            v = target[k]
            v_trunc = v[:120] + '...' if len(v) > 120 else v
            print(f'  {k} = {v_trunc}')
