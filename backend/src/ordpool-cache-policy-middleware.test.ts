import { NextFunction, Request, Response } from 'express';
import { findCachePolicy, ordpoolCachePolicy } from './ordpool-cache-policy-middleware';

describe('findCachePolicy — the path→TTL allowlist', () => {
  it('maps the heavy aggregations to edge 120 / browser 60', () => {
    expect(findCachePolicy('/api/v1/mining/pools/1m')).toEqual({ edge: 120, browser: 60 });
    expect(findCachePolicy('/api/v1/mining/hashrate/3d')).toEqual({ edge: 120, browser: 60 });
    expect(findCachePolicy('/api/v1/statistics/2h')).toEqual({ edge: 120, browser: 60 });
    expect(findCachePolicy('/api/v1/difficulty-adjustment')).toEqual({ edge: 120, browser: 60 });
  });

  it('maps the near-real-time endpoints to short edge TTLs', () => {
    expect(findCachePolicy('/api/v1/blocks/tip/height')).toEqual({ edge: 10, browser: 5 });
    expect(findCachePolicy('/api/v1/fees/recommended')).toEqual({ edge: 15, browser: 5 });
  });

  it('maps immutable block-by-hash resources to the 30d "forever" tier', () => {
    expect(findCachePolicy('/api/v1/block/00000000000000000000abc')).toEqual({ edge: 2592000, browser: 86400 });
    expect(findCachePolicy('/api/v1/block/00000000000000000000abc/txs')).toEqual({ edge: 2592000, browser: 86400 });
  });

  it('does NOT confuse /api/v1/blocks (the changing list) with /api/v1/block/ (immutable)', () => {
    // the trailing-slash distinction is load-bearing: the recent-blocks list and
    // the tip height must NOT get the 30d tier.
    expect(findCachePolicy('/api/v1/blocks/tip/height')).toEqual({ edge: 10, browser: 5 });
    expect(findCachePolicy('/api/v1/blocks')).toBeUndefined();
    expect(findCachePolicy('/api/v1/blocks/0/15')).toBeUndefined();
  });

  it('returns undefined for paths that must stay DYNAMIC', () => {
    // mutating / broadcast / websocket / per-entity lookups are never cached
    expect(findCachePolicy('/api/tx')).toBeUndefined();
    expect(findCachePolicy('/api/v1/ws')).toBeUndefined();
    expect(findCachePolicy('/api/address/bc1qxyz')).toBeUndefined();
    expect(findCachePolicy('/api/v1/blocks/tip/hash')).toBeUndefined();
    expect(findCachePolicy('/')).toBeUndefined();
  });
});

describe('ordpoolCachePolicy middleware', () => {
  function mockRes() {
    const headers: Record<string, string> = {};
    const res: Partial<Response> & { _headers: Record<string, string>; statusCode: number } = {
      statusCode: 200,
      _headers: headers,
      setHeader: jest.fn((k: string, v: string) => { headers[k.toLowerCase()] = v; return res as Response; }) as any,
      removeHeader: jest.fn((k: string) => { delete headers[k.toLowerCase()]; }) as any,
      writeHead: jest.fn(() => res as Response) as any,
    };
    return res;
  }

  it('stamps max-age + s-maxage (and clears Expires/Pragma) on a 200 for a cacheable path', () => {
    const req = { method: 'GET', path: '/api/v1/mining/pools/1m' } as Request;
    const res = mockRes();
    // upstream handler set the weak header + Expires we must override
    res._headers['cache-control'] = 'public';
    res._headers['expires'] = 'Tue, 08 Sep 2026 11:18:11 GMT';
    const next = jest.fn() as NextFunction;

    ordpoolCachePolicy(req, res as unknown as Response, next);
    expect(next).toHaveBeenCalledTimes(1);

    // the handler now flushes headers → our wrapped writeHead fires
    (res.writeHead as any)(200, {});

    expect(res._headers['cache-control']).toBe('public, max-age=60, s-maxage=120');
    expect(res._headers['vary']).toBe('Accept-Encoding');
    expect(res._headers['expires']).toBeUndefined();
  });

  it('does NOT stamp cache headers on a 5xx (a transient error must not be pinned)', () => {
    const req = { method: 'GET', path: '/api/v1/mining/pools/1m' } as Request;
    const res = mockRes();
    const next = jest.fn() as NextFunction;

    ordpoolCachePolicy(req, res as unknown as Response, next);
    (res.writeHead as any)(502, {});

    expect(res._headers['cache-control']).toBeUndefined();
  });

  it('passes through untouched for a non-allowlisted path (stays DYNAMIC)', () => {
    const req = { method: 'GET', path: '/api/address/bc1qxyz' } as Request;
    const res = mockRes();
    const originalWriteHead = res.writeHead;
    const next = jest.fn() as NextFunction;

    ordpoolCachePolicy(req, res as unknown as Response, next);

    expect(next).toHaveBeenCalledTimes(1);
    // writeHead was not wrapped
    expect(res.writeHead).toBe(originalWriteHead);
  });

  it('passes through untouched for a non-GET method (e.g. POST /api/tx-shaped)', () => {
    const req = { method: 'POST', path: '/api/v1/mining/pools/1m' } as Request;
    const res = mockRes();
    const originalWriteHead = res.writeHead;
    const next = jest.fn() as NextFunction;

    ordpoolCachePolicy(req, res as unknown as Response, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.writeHead).toBe(originalWriteHead);
  });
});
