/*
 * MCP (Model Context Protocol) tool server over Streamable HTTP, stateless
 * JSON mode. It exposes the same planning operations as /api/v1 to AI agents:
 * every tool is a pure computation on the canonical design model — nothing is
 * stored, so no session state or authentication surface exists.
 */
import packageMetadata from "./package.json" with { type: "json" };
import { machineResponseHeaders, machinePreflightHeaders } from "./headers.js";
import { HttpProblem, readJsonBody, opValidate, opReview, opRoute, opNextSubnet, opSuggestRange } from "./api.js";

const PROTOCOL_VERSION = "2025-06-18";
const SUPPORTED_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26"];

function rpcResult(id, result, protocolVersion = PROTOCOL_VERSION) {
  const headers = machineResponseHeaders();
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("MCP-Protocol-Version", protocolVersion);
  return new Response(JSON.stringify({ jsonrpc: "2.0", id, result }), { status: 200, headers });
}

function rpcError(id, code, message, protocolVersion = PROTOCOL_VERSION) {
  const headers = machineResponseHeaders();
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("MCP-Protocol-Version", protocolVersion);
  return new Response(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }), { status: 200, headers });
}

function notificationAccepted() {
  // Streamable HTTP: notifications and responses-only batches get 202 with an
  // empty body.
  return new Response(null, { status: 202, headers: machineResponseHeaders() });
}

const tool = (name, title, description, inputSchema, outputSchema) => ({ name, title, description, inputSchema, outputSchema });

// Structured results mirror the REST payloads exactly; declaring their shape
// lets agents validate tool answers instead of string-parsing them.
const validationIssueSchema = {
  type: "object", required: ["path", "message"],
  properties: { path: { type: "string" }, message: { type: "string" }, code: { type: "string" } }
};
const findingSchema = {
  type: "object", required: ["severity", "title", "message"],
  properties: {
    severity: { type: "string", enum: ["info", "advice", "warning", "error"] },
    title: { type: "string" }, message: { type: "string" },
    siteId: { type: "string", description: "Present when the finding points at one site." }
  }
};
const cidrResultSchema = {
  type: "object", required: ["cidr"], additionalProperties: false,
  properties: { cidr: { type: "string", description: "Allocated IPv4 CIDR block." } }
};

const TOOLS = [
  tool(
    "validate_design",
    "Validate an IPv4 network design",
    `Canonicalize a network-planner-studio design document against schema v3 and run all hard checks: subnet containment, overlaps, gateways, DHCP pools, VLAN IDs and hub-and-spoke wiring. Returns valid plus corrections, errors and warnings.`,
    {
      type: "object",
      required: ["design"],
      properties: { design: { type: "object", description: "A network-planner-studio/design v3 document (schema, version, sites, links)." } }
    },
    {
      type: "object", required: ["valid", "design", "corrections", "errors", "warnings"],
      properties: {
        valid: { type: "boolean", description: "True when no corrections and no validation errors were found." },
        design: { type: "object", description: "The canonical v3 document after normalization." },
        corrections: { type: "array", items: { type: "string" } },
        errors: { type: "array", items: validationIssueSchema },
        warnings: { type: "array", items: validationIssueSchema }
      }
    }
  ),
  tool(
    "review_design",
    "Review a design with the planner heuristics",
    "Run the workspace design review: weighted 0-100 score and findings for capacity risks, single dependencies, isolated sites, missing management segments and policy conflicts.",
    {
      type: "object",
      required: ["design"],
      properties: { design: { type: "object", description: "A network-planner-studio/design v3 document." } }
    },
    {
      type: "object", required: ["score", "summary", "issues"],
      properties: {
        score: { type: "integer", minimum: 0, maximum: 100 },
        summary: {
          type: "object", required: ["errors", "warnings", "advice"],
          properties: { errors: { type: "integer" }, warnings: { type: "integer" }, advice: { type: "integer" } }
        },
        issues: { type: "array", items: findingSchema }
      }
    }
  ),
  tool(
    "find_route",
    "Trace the permitted route between two sites",
    "BFS path trace across WAN links under the design's topology policy. Sites may be referenced by id or exact name. Returns reachability, hop names/ids and traversed link ids.",
    {
      type: "object",
      required: ["design", "from", "to"],
      properties: {
        design: { type: "object", description: "A network-planner-studio/design v3 document." },
        from: { type: "string", description: "Source site id or exact site name." },
        to: { type: "string", description: "Destination site id or exact site name." }
      }
    },
    {
      type: "object", required: ["reachable", "policyApplied", "hops", "hopIds", "links"],
      properties: {
        reachable: { type: "boolean" },
        policyApplied: {
          type: "object", required: ["topologyMode", "spokeToSpoke"],
          properties: {
            topologyMode: { type: "string", enum: ["custom", "hub-spoke", "mesh"] },
            spokeToSpoke: { type: "string", enum: ["via-hub", "denied"] }
          }
        },
        hops: { type: "array", items: { type: "string" }, description: "Site names along the path; empty when unreachable." },
        hopIds: { type: "array", items: { type: "string" } },
        links: { type: "array", items: { type: "string" }, description: "Traversed link ids." }
      }
    }
  ),
  tool(
    "next_subnet",
    "Allocate the next free aligned IPv4 subnet",
    "Given a parent CIDR and a required prefix, return the first aligned subnet that does not overlap any occupied CIDR.",
    {
      type: "object",
      required: ["parent", "prefix"],
      properties: {
        parent: { type: "string", description: "Parent range, e.g. 10.20.0.0/16." },
        prefix: { type: "integer", minimum: 8, maximum: 31 },
        occupied: { type: "array", items: { type: "string" }, description: "Already-used CIDRs inside parent." }
      }
    },
    cidrResultSchema
  ),
  tool(
    "suggest_site_range",
    "Suggest a private site address block",
    "Pick a non-overlapping RFC1918 block sized for a planned device count (50 -> /20, 250 -> /18, 1000+ -> /16).",
    {
      type: "object",
      properties: {
        occupied: { type: "array", items: { type: "string" }, description: "Site ranges already in use." },
        devices: { type: "integer", minimum: 1, maximum: 100000, description: "Planned primary devices; defaults to 50." }
      }
    },
    cidrResultSchema
  )
];

