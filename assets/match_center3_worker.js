"use strict";

const LIVE_STATUSES = new Set(["1H", "2H", "ET", "LIVE", "HT", "P", "BT", "INT"]);
const FINAL_STATUSES = new Set(["FT", "AET", "PEN", "AWD", "WO"]);

let preparedMatches = [];

function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

function inTimeWindow(minutes, fromMinutes, toMinutes) {
  if (!Number.isFinite(minutes) || !Number.isFinite(fromMinutes) || !Number.isFinite(toMinutes)) return true;
  if (fromMinutes <= toMinutes) return minutes >= fromMinutes && minutes <= toMinutes;
  return minutes >= fromMinutes || minutes <= toMinutes;
}

function shouldKeepMatch(match, query) {
  if (query.search) {
    const blob = match.searchBlob || "";
    if (!blob.includes(query.search)) return false;
  }

  const status = String(match.statusShort || "").toUpperCase();
  const kickoffTs = Number.isFinite(match.kickoffTs) ? match.kickoffTs : null;

  if (query.quickFilter === "live") {
    if (LIVE_STATUSES.has(status)) return true;
    if (kickoffTs == null || !Number.isFinite(query.nowTs)) return false;
    return kickoffTs >= query.nowTs - 10 * 60 * 1000 && kickoffTs <= query.nowTs + 30 * 60 * 1000;
  }

  if (query.quickFilter) return true;

  if (LIVE_STATUSES.has(status)) {
    if (match.liveOnly) return true;
    if (kickoffTs == null || !Number.isFinite(query.nowTs)) return true;
    if (query.nowTs - kickoffTs <= 150 * 60 * 1000) return true;
  }

  if (FINAL_STATUSES.has(status)) {
    if (kickoffTs != null && Number.isFinite(query.nowTs) && query.nowTs - kickoffTs <= 110 * 60 * 1000) {
      return true;
    }
  }

  if (query.useRollingCurrentWindow) {
    if (kickoffTs != null && Number.isFinite(query.rollingStartUtcMs)) return kickoffTs >= query.rollingStartUtcMs;
    return inTimeWindow(match.localKickoffMinutes, query.fromMinutes, query.toMinutes);
  }

  return inTimeWindow(match.localKickoffMinutes, query.fromMinutes, query.toMinutes);
}

self.addEventListener("message", event => {
  const message = event.data || {};
  const { type, token, payload } = message;

  if (type === "hydrate") {
    preparedMatches = Array.isArray(payload?.matches)
      ? payload.matches.map(match => ({
          fixture_id: match.fixture_id,
          searchBlob: normalizeText(match.searchBlob),
          localKickoffMinutes: Number(match.localKickoffMinutes),
          kickoffTs: Number.isFinite(match.kickoffTs) ? Number(match.kickoffTs) : null,
          statusShort: String(match.statusShort || "").toUpperCase(),
          liveOnly: Boolean(match.liveOnly),
        }))
      : [];
    self.postMessage({ type: "hydrated", token, count: preparedMatches.length });
    return;
  }

  if (type === "query") {
    const query = {
      search: normalizeText(payload?.search),
      quickFilter: String(payload?.quickFilter || ""),
      fromMinutes: Number(payload?.fromMinutes),
      toMinutes: Number(payload?.toMinutes),
      nowTs: Number(payload?.nowTs),
      useRollingCurrentWindow: Boolean(payload?.useRollingCurrentWindow),
      rollingStartUtcMs: Number.isFinite(payload?.rollingStartUtcMs) ? Number(payload.rollingStartUtcMs) : null,
    };
    const ids = preparedMatches
      .filter(match => shouldKeepMatch(match, query))
      .map(match => String(match.fixture_id));
    self.postMessage({ type: "result", token, ids });
  }
});
