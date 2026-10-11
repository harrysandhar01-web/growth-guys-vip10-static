# VIP10 static-site staging

This repository is the private GitHub staging target for the VIP10 public website replacement. It contains an **accepted-record static snapshot**, a route map, sitemap, feed, and crawler configuration generated from the matching site only.

## Current state

- **Not deployed** to GitHub Pages
- **No custom domain** attached
- **No DNS or redirect changes**
- **No live traffic moved**

The repository becomes eligible for a no-downtime cutover only after full route, content, SEO, canonical, alias, sitemap/feed, and crawler parity is validated against the active site. The active host remains the rollback target until that is complete.
