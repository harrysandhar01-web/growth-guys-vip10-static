# Deployment status

| Field | Value |
|---|---|
| State | staged; not deployed |
| Static content directory | public/ |
| Snapshot source | Canonical public HTML and public static assets |
| Intended canonical domain | growthguysvip10.ca |
| Current public domain | unchanged |
| GitHub Pages | not enabled by this repository |
| Custom domain / CNAME | not configured |
| DNS / redirects | unchanged |

## Boundary

This is a private route-parity staging artifact. It may contain a read-only canonical public HTML snapshot plus static record/feed files, but it does **not** replace the dynamic verification backend, database-backed current record, owner authentication, original-evidence storage, validator-gated acceptance, scheduler, or publication controls.

No domain cutover is permitted until route/content/metadata/JSON-LD, canonical and alias redirects, sitemap/feed, dynamic control-plane behavior, crawler readback, and rollback behavior are separately proven.
