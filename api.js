/*
 * Versioned REST surface over the canonical planning engine (network-core.js).
 * Stateless compute only: no storage, no user data, no credentials. Requests
 * are bounded and validated at this boundary; the engine stays pure.
 */
import packageMetadata from "./package.json" with { type: "json" };
import { machineResponseHeaders, machinePreflightHeaders } from "./headers.js";
import {
  SCHEMA_ID, SCHEMA_VERSION, DesignValidationError, migrateDesign, validateDesign,
  reviewDesignIssues, designScore, shortestPath, nextSubnet, suggestSiteRange,
  recommendSitePlan, recommendVlanPlan
} from "./public/network-core.js";

export const API_BODY_LIMIT_BYTES = 1024 * 1024;

export class HttpProblem extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const baseHeaders = () => machineResponseHeaders();

function jsonResponse(payload, { status = 200, headers = new Headers(), contentType = "application/json; charset=utf-8" } = {}) {
  const finalHeaders = baseHeaders();
  for (const [key, value] of headers) finalHeaders.set(key, value);
  finalHeaders.set("Content-Type", contentType);
  return new Response(JSON.stringify(payload), { status, headers: finalHeaders });
}

function problemResponse(problem, extra = {}) {
  const headers = new Headers(extra);
  return jsonResponse(
    { ok: false, error: { code: problem.code, message: problem.message } },
    { status: problem.status, headers }
  );
}

function preflight() {
  return new Response(null, { status: 204, headers: machinePreflightHeaders() });
}

export async function readJsonBody(request, { limitBytes = API_BODY_LIMIT_BYTES } = {}) {
  const contentType = String(request.headers.get("content-type") || "");
  if (!contentType.toLowerCase().startsWith("application/json")) {
    throw new HttpProblem(415, "unsupported_media_type", "Send the request body as application/json.");
  }
  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (declaredLength > limitBytes) {
    throw new HttpProblem(413, "payload_too_large", `Request bodies are limited to ${limitBytes} bytes.`);
  }
  const text = await request.text();
  if (text.length > limitBytes) {
    throw new HttpProblem(413, "payload_too_large", `Request bodies are limited to ${limitBytes} bytes.`);
  }
  if (!text.trim()) throw new HttpProblem(400, "empty_body", "The request body must contain a JSON document.");
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpProblem(400, "invalid_json", "The request body is not valid JSON.");
  }
}

/** Canonicalize a submitted design without rejecting it; report what moved. */
function parseDesign(rawDesign) {
  if (!rawDesign || typeof rawDesign !== "object" || Array.isArray(rawDesign)) {
    throw new HttpProblem(400, "invalid_design", "The design must be a JSON object with sites and links arrays.");
  }
  let migrated;
  try {
    migrated = migrateDesign(rawDesign, { strict: false });
  } catch (error) {
    if (error instanceof DesignValidationError) {
      throw new HttpProblem(400, "invalid_design", `${error.message} The design must be a JSON object with sites and links arrays.`);
    }
    throw error;
  }
  return migrated;
}

export function opValidate(rawDesign) {
  const migrated = parseDesign(rawDesign);
  const corrections = [...(migrated.importWarnings || [])];
  const validation = validateDesign(migrated);
  const { importWarnings: _reported, ...design } = migrated;
  return {
    valid: corrections.length === 0 && validation.errors.length === 0,
    design,
    corrections,
    errors: validation.errors,
    warnings: validation.warnings
  };
}

export function opReview(rawDesign) {
  // importWarnings stay attached here: they feed the same
  // "Recovered design data" findings the workspace shows.
  const migrated = parseDesign(rawDesign);
  const issues = reviewDesignIssues(migrated);
  const count = severity => issues.filter(issue => issue.severity === severity).length;
  return {
    score: designScore(issues),
    summary: { errors: count("error"), warnings: count("warning"), advice: count("advice") },
    issues
  };
}

