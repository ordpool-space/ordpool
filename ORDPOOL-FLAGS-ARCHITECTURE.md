# Ordpool transaction flags — architecture reference

This document is the canonical reference for **how `tx.flags` is computed,
persisted, transmitted, and consumed** across the ordpool backend, the
ordpool frontend, and the upstream mempool code they fork from. It walks
every code-execution branch where flags are produced or read, explains
what upstream mempool does (so future merges have a baseline), and
explains where we hack ordpool-specific bits into the pipeline.

Keep this document in sync with the code. If a call site moves, this
file is wrong; fix it.

---

## 0. Quick mental model

There are **three independent things** that all use the word "flags":

1. **Upstream mempool flags** — 32 bits of static + dynamic tx-shape
   classification: input/output script types, sighash variants, CPFP /
   RBF / replacement, coinjoin / consolidation / batch_payout, version,
   the cheap `inscription` heuristic, etc. Owned by upstream; we don't
   touch them. Bit positions defined in `mempool.interfaces.ts`'s
   `TransactionFlags` const.

2. **Ordpool flags** — 31 additional bits packed into bits **48–81** of
   the same field. Defined in
   `ordpool-parser/src/types/ordpool-transaction-flags.ts`, exported as
   `OrdpoolTransactionFlags`. Bits 45–47 are a deliberate safety margin
   in case upstream claims more bits on a future merge. The field
   semantically spans 82 bits, which is why everything that touches it
   uses `bigint`.

3. **The combined field** — at rest and on the wire, a JavaScript
   `number`. Note that JS Number can only represent integers exactly up
   to 2^53; ordpool bits (48–81) live *inside* that range only when
   they're a power of two, which they are by construction (each flag is
   `1n << Nn`). So a single-bit round-trip is exact, and any
   AND-of-flags / OR-of-flags that fits in the 48–81 window also
   round-trips exactly. Arithmetic must use `bigint` because JS bitwise
   operators silently truncate the operands to int32 — every ordpool bit
   gets zeroed if you naively `|` two numbers. See
   `__tests__/ordpool-flags-bigint-gotcha.test.ts` (4 tests, including a
   mutation-verified regression against `Common.getTransactionFlags`).

Wire shapes carry the combined field as `flags: number`. Server and
client both know how to interpret the upper 16 bits.

---

## 1. Upstream mempool's flag pipeline

### 1.1 The single producer: `Common.getTransactionFlags`

Upstream defines exactly one producer of `tx.flags`:

```ts
// backend/src/api/common.ts (upstream)
static getTransactionFlags(tx: TransactionExtended, height?: number): number {
  let flags = tx.flags ? BigInt(tx.flags) : 0n;

  // Update variable flags (CPFP, RBF replacement)
  flags &= ~TransactionFlags.cpfp_child;
  if (tx.ancestors?.length)   flags |= TransactionFlags.cpfp_child;
  flags &= ~TransactionFlags.cpfp_parent;
  if (tx.descendants?.length) flags |= TransactionFlags.cpfp_parent;
  flags &= ~TransactionFlags.replacement;
  if (tx.replacement)         flags |= TransactionFlags.replacement;

  // Already processed static flags, no need to do it again
  if (tx.flags) {
    return Number(flags);
  }

  // ... full static-flag derivation: version, script types, sighash,
  //     coinjoin heuristic, fake_pubkey, fake_scripthash,
  //     inscription/op_return scan, ...

  return Number(flags);
}
```

Three properties matter:

1. **It's synchronous in upstream.** Returns `number` directly. No I/O,
   no async work, no DB lookups. Pure tx-bytes → flags.
2. **The early-return at "Already processed static flags, no need to do
   it again"** fires whenever `tx.flags` is truthy on entry. Variable
   bits (CPFP / RBF / replacement) get refreshed unconditionally above
   the early-return; static bits are computed only on the first call.
3. **Every static flag is recomputable from witness/script bytes alone.**
   So once derived, the static bits never change. The early-return is a
   correctness-preserving optimisation.

### 1.2 Call sites of `Common.getTransactionFlags` (backend, upstream baseline)

| File:line | Caller | `tx.flags` state on entry | Why |
|---|---|---|---|
| `mempool.ts:155` | `$setMempool` (disk-cache reload at boot) | persisted from prior process | refresh variable bits after restart; static bits trusted |
| `mempool.ts:191` | new-tx ingest, gated by `!this.mempoolCache[id]` | `undefined` (brand new) | first classification |
| `mempool.ts:326` | new-tx ingest, alternate path (`newTransactions.push`) | `undefined` | first classification |
| `blocks.ts:1563` | block summary builder | inherits from `cpfpSummary.transactions` (which carry mempool flags) | reclassify confirmed txs; static bits trusted |
| `bitcoin-api.ts:411` | tx-fetch with prevouts added | explicitly cleared at `:409` | full reclassification because prevouts may unlock new bits (taproot inscription detection) |
| `Common.classifyTransaction` | also calls `getTransactionFlags`; called by `mempool-blocks.ts:685`, `blocks.ts:243`, summary endpoints | varies | sets `tx.flags = result` |
| `Common.classifyTransactions` | bulk wrapper | varies | per-tx classify |

