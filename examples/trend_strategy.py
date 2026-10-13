#!/usr/bin/env python3
"""Example: connect your own Python strategy to `hodl-agent listen`. Python 3.9+, standard library only.
Usage: HODL_SIGNAL_SECRET=<secret> [PORT=8787] [INTERVAL_SECONDS=900] [DRY_RUN=1] python3 examples/trend_strategy.py
"""
import json
import os
import time
import urllib.error
import urllib.request

PORT = int(os.environ.get("PORT", "8787"))
INTERVAL_SECONDS = int(os.environ.get("INTERVAL_SECONDS", "900"))
DRY_RUN = os.environ.get("DRY_RUN") == "1"
SECRET = os.environ.get("HODL_SIGNAL_SECRET", "")
if not SECRET and not DRY_RUN:
    raise SystemExit("Set HODL_SIGNAL_SECRET (the same value listen uses), or DRY_RUN=1")

# ===== 1. Example strategy – replace with your model =====
N = 4  # "in trend" = last close above the average of the last N 15-minute closes (4 = 1 hour)


def closes(pair):
    # Coinbase public candles, no API key. Rows are newest first: [time, low, high, open, close, volume].
    url = f"https://api.exchange.coinbase.com/products/{pair}/candles?granularity=900"
    req = urllib.request.Request(url, headers={"User-Agent": "hodl-trend-example"})
    with urllib.request.urlopen(req, timeout=15) as res:
        return [row[4] for row in reversed(json.load(res)[:300])]  # last 300, oldest first


def in_trend(c):
    return c[-1] > sum(c[-N:]) / N


def get_target_weights():
    """Returns (btc_trend, eth_trend, weights). Weights are percent per asset and sum to 100."""
    btc, eth = in_trend(closes("BTC-USD")), in_trend(closes("ETH-USD"))
    if btc and eth:
        return btc, eth, {"cbBTC": 50, "WETH": 50}
    if btc:
        return btc, eth, {"cbBTC": 50, "USDC": 50}
    if eth:
        return btc, eth, {"WETH": 50, "USDC": 50}
    return btc, eth, {"USDC": 100}

# ===== 2. HODL connection – the only code a fund adds =====
def send_weights(weights):
    """POSTs the weights to the local agent. Returns True when the agent accepted them (202)."""
    req = urllib.request.Request(
        f"http://127.0.0.1:{PORT}/signal", data=json.dumps({"weights": weights}).encode(), method="POST",
        headers={"content-type": "application/json", "x-signal-secret": SECRET},
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as res:
            print(f"  -> {res.status} signal_id {json.load(res)['signal_id']}")
            return True
    except urllib.error.HTTPError as err:  # 401 = wrong secret, 400 = invalid weights
        print(f"  -> HTTP {err.code}: {err.read().decode()}")
    except urllib.error.URLError as err:
        print(f"  -> listen is not reachable on port {PORT} ({err.reason}); retrying next loop")
    return False


# Send at start, then only when the target changes. A failed send is retried next loop.
last_sent = None
while True:
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    try:
        btc, eth, weights = get_target_weights()
    except Exception as err:  # price feed down: skip this loop
        print(f"{now}  price data failed: {err}")
    else:
        status = "dry run" if DRY_RUN else ("no change" if weights == last_sent else "sent")
        print(f"{now}  BTC trend {btc}  ETH trend {eth}  target {json.dumps(weights)}  {status}")
        if status == "sent" and send_weights(weights):
            last_sent = weights
    time.sleep(INTERVAL_SECONDS)
