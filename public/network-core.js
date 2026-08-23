/*
 * The browser UI is intentionally thin.  This module is the canonical,
 * versioned model for a design and is also used by the unit tests.  Keep the
 * validation here deterministic so JSON, CSV, form and recommendation input
 * cannot drift into different interpretations of an address plan.
 */

export const SCHEMA_ID = "network-planner-studio/design";
export const SCHEMA_VERSION = 3;

export const ENUMS = Object.freeze({
  siteTypes: Object.freeze(["office", "branch", "datacentre", "cloud", "warehouse"]),
  wanTypes: Object.freeze(["single", "dual", "none"]),
  topologyModes: Object.freeze(["custom", "hub-spoke", "mesh"]),
  topologyRoles: Object.freeze(["standalone", "hub", "spoke"]),
  breakoutModes: Object.freeze(["local", "hub", "none"]),
  vlanRoles: Object.freeze(["users", "voice", "guest", "iot", "servers", "management", "transit", "other"]),
  linkTypes: Object.freeze(["vpn", "private", "peering", "internet"]),
  resilience: Object.freeze(["single", "dual"]),
  routingTypes: Object.freeze(["static", "bgp"]),
  spokePolicies: Object.freeze(["via-hub", "denied"]),
  flowPolicies: Object.freeze(["allow", "restricted", "deny"]),
  modes: Object.freeze(["existing", "new", "sample", "imported"])
});

export class DesignValidationError extends Error {
  constructor(message, errors = []) {
    super(message);
    this.name = "DesignValidationError";
    this.errors = errors;
  }
}

function issue(path, message, code = "invalid") {
  return { path, message, code };
}

function has(value, values) {
  return values.includes(value);
}

