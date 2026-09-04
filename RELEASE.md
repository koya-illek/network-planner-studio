# Release Network Planner Studio

Use this checklist for a staged release to `network.illek.ie`. Do not mark the
release complete until every applicable check passes.

## Check the candidate

1. Start from a clean working tree.
2. Install locked dependencies only if they are missing or changed.
3. Run `npm run check:provenance` and the checks affected by the change. `npm run check:release` is the full gate for broad engine or API changes. Do not repeat passing checks solely for release ceremony.
4. Start the candidate with `npm run dev` when browser validation is needed.
5. Audit changed markup and links. Use Lighthouse for performance work.
6. For layout changes, inspect the affected views at 390, 768, and 1440 pixels. Check the browser console
   and failed network requests during the example, import, edit, and report
   paths.

## Complete manual accessibility acceptance

For changes to navigation, focus, or semantics, use a screen reader on a supported desktop browser. Confirm the affected
following behaviour:

- The product name, purpose, and primary action make sense in reading order.
- The skip link reaches the planner.
- Tabs, site rows, VLAN rows, links, and canvas nodes expose useful names and
  state.
- Each dialog announces its name, errors beside the affected field, and
  returns focus to the control that opened it.
- Saving, import errors, storage errors, and cross-tab warnings are announced.
- The implementation report has a useful heading structure and table reading
  order.

For gesture changes, use a physical touch device at a 390-pixel viewport. Open and close the Sites
drawer, drag a node, cancel a drag with a system gesture, pinch the canvas, edit
a VLAN, and open the implementation report. Confirm that controls remain
visible and the page has no horizontal overflow. Repeat the primary path at
200 percent zoom and with reduced motion enabled.

## Verify production

After the staged deployment, run:

```sh
npm run check:production
```

The command is read-only. It checks that production health reports the local
package and schema versions, the homepage has the self-only content security
policy, the legacy hostname redirects in one hop, and unknown routes return the
branded 404 page.

Open the canonical site at desktop and 390-pixel widths. Repeat the example,
CSV import, edit, export, and report paths. Check the browser console and failed
requests. Production is ready only when these checks pass against the deployed
build.