function resolveSite(migrated, reference) {
  const wanted = String(reference ?? "").trim().toLowerCase();
  return migrated.sites.find(site => site.id.toLowerCase() === wanted)
    || migrated.sites.find(site => site.name.trim().toLowerCase() === wanted)
    || null;
}

export function opRoute({ design, from, to }) {
  const migrated = parseDesign(design);
  const source = resolveSite(migrated, from), destination = resolveSite(migrated, to);
  if (!source) throw new HttpProblem(400, "unknown_site", `No site matches "${String(from)}". Use a site id or exact site name from the design.`);
  if (!destination) throw new HttpProblem(400, "unknown_site", `No site matches "${String(to)}". Use a site id or exact site name from the design.`);
  const route = shortestPath(migrated.sites, migrated.links, source.id, destination.id, {
    topologyMode: migrated.topologyMode,
    spokeToSpoke: migrated.policies?.spokeToSpoke || "via-hub"
  });
  return {
    reachable: Boolean(route),
    policyApplied: { topologyMode: migrated.topologyMode, spokeToSpoke: migrated.policies?.spokeToSpoke || "via-hub" },
    hops: route ? route.sites.map(id => migrated.sites.find(site => site.id === id)?.name || id) : [],
    hopIds: route ? [...route.sites] : [],
    links: route ? [...route.links] : []
  };
}

function boundedPositiveInteger(value, fallback, label) {
  if (value === undefined || value === null || value === "") return fallback;
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 1 || numeric > 100000) {
    throw new HttpProblem(400, "invalid_input", `${label} must be an integer from 1 to 100000.`);
  }
  return numeric;
}

export function opNextSubnet({ parent, prefix, occupied }) {
  if (typeof parent !== "string" || !parent.trim()) throw new HttpProblem(400, "invalid_input", "parent must be an IPv4 CIDR string such as 10.20.0.0/16.");
  if (!Number.isInteger(Number(prefix)) || Number(prefix) < 8 || Number(prefix) > 31) {
    throw new HttpProblem(400, "invalid_input", "prefix must be an integer from 8 to 31 and must fit inside parent.");
  }
  if (occupied !== undefined && !Array.isArray(occupied)) throw new HttpProblem(400, "invalid_input", "occupied must be an array of IPv4 CIDR strings.");
  try {
    return { cidr: nextSubnet(parent.trim(), Number(prefix), Array.isArray(occupied) ? occupied : []) };
  } catch (error) {
    throw new HttpProblem(400, "unallocatable", error.message);
  }
}

export function opSuggestRange({ occupied, devices } = {}) {
  if (occupied !== undefined && !Array.isArray(occupied)) throw new HttpProblem(400, "invalid_input", "occupied must be an array of IPv4 CIDR strings.");
  const wanted = boundedPositiveInteger(devices, 50, "devices");
  try {
    return { cidr: suggestSiteRange(Array.isArray(occupied) ? occupied : [], wanted) };
  } catch (error) {
    throw new HttpProblem(400, "unallocatable", error.message);
  }
}

/** Map the planner's structured rejection onto an honest HTTP problem. */
function planProblem(error) {
  const code = error.errors?.[0]?.code;
  if (code === "unknown-site") return new HttpProblem(400, "unknown_site", error.message);
  if (code === "unallocatable" || code === "exhausted") return new HttpProblem(400, "unallocatable", error.message);
  return new HttpProblem(400, "invalid_input", error.message);
}

function optionalSites(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some(entry => !entry || typeof entry !== "object" || Array.isArray(entry))) {
    throw new HttpProblem(400, "invalid_input", "sites must be an array of site objects with cidr and vlans.");
  }
  return value;
}

function optionalText(value, label, max = 100) {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") throw new HttpProblem(400, "invalid_input", `${label} must be a string.`);
  if (value.length > max) throw new HttpProblem(400, "invalid_input", `${label} must be at most ${max} characters.`);
  return value;
}