function randomId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `id-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
}

export function ipToInt(ip) {
  const text = String(ip ?? "").trim();
  const parts = text.split(".");
  if (parts.length !== 4 || parts.some(part => !/^\d{1,3}$/.test(part) || Number(part) > 255)) {
    throw new Error("Invalid IPv4 address");
  }
  return parts.reduce((number, part) => ((number << 8) >>> 0) + Number(part), 0) >>> 0;
}

export function intToIp(number) {
  const value = Number(number);
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) throw new Error("Invalid IPv4 integer");
  return [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255].join(".");
}

function cidrMask(prefix) {
  return prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
}

function parseCidrWithBounds(value, minPrefix, maxPrefix) {
  const parts = String(value ?? "").trim().split("/");
  if (parts.length !== 2) throw new Error("Use an IPv4 CIDR such as 10.0.0.0/24");
  const prefix = Number(parts[1]);
  if (!Number.isInteger(prefix) || prefix < minPrefix || prefix > maxPrefix) {
    throw new Error(`Use an IPv4 prefix between /${minPrefix} and /${maxPrefix}`);
  }
  const raw = ipToInt(parts[0]);
  const mask = cidrMask(prefix);
  const network = (raw & mask) >>> 0;
  const size = 2 ** (32 - prefix);
  if (raw !== network) throw new Error(`Network address must be ${intToIp(network)}/${prefix}`);
  return {
    cidr: `${intToIp(network)}/${prefix}`,
    network,
    broadcast: (network + size - 1) >>> 0,
    prefix,
    size,
    usable: prefix === 31 ? 2 : Math.max(0, size - 2)
  };
}

/** Allocation CIDRs are intentionally limited to /8 through /31. */
export function parseCidr(value, { allow31 = true, minPrefix = 8, maxPrefix = allow31 ? 31 : 30 } = {}) {
  return parseCidrWithBounds(value, minPrefix, maxPrefix);
}

/** Routing intent can represent a default route and a host route. */
export function parseRoutePrefix(value) {
  return parseCidrWithBounds(value, 0, 32);
}

export function rangesOverlap(a, b) {
  try {
    const first = parseCidr(a), second = parseCidr(b);
    return first.network <= second.broadcast && second.network <= first.broadcast;
  } catch {
    return false;
  }
}

export function contains(parent, child) {
  try {
    const outer = parseCidr(parent), inner = parseCidr(child);
    return outer.network <= inner.network && outer.broadcast >= inner.broadcast;
  } catch {
    return false;
  }
}

export function firstUsable(cidr) {
  try {
    const parsed = parseCidr(cidr);
    return intToIp((parsed.network + (parsed.prefix === 31 ? 0 : 1)) >>> 0);
  } catch {
    return "";
  }
}

export function endpointCapacity(cidr, reserved = 1, { gateway = "" } = {}) {
  const parsed = parseCidr(cidr);
  if (parsed.prefix === 31) return 2;
  const count = Math.max(0, Number.isFinite(Number(reserved)) ? Math.trunc(Number(reserved)) : 1);
  const gatewayValue = validHostInSubnet(gateway, cidr) ? ipToInt(gateway) : null;
  const reservedEnd = parsed.network + count;
  const gatewayOutsideReservedBlock = gatewayValue !== null && gatewayValue > reservedEnd;
  return Math.max(0, parsed.usable - count - Number(gatewayOutsideReservedBlock));
}

export function defaultDhcpPool(cidr, reserved = 1, { gateway = "" } = {}) {
  const parsed = parseCidr(cidr);
  if (parsed.prefix === 31) return { start: "", end: "" };
  const count = Math.max(1, Number.isFinite(Number(reserved)) ? Math.trunc(Number(reserved)) : 1);
  let start = Math.min(parsed.broadcast - 1, parsed.network + 1 + count);
  let end = parsed.broadcast - 1;
  if (validHostInSubnet(gateway, cidr)) {
    const gatewayValue = ipToInt(gateway);
    if (gatewayValue >= start && gatewayValue <= end) {
      const lowerSize = gatewayValue - start;
      const upperSize = end - gatewayValue;
      if (upperSize >= lowerSize) start = gatewayValue + 1;
      else end = gatewayValue - 1;
    }
  }
  if (start > end) return { start: "", end: "" };
  return { start: intToIp(start >>> 0), end: intToIp(end >>> 0) };
}

export function validHostInSubnet(ip, cidr) {
  try {
    const value = ipToInt(ip), parsed = parseCidr(cidr);
    return parsed.prefix === 31
      ? value >= parsed.network && value <= parsed.broadcast
      : value > parsed.network && value < parsed.broadcast;
  } catch {
    return false;
  }
}

export function validateGateway(gateway, cidr, { transit = false } = {}) {
  try {
    const parsed = parseCidr(cidr, { allow31: transit });
    const value = ipToInt(gateway);
    if (parsed.prefix === 31 && transit) return value >= parsed.network && value <= parsed.broadcast;
    return value > parsed.network && value < parsed.broadcast;
  } catch {
    return false;
  }
}

export function validateDhcpPool(cidr, gateway, reserved = 1, { enabled = true, start = "", end = "" } = {}) {
  const errors = [];
  let parsed;
  try {
    parsed = parseCidr(cidr);
  } catch (error) {
    return { valid: false, errors: [error.message], start: "", end: "" };
  }
  const count = Number(reserved);
  if (!Number.isInteger(count) || count < 1 || count > 1000) errors.push("Reserved addresses must be an integer from 1 to 1000");
  if (!validateGateway(gateway, cidr, { transit: parsed.prefix === 31 })) errors.push("Gateway must be a usable host inside the VLAN subnet");
  if (!enabled) return { valid: errors.length === 0, errors, start: "", end: "" };
  if (parsed.prefix === 31) {
    if (start || end) errors.push("A /31 transit subnet cannot have a DHCP pool");
    return { valid: errors.length === 0, errors, start: "", end: "" };
  }
  if (count > parsed.usable) errors.push("Reserved addresses exceed the usable hosts in this subnet");
  let first, last;
  try {
    first = ipToInt(start);
    last = ipToInt(end);
  } catch {
    errors.push("DHCP pool start and end must be IPv4 addresses");
    return { valid: false, errors, start: String(start || ""), end: String(end || "") };
  }
  if (!validHostInSubnet(start, cidr) || !validHostInSubnet(end, cidr)) errors.push("DHCP pool must use usable host addresses inside the VLAN subnet");
  if (first > last) errors.push("DHCP pool start must be before or equal to pool end");
  const reservedStart = parsed.network + 1;
  const reservedEnd = Math.min(parsed.broadcast - 1, parsed.network + count);
  if (first <= reservedEnd && last >= reservedStart) errors.push(`DHCP pool overlaps reserved addresses ${intToIp(reservedStart)} through ${intToIp(reservedEnd)}`);
  const gatewayValue = (() => { try { return ipToInt(gateway); } catch { return -1; } })();
  if (gatewayValue >= first && gatewayValue <= last) errors.push("DHCP pool must exclude the gateway address");
  return { valid: errors.length === 0, errors, start: String(start), end: String(end) };
}

export function prefixForDevices(devices, growth = 30, reserved = 1, { transit = false } = {}) {
  if (transit && Number(devices) <= 2) return 31;
  const needed = Math.ceil(Number(devices) * (1 + Number(growth) / 100)) + 2 + Number(reserved);
  for (let prefix = 30; prefix >= 8; prefix--) if (2 ** (32 - prefix) >= needed) return prefix;
  return 8;
}

export function nextSubnet(parentCidr, prefix, occupied = []) {
  const parent = parseCidr(parentCidr);
  if (!Number.isInteger(Number(prefix)) || Number(prefix) < parent.prefix || Number(prefix) > 31) throw new Error("Required subnet prefix must fit inside the site range and use /8 through /31");
  const normalizedPrefix = Number(prefix), size = 2 ** (32 - normalizedPrefix);
  // Parse each occupied allocation once, then walk the gaps numerically. The
  // previous candidate-by-candidate scan reparsed CIDR strings for every
  // (candidate, occupied) pair, stalling large parent ranges.
  const ranges = [];
  for (const value of Array.isArray(occupied) ? occupied : []) {
    try {
      const parsed = parseCidr(value);
      ranges.push([parsed.network, parsed.broadcast]);
    } catch { /* unparseable entries never blocked a candidate */ }
  }
  ranges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let candidate = parent.network;
  for (const [start, end] of ranges) {
    if (end < candidate) continue;
    if (start > candidate + size - 1) break;
    candidate = Math.ceil((end + 1) / size) * size;
  }
  if (candidate + size - 1 > parent.broadcast) throw new Error("No suitable free subnet remains in this site range");
  return `${intToIp(candidate)}/${normalizedPrefix}`;
}

export function suggestSiteRange(occupied = [], devices = 50) {
  const prefix = Number(devices) > 1000 ? 16 : Number(devices) > 250 ? 18 : 20;
  const candidates = [];
  for (let second = 0; second <= 255; second++) candidates.push(`10.${second}.0.0/${prefix}`);
  for (let second = 16; second <= 31; second++) candidates.push(`172.${second}.0.0/${prefix}`);
  for (let third = 0; third <= 240; third += 16) candidates.push(`192.168.${third}.0/${Math.max(prefix, 20)}`);
  const result = candidates.find(candidate => !occupied.some(value => rangesOverlap(candidate, value)));
  if (!result) throw new Error("No compatible private site block remains in the automatic allocation pools");
  return result;
}

export function isPrivateCidr(cidr) {
  try {
    const parsed = parseCidr(cidr);
    return contains("10.0.0.0/8", parsed.cidr) || contains("172.16.0.0/12", parsed.cidr) || contains("192.168.0.0/16", parsed.cidr);
  } catch {
    return false;
  }
}

export function isPrivateRoutePrefix(prefix) {
  try {
    const parsed = parseRoutePrefix(prefix);
    if (parsed.prefix === 0) return false;
    const value = parsed.network;
    return (value >= ipToInt("10.0.0.0") && value <= ipToInt("10.255.255.255"))
      || (value >= ipToInt("172.16.0.0") && value <= ipToInt("172.31.255.255"))
      || (value >= ipToInt("192.168.0.0") && value <= ipToInt("192.168.255.255"));
  } catch {
    return false;
  }
}

const FORMULA_CHARS = Object.freeze(["=", "+", "-", "@", "\t", "\r", "\n"]);

function needsFormulaGuard(value) {
  return FORMULA_CHARS.includes(value[0]) || /^\s+[=+\-@]/.test(value);
}

/** Neutralize spreadsheet formula execution for exported cells. */
export function guardCsvCell(value) {
  const text = String(value ?? "");
  if (text.startsWith("'")) return `'${text}`;
  return text && needsFormulaGuard(text) ? `'${text}` : text;
}

