#!/usr/bin/env python3
"""Opt-in WebFTP agent heartbeats; recent signals are not proof of agent health."""
import argparse
from datetime import datetime, timezone
import json
import os
import re
import sys
import time

import task_transport

AGENT = re.compile(r'^[a-z0-9][a-z0-9_-]{0,63}$')
MAX_HEARTBEAT = 4096
RECENT = 300
STALE = 900
CLOCK_SKEW = 60


def filename(agent):
    if not isinstance(agent, str) or not AGENT.fullmatch(agent):
        raise ValueError('Agent id must use lowercase ASCII letters, digits, hyphen or underscore')
    return 'agent-' + agent + '-heartbeat.json'


def write(client, agent, status=''):
    name = filename(agent)
    if not isinstance(status, str) or len(status) > 200 or any(ord(c) < 32 for c in status):
        raise ValueError('Status must be text up to 200 characters without control characters')
    payload = {'agent': agent, 'ts': datetime.now(timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z'), 'status': status, 'alive': True}
    client.put(name, payload)
    return {'agent': agent, 'sent': True, 'ts': payload['ts']}


def classify(agent, payload, now=None):
    filename(agent)
    if (not isinstance(payload, dict) or payload.get('agent') != agent or type(payload.get('alive')) is not bool or
            not isinstance(payload.get('status'), str) or len(payload['status']) > 200 or
            any(ord(c) < 32 for c in payload['status']) or not isinstance(payload.get('ts'), str)):
        return {'agent': agent, 'state': 'unknown'}
    try:
        timestamp = datetime.fromisoformat(payload['ts'].replace('Z', '+00:00'))
        if timestamp.tzinfo is None:
            raise ValueError('Timezone required')
        age = (now if now is not None else time.time()) - timestamp.timestamp()
        if not -CLOCK_SKEW <= age:
            raise ValueError('Timestamp is in the future')
    except (ValueError, OverflowError, OSError):
        return {'agent': agent, 'state': 'unknown'}
    age = max(0, int(age))
    state = 'declared_offline' if not payload['alive'] else 'recent' if age < RECENT else 'stale' if age < STALE else 'expired'
    return {'agent': agent, 'state': state, 'age_seconds': age, 'status': payload['status'], 'ts': payload['ts']}


def read(client, agent):
    name = filename(agent)
    try:
        payload = json.loads(client.get(name, MAX_HEARTBEAT))
        return classify(agent, payload)
    except (ValueError, OSError, TypeError, RecursionError):
        # Missing, unavailable and malformed cannot establish health.
        return {'agent': agent, 'state': 'unknown'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--agent', required=True)
    parser.add_argument('--status', default='')
    parser.add_argument('--interval', type=int, help='Opt in to periodic writes, at least 30 seconds; default writes once')
    args = parser.parse_args()
    try:
        filename(args.agent)
        if args.interval is not None and args.interval < 30:
            raise ValueError('Interval must be at least 30 seconds')
        client = task_transport.WebFTP(os.environ.get('WEBFTP_SHARE', ''), os.environ.get('WEBFTP_BEARER', ''))
        while True:
            print(json.dumps(write(client, args.agent, args.status), ensure_ascii=True), flush=True)
            if args.interval is None:
                return 0
            time.sleep(args.interval)
    except (ValueError, OSError):
        print('Heartbeat failed; check configuration, agent id, share and status.', file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        return 0


if __name__ == '__main__':
    raise SystemExit(main())
