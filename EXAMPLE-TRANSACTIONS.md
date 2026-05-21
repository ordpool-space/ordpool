# Example transactions

Click-through catalog of real-mainnet txs that exercise each protocol and use case
in ordpool's parser and viewers. Curated from the test fixtures in
`ordpool-parser/src/**/*.spec.ts` and the "Test cases:" comment blocks on the
frontend viewer components. Every txid below is asserted against real on-chain
data somewhere in the codebase.

Click a tx to inspect it on https://ordpool.space.

## Inscriptions

### Content types

- [`092111e882a8…`](https://ordpool.space/tx/092111e882a8025f3f05ab791982e8cc7fd7395afe849a5949fd56255b5c41cc) — inscription with multiple input witnesses
- [`2740d27e3017…`](https://ordpool.space/tx/2740d27e3017da44ee439792f6f60449e43992fddffd9387685b14d21b725ff0) — batch inscription, ~2,000 inscriptions in one tx
- [`49cbc5cbac92…`](https://ordpool.space/tx/49cbc5cbac92cf917dd4539d62720a3e528d17e22ef5fc47070a17ec0d3cf307) — JSON with `metadata` (tag 5) and `metaprotocol` (tag 7)
- [`430901147831…`](https://ordpool.space/tx/430901147831e41111aced3895ee4b9742cf72ac3cffa132624bd38c551ef379) — plain text
- [`4c83f2e1d12d…`](https://ordpool.space/tx/4c83f2e1d12d6f71e9f69159aff48f7946ce04c5ffcc3a3feee4080bac343722) — SVG, gzip-encoded body, carries a tag-15 note
- [`6dc2c16a74de…`](https://ordpool.space/tx/6dc2c16a74dedcae46300b2058ebadc7ca78aea78236459662375c8d7d9804db) — JavaScript, brotli-encoded body
- [`2c0c49fc122d…`](https://ordpool.space/tx/2c0c49fc122d223b7178a74064e59ffaa2db7ce7e541ef5c1a9188064f2f24ab) — gzip-encoded content
- [`7923e59abd8f…`](https://ordpool.space/tx/7923e59abd8f8ab40dcc7915ae864d8b7ad6776811ba4d478f42248a7827a7f3) — JPEG, exercises the pointer field (tag 2)
- [`73eb12c506ad…`](https://ordpool.space/tx/73eb12c506adaf02e219229b1c800ea1caa70c86a981e8fdb9e231237957224f) — CSS source
- [`77709919918d…`](https://ordpool.space/tx/77709919918d38c8a89761e3cd300d22ef312948044217327f54e62cc01b47a0) — complex SVG with embedded JavaScript

### Parent / child / delegate

- [`11d3f4b39e8a…`](https://ordpool.space/tx/11d3f4b39e8ab97995bab1eacf7dcbf1345ec59c07261c0197e18bf29b88d8da) — batch with pointer (tag 2) selecting child sat
- [`f988fe4b414a…`](https://ordpool.space/tx/f988fe4b414a3f3d4a815dd1b1675dea0ba6140b1d698d8970273c781fb95746) — multiple parents (tag 3 with several entries)
- [`6b6f65ba4bc2…`](https://ordpool.space/tx/6b6f65ba4bc2cbb8cec1e1ca5e1d426e442a05729cdbac6009cca185f7d95bab) — delegate (tag 11)

### Galleries and properties (tag 17)

- [`f6d848b3dc15…`](https://ordpool.space/tx/f6d848b3dc15955a82eb738f2de38e56a0346303444600f0e0726c678632c055) — OrdRain gallery (111 items, brotli-compressed properties)

### Decode-failure edge cases

- [`5125c1269bd9…`](https://ordpool.space/tx/5125c1269bd9c4605764fe76d253078d4c35897646004b8fa9837ad41e94a634) — Content-Encoding header lies: declared `br`, body is gzip (block 869,599)

### Plain-tx counter-example

- [`9ba6f71c6176…`](https://ordpool.space/tx/9ba6f71c6176ef7dab6751e4b71f6e6d13694d65134935bb275d89d1f0e9fdb2) — plain p2tr payment with no envelope (REKT commit); negative test

## CAT-21

Genesis cat plus a representative sample of subsequent mints; one large/oversized cat.

- [`98316dcb21da…`](https://ordpool.space/tx/98316dcb21daaa221865208fe0323616ee6dd84e6020b78bc6908e914ac03892) — genesis cat (cat #0, the very first nLockTime=21 tx)
- [`90dcf7825be0…`](https://ordpool.space/tx/90dcf7825be098d1700014f15c6e4b5f99371d61cc7fc40cd5c3ae9228c64290) — early mint
- [`4130bd5520ff…`](https://ordpool.space/tx/4130bd5520fff85dd98aeb8a3e03895062afb2cfd5215f878a9df835b261980e) — early mint
- [`76448f79c6c9…`](https://ordpool.space/tx/76448f79c6c90281ec4d15f3a027c48d3a1f72e9de20f4ca3461932384866513) — early mint
- [`499e011170e9…`](https://ordpool.space/tx/499e011170e99189b2fb43bf3de790d10a7ff4c6c855bc9f7986e0db82a19c67) — early mint
- [`7fd952b2723e…`](https://ordpool.space/tx/7fd952b2723eccdff0f0169931ed7fcf7d7a58581e6affc9209d30060f224a65) — early mint
- [`5ee1320ff65a…`](https://ordpool.space/tx/5ee1320ff65acbe01cb5074ec89deca1220dc30a29c672a6b97a2936b2613f4c) — early mint
- [`917320c3a6a9…`](https://ordpool.space/tx/917320c3a6a92f0c30e1876c164a1b06f57aae8be3c37aff74d8ec1f1a7da240) — early mint
- [`d2dd3b676584…`](https://ordpool.space/tx/d2dd3b67658416b27657fdb72d9a19021c1ebe3f797bf659182190c566ee4e57) — early mint
- [`eccac793d22d…`](https://ordpool.space/tx/eccac793d22d66a14c3fd6cd5adf5002d1347b503d3fe5171178bd4edf4cf57d) — early mint
- [`dc0628339faf…`](https://ordpool.space/tx/dc0628339faf50149bc7fffbb25544328fabc10ee16ac7326e1754f08025d7ca) — early mint
- [`2a6514a04d7b…`](https://ordpool.space/tx/2a6514a04d7b3ea839f177b6aec9418c24262629d885f09fdd83420853c2d7cc) — early mint
- [`5a68ffaea166…`](https://ordpool.space/tx/5a68ffaea166743b41f8ad02bbb77933e1b29729b338098280574cd7482de87c) — early mint
- [`8145338a41e2…`](https://ordpool.space/tx/8145338a41e2b8c8b275f38aa7b5b669f4d22ddf1b627f2632a157fb906104a0) — early mint
- [`bab0ca815cc5…`](https://ordpool.space/tx/bab0ca815cc56a281ff510067984f38236f533e9100d737a9fd28bd12521ac6f) — early mint
- [`6d895bcdb8af…`](https://ordpool.space/tx/6d895bcdb8af42669305f3360b35c403b35064ed7ff3e6845983016adb29af01) — early mint
- [`e8b98486b151…`](https://ordpool.space/tx/e8b98486b151fcc4570dbd526f6ef50d5c194e54e248592d04bb092d5c08c430) — early mint
- [`b0d6d810f4b3…`](https://ordpool.space/tx/b0d6d810f4b3a6c6f92c2d5f502877f30a7a343f8f937a41985ea1db8bf82f14) — large cat, exercises oversized witness/trait rendering

## Runestones

### Etchings

- [`2bb85f4b004b…`](https://ordpool.space/tx/2bb85f4b004be6da54f766c17c1e855187327112c231ef2ff35ebad0ea67c69e) — UNCOMMON•GOODS mint (the first rune ever, block 840,000)
- [`7923e59abd8f…`](https://ordpool.space/tx/7923e59abd8f8ab40dcc7915ae864d8b7ad6776811ba4d478f42248a7827a7f3) — etching BITCOIN•WIF•CAT, no terms, no divisibility (equals 0)
- [`9327998a4aee…`](https://ordpool.space/tx/9327998a4aee68a6792db8b00540976ebf81b32ef3c0fd52a43d4ce1e3c5cf11) — etching COOK•THE•MEMPOOL, 0 premine + cap 21b + offset height start/end
- [`d66de939cb3d…`](https://ordpool.space/tx/d66de939cb3ddb4d94f0949612e06e7a84d4d0be381d0220e2903aad68135969) — etching HOPE•YOU•GET•RICH with absolute height start/end

### Mints

- [`7f4c516ca5b7…`](https://ordpool.space/tx/7f4c516ca5b7b2b747bb04e0bd50aef2e8c4c34d78e681be40c5d93c9d635972) — mint UNCOMMON•GOODS
- [`e59cc3f24abd…`](https://ordpool.space/tx/e59cc3f24abd61c0b6ec97cbde001e6da859409644c8ed64027512ed5f61329e) — mint THE•PONZI•CHANNEL
- [`1ec45028e1f3…`](https://ordpool.space/tx/1ec45028e1f3b3ee82644cd6bbaf3f7966d85c8e6fe7c20b829d5c3633333ae6) — mint 1× GRAYSCALE•RUNE with edict
- [`897cb15f5d76…`](https://ordpool.space/tx/897cb15f5d7633e8daa9d29d8f8b73238668a136394d0c319b8e1f55a279df46) — mint 100,000 HOPE•YOU•GET•RICH

### Edicts

- [`795e09306dba…`](https://ordpool.space/tx/795e09306dba134150142801f92e66dbd44cfad304b0a0688578160a300352ee) — 13× 75 NOR•MOONRUNNERS edicts
- [`1af2a846befb…`](https://ordpool.space/tx/1af2a846befbfac4091bf540adad4fd1a86604c26c004066077d5fe22510e99b) — DOG airdrop, single edict + thousands of outputs
- [`c7a7cf4c146e…`](https://ordpool.space/tx/c7a7cf4c146e48e39b1ab2d235263886d364a225255d421dd61f19538e96e79c) — EPIC airdrop, single edict + thousands of outputs

### Pointer & edge cases

- [`b3205ea418e6…`](https://ordpool.space/tx/b3205ea418e67fb5a9b80bb14956e7566751903fb7fc6b36af55429af9681d0e) — runestone pointer field
- [`25d919c2f02c…`](https://ordpool.space/tx/25d919c2f02c00ef26a4d674ac1ecffd92684bce35fc449b7834841fd017a9f9) — first cenotaph (invalid runestone)
- [`28baf9374797…`](https://ordpool.space/tx/28baf9374797230174803b0c3f63fd39e22bb1972a25cc2af4e791ca8fc89dae) — `OP_RETURN OP_PUSHNUM_13 OP_PUSHBYTES_1 00`, no real message

### Alkanes (sub-protocol of Runes — Runestone tag 16383 + Protostone with `protocol_tag = 1`)

- [`972c41e6b564…`](https://ordpool.space/tx/972c41e6b564a5aa9663d94cd1b3cebcddd6ee8eae429c075ac50c841e3701d6) — block 949,000 alkanes tx (Runestone mint + alkanes protostone). Should fire both **Runes** and **Alkanes** chips.
- [`a8e52911c5c3…`](https://ordpool.space/tx/a8e52911c5c398e13ccf37b24e9adca5a799d7e0fb0ac97ff3e65b470c76cf36) — same block, same shape (second positive)
- [`bc668122adc8…`](https://ordpool.space/tx/bc668122adc872c81c91a1ddb3e2dee64372d6e4d749b3a655523b3af8ff9816) — same block, plain Runestone with no PROTOCOL tag — negative control, fires **Runes** but NOT Alkanes
- Block 949,948 carries **4,734** alkanes-tagged txs total — alkanes is one of the busiest L1 metaprotocols by tx count

## Atomicals

### nft / realm / dmitem

- [`d8c96e3920f1…`](https://ordpool.space/tx/d8c96e3920f15dfbca4bcb3a3b2fce214484cb913fdca3055dd0f7069387edd3) — realm `terafab` (#229,861), no file attachments
- [`7c8527547cc9…`](https://ordpool.space/tx/7c8527547cc99b39f9d02fa2e8d963d78a3d60692a05ad378a87b96abed4aab6) — toothy #7,579, NFT collection item with embedded PNG

### dft / dmt (distributed fungible token)

- [`1d2f39f54320…`](https://ordpool.space/tx/1d2f39f54320631d0432fa495a45a4f298a2ca1b18adef8e4356e327d003a694) — dft "atom", multi-chunk CBOR with embedded PNG (atomical #0)
- [`5390e86df989…`](https://ordpool.space/tx/5390e86df98982122175e18a7f24a1618d14e50e0b2242c7ca2c27730ffad700) — dmt mint of "atom"

### x / y / z (FT UTXO management — splat / split / custom-color)

- [`329a9fae404e…`](https://ordpool.space/tx/329a9fae404e4ca014b975dbcc7cb5267f47cccd2851a45ffa06c70744ae12cd) — splat (op `x`)
- [`054cc18a8162…`](https://ordpool.space/tx/054cc18a8162887917a1e6e5c60389bb4b6647167e6936d231466d7b2710f413) — split (op `y`)
- [`914a3f3575a1…`](https://ordpool.space/tx/914a3f3575a1da92035a57bd758da8588fd11776927ab880915f97e66612f773) — custom-color (op `z`)

## STAMP

OLGA-encoded P2WSH stamps. One fixture per common image MIME, plus a gzip and an unknown-MIME case.

- [`516e62beeffb…`](https://ordpool.space/tx/516e62beeffb26fb37f8e95e809274e5bbde76eb75a28357f6bbcd4eedbfe8ca) — PNG stamp
- [`d88d5e4e1adf…`](https://ordpool.space/tx/d88d5e4e1adfdc23117b52f35641ef5918812cf32ec3dcec54faa6d2d4dcae2e) — JPEG stamp
- [`9dbdb2ef0f84…`](https://ordpool.space/tx/9dbdb2ef0f84f8852f1abc3e0f39f6e223ee64ae1452ecceaea9eaf0a9ae9669) — GIF stamp
- [`085e0ccbf674…`](https://ordpool.space/tx/085e0ccbf674dfd5934eb635d392250afb4b6ce41ceb1347335f6f0e64c2f7d6) — SVG stamp
- [`3dfc964777a2…`](https://ordpool.space/tx/3dfc964777a27da2b93eddbe5a5da06923a1e1c7a80a386e884187dfb88877ff) — HTML stamp
- [`2825437c2d6c…`](https://ordpool.space/tx/2825437c2d6cf4250eca8b7bbc487107cc0ee4dfcd765a2dcf33ce31c7db2f45) — WebP stamp
- [`9660860095ba…`](https://ordpool.space/tx/9660860095ba470a9622b41ad7b594cb53dce5ade3c79cd2b226b27619bcd40a) — gzip-compressed stamp body
- [`da9f7bc49861…`](https://ordpool.space/tx/da9f7bc49861d4ab6e0933f539538963ada17c88440048519bf015305c38989d) — unknown MIME

## SRC-20

- [`04460b129b97…`](https://ordpool.space/tx/04460b129b970e53de19860f52a276358b5fe7dffc2bb25f7d35cefa62a1755e) — OLGA-encoded SRC-20 (raw JSON in P2WSH outputs, no `stamp:` prefix)
- [`50aeb77245a9…`](https://ordpool.space/tx/50aeb77245a9483a5b077e4e7506c331dc2f628c22046e7d2b4c6ad6c6236ae1) — SRC-20 transfer (multisig encoding)
- [`5ba7f995341b…`](https://ordpool.space/tx/5ba7f995341b9eb70c0cec4f893912f1d853d25d43ade4d3d7739d43bda85a87) — SRC-20 example
- [`bca22c3f97de…`](https://ordpool.space/tx/bca22c3f97de8ff26979f2a2ce188dc19300881ac1721843d0850956e3be95eb) — SRC-20 example

## SRC-721

- [`b74313d30090…`](https://ordpool.space/tx/b74313d300902c0cdf88dc101fb8f4c9ab7ad89c978edd30ca4ee7987cccdedd) — stamp #1,383,566; composable layered NFT mint: `{"p":"src-721","op":"mint","c":"A1473703777372088053","ts":[1,4,8,4,5,4,7,0,6,6]}`

## SRC-101

- [`5d18994d0981…`](https://ordpool.space/tx/5d18994d0981c421c115bf18a1ec0047cf63c06a4c94384a560ab74d6d0552f9) — BitNameService deploy (block 871,022), ARC4-encrypted across 22 multisig outputs

## Labitbu

- [`5a15dabc8f0c…`](https://ordpool.space/tx/5a15dabc8f0c1656ccd07bd2739f683b4c562fb66487329a41f959c38f0cf7d3) — WebP image in a Taproot witness control block (NUMS-keyed; mint window blocks 908,072–908,196)

## Counterparty

- [`4a412b0a7143…`](https://ordpool.space/tx/4a412b0a71439ad5eaf5f8a91878f8cf7c895037bc6b59ba93fd3d954eb4788e) — mpma (multi-party multi-asset send) via 1-of-3 bare multisig
- [`f3981dac3d2d…`](https://ordpool.space/tx/f3981dac3d2d43abf6c3bb059fbd998bcd8f76c4174fd1e2668599b9713649c9) — enhanced send (type 2), THEFAKERARE
- [`98c2165a58f7…`](https://ordpool.space/tx/98c2165a58f7d62201f6264a91db38424a24b4d71ce25ee63c50497646092cfa) — dispenser, 26 XCP at 0.00029 BTC per unit
- [`4366a0871759…`](https://ordpool.space/tx/4366a0871759d7c720f34984883848f6a806ef3ceba8c1e614b9cfe8f7e164a4) — issuance lock/reset (type 22), FRONTPEPE
- [`22077e8e1a6c…`](https://ordpool.space/tx/22077e8e1a6c109309c01f891073969fcaf396a8c4ba163f4a7e1d5a5795a77d) — DEX order (type 10)
- [`a23ea1acd8fd…`](https://ordpool.space/tx/a23ea1acd8fd775789e43c5b244b727f16649f66ad3e9527a853aee481e989bc) — destroy (type 110)
- [`7e4bc1905485…`](https://ordpool.space/tx/7e4bc190548fc55ff8cfa35b51a15bd503bfebd584573ae5e6b448b6aba59706) — cancel open order (type 70)
- [`627ae48d6b4c…`](https://ordpool.space/tx/627ae48d6b4cffb2ea734be1016dedef4cee3f8ffefaea5602dd58c696de6b74) — OLGA multisig image with 173 outputs — early NFT-style Counterparty asset
- [`dee5acb8d9a8…`](https://ordpool.space/tx/dee5acb8d9a859c731ea32a1b5defbc744450effd7fd53bd12791f21dc4b149f) — P2TR fairminter, generic envelope `OP_FALSE OP_IF <data> OP_ENDIF <pubkey> OP_CHECKSIG`
- [`e6ecd07a4817…`](https://ordpool.space/tx/e6ecd07a48178c363e61a2bf109a5d1dc5e44e9b31afff096074311fb51ca01d) — P2TR ord issuance, ORDINALMINT asset with embedded JPEG (block 933,916)
- [`6335eefb68f5…`](https://ordpool.space/tx/6335eefb68f5e57eddb95b329c368615e53cf5efe346be14d271c88a63b5461e) — classic send (block 489,000, before short_tx_type_id activation), 2.1B TRIGGERS

## BRC-20

BRC-20 detection is content-based — any inscription whose body is JSON with `{"p":"brc-20"}` flags as BRC-20. There is no dedicated mainnet fixture tx pinned in the parser tests; coverage runs through the inscription-content branch with synthetic JSON inputs. To see BRC-20 chips on a real block, open a known BRC-20-heavy block such as `https://ordpool.space/block/0000000000000000000221fd1ba086a7672e3e5a18ac5a4efc9f0cff0a78fe86` (block 831,802 — BRC-20 trio mints).

## Bitmap

Bitmap is a text inscription whose body matches the canonical `<height>.bitmap` shape (no whitespace, no leading zeros). The inscription claims the named block; ordpool renders the block's transactions as a Mondrian grid of orange squares (one square per tx, sized by output value via `logTxSize`). Parsed by `parseBitmapHeight` in ordpool-parser; rendered by `<app-bitmap-viewer>` inside the inscription-viewer.

Three canonical claims, spanning trivial to busy, for visual cross-checking against other indexers:

| Block | Inscription | ordpool | Cross-check on bitmap.trade |
|---|---|---|---|
| 0 (Genesis, 1 tx) | `86539aff…7660ee` | [view](https://ordpool.space/tx/86539aff946c437af8088955827b7e6ff48fc6192836d4071b697b5359b7a732) | [view](https://bitmap.trade/bitmap/0.bitmap) |
| 210,000 (1st halving, 457 txs) | `b8505f82…b13104` | [view](https://ordpool.space/tx/b8505f82e5ba0f7179f8d05213e631b375815c1af820eed9d6a34b48e1b13104) | [view](https://bitmap.trade/bitmap/210000.bitmap) |
| 840,000 (4th halving, 3,050 txs) | `05f8584c…7660ee` | [view](https://ordpool.space/tx/05f8584cf4dbe34ef677f8f316fcac9e6e4ccb0e298d53fd21edaac7787660ee) | [view](https://bitmap.trade/bitmap/840000.bitmap) |

Bitmap has no on-chain spec, only convention. There are two camps on whether the protocol stops at the halving block (840,000). bitlords.land indexes only heights up to and including 840,000; bitmap.trade and most other indexers accept claims indefinitely. ordpool follows the "render anything validly-shaped" line: any confirmed block height with a `.bitmap` claim gets the Mondrian render, no cutoff.

## OpenTimestamps

OTS commits are bare `OP_RETURN OP_PUSHBYTES_32 <32 bytes>` — no magic prefix, no marker. The parser side handles the `.ots` receipt (verifies attestations, walks Merkle paths up to the published calendar commit); the on-chain commit txs live separately.

- [`8d8ce7ac7b68…`](https://ordpool.space/tx/8d8ce7ac7b68335a040243f31e7e3a2ba8fb82166ca569e7c8b80361b90e8b9f) — Alice calendar broadcast (block 948,192). Canonical OTS test fixture used by the OTS-poll prototype.

## Edge cases / oddities

- [`5125c1269bd9…`](https://ordpool.space/tx/5125c1269bd9c4605764fe76d253078d4c35897646004b8fa9837ad41e94a634) — inscription decode failure (Content-Encoding lies)
- [`25d919c2f02c…`](https://ordpool.space/tx/25d919c2f02c00ef26a4d674ac1ecffd92684bce35fc449b7834841fd017a9f9) — first runestone cenotaph
- [`28baf9374797…`](https://ordpool.space/tx/28baf9374797230174803b0c3f63fd39e22bb1972a25cc2af4e791ca8fc89dae) — minimal OP_RETURN, no real message
- [`1af2a846befb…`](https://ordpool.space/tx/1af2a846befbfac4091bf540adad4fd1a86604c26c004066077d5fe22510e99b) — massive single-edict airdrop (DOG)
- [`c7a7cf4c146e…`](https://ordpool.space/tx/c7a7cf4c146e48e39b1ab2d235263886d364a225255d421dd61f19538e96e79c) — massive single-edict airdrop (EPIC)
- [`9ba6f71c6176…`](https://ordpool.space/tx/9ba6f71c6176ef7dab6751e4b71f6e6d13694d65134935bb275d89d1f0e9fdb2) — plain p2tr, no artifact (REKT commit, used as the negative-test baseline)
