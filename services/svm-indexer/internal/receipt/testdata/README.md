# Frozen receipt fixtures

These six JSON files are vendored byte-for-byte from
`tooling/receipt-codec/fixtures/*.json` in the Swaputer Tooling source tree at
commit `5548a84b25dfee61d2e52f80390f9ee516bea739`. The Explorer repository's
recursive dependency checkout pins a descendant of that immutable source
revision; the vendored fixture bytes remain unchanged.

The published `@swaputer-labs/receipt-codec@0.1.2` tarball does not contain
these fixtures. Its version identifies the matching codec API; the Tooling
commit above is the fixture provenance.

They are intentionally vendored so the Explorer indexer test suite is
self-contained. Update them only when the receipt wire format changes, and
keep the matching codec provenance current.