Upstream design intent: **classify each tx once on ingest**, persist the
result on the in-memory `mempoolCache` and in any downstream summary
table, and rely on the variable-bits-only refresh path for everything
else.

### 1.3 Wire shapes — what carries flags, what strips them

Upstream defines four wire shapes; only two carry flags.

| Type | Definition | Carries `flags`? | Used for |
|---|---|---|---|
| `TransactionStripped` | `{txid, fee, vsize, value, acc?, rate?, time?}` | **No, by design** | `latestTransactions` cache, `/mempool/recent` |
| `TransactionClassified` | `TransactionStripped` + `{flags: number}` | **Yes** | block summaries, classified-tx lists |
| `TransactionCompressed` | tuple `[txid, fee, vsize, value, rate, flags, acceleration?]` | **Yes** (slot 5) | WebSocket mempool delta |
| `MempoolDeltaChange` | tuple `[txid, rate, flags, acceleration?]` | **Yes** (slot 2) | WebSocket per-tx update |
| Full `Transaction` / `MempoolTransactionExtended` | every field, including `flags?: number` | **Optional** — server may set it before shipping, or may not | REST tx detail, WebSocket track-tx, internal data flow |

Two camps:

- **Bulk wire paths** (block summaries, mempool delta): ship `flags`
  explicitly. The client decorates all txs at once based on what came
  over the wire — recomputing N×500 flags client-side would be wasteful.
- **Single-tx / strip paths** (`/api/tx/:txid`, `/mempool/recent`,
  WS track-tx): ship without flags. The client recomputes on demand —
  computing one tx's flags is cheap.

### 1.4 The client-side counterpart: `transaction.utils.ts::getTransactionFlags`

Upstream's frontend mirrors `Common.getTransactionFlags` byte-for-byte:

```ts
// frontend/src/app/shared/transaction.utils.ts (upstream)
export function getTransactionFlags(tx, cpfpInfo?, replacement?, ...): bigint {
  let flags = tx.flags ? BigInt(tx.flags) : 0n;
  // ... variable bits via cpfpInfo / replacement ...
  if (tx.flags) return flags;        // server pre-classified -> trust it
  // ... full static-flag recomputation, identical to backend ...
  return flags;
}
```

The contract: **either the server set `tx.flags` and the client trusts
it, or the server stripped `tx.flags` and the client recomputes
deterministically from witness/script bytes.** Both paths must produce
the same answer for the same tx — that's an invariant upstream depends
on.

### 1.5 Where the upstream design works perfectly

Every upstream flag is derivable from witness/script bytes alone. So
the client-side recompute path is correct by construction. Upstream's
`/api/tx/:txid` shipping a flagless tx is fine — the client computes
all 32 bits from the bytes.

---

## 2. Ordpool's hacks on top of the mempool pipeline

### 2.1 The 31 ordpool flags (bits 48–81)

Source of truth: `ordpool-parser/src/types/ordpool-transaction-flags.ts`.
Upstream owns bits 0–44. Bits 45–47 are a deliberate safety margin in
case upstream claims more bits in a future merge.

**Type flags** (bits 48–58): "what protocol does this tx belong to?"

| Flag | Bit | Source | Recomputable client-side? |
|---|---|---|---|
| `ordpool_atomical` | 48 | witness scan via `AtomicalParserService` | ✅ |
| `ordpool_cat21` | 49 | `tx.nLockTime === 21` | ✅ |
| `ordpool_inscription` | 50 | witness scan via `InscriptionParserService` | ✅ |
| `ordpool_rune` | 51 | `OP_RETURN` scan via `RuneParserService` | ✅ |
| `ordpool_brc20` | 52 | inscription content JSON-parses with `p:'brc-20'` | ✅ |
| `ordpool_src20` | 53 | RC4-encrypted multisig output via `Src20ParserService` | ✅ |
| `ordpool_labitbu` | 54 | NUMS control-block + 4096-byte WebP via `LabitbuParserService` | ✅ |
| `ordpool_counterparty` | 55 | `OP_RETURN` scan via `CounterpartyParserService` | ✅ |
| `ordpool_stamp` | 56 | first-output P2WSH + RC4 + stamp marker | ✅ |
| `ordpool_src721` | 57 | counterparty subset | ✅ |
| `ordpool_src101` | 58 | counterparty subset | ✅ |

