# Network Planner Studio

An IPv4-only network design workbench for modelling existing environments and
planning new sites, VLANs and WAN connections.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the local-first component model,
data flow, privacy boundary, deployment topology, and external dependencies.

## Product principles

- Existing address space is entered without being silently changed.
- New subnets are allocated inside an explicit site parent range.
- Hard errors (invalid or overlapping ranges) are distinct from design advice.
- The canvas is visual; precise address data remains available in tables.
- Designs are private and local by default.

## Features

- Existing-network and new-network entry flows
- Draggable multi-site topology canvas
- Site-tree search plus collapsed overview for large imported designs
- Existing or automatically recommended site and VLAN ranges
- VLAN role, capacity and gateway planning
- VPN, private WAN, peering and internet connections
- Explicit hub, spoke and standalone topology roles
- Hub-and-spoke policy wizard with radial auto-layout
- Multi-hop animated route tracing through transit hubs
- Static or BGP routing intent, advertised prefixes and default routes
- Connection notes preserved in the planner and implementation report
- Address overlap, containment and capacity validation
- Single-WAN, segmentation and management-network design guidance
- Editable gateways, gateway-aware capacity, DHCP reservations and `/31` transit networks
- Explicit DHCP pool start/end planning with gateway exclusion checks
- Editable sites, VLANs and connections with undo/redo
- Trust-zone traffic policy matrix
- Design assumptions and implementation notes
- Local persistence and JSON import/export
- Multiple local projects with duplicate, open and delete workflows
- Print-ready implementation report for PDF handoff
- Versioned JSON migration plus RFC 4180 CSV address-plan import/export
- Versioned REST planning API (`/api/v1`, OpenAPI-described, with a standalone JSON Schema of the design model and a fetchable example design) and an MCP tool server at `/mcp` — both expose the recommendation engine (`sites/plan`, `plan_site`) alongside validation, review, routing and allocation; see [docs/api.md](docs/api.md)
- Zoom, pan, pinch, fit-to-screen, undoable keyboard nudges, drag-cancel snap-back and a mobile site drawer
- Responsive desktop and mobile layouts

## Run locally

```sh
npm install
npm run dev
```

Run both the networking unit tests and browser workflows:

```sh
npm test
npm run test:e2e
```

The health endpoint is available at `/api/health`. The planner engine is also
served as a versioned REST API and an MCP tool server; see
[docs/api.md](docs/api.md).

Before a release, run the complete local gate:

```sh
npm run check:release
```

The gate checks package, lockfile, health, and schema provenance. It then runs
the unit suite, browser suite, dependency audit, and Wrangler dry run.

## Deploy

Follow [RELEASE.md](RELEASE.md) for the acceptance checks and post-deployment
production smoke test.

```sh
npm run deploy
```

The Worker serves static assets directly and uses no database or paid binding.