/** Inverse of guardCsvCell so export/import round trips stay lossless. */
export function unguardCsvCell(value) {
  const text = String(value ?? "");
  if (text.startsWith("''")) return text.slice(1);
  return text.length > 1 && text[0] === "'" && needsFormulaGuard(text.slice(1)) ? text.slice(1) : text;
}

/** Parse RFC 4180 records, including escaped quotes and line breaks in quoted fields. */
export function parseCsvRows(value) {
  const text = String(value ?? "").replace(/^\uFEFF/, "");
  const rows = [];
  let row = [], field = "", state = "start";

  const finishField = () => { row.push(field); field = ""; state = "start"; };
  const finishRow = () => { finishField(); rows.push(row); row = []; };

  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (state === "quoted") {
      if (character !== '"') { field += character; continue; }
      if (text[index + 1] === '"') { field += '"'; index++; continue; }
      state = "after-quote";
      continue;
    }
    if (state === "after-quote") {
      if (character === ",") { finishField(); continue; }
      if (character === "\r" || character === "\n") {
        finishRow();
        if (character === "\r" && text[index + 1] === "\n") index++;
        continue;
      }
      if (character === " " || character === "\t") continue;
      throw new Error("CSV contains content after a closing quote");
    }
    if (character === '"') {
      if (state !== "start") throw new Error("CSV contains an unexpected quote");
      state = "quoted";
      continue;
    }
    if (character === ",") { finishField(); continue; }
    if (character === "\r" || character === "\n") {
      finishRow();
      if (character === "\r" && text[index + 1] === "\n") index++;
      continue;
    }
    field += character;
    state = "unquoted";
  }

  if (state === "quoted") throw new Error("CSV contains an unclosed quoted field");
  if (row.length || field || state !== "start") finishRow();
  return rows;
}

export function shortestPath(sites, links, from, to, { topologyMode = "custom", spokeToSpoke = "via-hub" } = {}) {
  if (from === to) return { sites: [from], links: [] };
  const byId = new Map(sites.map(site => [site.id, site]));
  const enforceHubSpoke = topologyMode === "hub-spoke" && ["denied", "via-hub"].includes(spokeToSpoke);
  if (enforceHubSpoke && spokeToSpoke === "denied" && byId.get(from)?.topologyRole === "spoke" && byId.get(to)?.topologyRole === "spoke") return null;
  const queue = [{ id: from, sitePath: [from], linkPath: [] }], seen = new Set([from]);
  while (queue.length) {
    const current = queue.shift();
    for (const link of links.filter(candidate => candidate.from === current.id || candidate.to === current.id)) {
      if (link.transitAllowed === false && current.id !== from) continue;
      const next = link.from === current.id ? link.to : link.from;
      if (seen.has(next) || !byId.has(next)) continue;
      const a = byId.get(current.id), b = byId.get(next);
      if (enforceHubSpoke && a?.topologyRole === "spoke" && b?.topologyRole === "spoke") continue;
      const candidate = { id: next, sitePath: [...current.sitePath, next], linkPath: [...current.linkPath, link.id] };
      if (next === to) return { sites: candidate.sitePath, links: candidate.linkPath };
      seen.add(next);
      queue.push(candidate);
    }
  }
  return null;
}

