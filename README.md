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

The health endpoint is available at `/api/health`.

## Deploy

```sh
npm run deploy
```

The Worker serves static assets directly and uses no database or paid binding.
