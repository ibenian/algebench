// expert-client — what the caller is told when the request goes wrong.
//
// The whole point of this module is that a failed expert call arrives as an
// ExpertError carrying enough to act on: the status, a 429's Retry-After, and
// for a 422 the FIELD that failed. A generic "request failed" for all of those
// is exactly what it exists to avoid, so each branch is pinned here.

import test from 'node:test';
import assert from 'node:assert/strict';

import { DERIVE_TIMEOUT_MS, ExpertError, invokeExpert } from './expert-client.js';

/**
 * The request init invokeExpert builds. Narrower than RequestInit — it is the
 * literal that module writes, so the assertions below can read
 * `headers['content-type']` and `signal` without re-narrowing every time.
 */
interface ExpertRequestInit {
    method: string;
    headers: Record<string, string>;
    body: string;
    signal: AbortSignal | undefined;
}

/** One recorded fetch call: the arguments the stub was handed. */
interface StubCall {
    url: string;
    opts: ExpertRequestInit;
}

interface StubFetchOptions {
    status?: number;
    body?: unknown;
    headers?: Record<string, string>;
    json?: boolean;
}

/** A fetch stub returning one canned response; records the call it saw. */
function stubFetch(
    { status = 200, body = {}, headers = {}, json = true }: StubFetchOptions = {},
): StubCall[] {
    const calls: StubCall[] = [];
    // The stub answers only the Response members expert-client reads (ok,
    // status, headers.get, json), and is handed only the arguments that module
    // passes — so it stands in for the real fetch through one cast here rather
    // than implementing Response and the full fetch overload set.
    globalThis.fetch = (async (url: string, opts: ExpertRequestInit) => {
        calls.push({ url, opts });
        return {
            ok: status >= 200 && status < 300,
            status,
            headers: { get: (k: string) => headers[k] ?? null },
            json: async () => {
                if (!json) throw new SyntaxError('not JSON');
                return body;
            },
        };
    }) as unknown as typeof fetch;
    return calls;
}

test('posts JSON to the named expert and returns the parsed body', async () => {
    const calls = stubFetch({ body: { ok: 1 } });
    const out = await invokeExpert('proof_animation', { a: 1 });
    assert.deepEqual(out, { ok: 1 });
    assert.equal(calls.length, 1);
    // `calls[0]!` throughout: the await above has already returned, so the
    // stub was called and the length assertion right here proves it.
    assert.equal(calls[0]!.url, '/api/expert/proof_animation');
    assert.equal(calls[0]!.opts.method, 'POST');
    assert.equal(calls[0]!.opts.headers['content-type'], 'application/json');
    assert.equal(calls[0]!.opts.body, '{"a":1}');
    assert.equal(calls[0]!.opts.signal, undefined);   // no timeout → no abort signal
});

test('the expert name is URL-encoded, and a missing body posts {}', async () => {
    const calls = stubFetch();
    await invokeExpert('a/b c', null);
    // `!`: the awaited call went through the stub, so calls[0] exists.
    assert.equal(calls[0]!.url, `/api/expert/${encodeURIComponent('a/b c')}`);
    assert.equal(calls[0]!.opts.body, '{}');
});

test('a non-JSON success body is tolerated, not thrown', async () => {
    stubFetch({ json: false });
    assert.equal(await invokeExpert('x', {}), null);
});

test('a 429 reports its Retry-After in seconds', async () => {
    stubFetch({ status: 429, body: {}, headers: { 'Retry-After': '12' } });
    const err = await invokeExpert('x', {}).then(() => null, (e) => e);
    assert.ok(err instanceof ExpertError);
    assert.equal(err.status, 429);
    assert.equal(err.retryAfter, 12);
    assert.match(err.message, /Too many requests/);
});

test('a 429 without a usable Retry-After reports null, not NaN', async () => {
    stubFetch({ status: 429, body: {}, headers: {} });
    const err = await invokeExpert('x', {}).then(() => null, (e) => e);
    assert.equal(err.retryAfter, null);
});

test('a 422 names the field that failed', async () => {
    stubFetch({
        status: 422,
        body: { detail: [{ loc: ['body', 'target_latex'], msg: 'field required' }] },
    });
    const err = await invokeExpert('x', {}).then(() => null, (e) => e);
    assert.equal(err.status, 422);
    assert.equal(err.message, 'target_latex: field required');
    assert.deepEqual(err.detail, [{ loc: ['body', 'target_latex'], msg: 'field required' }]);
});

test('a 422 whose detail has no usable loc still surfaces the message', async () => {
    stubFetch({ status: 422, body: { detail: [{ msg: 'bad request shape' }] } });
    const err = await invokeExpert('x', {}).then(() => null, (e) => e);
    assert.equal(err.message, 'bad request shape');
});

test('a server error prefers the body error string', async () => {
    stubFetch({ status: 500, body: { error: 'expert exploded' } });
    const err = await invokeExpert('x', {}).then(() => null, (e) => e);
    assert.equal(err.message, 'expert exploded');
    assert.equal(err.status, 500);
});

test('a server error with no error string falls back to the status', async () => {
    stubFetch({ status: 503, body: {} });
    const err = await invokeExpert('x', {}).then(() => null, (e) => e);
    assert.equal(err.message, 'Request failed (503).');
});

test('an unreachable server is reported as such, with status 0', async () => {
    globalThis.fetch = async () => { throw new TypeError('failed to fetch'); };
    const err = await invokeExpert('x', {}).then(() => null, (e) => e);
    assert.ok(err instanceof ExpertError);
    assert.equal(err.status, 0);
    assert.equal(err.timedOut, false);
    assert.equal(err.message, 'Could not reach the server.');
});

test('the client timeout aborts and is distinguishable from a network failure', async () => {
    // Same stand-in as stubFetch, minus the response: this one never settles
    // until the abort fires. `signal!` — timeoutMs is set below, so
    // invokeExpert always builds an AbortController for this call.
    globalThis.fetch = ((_url: string, opts: ExpertRequestInit) => new Promise((_resolve, reject) => {
        opts.signal!.addEventListener('abort', () => reject(new Error('aborted')));
    })) as unknown as typeof fetch;
    const err = await invokeExpert('x', {}, { timeoutMs: 5 }).then(() => null, (e) => e);
    assert.ok(err instanceof ExpertError);
    assert.equal(err.timedOut, true);
    assert.equal(err.status, 0);
    assert.match(err.message, /took too long/);
});

test('the derivation timeout stays above the backend refine budget', () => {
    // Contract with backend/experts/modules/proof_completion/module.py
    // (_TIME_BUDGET, 240s): budget + a full in-flight attempt + the build.
    assert.equal(DERIVE_TIMEOUT_MS, 360_000);
    assert.ok(DERIVE_TIMEOUT_MS > 240_000);
});