const LIMITS = Object.freeze({
  siteDevices: [1, 50000], growth: [0, 1000], coordinate: [0, 100], vlanId: [1, 4094], vlanDevices: [1, 65534], reserved: [1, 1000]
});

function safeIdentifier(value) {
  const id = String(value ?? "");
  return /^[A-Za-z0-9_-]{1,80}$/.test(id) ? id : randomId();
}

function finiteBounded(value, fallback, [min, max], integer = false, { errors = [], path = "value", validateTypes = false } = {}) {
  if (value === null || value === undefined) return fallback;
  if ((typeof value === "string" && !value.trim()) || !["number", "string"].includes(typeof value)) {
    if (validateTypes) errors.push(issue(path, `${path} must be a number`, "invalid-type"));
    return fallback;
  }
  const numeric = Number(value);
  if (validateTypes && typeof value !== "number") errors.push(issue(path, `${path} must be a number`, "invalid-type"));
  if (!Number.isFinite(numeric)) {
    if (validateTypes) errors.push(issue(path, `${path} must be finite`, "invalid-number"));
    return fallback;
  }
  if (validateTypes && (numeric < min || numeric > max || integer && !Number.isInteger(numeric))) errors.push(issue(path, `${path} must be ${integer ? "an integer " : ""}from ${min} to ${max}`, "invalid-number"));
  const bounded = Math.min(max, Math.max(min, numeric));
  return integer ? Math.trunc(bounded) : bounded;
}

function normalizedBoolean(value, fallback, errors, path, { validateTypes = false } = {}) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "boolean") return value;
  if (validateTypes) errors.push(issue(path, `${path} must be a boolean`, "invalid-type"));
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
}

function normalizedText(value, fallback, max) {
  return String(value ?? fallback).slice(0, max);
}

function canonicalAllocation(value) {
  if (!String(value ?? "").trim()) return "";
  try { return parseCidr(value).cidr; } catch { return String(value).trim().slice(0, 64); }
}

function canonicalRoutePrefixes(values, errors, path) {
  if (!Array.isArray(values)) return [];
  const result = [];
  values.slice(0, 100).forEach((value, index) => {
    try { result.push(parseRoutePrefix(value).cidr); }
    catch (error) { errors.push(issue(`${path}[${index}]`, error.message, "invalid-route-prefix")); }
  });
  return [...new Set(result)];
}

function normalizeVlan(raw = {}, errors = [], path = "vlan", { allowIncomplete = false, validateTypes = false } = {}) {
  const value = raw && typeof raw === "object" ? raw : {};
  const role = String(value.role || "other");
  if (!has(role, ENUMS.vlanRoles)) errors.push(issue(`${path}.role`, `Unknown VLAN role: ${role}`, "invalid-enum"));
  const cidr = canonicalAllocation(value.cidr);
  if (!cidr && !allowIncomplete) errors.push(issue(`${path}.cidr`, "VLAN subnet is required", "invalid-cidr"));
  else if (cidr && (() => { try { parseCidr(cidr); return false; } catch { return true; } })()) errors.push(issue(`${path}.cidr`, "VLAN subnet must be an aligned allocation CIDR from /8 through /31", "invalid-cidr"));
  const numberOptions = key => ({ errors, path: `${path}.${key}`, validateTypes });
  const reserved = finiteBounded(value.reserved, 1, LIMITS.reserved, true, numberOptions("reserved"));
  const gateway = normalizedText(value.gateway, firstUsable(cidr), 64);
  let pool = { start: "", end: "" };
  try { pool = defaultDhcpPool(cidr, reserved, { gateway }); } catch { /* validation below reports the CIDR */ }
  return {
    id: safeIdentifier(value.id),
    name: normalizedText(value.name, "Network", 100),
    vid: finiteBounded(value.vid, 1, LIMITS.vlanId, true, numberOptions("vid")),
    role: has(role, ENUMS.vlanRoles) ? role : "other",
    devices: finiteBounded(value.devices, 1, LIMITS.vlanDevices, true, numberOptions("devices")),
    cidr,
    gateway,
    dhcpEnabled: normalizedBoolean(value.dhcpEnabled, true, errors, `${path}.dhcpEnabled`, { validateTypes }),
    reserved,
    dhcpStart: normalizedBoolean(value.dhcpEnabled, true) ? normalizedText(value.dhcpStart || pool.start, "", 64) : "",
    dhcpEnd: normalizedBoolean(value.dhcpEnabled, true) ? normalizedText(value.dhcpEnd || pool.end, "", 64) : "",
    notes: normalizedText(value.notes, "", 2000)
  };
}