export function opPlanSite({ type, devices, growth, name, sites } = {}) {
  try {
    return { plan: recommendSitePlan({
      sites: optionalSites(sites),
      type: type === undefined ? "office" : type,
      devices: devices === undefined ? 50 : devices,
      growth: growth === undefined ? 30 : growth,
      name: optionalText(name, "name")
    }) };
  } catch (error) {
    if (error instanceof DesignValidationError) throw planProblem(error);
    throw error;
  }
}

export function opPlanVlan({ sites, siteId, role, devices, name } = {}) {
  if (!Array.isArray(sites)) throw new HttpProblem(400, "invalid_input", "sites must be an array of site objects; include the site that will own the VLAN.");
  if (siteId === undefined || siteId === null || siteId === "") throw new HttpProblem(400, "missing_field", 'The request body must include "siteId".');
  for (const entry of sites) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new HttpProblem(400, "invalid_input", "sites must be an array of site objects with cidr and vlans.");
    }
  }
  try {
    return { plan: recommendVlanPlan({
      sites,
      siteId,
      role: role === undefined ? "other" : role,
      devices: devices === undefined ? 30 : devices,
      name: optionalText(name, "name")
    }) };
  } catch (error) {
    if (error instanceof DesignValidationError) throw planProblem(error);
    throw error;
  }
}

function directory() {
  return {
    ok: true,
    service: packageMetadata.name,
    version: packageMetadata.version,
    schema: SCHEMA_ID,
    schemaVersion: SCHEMA_VERSION,
    mcp: "/mcp",
    designSchema: "/api/v1/design-schema.json",
    description: "Stateless IPv4 planning computations over the network-planner-studio canonical model. No accounts, no storage.",
    endpoints: [
      { method: "GET", path: "/api/v1/openapi.json", description: "OpenAPI 3.1 description of this API." },
      { method: "GET", path: "/api/v1/design-schema.json", description: "Standalone JSON Schema (draft 2020-12) of the canonical design document." },
      { method: "POST", path: "/api/v1/validate", description: "Canonicalize a design against schema v3 and report hard validation errors, warnings and normalization corrections." },
      { method: "POST", path: "/api/v1/review", description: "Run the workspace design review: weighted score plus heuristic findings (overlaps, capacity, hub-and-spoke consistency)." },
      { method: "POST", path: "/api/v1/route", description: "Trace the shortest permitted inter-site path under a design's topology policy." },
      { method: "POST", path: "/api/v1/sites/plan", description: "Plan a complete compatible site: a free RFC1918 block plus role-sized VLANs following the environment's ID conventions." },
      { method: "POST", path: "/api/v1/vlans/plan", description: "Plan one compatible VLAN inside an existing site, using the environment's VLAN ID convention." },
      { method: "POST", path: "/api/v1/subnets/next", description: "Allocate the next aligned free subnet inside a parent range." },
      { method: "POST", path: "/api/v1/site-range/suggest", description: "Suggest a non-overlapping RFC1918 site block for a planned device count." }
    ]
  };
}

/** Structural schema of the canonical design document. Single source for the
 * OpenAPI component and the standalone JSON Schema artifact, so machine
 * validation can never drift from what the endpoints actually accept. */
