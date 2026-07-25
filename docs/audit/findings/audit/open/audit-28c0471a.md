---
id: audit-28c0471a
auditor: audit
severity: low
category: reliability
area: src/registry/client.ts
status: open
found: 2026-07-26
---

# No proxy support: the registry client ignores HTTPS_PROXY

## Problem

`registryFor()` resolves which registry to contact, but nothing configures how to reach it. `fetch` is called bare at `client.ts` in both `fetchManifest` and `fetchLatest`, and Node's `fetch` does not honour `HTTP_PROXY` / `HTTPS_PROXY` without an explicit `ProxyAgent` dispatcher.

This is the residual of `audit-62ad8201`, which was resolved as fixed for the registry-URL and scope-authentication half. Splitting it out rather than leaving it inside a resolved finding, so the store does not report work as complete when part of it was not done.

## Evidence

`grep -rn 'ProxyAgent\|dispatcher\|HTTPS_PROXY' src/` returns nothing. The two `fetch` calls pass only `signal`.

## Impact

On a network that requires an egress proxy, every registry request fails. Behaviour is no longer silent — the failure counter added alongside the parent finding prints `Warning: N registry lookup(s) failed; the reported ranges may be too permissive` — so the run degrades loudly rather than lying. But the tool still cannot resolve anything in that environment, and `--offline` with a populated `node_modules` is the only workaround.

## Fix

Node ships `ProxyAgent` in undici; wire it when a proxy variable is present:

    import { ProxyAgent, setGlobalDispatcher } from 'undici'

    const proxy = process.env.HTTPS_PROXY ?? process.env.https_proxy
    if (typeof proxy === 'string' && proxy !== '') {
      setGlobalDispatcher(new ProxyAgent(proxy))
    }

`undici` is not currently a direct dependency, so this either adds one or waits for a stable global-agent API. Honour `NO_PROXY` before enabling it. Add a test that asserts the dispatcher is set when the variable is present.