function normalizeSite(raw = {}, errors = [], path = "site", options = {}) {
  const value = raw && typeof raw === "object" ? raw : {};
  const type = String(value.type || "office"), wan = String(value.wan || "single"), role = String(value.topologyRole || "standalone"), breakout = String(value.internetBreakout || "local");
  if (!has(type, ENUMS.siteTypes)) errors.push(issue(`${path}.type`, `Unknown site type: ${type}`, "invalid-enum"));
  if (!has(wan, ENUMS.wanTypes)) errors.push(issue(`${path}.wan`, `Unknown WAN type: ${wan}`, "invalid-enum"));
  if (!has(role, ENUMS.topologyRoles)) errors.push(issue(`${path}.topologyRole`, `Unknown topology role: ${role}`, "invalid-enum"));
  if (!has(breakout, ENUMS.breakoutModes)) errors.push(issue(`${path}.internetBreakout`, `Unknown breakout mode: ${breakout}`, "invalid-enum"));
  const cidr = canonicalAllocation(value.cidr);
  if (!cidr && !options.allowIncomplete) errors.push(issue(`${path}.cidr`, "Site range is required", "invalid-cidr"));
  else if (cidr && (() => { try { parseCidr(cidr, { allow31: false }); return false; } catch { return true; } })()) errors.push(issue(`${path}.cidr`, "Site range must be an aligned allocation CIDR from /8 through /30", "invalid-cidr"));
  const numberOptions = key => ({ errors, path: `${path}.${key}`, validateTypes: options.validateTypes });
  return {
    id: safeIdentifier(value.id),
    name: normalizedText(value.name, "Site", 100),
    type: has(type, ENUMS.siteTypes) ? type : "office",
    cidr,
    devices: finiteBounded(value.devices, 1, LIMITS.siteDevices, true, numberOptions("devices")),
    wan: has(wan, ENUMS.wanTypes) ? wan : "single",
    growth: finiteBounded(value.growth, 30, LIMITS.growth, false, numberOptions("growth")),
    x: finiteBounded(value.x, 20, LIMITS.coordinate, false, numberOptions("x")),
    y: finiteBounded(value.y, 20, LIMITS.coordinate, false, numberOptions("y")),
    topologyRole: has(role, ENUMS.topologyRoles) ? role : "standalone",
    hubId: value.hubId ? String(value.hubId).slice(0, 80) : null,
    internetBreakout: has(breakout, ENUMS.breakoutModes) ? breakout : "local",
    notes: normalizedText(value.notes, "", 2000),
    vlans: Array.isArray(value.vlans) ? value.vlans.slice(0, 200).map((vlan, index) => normalizeVlan(vlan, errors, `${path}.vlans[${index}]`, options)) : []
  };
}

function normalizeLink(raw = {}, errors = [], path = "link", { validateTypes = false } = {}) {
  const value = raw && typeof raw === "object" ? raw : {};
  const type = String(value.type || "vpn"), resilience = String(value.resilience || "single"), routingType = String(value.routingType || "static");
  if (!has(type, ENUMS.linkTypes)) errors.push(issue(`${path}.type`, `Unknown connection type: ${type}`, "invalid-enum"));
  if (!has(resilience, ENUMS.resilience)) errors.push(issue(`${path}.resilience`, `Unknown resilience: ${resilience}`, "invalid-enum"));
  if (!has(routingType, ENUMS.routingTypes)) errors.push(issue(`${path}.routingType`, `Unknown routing type: ${routingType}`, "invalid-enum"));
  return {
    id: safeIdentifier(value.id),
    from: String(value.from || "").slice(0, 80),
    to: String(value.to || "").slice(0, 80),
    type: has(type, ENUMS.linkTypes) ? type : "vpn",
    resilience: has(resilience, ENUMS.resilience) ? resilience : "single",
    routingType: has(routingType, ENUMS.routingTypes) ? routingType : "static",
    transitAllowed: normalizedBoolean(value.transitAllowed, true, errors, `${path}.transitAllowed`, { validateTypes }),
    defaultRoute: normalizedBoolean(value.defaultRoute, false, errors, `${path}.defaultRoute`, { validateTypes }),
    advertisedPrefixes: canonicalRoutePrefixes(value.advertisedPrefixes, errors, `${path}.advertisedPrefixes`),
    notes: normalizedText(value.notes, "", 2000)
  };
}

function normalizeFlowPolicies(value, errors) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result = {};
  Object.entries(value).slice(0, 500).forEach(([key, policy]) => {
    const parts = key.split(":");
    if (parts.length !== 2 || !has(parts[0], ENUMS.vlanRoles) || !has(parts[1], ENUMS.vlanRoles)) {
      errors.push(issue(`flowPolicies.${key}`, "Flow policy keys must contain two known VLAN roles", "invalid-policy"));
      return;
    }
    if (!has(policy, ENUMS.flowPolicies)) {
      errors.push(issue(`flowPolicies.${key}`, `Unknown flow policy: ${policy}`, "invalid-enum"));
      return;
    }
    result[`${parts[0]}:${parts[1]}`] = policy;
  });
  return result;
}

