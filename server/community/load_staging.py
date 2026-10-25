"""Bounded load probe against staging loopback only; never routes production writes."""
import argparse
import json
import statistics
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen


def run(seconds):
    receipt = json.loads(Path('/root/tora-community-stage-receipt.json').read_text())
    token_path = Path('/root/tora-community-stage-tickets.json')
    gateway = next(line.split('=',1)[1].strip() for line in Path('/etc/tora-community/gateway.env').read_text().splitlines() if line.startswith('COMMUNITY_GATEWAY_TOKEN='))
    base = 'http://127.0.0.1:8766/v1/community/posts/' + receipt['post_id']
    stop = time.monotonic() + seconds
    results = {'read': [], 'write': []}
    lock = threading.Lock()
    barrier = threading.Barrier(25)

    def worker(index):
        kind = 'read' if index < 20 else 'write'
        barrier.wait()
        count = 0
        while time.monotonic() < stop:
            started = time.monotonic()
            headers = {'Authorization':'Bearer '+gateway,'Content-Type':'application/json'}
            path, method, body = base, 'GET', None
            if kind == 'write':
                tokens = json.loads(token_path.read_text())
                headers['X-Community-Authorization'] = 'Bearer '+tokens[(index-20)%3]
                path += '/bookmark'
                method = 'PUT' if count % 2 == 0 else 'DELETE'
                body = b'{}'
            try:
                with urlopen(Request(path,method=method,headers=headers,data=body),timeout=10) as response:
                    status = response.status
                    value = json.load(response)
                    if value.get('data',{}).get('id') != receipt['post_id']: status = -2
            except HTTPError as error: status = error.code
            except Exception: status = -1
            elapsed = (time.monotonic()-started)*1000
            with lock: results[kind].append((status,elapsed))
            count += 1
            time.sleep(max(0,(1 if kind=='read' else 5)-(time.monotonic()-started)))

    started = time.monotonic()
    with ThreadPoolExecutor(25) as pool: list(pool.map(worker,range(25)))
    report = {'duration_seconds':round(time.monotonic()-started,1),'read_workers':20,'write_workers':5,'transport':'isolated loopback HTTP; public TLS latency excluded'}
    for kind, values in results.items():
        latency = sorted(value[1] for value in values)
        statuses = {}
        for status,_ in values: statuses[str(status)] = statuses.get(str(status),0)+1
        report[kind] = {'requests':len(values),'statuses':statuses,'p95_ms':round(latency[int(len(latency)*.95)-1],2),'maximum_ms':round(max(latency),2),'mean_ms':round(statistics.mean(latency),2)}
    Path('/root/tora-community-load-result.json').write_text(json.dumps(report,indent=2))
    print(json.dumps(report),flush=True)


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--seconds',type=int,default=600)
    run(min(600,max(10,parser.parse_args().seconds)))
