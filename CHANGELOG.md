# v1.0.0 – Full overhaul

* New Digital Artifact: Runestone messages in transactions
* New Digital Artifact: Detection of Atomicals (but no real parsing or display*)
* Drastically improved performance: server-side detection of Digital Artifacts (including runes)
* Ordpool Flags: Highlight transactions by included Digital Artifacts: CAT-21 Mint, Inscription, Rune, BRC-20, SRC-20 (Stamps)
* Ordpool Stats: Quick summaries of all detected Digital Artifacts in a block
* Various small improvements to the user interface

&nbsp;* If you can contribute, please send a <a href="https://github.com/ordpool-space/ordpool-parser" target="_blank">🧡 pull request (Github) to our repository</a>.

# v0.0.5 – CAT-21 Ordinals

![cats](https://github.com/ordpool-space/ordpool/assets/108269257/0fb9fad1-0cbd-4c77-b007-5206a1349c8a)

Announcement: https://twitter.com/HausHoppe/status/1781222510303785339

**What a wild ride. We unleached the cats!! Thank you everyone for being part of the creation of a new protocol on Bitcoin.** We started a movement! 

CAT-21 is a novel protocol that utilizes Bitcoin transactions and the Ordinals Theory to mint unique digital collectibles – CAT-21 ordinals. Each CAT-21 ordinal is linked to a unique pixelated cat image with various traits, offering a fresh and playful perspective on Bitcoin transactions and the Ordinals theory. Why? Because it's fun and complely free! And free means free! The minting process is completely free. **Price: FREE, no strings attached.** 😺


Read more about the **CAT-21 protocol** [in the whitepaper](https://github.com/ordpool-space/cat-21)<!--and [on the official website](https://cat21.space/)-->.

**More Features:**

* Basic support for delegate inscriptions → [Example](https://ordpool.space/tx/6b6f65ba4bc2cbb8cec1e1ca5e1d426e442a05729cdbac6009cca185f7d95bab)
* Various small improvements for the Inscription Accelerator


# v0.0.4 – Parsing everything

<img width="1024" alt="Stamps (SRC-20)" src="https://github.com/ordpool-space/ordpool/assets/108269257/765e5e4a-11a4-41db-87aa-aad6671689ac">
<img width="1031" alt="Multiple Parents" src="https://github.com/ordpool-space/ordpool/assets/108269257/491907f3-fac9-4f41-b61b-becd11df7d2c">

Announcement: https://twitter.com/HausHoppe/status/1747656943286571047

This version finally brings support for all types of inscriptions and features to Ordpool:

* Inscriptions on inputs after the first → [Example](https://ordpool.space/tx/092111e882a8025f3f05ab791982e8cc7fd7395afe849a5949fd56255b5c41cc)
* Batch inscriptions via pointers (see [pointer docs](https://docs.ordinals.com/inscriptions/pointer.html)) → [Example](https://ordpool.space/tx/11d3f4b39e8ab97995bab1eacf7dcbf1345ec59c07261c0197e18bf29b88d8da)
* Parent inscriptions (see [provenance docs](https://docs.ordinals.com/inscriptions/provenance.html)) → [Example](https://ordpool.space/tx/11d3f4b39e8ab97995bab1eacf7dcbf1345ec59c07261c0197e18bf29b88d8da)
* Metadata and Metaprotocol (see [metadata docs](https://docs.ordinals.com/inscriptions/metadata.html)), which are used by **[CBRC-20](https://cybord.org/)** → [Example](https://ordpool.space/tx/49cbc5cbac92cf917dd4539d62720a3e528d17e22ef5fc47070a17ec0d3cf307)
* Brotli content-encoding → [Example](https://ordpool.space/tx/6dc2c16a74dedcae46300b2058ebadc7ca78aea78236459662375c8d7d9804db)
* Support for multiple parents → [Example](https://ordpool.space/tx/f988fe4b414a3f3d4a815dd1b1675dea0ba6140b1d698d8970273c781fb95746)
* Support for minimal push numbers (OP_PUSHNUM) for tags, which are not encoded by `ord` but by [Chisel](https://chisel.xyz) → [Example](https://ordpool.space/tx/f988fe4b414a3f3d4a815dd1b1675dea0ba6140b1d698d8970273c781fb95746)

We also added experimental support for Bitcoin Stamps (**[SRC-20](https://stampchain.io/)**) → [Example](https://ordpool.space/tx/50aeb77245a9483a5b077e4e7506c331dc2f628c22046e7d2b4c6ad6c6236ae1).
'Experimental' means that SRC-20 Bitcoin Transactions are highlighted in the Mempool Block Overview and shown on the Transaction-Details page, but they are not highlighted for confirmed blocks.

**More Features:**

* CSS, JavaScript, and JSON are now formatted and displayed with Syntax-Highlighting

**Bugfixes:**

- Parser is not aware of batch inscriptions, see [#2](https://github.com/ordpool-space/ordpool/issues/2)
- Download links to Xverse and Unisat were mixed


# v0.0.3 – ordpool-parser

**New Feature:**

We've extracted the Inscription parser to a separate repository! 
Now it's your turn! Fork it and add support for Bitcoin Stamps, Atomicals or any other Metaprotocol.
Can't wait to see what you come up with! 🚀

More at: 
* https://github.com/ordpool-space/ordpool-parser
* https://www.npmjs.com/package/ordpool-parser

**Bugfixes:**

- Fixes broken Unicode encoding, see [#5](https://github.com/ordpool-space/ordpool/issues/5)


# v0.0.2 – "Inscription Accelerator" 🚀 

![Screenshot](https://github.com/ordpool-space/ordpool/assets/108269257/5a6179cd-e835-414c-b4a8-4167a14ae85c)

Announcement: https://twitter.com/HausHoppe/status/1732070762972868920

**New Feature:**

We are proud to present the 'Inscription Accelerator'! 🚀  ([PR #6](https://github.com/ordpool-space/ordpool/pull/6))

Is your inscription stuck in the mempool and you don't want to wait any longer?
We can help you to create a high-priority follow-up transaction that will boost this inscription.
Made in partnership with our friends at OrdinalsBot.

**Bugfixes:**

- Fixes broken caching of existing blocks, see [#1](https://github.com/ordpool-space/ordpool/issues/1)

**Known Issues:**

- Right now, the Parser is not aware of batch inscriptions, see [#2](https://github.com/ordpool-space/ordpool/issues/2)


<br>

# v0.0.1 – Initial Release: "Amsterdam"

![mempool-space-preview](https://github.com/ordpool-space/ordpool/assets/108269257/f15ee074-72ad-4cbd-acad-cb93931a5258)
The very first public version that was released right before Inscribing Amsterdam!

Announcement: https://twitter.com/HausHoppe/status/1712793358769242288