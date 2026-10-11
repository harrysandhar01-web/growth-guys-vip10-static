# VIP10 static-site staging

This repository is the private GitHub staging target for the VIP10 public website replacement. It contains an **accepted-record static snapshot**, a route map, sitemap, feed, and crawler configuration generated from the matching site only.

## Current state

- **Not deployed** to GitHub Pages
- **No custom domain** attached
- **No DNS or redirect changes**
- **No live traffic moved**

The repository becomes eligible for a no-downtime cutover only after full route, content, SEO, canonical, alias, sitemap/feed, and crawler parity is validated against the active site. The active host remains the rollback target until that is complete.

## Intended destination

The intended canonical public hostname is **growthguysvip10.ca**, but no GitHub Pages CNAME file or DNS record has been configured. The generated static build is located in the  directory.
