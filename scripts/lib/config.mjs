// scripts/lib/config.mjs — Every source and limit in one place: sheet ids, TAS Exchange event sets and scan limits, TMX map packs, map search, auto-import.
// Part of scripts/update-data.mjs (see the top of that file for what a run does).

export const SHEETS = {
  // Current season. The sheet must be shared as "Anyone with the link can view".
  s3: { kind: 'gviz', id: '1Ylmj87seG1TF7ZRlnx8puwTFt39tAKdPF0JEpfhcTOc', sheet: 'Editions' },
  s2: { kind: 'gviz', id: '1g7M1IWvDlqmUkUWB6oSX-HKf7tCpAmaQK_nvNGBEppw', sheet: 'Editions' },
  s1: { kind: 'csv', url: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vT2PVKpC2mV_UWnXg6ouoPooQ6lgJlPLNIen11GniPy0q3m40b9CL_VTyhWP0V2cGEMItY7c75LLjZH/pub?output=csv' },
  tm20: { kind: 'csv', url: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRDvd1q6-1ze91Uv30Lm4nOjkx9Q-r2ceqkSetJIeILpYzBfRKlwU-wT6GhJ2Xh_b3XLLIYMrsBb1m_/pub?output=csv', mustStartWith: '👥' },
};

export const EVENT_SETS = {
  s2: /SpeedTAS Season2/i,
  s3: /SpeedTAS (Season ?3|S3)\b/i,
  tm20: /SpeedTAS TM20/i,
};

export const EVENT_SCAN_FROM = 40;

      // lowest event id worth checking
export const EVENT_SCAN_KNOWN = 270;

    // events up to here already exist (Nov 2026): the first run reads them all, holes included
export const EVENT_LOOKAHEAD = 15;

      // this many missing ids in a row = past the newest event
export const RESULT_RECHECKS = 12;

      // most event pages re-read per run for results that were still hidden
export const MAX_CHECKS_PER_EVENT = 4;

  // an event whose times stay hidden is given up on after this many reads
export const REPLAY_BACKFILL = 50;

      // most older events re-read per run to pick up their replay ids
export const INPUT_FETCHES = 120;

       // most input files downloaded per run (the backlog spreads over a few runs)
export const AUTO_IMPORT = { s3: 's3', tm20: 'tm20' };

export const MAP_PACKS = { s1: 11621132, s2: 13122890 };

export const MAP_SEARCH = { s3: { query: 'SpeedTAS 3', name: /^\s*SpeedTAS\s*(?:S(?:eason)?\s*)?3\s*#\s*0*(\d+)\b/i } };

export const MAP_SEASONS = [...new Set([...Object.keys(MAP_PACKS), ...Object.keys(MAP_SEARCH)])];

export const MAP_FIELDS = 'TrackId,TrackName,Authors[],AuthorTime,WRReplay.ReplayTime,WRReplay.User.Name,HasThumbnail';

/* TAS Exchange name -> sheet name, for names the history can't work out on its own. Keys are lower-case, letters/digits only. */
export const MANUAL_ALIASES = {};