**Sub-op flags** (bits 59–80): "what specific operation within that protocol?"

| Flag | Bit | Source | Recomputable client-side? |
|---|---|---|---|
| `ordpool_inscription_mint` | 59 | parser detects an inscription envelope at first-sat | ✅ |
| `ordpool_inscription_image` | 60 | inscription content-type starts with `image/` | ✅ |
| `ordpool_inscription_text` | 61 | inscription content-type starts with `text/` | ✅ |
| `ordpool_inscription_json` | 62 | content-type is `application/json` or text-parseable JSON | ✅ |
| `ordpool_atomical_mint` | 63 | atomical operation `mint` | ✅ |
| `ordpool_atomical_update` | 64 | atomical operation `mod` / `evt` | ✅ |
| `ordpool_cat21_mint` | 65 | always co-set with `ordpool_cat21` (every cat is a mint) | ✅ |
| `ordpool_rune_etch` | 66 | runestone carries an etching | ✅ |
| `ordpool_rune_mint` | 67 | runestone carries a mint | ✅ |
| `ordpool_rune_cenotaph` | 68 | parser flagged runestone as a cenotaph | ✅ |
| `ordpool_brc20_deploy` | 69 | BRC-20 JSON `op:'deploy'` | ✅ |
| `ordpool_brc20_mint` | 70 | BRC-20 JSON `op:'mint'` | ✅ |
| `ordpool_brc20_transfer` | 71 | BRC-20 JSON `op:'transfer'` | ✅ |
| `ordpool_src20_deploy` | 72 | SRC-20 `op:'deploy'` | ✅ |
| `ordpool_src20_mint` | 73 | SRC-20 `op:'mint'` | ✅ |
| `ordpool_src20_transfer` | 74 | SRC-20 `op:'transfer'` | ✅ |
| `ordpool_stamp_image` | 75 | stamp content-type starts with `image/` | ✅ |
| `ordpool_stamp_text` | 76 | stamp content-type starts with `text/` | ✅ |
| `ordpool_stamp_json` | 77 | stamp content is JSON | ✅ |
| `ordpool_atomical_image` | 78 | atomical CBOR payload carries an image file | ✅ |
| `ordpool_atomical_text` | 79 | atomical CBOR payload carries a text file | ✅ |
| `ordpool_atomical_json` | 80 | atomical CBOR payload carries a JSON file | ✅ |

**The indexer-derived odd-one-out** (bit 81):

| Flag | Bit | Source | Recomputable client-side? |
|---|---|---|---|
| **`ordpool_ots`** | **81** | **`ordpoolOtsTxidSet.has(txid)`** in the backend (set by the OTS poller from `ordpool_stats_ots` MariaDB satellite) | ❌ **no — backend-only state** |

Thirty of thirty-one ordpool flags follow the upstream design contract:
parser-derivable, client-recomputable. They piggyback on the
strip-and-recompute pattern.

**`ordpool_ots` is the lone exception.** OTS calendar commits look
like `OP_RETURN OP_PUSHBYTES_32 <32 bytes>` with no magic prefix —
indistinguishable from any other 32-byte OP_RETURN by witness inspection
alone. Identification requires knowing the txid-set of published
calendar commits, which lives only on the backend
(`ordpool_stats_ots` satellite table + the live
`ordpoolOtsTxidSet`).

Twelve of thirteen ordpool flags follow the upstream design contract:
parser-derivable, client-recomputable. They go through the same
strip-and-recompute pattern as upstream's own flags.

**`ordpool_ots` is the lone exception.** The bit answers "did some OTS
calendar publish a Merkle root in this tx's `OP_RETURN` output where the
root commits to user-submitted hashes?" The witness alone does not tell
you which Merkle roots correspond to which calendars, nor whether the
calendar has actually published that root. The only way to know is to
maintain a hot set of "txids known to be OTS commits" — which is what
the `ordpool-ots-poller` does on the backend.

### 2.2 Backend hooks: where ordpool bits get OR'd in

We modify `Common.getTransactionFlags` to be async, and to OR ordpool
bits in after upstream's static-flag block. Post-patch (commit
20b6a364e), the function looks like:

```ts
// backend/src/api/common.ts (our fork)
static async getTransactionFlags(tx: TransactionExtended, height?: number): Promise<number> {
  let flags = tx.flags ? BigInt(tx.flags) : 0n;

  // Variable bits — unchanged from upstream
  flags &= ~TransactionFlags.cpfp_child;
  if (tx.ancestors?.length)   flags |= TransactionFlags.cpfp_child;
  flags &= ~TransactionFlags.cpfp_parent;
  if (tx.descendants?.length) flags |= TransactionFlags.cpfp_parent;
  flags &= ~TransactionFlags.replacement;
  if (tx.replacement)         flags |= TransactionFlags.replacement;

  // HACK -- Ordpool OTS: indexer-derived flag, applied UNCONDITIONALLY
  // ABOVE the early-return. Static-flag bits are safe to skip on re-runs
  // because they're derivable from witness bytes once and forever, but
  // OTS is dynamic (the poller hydrates ordpoolOtsTxidSet asynchronously).
  // A tx classified before the poller observed its calendar batch must
  // pick up the bit on later re-classifications.
  addOtsFlag(tx as { txid: string; _ordpoolFlags?: number });
  const otsFlags = (tx as { _ordpoolFlags?: number })._ordpoolFlags;
  if (otsFlags) flags |= BigInt(otsFlags);

  if (tx.flags) {
    return Number(flags);          // upstream's early-return, preserved
  }

  // ... upstream static-flag derivation, byte-identical ...

  // HACK -- Ordpool: parser ORs in artifact (parser-derived) bits.
  // Static once witness is known, so this only runs on first
  // classification (slow path past the early-return).
  try {
    flags = await DigitalArtifactAnalyserService.analyseTransaction(tx, flags);
  } catch (e) {
    logger.warn('ordpool-parser analyseTransaction failed: ' + ...);
  }

  return Number(flags);
}
```

Two surgical insertions:

- **OTS pre-enrichment** above the early-return. O(1) `Set.has()` so
  cheap to do on every call. Reads/writes `tx._ordpoolFlags` as a
  side-channel (the OTS poller writes this field, we read it).
- **`analyseTransaction` call** at the end of the slow path. Async
  because the parser does brotli/gzip decompression (which uses
  `DecompressionStream`, an async API in jsdom). This is the source of
  the whole-pipeline `async` cascade.

### 2.3 The `async` cascade

Because `Common.getTransactionFlags` is `async` and everything
downstream awaits it, the following upstream entry points became `async`
in our fork:

- `Common.classifyTransaction`, `Common.classifyTransactions`
- `Blocks.summarizeBlockTransactions`
- `Blocks.$getBlockExtended`
- `Mempool.$setMempool` (every call site already `await`s, but the
  semantic shift matters: a single mempool startup now serialises
  through `ordpool-parser` per tx)
- The block-processor's `$processNewBlock`
- The mempool tick

Why this matters for upstream merges: every PR upstream merges that
adds a new call to `Common.getTransactionFlags` will be sync. Our fork
needs to make it `await`. The HACK markers in `common.ts` document this.

### 2.4 The OTS poller

`OrdpoolOtsTxidSet` (`backend/src/api/ordpool-ots-txid-set.ts`) is a
process-singleton `Set<string>` of every txid known to be an OTS
calendar commit. Hydrated at boot from the `ordpool_stats_ots` table
(via `OrdpoolOtsRepository.getAllTxids()`), kept fresh by
`ordpool-ots-poller.ts` (which polls each configured calendar's recent
batches, parses out the txids, calls `set.add(txid)`).

The poller runs every 60 s by default. New txs may sit in mempool for
some time before the poller learns about them — this is the
eventual-consistency window that drives the entire OTS-flag design.

`addOtsFlag(tx)` is the helper that reads from `ordpoolOtsTxidSet` and
writes `tx._ordpoolFlags |= ordpool_ots` if the txid matches. O(1).

### 2.5 Frontend hooks: where ordpool bits get OR'd in (almost)

The frontend's `transaction.utils.ts::getTransactionFlags` is also async
in our fork:

```ts
// frontend/src/app/shared/transaction.utils.ts (our fork)
export async function getTransactionFlags(tx, cpfpInfo?, replacement?, ...): Promise<bigint> {
  let flags = tx.flags ? BigInt(tx.flags) : 0n;
  // ... variable bits (CPFP / RBF / replacement) ...
  if (tx.flags) {
    return flags;                    // server pre-classified -> trust it
  }
  // ... upstream static-flag recomputation, byte-identical ...

  // HACK -- Ordpool: parser ORs in artifact flags. Mirrors backend's
  // call site. NO _ordpoolFlags side-channel read needed -- pure
  // functional contract.
  try {
    flags = await DigitalArtifactAnalyserService.analyseTransaction(tx, flags);
  } catch {
    /* swallow */
  }

  return flags;
}
```

Critically: **the frontend has no `ordpoolOtsTxidSet`.** It cannot
recompute `ordpool_ots`. Whatever path delivers a tx to the frontend
must either:

- ship `tx.flags` with the OTS bit already OR'd in (bulk paths do this),
  OR
- ship a separate signal — see the `isOtsCommit` design in §4.

---

## 3. The wire-surface map (post-patch 20b6a364e)