const DESIGN_DOCUMENT_SCHEMA = {
  type: "object",
  description: `A ${SCHEMA_ID} v${SCHEMA_VERSION} design document.`,
  required: ["schema", "version", "sites", "links"],
  properties: {
    schema: { type: "string", const: SCHEMA_ID },
    version: { type: "integer", const: SCHEMA_VERSION },
    projectId: { type: "string" },
    name: { type: "string" },
    topologyMode: { type: "string", enum: ["custom", "hub-spoke", "mesh"] },
    policies: { type: "object", properties: { spokeToSpoke: { type: "string", enum: ["via-hub", "denied"] }, centralizedInspection: { type: "boolean" }, secondaryHubId: { type: ["string", "null"] } } },
    flowPolicies: { type: "object", additionalProperties: { type: "string", enum: ["allow", "restricted", "deny"] } },
    assumptions: { type: "array", items: { type: "string" } },
    sites: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "cidr"],
        properties: {
          id: { type: "string" }, name: { type: "string" },
          type: { type: "string", enum: ["office", "branch", "datacentre", "cloud", "warehouse"] },
          cidr: { type: "string", description: "Aligned IPv4 allocation CIDR /8 to /30." },
          wan: { type: "string", enum: ["single", "dual", "none"] },
          topologyRole: { type: "string", enum: ["standalone", "hub", "spoke"] },
          hubId: { type: ["string", "null"] },
          internetBreakout: { type: "string", enum: ["local", "hub", "none"] },
          vlans: {
            type: "array",
            items: {
              type: "object",
              required: ["id", "cidr"],
              properties: {
                id: { type: "string" }, name: { type: "string" }, vid: { type: "integer", minimum: 1, maximum: 4094 },
                role: { type: "string", enum: ["users", "voice", "guest", "iot", "servers", "management", "transit", "other"] },
                cidr: { type: "string" }, gateway: { type: "string" }, devices: { type: "integer" },
                dhcpEnabled: { type: "boolean" }, reserved: { type: "integer" }, dhcpStart: { type: "string" }, dhcpEnd: { type: "string" }
              }
            }
          }
        }
      }
    },
    links: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "from", "to"],
        properties: {
          id: { type: "string" }, from: { type: "string" }, to: { type: "string" },
          type: { type: "string", enum: ["vpn", "private", "peering", "internet"] },
          resilience: { type: "string", enum: ["single", "dual"] },
          routingType: { type: "string", enum: ["static", "bgp"] },
          transitAllowed: { type: "boolean" },
          defaultRoute: { type: "boolean" },
          advertisedPrefixes: { type: "array", items: { type: "string" } }
        }
      }
    }
  }
};

function designSchema() {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "https://network.illek.ie/api/v1/design-schema.json",
    title: "Network Planner Studio design document",
    ...DESIGN_DOCUMENT_SCHEMA
  };
}

