/*
 * The browser UI is intentionally thin.  This module is the canonical,
 * versioned model for a design and is also used by the unit tests.  Keep the
 * validation here deterministic so JSON, CSV, form and recommendation input
 * cannot drift into different interpretations of an address plan.
 */

export const SCHEMA_ID = "network-planner-studio/design";
export const SCHEMA_VERSION = 3;
// Import/migrate reject oversized documents before walking them, so a
// hostile or legacy file cannot freeze the browser tab.
export const DESIGN_MAX_SITES = 500;
export const DESIGN_MAX_LINKS = 2000;

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
  // Adjacency is built once so a dense imported design is O(V+E) per trace
  // instead of rescanning every link for every dequeued site. Edges keep the
  // original link order, which pins which equal-length route a BFS finds.
  const adjacency = new Map();
  for (const link of links) {
    if (!byId.has(link.from) || !byId.has(link.to)) continue;
    for (const [a, b] of [[link.from, link.to], [link.to, link.from]]) {
      if (!adjacency.has(a)) adjacency.set(a, []);
      adjacency.get(a).push({ next: b, link });
    }
  }
  const queue = [{ id: from, sitePath: [from], linkPath: [] }], seen = new Set([from]);
  while (queue.length) {
    const current = queue.shift();
    for (const { next, link } of adjacency.get(current.id) || []) {
      if (link.transitAllowed === false && current.id !== from) continue;
      if (seen.has(next)) continue;
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
    for (let otherIndex = 0; otherIndex < siteIndex; otherIndex++) {
      const other = design.sites[otherIndex];
      if (site.cidr && other?.cidr && rangesOverlap(site.cidr, other.cidr)) errors.push(issue(`${sitePath}.cidr`, `${site.cidr} overlaps ${other.name}`, "overlap"));
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
    const sites = design.sites || [];
    const links = design.links || [];
    const hubs = sites.filter(site => site.topologyRole === "hub");
    if (!hubs.length) errors.push(issue("sites", "Hub-and-spoke mode requires at least one hub", "missing-hub"));
    const secondaryHubId = design.policies?.secondaryHubId;
    if (secondaryHubId) {
      const secondary = sites.find(site => site.id === secondaryHubId);
      if (!secondary || secondary.topologyRole !== "hub") errors.push(issue("policies.secondaryHubId", "Secondary hub assignment is invalid", "invalid-hub"));
    }
    for (const [spokeIndex, site] of sites.entries()) {
      if (site.topologyRole !== "spoke") continue;
      const hub = sites.find(candidate => candidate.id === site.hubId);
      if (!hub || hub.topologyRole !== "hub") {
        errors.push(issue(`sites[${spokeIndex}].hubId`, "Spoke hub assignment is invalid", "invalid-hub"));
        continue;
      }
      const linked = links.some(link => (link.from === site.id && link.to === hub.id) || (link.to === site.id && link.from === hub.id));
      if (!linked) errors.push(issue(`sites[${spokeIndex}]`, `${site.name} is assigned to ${hub.name} but no connection exists`, "missing-hub-link"));
    }
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
  if (input.sites.length > DESIGN_MAX_SITES) {
    throw new DesignValidationError(`Designs are limited to ${DESIGN_MAX_SITES} sites; this one has ${input.sites.length}.`, [issue("sites", `Designs are limited to ${DESIGN_MAX_SITES} sites; this one has ${input.sites.length}.`, "design-too-large")]);
  }
  if (input.links.length > DESIGN_MAX_LINKS) {
    throw new DesignValidationError(`Designs are limited to ${DESIGN_MAX_LINKS} links; this one has ${input.links.length}.`, [issue("links", `Designs are limited to ${DESIGN_MAX_LINKS} links; this one has ${input.links.length}.`, "design-too-large")]);
  }
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

/*
 * Heuristic design review. Input is a canonical (migrated) design; output is
 * presentation-free findings so the workspace review, report and score all
 * report exactly the same issues from one implementation.
 */
function reviewIssue(severity, title, message, siteId) {
  const item = { severity, title, message };
  if (siteId) item.siteId = siteId;
  return item;
}

function parseOrIssue(cidr) {
  try { return parseCidr(cidr); } catch { return null; }
}

export function reviewDesignIssues(design) {
  const sites = Array.isArray(design?.sites) ? design.sites : [];
  const links = Array.isArray(design?.links) ? design.links : [];
  const issues = [];
  for (const message of design?.importWarnings || []) issues.push(reviewIssue("warning", "Recovered design data", message));
  if (!sites.length) return [...issues, reviewIssue("info", "Start the address hierarchy", "Add a site with a parent IPv4 range and create VLANs inside it.")];
  // Review compares every site pair, so each range is parsed once and sites
  // are indexed by id up front; re-parsing CIDR strings per pair stalls
  // multi-thousand-site imports on the main thread.
  const siteById = new Map(sites.map(site => [site.id, site]));
  const ranges = sites.map(site => parseOrIssue(site.cidr));
  const connectionCounts = new Map();
  for (const link of links) {
    connectionCounts.set(link.from, (connectionCounts.get(link.from) || 0) + 1);
    connectionCounts.set(link.to, (connectionCounts.get(link.to) || 0) + 1);
  }
  for (let i = 0; i < sites.length; i++) {
    const site = sites[i], sp = ranges[i];
    if (!sp) issues.push(reviewIssue("error", "Invalid site range", `${site.name} does not have a valid IPv4 CIDR range.`, site.id));
    else if (!isPrivateCidr(site.cidr)) issues.push(reviewIssue("warning", "Public site address space", `${site.name} uses ${site.cidr}, which is not RFC1918 private address space. Confirm ownership and intent.`, site.id));
    for (let j = i + 1; j < sites.length; j++) {
      const sq = ranges[j];
      if (sp && sq && sp.network <= sq.broadcast && sq.network <= sp.broadcast) issues.push(reviewIssue("error", "Overlapping site ranges", `${site.name} and ${sites[j].name} overlap. VPN routing between them will be ambiguous.`, site.id));
    }
    if ((connectionCounts.get(site.id) || 0) > 0 && site.wan === "single") issues.push(reviewIssue("warning", "Single WAN dependency", `${site.name} has inter-site connectivity but only one WAN path. Document the accepted outage risk.`, site.id));
    if (!site.vlans.length) issues.push(reviewIssue("warning", "No VLANs defined", `${site.name} has a parent range but no usable networks yet.`, site.id));
    const vids = new Map();
    for (let vIndex = 0; vIndex < site.vlans.length; vIndex++) {
      const vlan = site.vlans[vIndex], vp = parseOrIssue(vlan.cidr);
      if (vids.has(vlan.vid)) issues.push(reviewIssue("error", "Duplicate VLAN ID", `${site.name} uses VLAN ${vlan.vid} for both ${vids.get(vlan.vid)} and ${vlan.name}.`, site.id));
      vids.set(vlan.vid, vlan.name);
      if (!vp) issues.push(reviewIssue("error", "Invalid VLAN subnet", `${site.name} / ${vlan.name} has an invalid IPv4 subnet.`, site.id));
      else {
        if (sp && vp && !(sp.network <= vp.network && sp.broadcast >= vp.broadcast)) issues.push(reviewIssue("error", "VLAN outside site range", `${vlan.cidr} is not contained by ${site.name}'s ${site.cidr} allocation.`, site.id));
        let capacity;
        try { capacity = endpointCapacity(vlan.cidr, Number(vlan.reserved ?? 1), { gateway: vlan.gateway }); } catch { capacity = 0; }
        if (vlan.devices > capacity) issues.push(reviewIssue("error", "Subnet over capacity", `${site.name} / ${vlan.name} needs ${vlan.devices} endpoint addresses but ${vlan.cidr} has only ${capacity} after reservations.`, site.id));
        else if (capacity > 0 && vlan.devices / capacity > .8) issues.push(reviewIssue("warning", "Low address headroom", `${site.name} / ${vlan.name} is planned above 80% of endpoint capacity.`, site.id));
        if (vp.prefix === 31 && vlan.role !== "transit") issues.push(reviewIssue("error", "Invalid /31 use", `${site.name} / ${vlan.name} uses /31 but is not a transit network.`, site.id));
        if (vp.prefix < 22 && vlan.role !== "guest") issues.push(reviewIssue("advice", "Large broadcast domain", `${site.name} / ${vlan.name} is a /${vp.prefix}. Consider whether a smaller failure and broadcast domain is preferable.`, site.id));
        if (!validateGateway(vlan.gateway, vlan.cidr, { transit: vlan.role === "transit" })) issues.push(reviewIssue("error", "Invalid gateway", `${site.name} / ${vlan.name} must use a usable gateway inside ${vlan.cidr}.`, site.id));
        const pool = validateDhcpPool(vlan.cidr, vlan.gateway, vlan.reserved, { enabled: vlan.dhcpEnabled, start: vlan.dhcpStart, end: vlan.dhcpEnd });
        for (const message of pool.errors) issues.push(reviewIssue("error", message.includes("gateway") ? "Gateway inside DHCP pool" : "Invalid DHCP pool", `${site.name} / ${vlan.name}: ${message}.`, site.id));
      }
      for (let k = vIndex + 1; k < site.vlans.length; k++) if (rangesOverlap(vlan.cidr, site.vlans[k].cidr)) issues.push(reviewIssue("error", "Overlapping VLAN subnets", `${site.name}: ${vlan.name} overlaps ${site.vlans[k].name}.`, site.id));
    }
    if (site.vlans.length >= 3 && !site.vlans.some(v => v.role === "management")) issues.push(reviewIssue("advice", "No management segment", `${site.name} has several VLANs but no dedicated network-management segment.`, site.id));
    if (site.vlans.some(v => v.role === "guest") && site.vlans.some(v => v.role === "users")) issues.push(reviewIssue("info", "Trust boundary required", `${site.name}'s guest network should be denied access to private staff and infrastructure ranges.`, site.id));
  }
  if (sites.length > 1) {
    // Iterative flood fill over a prebuilt adjacency list: a deep imported
    // chain must not exhaust the stack or rescan every link per site.
    const neighbours = new Map();
    for (const link of links) {
      if (!siteById.has(link.from) || !siteById.has(link.to)) continue;
      for (const [a, b] of [[link.from, link.to], [link.to, link.from]]) {
        if (!neighbours.has(a)) neighbours.set(a, []);
        neighbours.get(a).push(b);
      }
    }
    const visited = new Set(), stack = [sites[0].id];
    while (stack.length) {
      const id = stack.pop();
      if (visited.has(id)) continue;
      visited.add(id);
      for (const next of neighbours.get(id) || []) stack.push(next);
    }
    for (const site of sites.filter(s => !visited.has(s.id))) issues.push(reviewIssue("warning", "Isolated site", `${site.name} is not connected to the rest of the topology.`, site.id));
  }
  for (const link of links) {
    const a = siteById.get(link.from), b = siteById.get(link.to);
    if (!a || !b) continue;
    if (link.routingType === "static" && !(link.advertisedPrefixes || []).length) issues.push(reviewIssue("warning", "Static route intent is missing", `${a.name} ↔ ${b.name} uses static routing but has no documented advertised prefixes.`, a.id));
    for (const prefix of link.advertisedPrefixes || []) {
      try { parseRoutePrefix(prefix); } catch (error) { issues.push(reviewIssue("error", "Invalid advertised prefix", `${a.name} ↔ ${b.name}: ${error.message}.`, a.id)); continue; }
      if (prefix !== "0.0.0.0/0" && !isPrivateRoutePrefix(prefix)) issues.push(reviewIssue("advice", "Non-private advertised prefix", `${a.name} ↔ ${b.name} advertises ${prefix}. Confirm ownership and intent.`, a.id));
    }
  }
  if (design.topologyMode === "hub-spoke") {
    const hubs = sites.filter(s => s.topologyRole === "hub"), spokes = sites.filter(s => s.topologyRole === "spoke");
    if (!hubs.length) issues.push(reviewIssue("error", "Hub is missing", "Hub-and-spoke mode requires at least one site with the hub role."));
    if (hubs.length === 1 && spokes.length > 1) issues.push(reviewIssue("warning", "Single hub dependency", `${hubs[0].name} is the only transit hub for ${spokes.length} spokes.`, hubs[0].id));
    const secondary = sites.find(s => s.id === design.policies?.secondaryHubId && s.topologyRole === "hub");
    if (design.policies?.secondaryHubId && !secondary) issues.push(reviewIssue("error", "Secondary hub is invalid", "The configured secondary hub no longer exists or no longer has the hub role."));
    for (const spoke of spokes) {
      const hub = siteById.get(spoke.hubId);
      if (!hub || hub.topologyRole !== "hub") issues.push(reviewIssue("error", "Spoke has no valid hub", `${spoke.name} is marked as a spoke but has no valid hub assignment.`, spoke.id));
      else if (!links.some(l => (l.from === spoke.id && l.to === hub.id) || (l.to === spoke.id && l.from === hub.id))) issues.push(reviewIssue("error", "Spoke is not connected to hub", `${spoke.name} is assigned to ${hub.name} but no connection exists.`, spoke.id));
      if (secondary && !links.some(l => (l.from === spoke.id && l.to === secondary.id) || (l.to === spoke.id && l.from === secondary.id))) issues.push(reviewIssue("warning", "Secondary hub path is missing", `${spoke.name} is not connected to secondary hub ${secondary.name}.`, spoke.id));
      if (spoke.internetBreakout === "hub" && !links.some(l => ((l.from === spoke.id && l.to === spoke.hubId) || (l.to === spoke.id && l.from === spoke.hubId)) && l.defaultRoute)) issues.push(reviewIssue("warning", "Central breakout lacks default route", `${spoke.name} uses hub internet breakout but its hub link does not advertise a default route.`, spoke.id));
    }
    for (const link of links) {
      const a = siteById.get(link.from), b = siteById.get(link.to);
      if (a?.topologyRole === "spoke" && b?.topologyRole === "spoke") issues.push(reviewIssue("warning", "Direct spoke link conflicts with policy", `${a.name} and ${b.name} are directly connected even though spoke traffic is ${design.policies?.spokeToSpoke}.`, a.id));
    }
  }
  if (!issues.some(i => ["error", "warning"].includes(i.severity))) issues.unshift(reviewIssue("info", "Core checks passed", "No overlaps, invalid allocations or immediate capacity risks were found."));
  return issues;
}

/** The workspace score: 100 minus weighted findings, floored at zero. */
export function designScore(issues) {
  const count = severity => issues.filter(issue => issue.severity === severity).length;
  return Math.max(0, 100 - count("error") * 18 - count("warning") * 7 - count("advice") * 2);
}

/** Default trust-zone policy between two VLAN roles when none is explicit. */
export function defaultFlowPolicy(source, destination) {
  if (source === destination) return "allow";
  if (source === "guest") return "deny";
  if (source === "management") return "allow";
  if (source === "iot") return ["servers", "management"].includes(destination) ? "restricted" : "deny";
  if (destination === "management") return "deny";
  if (source === "users" && destination === "servers") return "restricted";
  return "restricted";
}

/*
 * Recommendation engine. Given what already exists (occupied ranges, VLAN ID
 * conventions) it produces a compatible site or VLAN plan. Plans carry no
 * object identities: callers assign ids when merging a plan into a design.
 * The workspace recommendation dialog runs this implementation, so preview
 * and apply cannot drift into different advice.
 */
export const ROLE_DEFAULTS = Object.freeze({
  users: { name: "Staff", vid: 10 }, voice: { name: "Voice", vid: 20 }, guest: { name: "Guest", vid: 30 },
  servers: { name: "Servers", vid: 40 }, iot: { name: "IoT", vid: 50 }, management: { name: "Management", vid: 99 },
  transit: { name: "Transit", vid: 90 }, other: { name: "Network", vid: 60 }
});

export function nextAvailableVlanId(site) {
  const vlans = Array.isArray(site?.vlans) ? site.vlans : [];
  for (const id of [10, 20, 30, 40, 50, 60, 70, 80, 90, 99]) if (!vlans.some(v => v.vid === id)) return id;
  for (let id = 1; id <= 4094; id++) if (!vlans.some(v => v.vid === id)) return id;
  return null;
}

/** The VLAN ID this environment already uses for the role, when free at the site. */
export function conventionalVlanId(role, site, existingSites = []) {
  const counts = new Map();
  for (const existing of Array.isArray(existingSites) ? existingSites : []) {
    for (const vlan of Array.isArray(existing?.vlans) ? existing.vlans : []) {
      if (vlan.role === role) counts.set(vlan.vid, (counts.get(vlan.vid) || 0) + 1);
    }
  }
  const ranked = [...counts].sort((a, b) => b[1] - a[1]).map(([vid]) => vid);
  const vlans = Array.isArray(site?.vlans) ? site.vlans : [];
  for (const vid of [...ranked, ROLE_DEFAULTS[role]?.vid || 60]) if (!vlans.some(v => v.vid === vid)) return vid;
  return nextAvailableVlanId(site);
}

export function sitePlanRoles(siteType) {
  if (siteType === "cloud" || siteType === "datacentre") return ["servers", "management"];
  if (siteType === "warehouse") return ["users", "iot", "guest", "management"];
  return ["users", "voice", "guest", "management"];
}

const ROLE_DEVICE_SHARE = Object.freeze({ users: 1, voice: .8, guest: 1.2, iot: .65, servers: .45, management: .12 });

export function plannedRoleDevices(role, primaryDevices) {
  return Math.max(role === "management" ? 12 : 4, Math.ceil(Number(primaryDevices) * (ROLE_DEVICE_SHARE[role] || .5)));
}

/** Validate plan data through the canonical factory, then drop the probe id. */
function identityFreeVlan(values) {
  const { id: _probe, ...vlan } = createVlan({ ...values, id: "plan" });
  return vlan;
}

function planInputError(message, path, code) {
  return new DesignValidationError(message, [issue(path, message, code)]);
}

/**
 * Plan a complete compatible site: a free RFC1918 parent block plus one
 * correctly sized subnet per role, following the environment's VLAN ID
 * conventions. Deterministic for identical inputs.
 */
export function recommendSitePlan({ sites = [], type = "office", devices = 50, growth = 30, name = "" } = {}) {
  const existingSites = Array.isArray(sites) ? sites : [];
  if (!has(type, ENUMS.siteTypes)) throw planInputError(`Unknown site type: ${type}`, "type", "invalid-enum");
  const primary = Math.trunc(Number(devices));
  if (!Number.isInteger(primary) || primary < 1 || primary > LIMITS.siteDevices[1]) {
    throw planInputError(`devices must be an integer from 1 to ${LIMITS.siteDevices[1]}`, "devices", "invalid-number");
  }
  const plannedGrowth = Number(growth);
  if (!Number.isFinite(plannedGrowth) || plannedGrowth < LIMITS.growth[0] || plannedGrowth > LIMITS.growth[1]) {
    throw planInputError(`growth must be from ${LIMITS.growth[0]} to ${LIMITS.growth[1]}`, "growth", "invalid-number");
  }
  let cidr;
  try {
    cidr = suggestSiteRange(existingSites.map(site => site?.cidr).filter(Boolean), primary);
  } catch (error) {
    throw planInputError(error.message, "sites", "unallocatable");
  }
  const occupied = [], planned = [], shell = { vlans: [] };
  for (const role of sitePlanRoles(type)) {
    const count = plannedRoleDevices(role, primary);
    let subnet, vid;
    try { subnet = nextSubnet(cidr, prefixForDevices(count, plannedGrowth), occupied); }
    catch (error) { throw planInputError(error.message, "sites", "unallocatable"); }
    vid = conventionalVlanId(role, shell, existingSites);
    if (vid === null) throw planInputError("This site has no free VLAN IDs", "vlans", "exhausted");
    const pool = defaultDhcpPool(subnet, 1);
    const plan = identityFreeVlan({
      name: ROLE_DEFAULTS[role].name, vid, role, devices: count, cidr: subnet, gateway: firstUsable(subnet),
      dhcpEnabled: !["servers", "management"].includes(role), reserved: 1,
      dhcpStart: pool.start, dhcpEnd: pool.end, notes: "Recommended for the new site.", siteCidr: cidr
    });
    shell.vlans.push(plan);
    planned.push(plan);
    occupied.push(subnet);
  }
  // Prove the composed plan passes canonical validation before returning it.
  createSite({
    id: "plan", name: String(name || "").trim() || "New site", type, devices: primary,
    growth: plannedGrowth, cidr, wan: "single", topologyRole: "standalone", internetBreakout: "local",
    notes: "", x: 20, y: 20, vlans: planned.map((vlan, index) => ({ ...vlan, id: `plan-${index}` }))
  });
  return {
    name: String(name || "").trim() || "New site",
    type, devices: primary, growth: plannedGrowth, cidr,
    vlans: planned
  };
}

/**
 * Plan one compatible VLAN inside an existing site: smallest recommended
 * subnet with the site's growth allowance, using the environment's VLAN ID
 * convention for the role.
 */
export function recommendVlanPlan({ sites = [], siteId, role = "other", devices = 30, name = "" } = {}) {
  const existingSites = Array.isArray(sites) ? sites : [];
  if (!has(role, ENUMS.vlanRoles)) throw planInputError(`Unknown VLAN role: ${role}`, "role", "invalid-enum");
  const site = existingSites.find(candidate => candidate && candidate.id === siteId);
  if (!site) throw planInputError(`No site matches "${String(siteId ?? "")}".`, "siteId", "unknown-site");
  const wanted = Math.trunc(Number(devices));
  if (!Number.isInteger(wanted) || wanted < 1 || wanted > LIMITS.vlanDevices[1]) {
    throw planInputError(`devices must be an integer from 1 to ${LIMITS.vlanDevices[1]}`, "devices", "invalid-number");
  }
  const vid = conventionalVlanId(role, site, existingSites);
  if (vid === null) throw planInputError(`${site.name || "This site"} has no free VLAN IDs`, "vlans", "exhausted");
  let cidr;
  try { cidr = nextSubnet(site.cidr, prefixForDevices(wanted, Number(site.growth) || 30), (site.vlans || []).map(v => v.cidr)); }
  catch (error) { throw planInputError(error.message, "site.cidr", "unallocatable"); }
  const dhcpEnabled = !["servers", "management"].includes(role);
  const pool = defaultDhcpPool(cidr, 1);
  return identityFreeVlan({
    name: String(name || "").trim() || ROLE_DEFAULTS[role].name, vid, role, devices: wanted, cidr,
    gateway: firstUsable(cidr), dhcpEnabled, reserved: 1,
    dhcpStart: dhcpEnabled ? pool.start : "", dhcpEnd: dhcpEnabled ? pool.end : "",
    notes: "Recommended by the compatibility assistant.", siteCidr: site.cidr
  });
}

/*
 * The canonical example design used by the workspace "explore a complete
 * example" starting point. Entity ids are stable so tests can reference
 * them; callers assign their own projectId.
 */
export function exampleDesign() {
  const vlansFor = (siteCidr, specs) => specs.map(spec => {
    const pool = defaultDhcpPool(spec.cidr, 1);
    return createVlan({
      id: spec.id, name: spec.name, vid: spec.vid, role: spec.role, devices: spec.devices,
      cidr: spec.cidr, gateway: firstUsable(spec.cidr), dhcpEnabled: spec.role !== "servers",
      reserved: 1, dhcpStart: pool.start, dhcpEnd: pool.end, notes: "", siteCidr
    });
  });
  const hq = createSite({
    id: "hq", name: "Cork HQ", type: "office", cidr: "10.20.0.0/16", devices: 180,
    wan: "dual", growth: 30, x: 42, y: 40, topologyRole: "hub", hubId: null,
    internetBreakout: "local", notes: "Primary network hub.",
    vlans: vlansFor("10.20.0.0/16", [
      { id: "hq-staff", name: "Staff", vid: 10, role: "users", devices: 100, cidr: "10.20.10.0/25" },
      { id: "hq-voice", name: "Voice", vid: 20, role: "voice", devices: 80, cidr: "10.20.20.0/25" },
      { id: "hq-guest", name: "Guest", vid: 30, role: "guest", devices: 120, cidr: "10.20.30.0/24" },
      { id: "hq-mgmt", name: "Management", vid: 99, role: "management", devices: 22, cidr: "10.20.99.0/27" }
    ])
  });
  const branch = createSite({
    id: "branch", name: "Dublin office", type: "branch", cidr: "10.30.0.0/16", devices: 70,
    wan: "single", growth: 30, x: 70, y: 20, topologyRole: "spoke", hubId: "hq",
    internetBreakout: "hub", notes: "",
    vlans: vlansFor("10.30.0.0/16", [
      { id: "branch-staff", name: "Staff", vid: 10, role: "users", devices: 52, cidr: "10.30.10.0/26" },
      { id: "branch-voice", name: "Voice", vid: 20, role: "voice", devices: 45, cidr: "10.30.20.0/26" },
      { id: "branch-guest", name: "Guest", vid: 30, role: "guest", devices: 70, cidr: "10.30.30.0/25" }
    ])
  });
  const cloud = createSite({
    id: "cloud", name: "Hosted network", type: "cloud", cidr: "10.80.0.0/16", devices: 40,
    wan: "none", growth: 50, x: 42, y: 72, topologyRole: "spoke", hubId: "hq",
    internetBreakout: "hub", notes: "Generic IPv4 example. Cloud-provider address reservations and managed DHCP rules are not modelled; verify them before implementation.",
    vlans: vlansFor("10.80.0.0/16", [
      { id: "cloud-apps", name: "Applications", vid: 40, role: "servers", devices: 28, cidr: "10.80.10.0/26" },
      { id: "cloud-endpoints", name: "Private endpoints", vid: 50, role: "servers", devices: 18, cidr: "10.80.20.0/27" }
    ])
  });
  const links = [
    createLink({ id: "link-hq-branch", from: "hq", to: "branch", type: "vpn", resilience: "dual", routingType: "bgp", transitAllowed: true, defaultRoute: true, advertisedPrefixes: [], notes: "Primary branch path." }),
    createLink({ id: "link-hq-cloud", from: "hq", to: "cloud", type: "vpn", resilience: "single", routingType: "bgp", transitAllowed: true, defaultRoute: false, advertisedPrefixes: [], notes: "Cloud application path." })
  ];
  return {
    schema: SCHEMA_ID,
    version: SCHEMA_VERSION,
    projectId: "illek-example-network",
    name: "Illek example network",
    mode: "sample",
    topologyMode: "hub-spoke",
    policies: { spokeToSpoke: "via-hub", centralizedInspection: true, secondaryHubId: null },
    flowPolicies: {},
    assumptions: ["Cork HQ provides transit and centralized inspection."],
    sites: [hq, branch, cloud],
    links,
    updatedAt: new Date().toISOString()
  };
}