function validateNormalizedDesign(design, { allowIncomplete = false } = {}) {
  const errors = [], warnings = [];
  if (!design || typeof design !== "object") return { valid: false, errors: [issue("design", "Design must be a JSON object", "invalid-design")], warnings };
  if (design.schema !== SCHEMA_ID) errors.push(issue("schema", `Unsupported schema: ${design.schema || "missing"}`, "invalid-schema"));
  if (design.version !== SCHEMA_VERSION) errors.push(issue("version", `Design schema version must be ${SCHEMA_VERSION}`, "invalid-version"));
  if (!has(design.topologyMode, ENUMS.topologyModes)) errors.push(issue("topologyMode", `Unknown topology mode: ${design.topologyMode}`, "invalid-enum"));
  if (design.mode !== null && design.mode !== undefined && !has(design.mode, ENUMS.modes)) errors.push(issue("mode", `Unknown design mode: ${design.mode}`, "invalid-enum"));
  if (!design.policies || !has(design.policies.spokeToSpoke, ENUMS.spokePolicies)) errors.push(issue("policies.spokeToSpoke", `Unknown spoke policy: ${design.policies?.spokeToSpoke}`, "invalid-enum"));
  for (const [key, value] of Object.entries(design.flowPolicies || {})) {
    const parts = key.split(":");
    if (parts.length !== 2 || !has(parts[0], ENUMS.vlanRoles) || !has(parts[1], ENUMS.vlanRoles)) errors.push(issue(`flowPolicies.${key}`, "Flow policy keys must contain two known VLAN roles", "invalid-policy"));
    else if (!has(value, ENUMS.flowPolicies)) errors.push(issue(`flowPolicies.${key}`, `Unknown flow policy: ${value}`, "invalid-enum"));
  }
  const siteIds = new Set(), vlanObjectIds = new Set(), linkIds = new Set();
  if (!Array.isArray(design.sites)) errors.push(issue("sites", "Design must contain a sites array", "invalid-design"));
  if (!Array.isArray(design.links)) errors.push(issue("links", "Design must contain a links array", "invalid-design"));
  for (const [siteIndex, site] of (design.sites || []).entries()) {
    const sitePath = `sites[${siteIndex}]`;
    if (!has(site.type, ENUMS.siteTypes)) errors.push(issue(`${sitePath}.type`, `Unknown site type: ${site.type}`, "invalid-enum"));
    if (!has(site.wan, ENUMS.wanTypes)) errors.push(issue(`${sitePath}.wan`, `Unknown WAN type: ${site.wan}`, "invalid-enum"));
    if (!has(site.topologyRole, ENUMS.topologyRoles)) errors.push(issue(`${sitePath}.topologyRole`, `Unknown topology role: ${site.topologyRole}`, "invalid-enum"));
    if (!has(site.internetBreakout, ENUMS.breakoutModes)) errors.push(issue(`${sitePath}.internetBreakout`, `Unknown breakout mode: ${site.internetBreakout}`, "invalid-enum"));
    if (siteIds.has(site.id)) errors.push(issue(`${sitePath}.id`, `Duplicate site ID: ${site.id}`, "duplicate-id"));
    siteIds.add(site.id);
    let siteCidr;
    try { siteCidr = parseCidr(site.cidr, { allow31: false }); } catch (error) { if (!allowIncomplete) errors.push(issue(`${sitePath}.cidr`, error.message, "invalid-cidr")); }
    const vlanVid = new Set();
    for (const [vlanIndex, vlan] of (site.vlans || []).entries()) {
      const path = `${sitePath}.vlans[${vlanIndex}]`;
      if (!has(vlan.role, ENUMS.vlanRoles)) errors.push(issue(`${path}.role`, `Unknown VLAN role: ${vlan.role}`, "invalid-enum"));
      if (vlanObjectIds.has(vlan.id)) errors.push(issue(`${path}.id`, `Duplicate VLAN object ID: ${vlan.id}`, "duplicate-id"));
      vlanObjectIds.add(vlan.id);
      if (vlanVid.has(vlan.vid)) errors.push(issue(`${path}.vid`, `Duplicate VLAN ID ${vlan.vid} at ${site.name}`, "duplicate-vlan"));
      vlanVid.add(vlan.vid);
      let vlanCidr;
      try { vlanCidr = parseCidr(vlan.cidr, { allow31: vlan.role === "transit" }); } catch (error) { if (!allowIncomplete) errors.push(issue(`${path}.cidr`, error.message, "invalid-cidr")); }
      if (siteCidr && vlanCidr && !contains(site.cidr, vlan.cidr)) errors.push(issue(`${path}.cidr`, `${vlan.cidr} is outside site range ${site.cidr}`, "outside-parent"));
      if (vlanCidr && !validateGateway(vlan.gateway, vlan.cidr, { transit: vlan.role === "transit" })) errors.push(issue(`${path}.gateway`, "Gateway must be a usable host inside the VLAN subnet", "invalid-gateway"));
      if (vlanCidr) {
        const pool = validateDhcpPool(vlan.cidr, vlan.gateway, vlan.reserved, { enabled: vlan.dhcpEnabled, start: vlan.dhcpStart, end: vlan.dhcpEnd });
        pool.errors.forEach(message => errors.push(issue(`${path}.dhcp`, message, "invalid-dhcp")));
      }
      for (let otherIndex = 0; otherIndex < vlanIndex; otherIndex++) {
        const other = site.vlans[otherIndex];
        if (vlan.cidr && other?.cidr && rangesOverlap(vlan.cidr, other.cidr)) errors.push(issue(`${path}.cidr`, `${vlan.cidr} overlaps ${other.name}`, "overlap"));
      }
    }
  }
  for (const [linkIndex, link] of (design.links || []).entries()) {
    const path = `links[${linkIndex}]`;
    if (!has(link.type, ENUMS.linkTypes)) errors.push(issue(`${path}.type`, `Unknown connection type: ${link.type}`, "invalid-enum"));
    if (!has(link.resilience, ENUMS.resilience)) errors.push(issue(`${path}.resilience`, `Unknown resilience: ${link.resilience}`, "invalid-enum"));
    if (!has(link.routingType, ENUMS.routingTypes)) errors.push(issue(`${path}.routingType`, `Unknown routing type: ${link.routingType}`, "invalid-enum"));
    if (linkIds.has(link.id)) errors.push(issue(`${path}.id`, `Duplicate link ID: ${link.id}`, "duplicate-id"));
    linkIds.add(link.id);
    if (!siteIds.has(link.from) || !siteIds.has(link.to)) errors.push(issue(path, "Connection endpoints must reference existing sites", "dangling-link"));
    if (link.from === link.to) errors.push(issue(path, "Connection endpoints must be different sites", "self-link"));
    if (link.defaultRoute && !link.advertisedPrefixes.includes("0.0.0.0/0")) warnings.push(issue(`${path}.defaultRoute`, "Default route intent is enabled and will be reported as 0.0.0.0/0", "default-route"));
  }
  if (design.topologyMode === "hub-spoke") {
    const hubs = design.sites.filter(site => site.topologyRole === "hub");
    if (!hubs.length) errors.push(issue("sites", "Hub-and-spoke mode requires at least one hub", "missing-hub"));
    for (const site of design.sites.filter(candidate => candidate.topologyRole === "spoke")) if (site.hubId && !siteIds.has(site.hubId)) errors.push(issue(`sites.${site.id}.hubId`, "Spoke hub assignment is invalid", "invalid-hub"));
  }
  return { valid: errors.length === 0, errors, warnings };
}

