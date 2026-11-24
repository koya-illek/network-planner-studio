// App generations intentionally do not share mutable document slots. A cached
// pre-locking client cannot overwrite this generation's library or drafts.
export const STORAGE_KEY = 'network-planner-studio.v2';
export const LIBRARY_KEY = 'network-planner-studio.projects.v2';
export const DRAFT_PREFIX = 'network-planner-studio.pending.v2.';
export const WRITE_LOCK = 'network-planner-studio.library-write.v2';
export const LEGACY_ACTIVE = 'network-planner-studio.v1';
export const LEGACY_LIBRARY = 'network-planner-studio.projects.v1';
export const LEGACY_DRAFT_PREFIX = 'network-planner-studio.pending.v1.';
export const LEGACY_ACTIVE_RECOVERY = LEGACY_ACTIVE + '.unreadable';
export const LEGACY_LIBRARY_RECOVERY = LEGACY_LIBRARY + '.unreadable';
export const isLegacyKey = key => [LEGACY_ACTIVE, LEGACY_LIBRARY, LEGACY_ACTIVE_RECOVERY, LEGACY_LIBRARY_RECOVERY].includes(key) || key?.startsWith(LEGACY_DRAFT_PREFIX);

function canonical(value) {
  return JSON.stringify(value, (_, part) => part && typeof part === 'object' && !Array.isArray(part)
    ? Object.fromEntries(Object.keys(part).sort().map(key => [key, part[key]]))
    : part);
}

async function digest(text) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

// This bridge never writes, clears, quarantines or deletes a legacy slot.
// The importer must have a separate writer identity from the active editor.
export function createLegacyBridge({storage, validate, persistence, hash = digest}) {
  const importing = new Map();

  async function rows() {
    const candidates = [], errors = [], seen = new Set();
    const invalid = (label, raw, error) => errors.push({label, raw, error: error.message || String(error)});

    function add(raw, label) {
      try {
        if (raw.length > 10 * 1024 * 1024) throw new Error('This previous-version design exceeds 10 MB. Download it for recovery.');
        const parsed = JSON.parse(raw), document = validate(parsed);
        // Hash source content, not normalisation-generated IDs/timestamps.
        // Otherwise an unchanged old design with missing IDs could multiply.
        const identity = {...parsed};
        delete identity.updatedAt;
        delete identity.importWarnings;
        const fingerprint = canonical(identity);
        if (seen.has(fingerprint)) return;
        seen.add(fingerprint);
        candidates.push({label, raw, document, fingerprint});
      } catch (error) {
        invalid(label, raw, error);
      }
    }

    try {
      for (const [key, label, itemLabel] of [
        [LEGACY_LIBRARY, 'Previous-version library', 'Saved in previous version'],
        [LEGACY_LIBRARY_RECOVERY, 'Previous-version library recovery', 'Recovered previous-version save'],
      ]) {
        const raw = storage.getItem(key);
        if (raw === null) continue;
        try {
          if (raw.length > 64 * 1024 * 1024) throw new Error('The previous-version library exceeds 64 MB. Download it for recovery.');
          const library = JSON.parse(raw);
          if (!library || typeof library !== 'object' || Array.isArray(library)) throw new Error('Unreadable previous-version library');
          for (const value of Object.values(library)) add(JSON.stringify(value), itemLabel);
        } catch (error) {
          invalid(label, raw, error);
        }
      }
      for (const [key, label] of [
        [LEGACY_ACTIVE, 'Open in previous version'],
        [LEGACY_ACTIVE_RECOVERY, 'Previous-version current-design recovery'],
      ]) {
        const raw = storage.getItem(key);
        if (raw !== null) add(raw, label);
      }
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i);
        if (!key?.startsWith(LEGACY_DRAFT_PREFIX)) continue;
        const raw = storage.getItem(key);
        if (raw === null) continue;
        try {
          const value = JSON.parse(raw);
          if (value.format !== 'network-planner-pending.v1') throw new Error('Unrecognised previous-version draft');
          add(JSON.stringify(value.document), 'Unfinished previous-version save');
        } catch (error) {
          invalid('Previous-version draft', raw, error);
        }
      }
    } catch (error) {
      invalid('Previous-version storage', null, error);
    }

    const result = [];
    for (const row of candidates) {
      try {
        const targetId = 'legacy-' + await hash(row.fingerprint);
        result.push({...row, targetId});
      } catch (error) {
        invalid(row.label, row.raw, error);
      }
    }
    return [...result, ...errors];
  }

  function importCopy(row) {
    if (!row.document || !row.targetId) return Promise.reject(new Error('Download this unreadable previous-version data for recovery.'));
    if (importing.has(row.targetId)) return importing.get(row.targetId);
    const document = {...row.document, projectId: row.targetId};
    const operation = persistence.enqueue(document, {keepExisting: true})
      .then(result => {
        if (!result.ok) throw result.error || new Error('This copy needs recovery before it can be opened.');
        return result.existing || document;
      })
      .finally(() => importing.delete(row.targetId));
    importing.set(row.targetId, operation);
    return operation;
  }

  return {rows, importCopy};
}
