#!/usr/bin/env python3
"""Мелкие утилиты обработки изображений без scipy.

label_components: связные области (4-связность) через объединение
горизонтальных пробегов — быстро и предсказуемо на картинках 1400x768.
"""
from collections import defaultdict

import numpy as np


def label_components(mask):
    """Возвращает (labels, count). labels — int32, 0 = фон, 1..count — области."""
    h, w = mask.shape
    labels = np.zeros((h, w), dtype=np.int32)
    parent = [0]

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a, b):
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[max(ra, rb)] = min(ra, rb)

    prev_runs = []          # [(start, end, label)]
    next_id = 1
    for y in range(h):
        row = mask[y]
        if not row.any():
            prev_runs = []
            continue

        # пробеги текущей строки
        idx = np.nonzero(np.diff(np.concatenate(([0], row.astype(np.int8), [0]))))[0]
        runs = list(zip(idx[0::2], idx[1::2]))

        cur_runs = []
        pi = 0
        for a, b in runs:
            label = 0
            # ищем пересечения с пробегами предыдущей строки
            while pi < len(prev_runs) and prev_runs[pi][1] <= a:
                pi += 1
            j = pi
            while j < len(prev_runs) and prev_runs[j][0] < b:
                plabel = prev_runs[j][2]
                if label == 0:
                    label = plabel
                else:
                    union(label, plabel)
                j += 1
            if label == 0:
                label = next_id
                parent.append(label)
                next_id += 1
            labels[y, a:b] = label
            cur_runs.append((a, b, label))
        prev_runs = cur_runs

    # нормализуем метки
    remap = defaultdict(int)
    out = np.zeros_like(labels)
    for old in np.unique(labels):
        if old == 0:
            continue
        root = find(int(old))
        if root not in remap:
            remap[root] = len(remap) + 1
        out[labels == old] = remap[root]
    return out, len(remap)


def border_component(mask):
    """Маска областей, касающихся края картинки."""
    labels, n = label_components(mask)
    if n == 0:
        return np.zeros_like(mask, bool)
    edge = np.concatenate([labels[0], labels[-1], labels[:, 0], labels[:, -1]])
    edge_labels = set(int(v) for v in np.unique(edge) if v)
    if not edge_labels:
        return np.zeros_like(mask, bool)
    return np.isin(labels, list(edge_labels))
