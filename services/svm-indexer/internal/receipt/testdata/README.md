# Frozen receipt fixtures

These six JSON files are vendored byte-for-byte from
`tooling/receipt-codec/fixtures/*.json` in the Swaputer Tooling source tree at
commit `de107b1e3829397c6b8e248a86b3e5e1b1d7dd3b`. The Explorer repository pins
that source revision through its recursive dependency checkout.

The published `@swaputer-labs/receipt-codec@0.1.2` tarball does not contain
these fixtures. Its version identifies the matching codec API; the Tooling
commit above is the fixture provenance.

They are intentionally vendored so the Explorer indexer test suite is
self-contained. Update them only when the receipt wire format changes, and
keep the matching codec provenance current.
