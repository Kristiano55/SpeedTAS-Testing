/**
 * SpeedTAS: copy auto-imported results from the website into this Google Sheet.
 *
 * The data Action adds a finished edition to the website as soon as TAS Exchange shows its times
 * (marked "auto"). This script copies those editions into the Editions tab, so the sheet stays the
 * full record. It only fills an edition row that is still empty, and adds a column for a new player.
 * It never changes results that are already in the sheet.
 *
 * Setup (once, in the Season 3 sheet):
 *   1. Extensions > Apps Script, paste this file, save.
 *   2. Run "installTrigger" once and allow access when Google asks.
 *      It then runs every hour; "SpeedTAS > Import auto results now" runs it by hand.
 * For the TM2020 sheet, paste it there too and set DATA_FILE to 'tm20'.
 */
const DATA_FILE = 's3';
const SITE = 'https://kristiano55.github.io/SpeedTAS-Testing';
const TAB = 'Editions';

function onOpen() {
  SpreadsheetApp.getUi().createMenu('SpeedTAS').addItem('Import auto results now', 'importAutoResults').addToUi();
}

function installTrigger() {
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'importAutoResults').forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('importAutoResults').timeBased().everyHours(1).create();
  importAutoResults();
}

function importAutoResults() {
  const res = UrlFetchApp.fetch(`${SITE}/data/${DATA_FILE}.json?t=${Date.now()}`, {muteHttpExceptions: true});
  if (res.getResponseCode() !== 200) throw new Error(`Could not read ${DATA_FILE}.json (HTTP ${res.getResponseCode()})`);
  const auto = JSON.parse(res.getContentText()).editions.filter(e => e.auto);
  if (!auto.length) return;

  const sh = SpreadsheetApp.getActive().getSheetByName(TAB);
  const header = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const key = n => String(n).toLowerCase().replace(/[^a-z0-9]/g, '');
  const colOf = {};
  header.forEach((h, i) => { if (i > 0 && h !== '') colOf[key(h)] = i + 1; });
  const firstCol = sh.getRange(1, 1, sh.getLastRow(), 1).getValues().map(r => String(r[0]).trim());

  let imported = 0;
  auto.forEach(ed => {
    const row = firstCol.indexOf(String(ed.edition)) + 1;
    if (row < 2) return; // no row for this edition number: leave it for a human
    const width = sh.getLastColumn();
    const existing = sh.getRange(row, 2, 1, Math.max(1, width - 1)).getValues()[0];
    if (existing.some(v => v !== '' && v !== null)) return; // the sheet already has results here: it wins
    Object.entries(ed.results).forEach(([name, place]) => {
      let col = colOf[key(name)];
      if (!col) { col = sh.getLastColumn() + 1; sh.getRange(1, col).setValue(name); colOf[key(name)] = col; }
      sh.getRange(row, col).setValue(place);
    });
    imported++;
  });
  if (imported) console.log(`Imported ${imported} edition(s) from TAS Exchange.`);
}