Walking every wire surface that ships a tx (or tx shape) to a client,
asking: does the OTS bit reach the consumer?

### 3.1 Bulk wire surfaces — OTS bit travels in `tx.flags`

These all flow tx through `Common.classifyTransaction` (which calls
`getTransactionFlags`, which OR's in OTS) before the wire write.
Post-patch, the early-return doesn't drop OTS, so every re-classification
preserves it too.

| Surface | Wire shape | Server entry point | OTS reachable? |
|---|---|---|---|
| `GET /api/v1/block/:hash/summary` | `TransactionClassified[]` | `Blocks.$getStrippedBlockTransactions` → `classifyTransaction` | ✅ |
| `GET /api/v1/block/:hash/tx/:txid/summary` | `TransactionClassified` | `Blocks.$getSingleTxFromSummary` (reads from `blocks_summaries` table — already classified at write time) | ✅ |
| WebSocket mempool delta | `TransactionCompressed[]` | mempool ingest set `tx.flags` at `mempool.ts:155`/`191`/`326` | ✅ |
| WebSocket block-summary push | `TransactionClassified[]` | block processor `summarizeBlockTransactions` | ✅ |
| `blocks_summaries` MariaDB write | JSON of `TransactionClassified[]` | `BlocksSummariesRepository.$saveTransactions` after `classifyTransaction` | ✅ |
| Redis mempool cache | full `MempoolTransactionExtended` including `flags: number` | `redisCache.$addTransaction`, called immediately after the mempool ingest path that classified it | ✅ |
| Disk mempool snapshot | full `MempoolTransactionExtended` including `flags: number` | shutdown path persists the in-memory cache verbatim | ✅ |

### 3.2 Strip surfaces — `tx.flags` is intentionally absent

These follow upstream's strip-and-recompute pattern. Client receives a
tx without flags; client recomputes locally.

| Surface | Wire shape | Server-side flag-source | OTS reachable? |
|---|---|---|---|
| `latestTransactions` cache + `/mempool/recent` | `TransactionStripped[]` | `Common.stripTransaction` drops `flags` by design | N/A — wire shape has no `flags` field, frontend never reads it |
| `GET /api/v1/tx/:txId` | full `Transaction` from `$getTransactionExtended` | **no classification** | ❌ **client can recompute parser-derived bits; OTS missing** |
| WebSocket track-tx | full `MempoolTransactionExtended` from `$getMempoolTransactionExtended` | **no classification** | ❌ **same as above** |

### 3.3 The two holes (specific, scoped)

The strip surfaces in §3.2 are not "bugs" in upstream's design — the
client-side recompute is sufficient because upstream's flags are all
recomputable. **In ordpool, the strip surfaces drop `ordpool_ots`
without any client-side fallback.**

Concrete observable symptom (pre-mitigation):

- Open `https://ordpool.space/tx/<a-known-OTS-commit-txid>` directly
  (cold cache). The OpenTimestamps badge does **not** appear.
- Navigate to the same tx via a block-summary table. The badge **does**
  appear, because the block summary delivered `tx.flags` with the OTS
  bit set.

---

## 4. The `isOtsCommit` mitigation

### 4.1 Wire-shape extension

Add an **optional** field `isOtsCommit: boolean | null` to the wire
shapes that get stripped of `flags`. The field is a tristate:

- `true` — server confirms this tx is in `ordpoolOtsTxidSet` (OTS commit).
- `false` — server confirms this tx is **not** in `ordpoolOtsTxidSet`
  (most txs).
- `null` — server didn't bother computing (use this for the "I don't
  know" case, e.g. a non-OTS-relevant code path).

Where the field appears:

- **REST `GET /api/v1/tx/:txId`** — set by the route handler after
  `$getTransactionExtended`. O(1) `Set.has()` lookup.
- **WebSocket track-tx** — same as above.

Where it does **not** appear:

- Bulk surfaces that already ship `tx.flags`. Pointless duplication.
- `TransactionStripped` (`latestTransactions`). The frontend's recent-tx
  widget doesn't render OTS state. Carrying the field would be useless
  bytes.

### 4.2 Client-side OP_RETURN fast path

`ordpool_ots` requires an `OP_RETURN` output by construction — the
calendar's Merkle root is published in an OP_RETURN, period. So the
client can answer "definitely false" for any tx with zero OP_RETURN
outputs without consulting the server.

Pseudocode for the frontend's flag-derivation:

```ts
async function getTransactionFlags(tx) {
  if (tx.flags) return BigInt(tx.flags) | variableBits;   // bulk path: trust server

  let flags = computeStaticFlags(tx);
  flags = await DigitalArtifactAnalyserService.analyseTransaction(tx, flags);

  // OTS reconstruction (strip-path only)
  const opReturnCount = tx.vout.filter(v => v.scriptpubkey_type === 'op_return').length;
  if (opReturnCount === 0) {
    // No OP_RETURN -> definitely not an OTS commit. Skip the server.
  } else if (tx.isOtsCommit === true) {
    flags |= OTS_BIT;
  } else if (tx.isOtsCommit === false) {
    // server confirmed: not an OTS commit
  } else {
    // tristate is null -> ask the backend
    const isCommit = await otsKnowledgeService.isOtsCommit(tx.txid);
    if (isCommit) flags |= OTS_BIT;
  }
  return flags;
}
```

In practice, the route handlers in §4.1 **will** set `isOtsCommit` on
every response, so the `else` branch (lazy fetch) is only taken when
the frontend got the tx from somewhere else (third-party API, manual
construction, dev playground).

### 4.3 Lazy backend endpoint

A small route, intended to be cacheable:

```
GET /api/v1/ordpool/ots/is-commit/:txid  ->  { result: boolean }
```

- Implementation: one `ordpoolOtsTxidSet.has(txid)` call.
- Cache header: `Cache-Control: public, max-age=60` (the answer can flip
  `false` → `true` as the poller catches up; never the reverse). 60 s
  matches the poller's cycle.
- Optional batch variant: `POST /api/v1/ordpool/ots/is-commit { txids: string[] }`
  → `{ [txid]: boolean }`. Bound batch size to ~256 to keep the wire
  payload small.

### 4.4 Client-side cache

A `Map<txid, boolean>` in `sessionStorage` (or just in-memory, since
the answer is cheap to refetch). One subtle detail:

- `true` results are **monotonic** — once a tx is known to be an OTS
  commit, that's permanent. Cache forever.
- `false` results are **NOT monotonic** — the poller might learn about
  the tx after the negative response. Cache with a TTL (60 s matches
  the route's `Cache-Control`).

In production this asymmetry doesn't matter much because the OP_RETURN
fast-path eliminates ~99% of negative lookups, and the remaining ones
are rare enough that always-refetching is fine.

### 4.5 Why this design preserves the upstream merge surface

`isOtsCommit` is an additive, optional field on existing wire shapes.
Upstream PRs that touch `Transaction` or `MempoolTransactionExtended`
don't conflict with this field because TypeScript optional properties
don't break structural typing on either side.

The lazy endpoint is purely ordpool-namespaced (`/api/v1/ordpool/ots/...`)
so it can't collide with anything upstream adds.

---

## 5. Code-execution branches — exhaustive walk

This section enumerates every backend call to `Common.getTransactionFlags`
and `Common.classifyTransaction`, the state of `tx.flags` on entry, and
the post-patch behaviour for OTS.

### 5.1 `mempool.ts:155` — `$setMempool` (boot-time disk-cache reload)

```ts
this.mempoolCache[txid].flags = await Common.getTransactionFlags(this.mempoolCache[txid]);
```

- **Context**: process boot, after the on-disk snapshot has been loaded
  into `mempoolCache`. The snapshot was persisted with `tx.flags` from
  the prior process.
- **`tx.flags` on entry**: truthy (persisted value, possibly stale).
- **Early-return**: fires (no static-flag recomputation needed).
- **OTS pre-enrichment** (above early-return): runs. Picks up the bit
  if the poller has bootstrapped `ordpoolOtsTxidSet` by this point.
- **Post-patch behaviour**: ✅ correct. A tx that was OTS-eligible
  before restart but lacked the bit in the snapshot gets the bit applied
  here (provided the poller's bootstrap completed first — see §6.1).

### 5.2 `mempool.ts:191` — new-tx ingest, fresh path

```ts
if (!this.mempoolCache[extendedTransaction.txid]) {
  extendedTransaction.flags = await Common.getTransactionFlags(extendedTransaction);
  ...
}
```

- **Context**: a brand-new tx surfaced via the bitcoind ZMQ stream;
  doesn't exist in mempool cache yet.
- **`tx.flags` on entry**: `undefined`.
- **Early-return**: does not fire.
- **Behaviour**: full static-flag derivation + parser-derived bits +
  OTS lookup. If the poller has already observed this tx's calendar
  batch, OTS bit is set on first classification.
- **Post-patch behaviour**: ✅ correct.

### 5.3 `mempool.ts:326` — new-tx ingest, alternate path

Same as §5.2 — gated by `newTransactions.push`, so `tx.flags` is
`undefined`.

### 5.4 `blocks.ts:1563` — block-summary builder

```ts
const classifiedTxs = await Promise.all(cpfpSummary.transactions.map(async tx => {
  let flags: number = 0;
  flags = await Common.getTransactionFlags(tx, height);
  ...
}));
```

- **Context**: building a block summary for an already-confirmed block.
  Txs come from `cpfpSummary.transactions`, which inherits flags from
  the mempool path (they were classified at mempool ingest before
  confirming into this block).
- **`tx.flags` on entry**: truthy (from mempool).
- **Early-return**: fires.
- **OTS pre-enrichment** (above early-return): runs. If the poller
  observed the calendar batch between mempool ingest and block
  confirmation, OTS bit is added here. **This is the post-patch fix
  for the eventual-consistency hole.**
- **Post-patch behaviour**: ✅ correct.

### 5.5 `bitcoin-api.ts:411` — tx-fetch with prevouts

```ts
if (addedPrevouts) {
  transaction.flags = undefined;     // explicit clear
  transaction.flags = await Common.getTransactionFlags(transaction, ...);
}
```

- **Context**: someone fetched a tx and then we added prevout data
  (which unlocks new bit derivations, e.g. taproot inscription
  detection).
- **`tx.flags` on entry to `getTransactionFlags`**: `undefined` (just
  cleared).
- **Early-return**: does not fire.
- **Behaviour**: full recomputation.
- **Post-patch behaviour**: ✅ correct.

### 5.6 `Common.classifyTransaction` (called from many places)

Calls `getTransactionFlags` and assigns the result to `tx.flags`. The
state of `tx.flags` on entry depends entirely on the caller. Notable
callers:

- `mempool-blocks.ts:685` — building projected mempool blocks. Txs come
  from `mempoolCache`, so `tx.flags` is already set.
- `blocks.ts:243` (`summarizeBlockTransactions`) — same shape.
- `block-processor.ts:68` — new-block confirmation processing. Txs
  inherit from CPFP summary (mempool-classified).

All three: early-return fires, OTS pre-enrichment runs on top, post-patch
correctness ✅.

### 5.7 Strip paths — no classification

`$getTransactionExtended` (called from `bitcoin.routes.ts:247` and
elsewhere) does **not** call `getTransactionFlags`. The returned tx
ships with `tx.flags = undefined` over the wire. Client recomputes.

This is the **only** category where the post-patch behaviour is
unresolved for OTS — see §4 for the mitigation.

---

## 6. Challenges & mitigations

### 6.1 Boot-time race: poller bootstrap vs first mempool tick

If the poller's `ordpoolOtsTxidSet.bootstrap()` is still running when
`$setMempool` fires for the first time, the OTS lookup sees an empty
set — every tx misclassified.

**Mitigation (existing):** `index.ts:150` awaits
`ordpoolOtsTxidSet.bootstrap()` before the mempool sync starts. The
boot order is hardcoded. Document this dependency in
`backend/.claude/CLAUDE.md` so future refactors don't accidentally
reorder boot.

**Risk if violated:** silent under-tagging for the first ~5 minutes
after restart, until the next mempool tick re-classifies. Hard to spot
without a regression test (we should add one — see §7).

### 6.2 Eventual-consistency window: poller-late tx

A tx enters mempool, gets classified, but the calendar that published
its batch hadn't been polled yet at that moment.

**Mitigation (post-patch 20b6a364e):** OTS pre-enrichment runs
unconditionally above `getTransactionFlags`'s early-return. Every
re-classification re-checks the set, so any subsequent call picks up
the bit once the poller catches up.

**Re-classification triggers**: mempool refresh, block confirmation,
historical block-summary rebuild, mempool-blocks projection rebuild.
All of these refresh the bit through the patched call sites in §5.

### 6.3 Strip wire surfaces: OTS bit doesn't reach the frontend

Single-tx GET and WS track-tx ship `tx.flags = undefined`. Frontend
recomputes parser-derived bits but cannot recompute OTS.

**Mitigation (proposed, not yet shipped):** the `isOtsCommit` tristate
field — §4 above.

### 6.4 BigInt arithmetic gotcha

Every ordpool flag lives at bit ≥ 48; the highest (`ordpool_ots`) is at
bit 70. JavaScript's bitwise operators (`|`, `&`, `^`, `<<`, `>>`)
coerce to int32 before computing — every ordpool bit gets truncated to
zero.

**Mitigation (existing):** all code that touches ordpool flags converts
to `BigInt` first, ORs in `BigInt` space, then converts back to `Number`
for storage. Pinned by `backend/src/__tests__/ordpool-flags-bigint-gotcha.test.ts`
(4 tests, including a mutation-verified regression against
`Common.getTransactionFlags`).

### 6.5 Async cascade

`Common.getTransactionFlags` is `async` in our fork (upstream is sync).
Every caller must `await`. Every upstream PR that adds a new caller
must be patched on merge.

**Mitigation:** HACK markers around every changed call site, calling
out the sync→async transition. The pattern is documented in
`backend/.claude/CLAUDE.md` under the "ordpool flags must be applied
everywhere" HARD RULE.

### 6.6 Static-bit downgrade risk

The early-return at `getTransactionFlags`'s middle assumes static bits
never change once derived. **For parser-derived ordpool bits this is
TRUE**: they're derivable from witness bytes alone, and witnesses are
immutable once a tx is in mempool. So a tx classified at mempool ingest
has the right parser bits forever.

**Mitigation:** none needed for parser-derived bits. The
eventual-consistency story is unique to OTS — see §6.2.

### 6.7 OTS bit downgrade risk

`addOtsFlag` is OR-only. Once `tx.flags` carries the OTS bit, no code
path clears it. Even if the poller's `ordpoolOtsTxidSet` somehow forgot
the txid (DB scrub, manual cleanup), the bit survives in any tx that
was previously classified with it set. **Once anchored, always anchored.**

Pinned by `backend/src/api/ordpool-flags-ots-retroactive.test.ts`
("re-classification: tx already has OTS bit + poller forgot it → bit
STAYS").

---

## 7. Outstanding work (not yet shipped)

These follow naturally from the analysis above. Each is in scope; none
is in flight.

1. **`isOtsCommit` wire field** + the lazy `/api/v1/ordpool/ots/is-commit/:txid`
   endpoint + frontend OP_RETURN fast path + sessionStorage cache.
   Targets §3.3, §6.3.

2. **Regression test for §6.1**: assert that
   `ordpoolOtsTxidSet.bootstrap()` happens before the first
   `$setMempool` call, by hooking the boot sequence.

3. **Frontend integration test**: load `/tx/<known-OTS-commit-txid>`
   cold, assert the OpenTimestamps badge renders. Requires a
   deterministic OTS-commit fixture (the cat21-mint bombs from
   `ordpool-parser/testdata/` are wrong shape — they're inscriptions,
   not OTS commits; need a real OTS calendar tx).

4. **Cypress E2E**: deep-link to a block-detail page → confirm OTS
   marker on a known tx. Currently untested.

---

## Appendix A — File pointers

| Concern | File:line | Notes |
|---|---|---|
| Backend flag-producer | `backend/src/api/common.ts:613` | `getTransactionFlags` (async, ordpool fork) |
| Backend OTS pre-enrichment | `backend/src/api/common.ts:645` | post-patch, above early-return (`return Number(flags)` at `:653`) |
| Backend OTS-set singleton | `backend/src/api/ordpool-ots-txid-set.ts` | in-memory `Set<string>` |
| Backend OTS poller | `backend/src/api/ordpool-ots-poller.ts` | 60s-cycle calendar scraper |
| Backend OTS pre-enrichment helper | `backend/src/api/ordpool-ots-flag.ts` | `addOtsFlag`, `addOtsFlagBatch` |
| Flag constants (source of truth) | `ordpool-parser/src/types/ordpool-transaction-flags.ts` | `OrdpoolTransactionFlags` — 31 flags at bits 48–81 |
| Frontend flag-producer | `frontend/src/app/shared/transaction.utils.ts:800` | `getTransactionFlags` (async, ordpool fork) |
| Upstream baseline (reference) | `/tmp/mempool-fresh/backend/src/api/common.ts:610` | upstream `getTransactionFlags` (sync) |
| OTS retroactive-application test | `backend/src/api/ordpool-flags-ots-retroactive.test.ts` | pins eventual-consistency invariant |
| BigInt-gotcha test | `backend/src/__tests__/ordpool-flags-bigint-gotcha.test.ts` | pins arithmetic invariant |

## Appendix B — Glossary

- **Bulk wire surface** — a wire shape that carries many tx classifications
  in one payload (block summary, mempool delta). Always ships `tx.flags`
  to avoid N×client-side recomputations.
- **Strip wire surface** — a wire shape that ships individual txs without
  `tx.flags`. Client recomputes from witness bytes. Upstream's
  optimisation for the long tail of one-off tx fetches.
- **Eventual consistency** — the OTS poller observes calendar batches
  asynchronously, so the answer to "is this tx an OTS commit?" can flip
  from `false` to `true` over time. (Never the reverse.)
- **Parser-derivable flag** — a flag whose value is computable from
  witness/script bytes alone. Every ordpool flag except `ordpool_ots`.
- **Indexer-derived flag** — a flag whose value requires server-side
  state that the client cannot reconstruct. `ordpool_ots` is the only
  one in our codebase.
- **Strip-and-recompute pattern** — upstream's design contract: server
  classifies once, may strip on the wire, client recomputes
  deterministically. Works for every flag the client can recompute.
- **Tristate `isOtsCommit`** — `true` / `false` / `null` field for
  passing OTS knowledge on strip wire surfaces, where `null` means
  "the server didn't tell us, the client should ask."