/** Return structured validation evidence without mutating the design. */
export function validateDesign(design, options = {}) {
  return validateNormalizedDesign(design, options);
}

export function assertValidDesign(design, options = {}) {
  const result = validateDesign(design, options);
  if (!result.valid) throw new DesignValidationError(result.errors[0]?.message || "Design is invalid", result.errors);
  return design;
}

export function createVlan(values = {}, options = {}) {
  const errors = [];
  const vlan = normalizeVlan(values, errors, "vlan", { allowIncomplete: false, validateTypes: true });
  const design = { schema: SCHEMA_ID, version: SCHEMA_VERSION, mode: null, sites: [{ id: "site", name: "Site", type: "office", cidr: values.siteCidr || "10.0.0.0/8", devices: 1, wan: "single", growth: 30, x: 0, y: 0, topologyRole: "standalone", internetBreakout: "local", vlans: [vlan] }], links: [], topologyMode: "custom", policies: { spokeToSpoke: "via-hub" }, flowPolicies: {} };
  const result = validateNormalizedDesign(design);
  if (errors.length || !result.valid) throw new DesignValidationError((errors[0] || result.errors[0])?.message || "VLAN is invalid", [...errors, ...result.errors]);
  return vlan;
}

export function createSite(values = {}, options = {}) {
  const errors = [];
  const site = normalizeSite(values, errors, "site", { allowIncomplete: false, validateTypes: true });
  const design = { schema: SCHEMA_ID, version: SCHEMA_VERSION, mode: null, sites: [site], links: [], topologyMode: "custom", policies: { spokeToSpoke: "via-hub" }, flowPolicies: {} };
  const result = validateNormalizedDesign(design);
  if (errors.length || !result.valid) throw new DesignValidationError((errors[0] || result.errors[0])?.message || "Site is invalid", [...errors, ...result.errors]);
  return site;
}

export function createLink(values = {}) {
  const errors = [];
  const link = normalizeLink(values, errors, "link", { validateTypes: true });
  if (errors.length) throw new DesignValidationError(errors[0].message, errors);
  return link;
}

/**
 * Migrate legacy v1/v2 JSON into the v3 canonical schema.  Numeric legacy
 * values are bounded for recoverability; structural, address, enum and policy
 * errors are surfaced to callers instead of being silently marked healthy.
 */