function openapi() {
  const ok = description => ({ description });
  const jsonBody = schema => ({ required: true, content: { "application/json": { schema } } });
  const jsonResponseFor = schema => ({ 200: { ...ok("Computed result."), content: { "application/json": { schema } } } });
  const errors = {
    "400": ok("Invalid input or unallocatable request."),
    "413": ok("Body exceeded 1 MiB."),
    "415": ok("Content-Type was not application/json."),
    "405": ok("Method not allowed for this path.")
  };
  const designRef = { $ref: "#/components/schemas/DesignDocument" };
  return {
    openapi: "3.1.0",
    info: {
      title: "Network Planner Studio API",
      version: packageMetadata.version,
      description: `Stateless IPv4 planning computations over the ${SCHEMA_ID} v${SCHEMA_VERSION} canonical model. All operations are pure: designs are validated, reviewed and traced without being stored.`,
      license: { name: "Proprietary" }
    },
    servers: [{ url: "https://network.illek.ie" }],
    paths: {
      "/api/v1": { get: { ...ok("Service directory."), summary: "List API endpoints.", responses: jsonResponseFor({ $ref: "#/components/schemas/Directory" }) } },
      "/api/v1/openapi.json": { get: { summary: "This OpenAPI document.", responses: jsonResponseFor({ type: "object" }) } },
      "/api/v1/design-schema.json": {
        get: {
          summary: "Standalone JSON Schema of the canonical design document",
          description: `Draft 2020-12 JSON Schema for ${SCHEMA_ID} v${SCHEMA_VERSION}, usable with offline validators; mirrors components.schemas.DesignDocument.`,
          responses: jsonResponseFor({ type: "object" })
        }
      },
      "/api/v1/validate": {
        post: {
          summary: "Validate and canonicalize a design",
          description: "Migrates the submitted document to the v3 canonical form, reports normalization corrections, and runs all hard checks (containment, overlap, gateways, DHCP pools, hub-and-spoke wiring).",
          requestBody: jsonBody({
            type: "object",
            required: ["design"],
            properties: { design: designRef }
          }),
          responses: {
            ...jsonResponseFor({ $ref: "#/components/schemas/ValidateResult" }),
            ...errors
          }
        }
      },
      "/api/v1/review": {
        post: {
          summary: "Review a design with the workspace heuristics",
          description: "Returns the same weighted score and findings the browser workspace shows, including recovered-import warnings.",
          requestBody: jsonBody({ type: "object", required: ["design"], properties: { design: designRef } }),
          responses: { ...jsonResponseFor({ $ref: "#/components/schemas/ReviewResult" }), ...errors }
        }
      },
      "/api/v1/route": {
        post: {
          summary: "Trace a permitted inter-site route",
          description: "Sites may be referenced by id or exact name. Hub-and-spoke transit policy from the design is applied.",
          requestBody: jsonBody({
            type: "object",
            required: ["design", "from", "to"],
            properties: {
              design: designRef,
              from: { type: "string", description: "Source site id or exact name." },
              to: { type: "string", description: "Destination site id or exact name." }
            }
          }),
          responses: { ...jsonResponseFor({ $ref: "#/components/schemas/RouteResult" }), ...errors }
        }
      },
      "/api/v1/subnets/next": {
        post: {
          summary: "Allocate the next free subnet",
          requestBody: jsonBody({
            type: "object",
            required: ["parent", "prefix"],
            properties: {
              parent: { type: "string", examples: ["10.20.0.0/16"] },
              prefix: { type: "integer", minimum: 8, maximum: 31 },
              occupied: { type: "array", items: { type: "string" }, description: "Already-used CIDRs inside parent." }
            }
          }),
          responses: { ...jsonResponseFor({ type: "object", properties: { cidr: { type: "string" } }, required: ["cidr"] }), ...errors }
        }
      },
      "/api/v1/sites/plan": {
        post: {
          summary: "Plan a complete compatible site",
          description: "Runs the workspace recommendation engine: picks a free RFC1918 parent block, then one growth-sized subnet per role (office/branch: users, voice, guest, management; warehouse adds IoT; cloud and datacentre get servers plus management), following the VLAN ID conventions of the sites you pass in. Plans carry no object ids; assign them when merging into a design.",
          requestBody: jsonBody({
            type: "object",
            properties: {
              type: { type: "string", enum: ["office", "branch", "datacentre", "cloud", "warehouse"], default: "office" },
              devices: { type: "integer", minimum: 1, maximum: 50000, default: 50, description: "Planned primary devices; role shares derive from it." },
              growth: { type: "number", minimum: 0, maximum: 1000, default: 30 },
              name: { type: "string", default: "New site" },
              sites: { type: "array", items: designRef, description: "Existing sites, used for range avoidance and VLAN ID conventions." }
            }
          }),
          responses: { ...jsonResponseFor({ $ref: "#/components/schemas/SitePlan" }), ...errors }
        }
      },
      "/api/v1/vlans/plan": {
        post: {
          summary: "Plan one compatible VLAN",
          description: "Allocates the smallest recommended subnet inside an existing site using the site's growth allowance, and the environment's most-used VLAN ID for the role.",
          requestBody: jsonBody({
            type: "object",
            required: ["sites", "siteId"],
            properties: {
              sites: { type: "array", items: designRef, description: "The design's sites; one must match siteId." },
              siteId: { type: "string", description: "Id of the site that will own the new VLAN." },
              role: { type: "string", enum: ["users", "voice", "guest", "iot", "servers", "management", "transit", "other"], default: "other" },
              devices: { type: "integer", minimum: 1, maximum: 65534, default: 30 },
              name: { type: "string", description: "Defaults to the role's conventional name." }
            }
          }),
          responses: { ...jsonResponseFor({ $ref: "#/components/schemas/VlanPlan" }), ...errors }
        }
      },
      "/api/v1/site-range/suggest": {
        post: {
          summary: "Suggest a private site block",
          requestBody: jsonBody({
            type: "object",
            properties: {
              occupied: { type: "array", items: { type: "string" } },
              devices: { type: "integer", minimum: 1, maximum: 100000, description: "Planned primary device count; drives the suggested prefix." }
            }
          }),
          responses: { ...jsonResponseFor({ type: "object", properties: { cidr: { type: "string" } }, required: ["cidr"] }), ...errors }
        }
      }
    },
    components: {
      schemas: {
        Directory: {
          type: "object",
          properties: {
            ok: { type: "boolean" },
            service: { type: "string" },
            version: { type: "string" },
            schema: { type: "string" },
            schemaVersion: { type: "integer" },
            endpoints: { type: "array", items: { type: "object", properties: { method: { type: "string" }, path: { type: "string" }, description: { type: "string" } } } }
          }
        },
        DesignDocument: DESIGN_DOCUMENT_SCHEMA,
                ValidationIssue: {
          type: "object",
          properties: {
            path: { type: "string" },
            message: { type: "string" },
            code: { type: "string", examples: ["invalid-cidr", "overlap", "duplicate-id", "outside-parent"] }
          }
        },
        ReviewFinding: {
          type: "object",
          properties: {
            severity: { type: "string", enum: ["info", "advice", "warning", "error"] },
            title: { type: "string" },
            message: { type: "string" },
            siteId: { type: "string" }
          }
        },
        ValidateResult: {
          type: "object",
          properties: {
            valid: { type: "boolean", description: "True when no corrections and no validation errors were found." },
            design: { $ref: "#/components/schemas/DesignDocument" },
            corrections: { type: "array", items: { type: "string" }, description: "Human-readable notes about values normalized during migration." },
            errors: { type: "array", items: { $ref: "#/components/schemas/ValidationIssue" } },
            warnings: { type: "array", items: { $ref: "#/components/schemas/ValidationIssue" } }
          }
        },
        ReviewResult: {
          type: "object",
          properties: {
            score: { type: "integer", minimum: 0, maximum: 100 },
            summary: { type: "object", properties: { errors: { type: "integer" }, warnings: { type: "integer" }, advice: { type: "integer" } } },
            issues: { type: "array", items: { $ref: "#/components/schemas/ReviewFinding" } }
          }
        },
        RouteResult: {
          type: "object",
          properties: {
            reachable: { type: "boolean" },
            policyApplied: { type: "object", properties: { topologyMode: { type: "string" }, spokeToSpoke: { type: "string" } } },
            hops: { type: "array", items: { type: "string" }, description: "Site names along the path." },
            hopIds: { type: "array", items: { type: "string" } },
            links: { type: "array", items: { type: "string" }, description: "Link ids traversed." }
          }
        },
        PlannedVlan: {
          type: "object",
          description: "One planned VLAN. Identity-free: assign an id when merging into a design.",
          required: ["name", "vid", "role", "devices", "cidr", "gateway"],
          properties: {
            name: { type: "string" },
            vid: { type: "integer", minimum: 1, maximum: 4094 },
            role: { type: "string", enum: ["users", "voice", "guest", "iot", "servers", "management", "transit", "other"] },
            devices: { type: "integer" },
            cidr: { type: "string" },
            gateway: { type: "string" },
            dhcpEnabled: { type: "boolean" },
            reserved: { type: "integer" },
            dhcpStart: { type: "string" },
            dhcpEnd: { type: "string" },
            notes: { type: "string" }
          }
        },
        SitePlan: {
          type: "object",
          required: ["name", "type", "devices", "growth", "cidr", "vlans"],
          properties: {
            name: { type: "string" },
            type: { type: "string", enum: ["office", "branch", "datacentre", "cloud", "warehouse"] },
            devices: { type: "integer" },
            growth: { type: "number" },
            cidr: { type: "string", description: "Suggested free RFC1918 parent block for the site." },
            vlans: { type: "array", items: { $ref: "#/components/schemas/PlannedVlan" } }
          }
        },
        VlanPlan: {
          type: "object",
          required: ["name", "vid", "role", "devices", "cidr", "gateway"],
          properties: {
            name: { type: "string" },
            vid: { type: "integer", minimum: 1, maximum: 4094 },
            role: { type: "string", enum: ["users", "voice", "guest", "iot", "servers", "management", "transit", "other"] },
            devices: { type: "integer" },
            cidr: { type: "string" },
            gateway: { type: "string" },
            dhcpEnabled: { type: "boolean" },
            reserved: { type: "integer" },
            dhcpStart: { type: "string" },
            dhcpEnd: { type: "string" },
            notes: { type: "string" }
          }
        }
      }
    }
  };
}

