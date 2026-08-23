# Release Network Planner Studio

Use this checklist for a staged release to `network.illek.ie`. Do not mark the
release complete until every applicable check passes.

## Check the candidate

1. Start from a clean working tree.
2. Install the locked dependencies with `npm ci`.
3. Run `npm run check:release`.
4. Start the candidate with `npm run dev`.
5. Run the Illek HTML audit and Lighthouse against the local homepage.
6. Inspect the planner at 390, 768, and 1440 pixels. Check the browser console
   and failed network requests during the example, import, edit, and report
   paths.

## Complete manual accessibility acceptance

Use a screen reader on a supported desktop browser. Confirm all of the
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

Use a physical touch device at a 390-pixel viewport. Open and close the Sites
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