export function migrateDesign(input, { strict = true } = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new DesignValidationError("Design must be a JSON object", [issue("design", "Design must be a JSON object", "invalid-design")]);
  if (!Array.isArray(input.sites) || !Array.isArray(input.links)) throw new DesignValidationError("Design must contain sites and links arrays", [issue("design", "Design must contain sites and links arrays", "invalid-design")]);
  const inputVersion = Number(input.version || 1), legacyIncomplete = inputVersion <= 1;
  const errors = [];
  if (inputVersion >= SCHEMA_VERSION && input.schema !== SCHEMA_ID) errors.push(issue("schema", `Design schema must be ${SCHEMA_ID}`, "invalid-schema"));
  const idMap = new Map(), rawSiteIds = new Set(), sites = [];
  input.sites.forEach((raw, index) => {
    const rawId = String(raw?.id || "");
    if (rawSiteIds.has(rawId) && rawId) errors.push(issue(`sites[${index}].id`, `Duplicate site ID: ${rawId}`, "duplicate-id"));
    rawSiteIds.add(rawId);
    const normalized = normalizeSite(raw, errors, `sites[${index}]`, { allowIncomplete: legacyIncomplete, validateTypes: inputVersion >= SCHEMA_VERSION });
    idMap.set(rawId, normalized.id);
    sites.push(normalized);
  });
  const siteIds = new Set(sites.map(site => site.id));
  if (siteIds.size !== sites.length) errors.push(issue("sites", "Every site must have a unique ID", "duplicate-id"));
  for (const site of sites) if (site.hubId) site.hubId = idMap.get(site.hubId) || site.hubId;
  const links = [];
  const rawLinkIds = new Set();
  input.links.forEach((raw, index) => {
    const rawId = String(raw?.id || "");
    if (rawLinkIds.has(rawId) && rawId) errors.push(issue(`links[${index}].id`, `Duplicate link ID: ${rawId}`, "duplicate-id"));
    rawLinkIds.add(rawId);
    const normalized = normalizeLink({ ...raw, from: idMap.get(String(raw?.from || "")) || raw?.from, to: idMap.get(String(raw?.to || "")) || raw?.to }, errors, `links[${index}]`, { validateTypes: inputVersion >= SCHEMA_VERSION });
    if (siteIds.has(normalized.from) && siteIds.has(normalized.to) && normalized.from !== normalized.to) links.push(normalized);
    else if (!legacyIncomplete) errors.push(issue(`links[${index}]`, "Connection endpoints must reference two different existing sites", "dangling-link"));
  });
  const topologyMode = String(input.topologyMode || "custom");
  if (!has(topologyMode, ENUMS.topologyModes)) errors.push(issue("topologyMode", `Unknown topology mode: ${topologyMode}`, "invalid-enum"));
  const mode = input.mode == null ? null : String(input.mode);
  if (mode !== null && !has(mode, ENUMS.modes)) errors.push(issue("mode", `Unknown design mode: ${mode}`, "invalid-enum"));
  const policies = input.policies && typeof input.policies === "object" ? input.policies : {};
  const spokeToSpoke = String(policies.spokeToSpoke || "via-hub");
  if (!has(spokeToSpoke, ENUMS.spokePolicies)) errors.push(issue("policies.spokeToSpoke", `Unknown spoke policy: ${spokeToSpoke}`, "invalid-enum"));
  const secondaryHubId = policies.secondaryHubId ? idMap.get(String(policies.secondaryHubId)) || String(policies.secondaryHubId) : null;
  if (secondaryHubId && !siteIds.has(secondaryHubId)) errors.push(issue("policies.secondaryHubId", "Secondary hub assignment is invalid", "invalid-hub"));
  const design = {
    schema: SCHEMA_ID,
    version: SCHEMA_VERSION,
    projectId: safeIdentifier(input.projectId),
    name: normalizedText(input.name, "Imported network", 80),
    mode,
    topologyMode: has(topologyMode, ENUMS.topologyModes) ? topologyMode : "custom",
    policies: { spokeToSpoke: has(spokeToSpoke, ENUMS.spokePolicies) ? spokeToSpoke : "via-hub", centralizedInspection: normalizedBoolean(policies.centralizedInspection, false, errors, "policies.centralizedInspection", { validateTypes: inputVersion >= SCHEMA_VERSION }), secondaryHubId },
    flowPolicies: normalizeFlowPolicies(input.flowPolicies, errors),
    assumptions: Array.isArray(input.assumptions) ? input.assumptions.slice(0, 200).map(value => normalizedText(value, "", 2000)).filter(Boolean) : [],
    sites,
    links,
    updatedAt: typeof input.updatedAt === "string" && input.updatedAt ? input.updatedAt : new Date().toISOString()
  };
  const validation = validateNormalizedDesign(design, { allowIncomplete: legacyIncomplete });
  errors.push(...validation.errors);
  if (strict && errors.length) throw new DesignValidationError(errors[0].message, errors);
  design.importWarnings = [...new Set(errors.map(item => item.message))].slice(0, 100);
  return design;
}

export function createDesign(values = {}) {
  return migrateDesign({ ...values, schema: SCHEMA_ID, version: SCHEMA_VERSION }, { strict: true });
}
