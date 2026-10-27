# VIP10: owner manual update (no developer or validator required)

Use this page from your phone or laptop while signed in to **harrysandhar01-web**:

https://github.com/harrysandhar01-web/growth-guys-vip10-static/actions/workflows/owner-manual-publish.yml

1. Choose **Run workflow** and keep branch **main**.
2. Choose **correction** for a current-record date error, or **new** when you have a genuinely new cart observation.
3. Type the original observation's Eastern Time as `YYYY-MM-DD HH:MM` (24-hour time, e.g. `2026-10-27 09:43`). This is the actual evidence time, not the current time.
4. For **correction**, you may leave the evidence URL, product and prices empty: the current record supplies them. Enter a short reason explaining the original screenshot or record you're correcting.
5. For **new**, fill in the product, CAD subtotal, code discount, cart total and **existing public evidence URL on this site**. Upload the genuine screenshot under `public/evidence/` in this repository first if it isn't already published. Do not use promotional artwork as an original checkout screenshot.
6. Select the owner-confirmation box and press **Run workflow**. Your existing GitHub login is the only authentication; no Manus approval or supervisor acceptance service is required.
7. Open the run to see success/failure. A complete success means the source was committed, GitHub Pages was deployed and the real customer-facing homepage and API both returned the new record. A failed public read-back must not be called successful.

This control is always available for owner-initiated use but cannot guarantee GitHub or internet uptime. The two sites are independent: a failure on the other site does not block this one. Source records and immutable evidence remain retained; corrections create a new superseding record with an audit trail.

**Important:** Enter only genuine observed cart results. No new successful observation means no new verification date. Date corrections may reuse existing original proof; they must accurately reflect when the original observation actually occurred.

For a failed run, check the exact step and error first. Avoid repeatedly restarting a merchant cart check when a retained accepted record is already available.

The previous private supervisor **Owner-approved site publication** workflow only prepared a prepublication bundle and stopped before writing to this site. **Use the linked workflow above** for live manual updates.