function callTool(name, args = {}) {
  switch (name) {
    case "validate_design": return opValidate(requireArg(args, "design"));
    case "review_design": return opReview(requireArg(args, "design"));
    case "find_route": return opRoute({
      design: requireArg(args, "design"),
      from: requireArg(args, "from"),
      to: requireArg(args, "to")
    });
    case "next_subnet": return opNextSubnet({
      parent: requireArg(args, "parent"),
      prefix: requireArg(args, "prefix"),
      occupied: args.occupied
    });
    case "suggest_site_range": return opSuggestRange(args);
    default: return undefined;
  }
}

function requireArg(args, key) {
  if (args[key] === undefined) throw new HttpProblem(400, "missing_argument", `Tool arguments must include "${key}".`);
  return args[key];
}

export async function handleMcpRequest(request) {
  const method = request.method;
  try {
    if (method === "OPTIONS") return new Response(null, { status: 204, headers: machinePreflightHeaders() });
    if (method !== "POST") {
      // No SSE stream is offered in stateless mode, so GET must be refused.
      const headers = machineResponseHeaders();
      headers.set("Allow", "POST, OPTIONS");
      return new Response(null, { status: 405, headers });
    }

    let message;
    try {
      message = await readJsonBody(request);
    } catch (error) {
      if (!(error instanceof HttpProblem)) throw error;
      if (error.code === "invalid_json" || error.code === "empty_body") return rpcError(null, -32700, "Parse error");
      if (error.code === "payload_too_large") {
        const headers = machineResponseHeaders();
        headers.set("Content-Type", "application/json; charset=utf-8");
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: error.message } }), { status: 413, headers });
      }
      const headers = machineResponseHeaders();
      headers.set("Content-Type", "application/json; charset=utf-8");
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32600, message: error.message } }), { status: error.status, headers });
    }

    if (Array.isArray(message)) return rpcError(null, -32600, "Batch requests are not supported by this server.");
    if (!message || typeof message !== "object" || typeof message.method !== "string") {
      return rpcError(message?.id ?? null, -32600, "Invalid Request");
    }

    const { id, method: rpcMethod, params } = message;
    const requestedVersion = String(params?.protocolVersion || "");
    const negotiated = SUPPORTED_PROTOCOL_VERSIONS.includes(requestedVersion) ? requestedVersion : PROTOCOL_VERSION;

    // Notifications carry no id and expect acknowledgement only.
    if (id === undefined) return notificationAccepted();

    switch (rpcMethod) {
      case "initialize":
        return rpcResult(id, {
          protocolVersion: negotiated,
          capabilities: { tools: {} },
          serverInfo: { name: packageMetadata.name, title: "Network Planner Studio", version: packageMetadata.version },
          instructions: "Stateless IPv4 planning tools over the network-planner-studio/design v3 model. Use validate_design after building a design and review_design for heuristic findings; next_subnet and suggest_site_range allocate addresses; find_route traces inter-site paths under topology policy."
        }, negotiated);
      case "ping":
        return rpcResult(id, {}, negotiated);
      case "tools/list":
        return rpcResult(id, { tools: TOOLS }, negotiated);
      case "tools/call": {
        const name = params?.name;
        if (typeof name !== "string") return rpcError(id, -32602, "tools/call requires a tool name.", negotiated);
        let payload;
        try {
          payload = callTool(name, params.arguments && typeof params.arguments === "object" ? params.arguments : {});
        } catch (error) {
          if (!(error instanceof HttpProblem)) throw error;
          // Tool failures are results, not protocol errors.
          return rpcResult(id, {
            isError: true,
            content: [{ type: "text", text: `${error.code}: ${error.message}` }]
          }, negotiated);
        }
        if (payload === undefined) return rpcError(id, -32602, `Unknown tool: ${name}`, negotiated);
        return rpcResult(id, {
          content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
          structuredContent: payload
        }, negotiated);
      }
      default:
        return rpcError(id, -32601, `Method not found: ${rpcMethod}`, negotiated);
    }
  } catch (error) {
    console.error(`mcp: unhandled ${error?.stack || error}`);
    return rpcError(null, -32603, "Internal error");
  }
}