async function handlePost(request, bodyHandler) {
  try {
    const body = await readJsonBody(request);
    return jsonResponse({ ok: true, result: bodyHandler(body) });
  } catch (error) {
    if (error instanceof HttpProblem) return problemResponse(error);
    console.error(`api: unhandled ${error?.stack || error}`);
    return problemResponse(new HttpProblem(500, "internal_error", "The request could not be computed."));
  }
}

export async function handleApiRequest(request) {
  const url = new URL(request.url);
  const method = request.method;
  try {
    if (method === "OPTIONS") return preflight();
    const notAllowed = allow => problemResponse(new HttpProblem(405, "method_not_allowed", `${method} is not supported here.`), { Allow: allow });
    // Directory responses are computed per request; a HEAD must not carry a
    // phantom body even where the runtime would strip one.
    const headOr = response => method === "HEAD" ? new Response(null, { status: response.status, headers: response.headers }) : response;

    if (url.pathname === "/api/v1" || url.pathname === "/api/v1/") {
      if (!["GET", "HEAD"].includes(method)) return notAllowed("GET, HEAD, OPTIONS");
      return headOr(jsonResponse(directory()));
    }
    if (url.pathname === "/api/v1/openapi.json") {
      if (!["GET", "HEAD"].includes(method)) return notAllowed("GET, HEAD, OPTIONS");
      return headOr(jsonResponse(openapi()));
    }
    if (url.pathname === "/api/v1/design-schema.json") {
      if (!["GET", "HEAD"].includes(method)) return notAllowed("GET, HEAD, OPTIONS");
      return headOr(jsonResponse(designSchema(), { contentType: "application/schema+json; charset=utf-8" }));
    }

    const postedRoutes = {
      "/api/v1/validate": body => opValidate(requireField(body, "design")),
      "/api/v1/review": body => opReview(requireField(body, "design")),
      "/api/v1/route": body => opRoute({
        design: requireField(body, "design"),
        from: requireField(body, "from"),
        to: requireField(body, "to")
      }),
      "/api/v1/subnets/next": body => opNextSubnet({
        parent: requireField(body, "parent"),
        prefix: requireField(body, "prefix"),
        occupied: body.occupied
      }),
      "/api/v1/site-range/suggest": body => opSuggestRange(body),
      "/api/v1/sites/plan": body => opPlanSite(body),
      "/api/v1/vlans/plan": body => opPlanVlan(body)
    };
    const handler = postedRoutes[url.pathname];
    if (handler) {
      if (method !== "POST") return notAllowed("POST, OPTIONS");
      return await handlePost(request, handler);
    }
    return problemResponse(new HttpProblem(404, "not_found", `Unknown API path ${url.pathname}. See GET /api/v1 for the endpoint directory.`));
  } catch (error) {
    if (error instanceof HttpProblem) return problemResponse(error);
    console.error(`api: unhandled ${error?.stack || error}`);
    return problemResponse(new HttpProblem(500, "internal_error", "The request could not be computed."));
  }
}

function requireField(body, key) {
  if (!body || typeof body !== "object" || body[key] === undefined) {
    throw new HttpProblem(400, "missing_field", `The request body must include "${key}".`);
  }
  return body[key];
}
