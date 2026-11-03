/**
 * Rancho MATHCOUNTS check-in.
 *
 * Two front ends share the handlers below:
 *   - mc.uhsmathclub.org/hello  ->  doPost(), JSON over a public web app
 *   - this script's own web app ->  doGet() + google.script.run, the fallback
 *
 * Sheet layout (fixed — see SKILL.md):
 *   Dashboard   B1 day code, C1 announcement; from row 3:
 *               A name, B student ID, C timestamp, D personal message,
 *               E student response, F leaving-early time,
 *               G onward free for coaches and for answers to C1's questions
 *   Log         A name, B timestamp, C response, D answers.  Append-only.
 *   Attendance  A name, B student ID, then one column per meeting, date in row 1
 *
 * Deploy as a web app with "Execute as: Me" and "Who has access: Anyone",
 * then paste the /exec URL into site.yml.
 */

var SS = SpreadsheetApp.getActiveSpreadsheet();

var DASHBOARD = "Dashboard";
var LOG = "Log";
var ATTENDANCE = "Attendance";

var CODE_CELL = "B1";
var ANNOUNCEMENT_CELL = "C1";
var HEADER_ROW = 2;
var FIRST_STUDENT_ROW = 3;

var TIMEZONE = "America/Los_Angeles";
var STAMP_FORMAT = "M/d/yyyy h:mm:ss AM/PM";

/** Crockford base-32: no I, L, O (misread as 1, 1, 0) and no U. */
var CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
/**
 * What a student may type. The generator never draws a U, but a coach who
 * writes a themed code like "UNIT" into B1 by hand still needs it to work.
 */
var TYPABLE = CROCKFORD + "U";
var CODE_LENGTH = 4;

/** Sheets' "light red 3". Only ever cleared if it is still exactly this. */
var PROBLEM_FILL = "#f4cccc";


/* ======================================================================
 * Menu
 * ==================================================================== */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("MATHCOUNTS")
    .addItem("New day", "newDay")
    .addItem("New code only", "newCodeOnly")
    .addItem("New attendance column", "newAttendanceColumn")
    .addSeparator()
    .addItem("Evaluate template", "evaluateTemplate")
    .addItem("Evaluate template and save note", "evaluateTemplateAndSaveNote")
    .addItem("Restore template from note", "restoreTemplateFromNote")
    .addSeparator()
    .addItem("Check code and announcement", "checkDashboard")
    .addItem("Clear announcement answers", "clearAnswers")
    .addToUi();
}

/**
 * The one trigger. Typing into B1 or C1 re-checks them and turns the cell
 * red if a student would hit a problem — a code nobody can type, or a
 * question that is malformed. It never blocks the edit or opens a dialog;
 * "Check code and announcement" says what is wrong.
 */
function onEdit(e) {
  if (!e || !e.range) return;
  var range = e.range;
  var sheet = range.getSheet();
  if (sheet.getName() !== DASHBOARD || range.getRow() !== 1) return;
  if (range.getLastColumn() < 2 || range.getColumn() > 3) return;
  markProblems_(sheet, dashboardReport_(sheet));
}

/**
 * Start a meeting: roll a new code, clear the day's columns, un-bold the
 * names. Attendance columns are added by hand — the formulas there read the
 * Log, so nothing in this script needs to touch that sheet.
 */
function newDay() {
  var sheet = SS.getSheetByName(DASHBOARD);
  var lastRow = sheet.getLastRow();

  if (lastRow >= FIRST_STUDENT_ROW) {
    var rows = lastRow - FIRST_STUDENT_ROW + 1;
    sheet.getRange(FIRST_STUDENT_ROW, 1, rows, 1).setFontWeight("normal");
    sheet.getRange(FIRST_STUDENT_ROW, 3, rows, 4).clearContent(); // C through F
    // Only E and F. Column D's note is the message template and it stays.
    sheet.getRange(FIRST_STUDENT_ROW, 5, rows, 2).clearNote();
  }

  rollCode_();
}

/** Re-roll the code mid-meeting without clearing anything. */
function newCodeOnly() {
  rollCode_();
}

function rollCode_() {
  var code = generateCode_();
  var cell = SS.getSheetByName(DASHBOARD).getRange(CODE_CELL);
  cell.setValue(code);
  flag_(cell, false); // a script edit fires no onEdit; a generated code is always typable
  return code;
}

/**
 * Four Crockford characters drawn from a SHA-256 digest of a fresh UUID.
 * 32 divides 256 evenly, so taking each byte modulo 32 is already uniform
 * and no rejection step is needed.
 */
function generateCode_() {
  var seed = Utilities.getUuid() + ":" + new Date().getTime();
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, seed);
  var code = "";
  for (var i = 0; i < bytes.length && code.length < CODE_LENGTH; i++) {
    code += CROCKFORD.charAt((bytes[i] & 0xff) % 32);
  }
  return code;
}

/* ======================================================================
 * The day code
 * ==================================================================== */

/**
 * Fold the predictable transcription mistakes back in: O reads as 0, I and L
 * read as 1, and Crockford ignores hyphens.
 */
function normalizeCode_(raw) {
  var text = String(raw === null || raw === undefined ? "" : raw).toUpperCase();
  var out = "";
  for (var i = 0; i < text.length; i++) {
    var character = text.charAt(i);
    if (character === "-") continue;
    if (character === "I" || character === "L") character = "1";
    else if (character === "O") character = "0";
    if (TYPABLE.indexOf(character) > -1) out += character;
  }
  return out;
}

/**
 * Compare without an early exit.
 *
 * Apps Script cannot truly guarantee constant time, and network jitter to
 * Google dwarfs any timing signal a student could measure. This costs four
 * lines and closes the argument; the real protection is that 32^4 is
 * 1,048,576 and that the code is rotated every meeting.
 */
function constantTimeEquals_(a, b) {
  var left = String(a);
  var right = String(b);
  var difference = left.length ^ right.length;
  var length = Math.max(left.length, right.length);
  for (var i = 0; i < length; i++) {
    difference |= (left.charCodeAt(i) | 0) ^ (right.charCodeAt(i) | 0);
  }
  return difference === 0;
}

function codeIsCorrect_(submitted) {
  var expected = normalizeCode_(
    SS.getSheetByName(DASHBOARD).getRange(CODE_CELL).getDisplayValue()
  );
  if (expected.length !== CODE_LENGTH) return false; // no code set yet
  return constantTimeEquals_(expected, normalizeCode_(submitted));
}


/* ======================================================================
 * Handlers — shared by the public site and the fallback web app
 * ==================================================================== */

/** One entry point for both front ends: doPost() and google.script.run. */
function api(body) {
  body = body || {};
  if (body.action === "gate") return gate(body.code);
  if (body.action === "fields") return restrictedFields(body.code, body.id);
  if (body.action === "checkin") {
    return checkIn(body.code, body.id, body.message, body.leaving, body.answers);
  }
  return { ok: false, error: "bad_request" };
}

/**
 * Step 1. Nothing here touches a student record. Questions limited to some
 * students with data-only are sent as an empty slot; see restrictedFields.
 */
function gate(code) {
  if (!codeIsCorrect_(code)) return { ok: false, error: "code" };
  var announcement = readAnnouncement_(SS.getSheetByName(DASHBOARD));
  return {
    ok: true,
    announcement: announcement.html,
    fields: announcement.fields.map(function (field) {
      return field.only ? { i: field.i, restricted: true } : publicField_(field);
    })
  };
}

/**
 * Step 2, once nine digits are typed: the data-only questions meant for
 * that ID. A question's label can be personal, so it is never sent to
 * anyone it is not for.
 */
function restrictedFields(code, id) {
  if (!codeIsCorrect_(code)) return { ok: false, error: "code" };
  var wanted = digitsOnly_(id);
  var fields = readAnnouncement_(SS.getSheetByName(DASHBOARD)).fields
    .filter(function (field) { return field.only && field.only.indexOf(wanted) > -1; })
    .map(publicField_);
  return { ok: true, fields: fields };
}

/** Step 2. The code is re-checked before the ID is looked at. */
function checkIn(code, id, message, leaving, answers) {
  if (!codeIsCorrect_(code)) return { ok: false, error: "code" };

  // Read before taking the lock: it is the slowest call and changes nothing.
  var sheet = SS.getSheetByName(DASHBOARD);
  var fields = readAnnouncement_(sheet).fields;

  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
  } catch (error) {
    return { ok: false, error: "busy" };
  }

  try {
    var row = findStudentRow_(sheet, id);
    if (!row) return { ok: false, error: "id" };

    // The page checks every answer before sending it, so this only fails if
    // the announcement changed mid-check-in or someone bypassed the page.
    var writes = planAnswers_(fields, digitsOnly_(id), answers);
    if (!writes) return { ok: false, error: "answers" };

    var now = new Date();
    var name = sheet.getRange(row, 1).getDisplayValue();
    var response = String(message === null || message === undefined ? "" : message);
    var leavingText = String(leaving === null || leaving === undefined ? "" : leaving);

    // A second check-in overwrites the first. Push whatever E and F already
    // held into their notes so a coach can still see that the student said
    // they were leaving early, even after the answer was replaced.
    var previousStamp = sheet.getRange(row, 3).getDisplayValue();
    archiveCell_(sheet.getRange(row, 5), previousStamp);
    archiveCell_(sheet.getRange(row, 6), previousStamp);

    sheet.getRange(row, 1).setFontWeight("bold");
    sheet.getRange(row, 3).setValue(now).setNumberFormat(STAMP_FORMAT);
    sheet.getRange(row, 5).setValue(asText_(response));
    sheet.getRange(row, 6).setValue(leavingText);
    writeAnswers_(sheet, row, writes, previousStamp);

    // Log!B must be a real Date: the Attendance formulas compare INT() of it
    // against INT() of the date in row 1, and a text timestamp never matches.
    var log = SS.getSheetByName(LOG);
    var entry = [name, now, asText_(response)];
    if (writes.length) entry.push(asText_(summarizeWrites_(writes)));
    log.appendRow(entry);
    log.getRange(log.getLastRow(), 2).setNumberFormat(STAMP_FORMAT);

    return {
      ok: true,
      name: firstName_(name),
      message: renderMessage_(sheet, row)
    };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Append a cell's current contents to its own note before it is replaced.
 * Column D is never archived this way: its note is the message template.
 */
function archiveCell_(cell, stamp) {
  var previous = cell.getDisplayValue();
  if (!previous) return;

  var note = cell.getNote();
  var entry = (stamp ? stamp + " - " : "") + previous;
  cell.setNote(note ? note + "\n" + entry : entry);
}

/**
 * Store what a student typed as text, exactly. Without the apostrophe,
 * "=IMPORTRANGE(...)" would run as a formula and "007" would become 7.
 * Sheets hides the apostrophe; it is not part of the value.
 */
function asText_(value) {
  var text = String(value === null || value === undefined ? "" : value);
  return text ? "'" + text : "";
}

/** Dashboard!A holds "Preferred (Legal) Last"; the greeting wants the first word. */
function firstName_(name) {
  return String(name).trim().split(/\s+/)[0] || "";
}

function digitsOnly_(value) {
  return String(value === null || value === undefined ? "" : value).replace(/\D/g, "");
}

/**
 * Scan from row 3 so the day code in B1 can never be matched as an ID, and
 * compare on digits alone so a formatted or leading-zero ID still resolves.
 */
function findStudentRow_(sheet, id) {
  var lastRow = sheet.getLastRow();
  if (lastRow < FIRST_STUDENT_ROW) return 0;

  var wanted = digitsOnly_(id);
  if (!wanted) return 0;

  var ids = sheet
    .getRange(FIRST_STUDENT_ROW, 2, lastRow - FIRST_STUDENT_ROW + 1, 1)
    .getDisplayValues();

  for (var i = 0; i < ids.length; i++) {
    if (digitsOnly_(ids[i][0]) === wanted) return FIRST_STUDENT_ROW + i;
  }
  return 0;
}


/* ======================================================================
 * Attendance
 * ==================================================================== */

/** Append one dated column to Attendance, formulas and formatting included. */
function newAttendanceColumn() {
  var sheet = SS.getSheetByName(ATTENDANCE);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  var column = sheet.getLastColumn() + 1;
  var letter = columnLetter_(column);

  var today = new Date();
  today.setHours(0, 0, 0, 0);
  sheet.getRange(1, column).setValue(today);

  var formulas = [];
  for (var row = 2; row <= lastRow; row++) {
    formulas.push([
      "=IF(ISERROR(VLOOKUP($A" + row + ",FILTER(Log!$A$2:$A, " +
      "INT(Log!$B$2:$B)=INT(" + letter + "$1)),1,FALSE)),FALSE,TRUE)"
    ]);
  }
  sheet.getRange(2, column, formulas.length, 1).setFormulas(formulas);

  // Carry over the date format and the checkboxes from the previous meeting.
  if (column > 3) {
    var source = sheet.getRange(1, column - 1, lastRow, 1);
    var target = sheet.getRange(1, column, lastRow, 1);
    source.copyTo(target, SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
    source.copyTo(target, SpreadsheetApp.CopyPasteType.PASTE_DATA_VALIDATION, false);
  }
}

function columnLetter_(index) {
  var letter = "";
  while (index > 0) {
    var remainder = (index - 1) % 26;
    letter = String.fromCharCode(65 + remainder) + letter;
    index = Math.floor((index - 1) / 26);
  }
  return letter;
}


/* ======================================================================
 * Message templates
 *
 * A coach writes one template into column D and expands it down a
 * selection. Tokens start with a backslash:
 *
 *   \Name       preferred first name    (first word of column A)
 *   \FullName   column A verbatim
 *   \LastName   last word of column A
 *   \LegalName  the name inside parentheses, or the first word
 *   \G \H \AA any column from G onward, by letter
 *   \n          a line break
 *   \\          a literal backslash
 *   \* \_ \~ \[ \# \> \`  that character, never read as markdown
 *
 * Presets are matched before column letters, so \LastName is a preset and
 * not column L followed by "astName". An unknown token is left alone
 * rather than silently deleted. A substituted value is always literal: a
 * student's answer in column K that contains ** stays as typed.
 *
 * Inline markers become real cell formatting: **bold**, *italic*,
 * __underline__, ~~strike~~, [text](url). A marker with no partner is
 * printed as written, so "2*3" stays "2*3". Headings, blockquotes, `code`
 * and ![images](url) are left as written and parsed when the page renders
 * them, because a spreadsheet cell cannot express them.
 * ==================================================================== */

var MESSAGE_COL = 4;              // Dashboard column D
var FIRST_TEMPLATE_COL = 7;       // \G is the first column a token may read
var PRESETS = ["FullName", "LegalName", "LastName", "Name"]; // longest first
var ESCAPABLE = "\\*_~[]()<>#!`";


function evaluateTemplate() {
  expandSelection_(false);
}

function evaluateTemplateAndSaveNote() {
  expandSelection_(true);
}

/** Put the saved template back into the cell so it can be edited again. */
function restoreTemplateFromNote() {
  var sheet = SS.getSheetByName(DASHBOARD);
  var rows = selectedMessageRows_(sheet);
  if (!rows) return;

  var count = rows.bottom - rows.top + 1;
  var cells = sheet.getRange(rows.top, MESSAGE_COL, count, 1);
  var notes = cells.getNotes();
  var values = cells.getValues();
  var ids = sheet.getRange(rows.top, 2, count, 1).getDisplayValues();

  var out = [];
  for (var i = 0; i < count; i++) {
    var keep = !digitsOnly_(ids[i][0]) || !notes[i][0];
    out.push([keep ? values[i][0] : notes[i][0]]);
  }
  cells.setValues(out); // one write, so one undo
}

/**
 * Read the whole block, expand it in memory, write it back in one call.
 *
 * Doing this cell by cell costs four API round trips per row and, worse,
 * leaves one undo step per row behind: a coach who picks the wrong menu
 * item would have to hold Ctrl+Z down. Batched, the values are a single
 * undo, and saving notes adds exactly one more.
 */
function expandSelection_(saveNote) {
  var sheet = SS.getSheetByName(DASHBOARD);
  var rows = selectedMessageRows_(sheet);
  if (!rows) return;

  var lastColumn = sheet.getLastColumn();
  var count = rows.bottom - rows.top + 1;

  var table = sheet.getRange(rows.top, 1, count, lastColumn).getDisplayValues();
  var cells = sheet.getRange(rows.top, MESSAGE_COL, count, 1);
  var rich = cells.getRichTextValues();
  var notes = cells.getNotes();

  var outValues = [];
  var outNotes = [];
  var touched = false;

  for (var i = 0; i < count; i++) {
    var current = rich[i][0] || SpreadsheetApp.newRichTextValue().setText("").build();
    var text = current.getText();
    var note = notes[i][0];

    // Rows with no ID are spacers that group students visually. They have
    // no name to substitute, so leave them exactly as they are.
    if (!digitsOnly_(table[i][1])) {
      outValues.push([current]);
      outNotes.push([note]);
      continue;
    }

    // A cell that still has markers is a fresh edit and wins over the note.
    // Otherwise the note is the template and the cell is last run's output.
    var fresh = hasTemplateMarkup_(text) && !isOutputOf_(text, note, table[i], lastColumn);
    var source = fresh ? text : (note || text);

    if (!source) {
      outValues.push([current]);
      outNotes.push([note]);
      continue;
    }

    touched = true;
    outValues.push([buildRichText_(expandTokens_(source, table[i], lastColumn), false)]);
    outNotes.push([source]);
  }

  if (!touched) return;
  cells.setRichTextValues(outValues);
  if (saveNote) cells.setNotes(outNotes);
}

/** The part of the selection that lands in column D, from row 3 down. */
function selectedMessageRows_(sheet) {
  var selection = SpreadsheetApp.getActiveRange();
  var ui = SpreadsheetApp.getUi();

  if (!selection || selection.getSheet().getName() !== DASHBOARD) {
    ui.alert("Select cells in column D of the Dashboard first.");
    return null;
  }
  if (selection.getColumn() > MESSAGE_COL || selection.getLastColumn() < MESSAGE_COL) {
    ui.alert("That selection does not include column D.");
    return null;
  }

  var top = Math.max(selection.getRow(), FIRST_STUDENT_ROW);
  var bottom = selection.getLastRow();
  if (bottom < top) {
    ui.alert("Select cells in column D of the Dashboard first.");
    return null;
  }
  return { top: top, bottom: bottom };
}


/* ---------- token expansion ---------- */

function hasTemplateMarkup_(text) {
  return /\\[A-Za-z\\*_~\[\]()<>#!`]/.test(text) ||
    /\*\*|~~|__|\*[^*]+\*|\[[^\]]*\]\([^)]*\)/.test(text);
}

/** Preferred first name, from "Preferred (Legal) Last" or "First Last". */
function presetValue_(preset, fullName) {
  var name = String(fullName).trim();
  var words = name.split(/\s+/);

  if (preset === "FullName") return name;
  if (preset === "LastName") return words[words.length - 1] || "";
  if (preset === "LegalName") {
    var inside = name.match(/\(([^)]*)\)/);
    return inside ? inside[1].trim() : (words[0] || "");
  }
  return words[0] || ""; // \Name
}

function columnIndexFromLetters_(letters) {
  var index = 0;
  for (var i = 0; i < letters.length; i++) {
    index = index * 26 + (letters.charCodeAt(i) - 64);
  }
  return index;
}

/*
 * Text moves between these steps as an array of characters, each carrying
 * the cell formatting it came with (`base`) and whether it must be printed
 * as itself rather than read as markdown (`literal`).
 */
function pushText_(out, text, base, literal) {
  for (var k = 0; k < text.length; k++) {
    out.push({ c: text.charAt(k), base: base, literal: literal });
  }
}

function charsText_(chars) {
  var text = "";
  for (var i = 0; i < chars.length; i++) text += chars[i].c;
  return text;
}

/** A cell's rich text as characters, keeping bold, italics and links typed in the sheet. */
function charsFromRich_(rich) {
  var chars = [];
  if (!rich) return chars;
  var runs = rich.getRuns();
  for (var r = 0; r < runs.length; r++) {
    var style = runs[r].getTextStyle();
    pushText_(chars, runs[r].getText(), {
      bold: !!style.isBold(),
      italic: !!style.isItalic(),
      underline: !!style.isUnderline(),
      strike: !!style.isStrikethrough(),
      link: runs[r].getLinkUrl() || null
    }, false);
  }
  return chars;
}

/**
 * One left-to-right pass. Everything is resolved in source order so that
 * \\\\Name yields a literal \\Name rather than a substituted name.
 */
function expandTokens_(source, values, lastColumn) {
  var fullName = values[0];
  var out = [];
  var i = 0;

  while (i < source.length) {
    if (source.charAt(i) !== "\\") {
      pushText_(out, source.charAt(i), null, false);
      i += 1;
      continue;
    }

    var rest = source.substring(i + 1);
    var next = rest.charAt(0);

    if (next === "n") {                 // \n -> a line break
      pushText_(out, "\n", null, false);
      i += 2;
      continue;
    }
    if (next && ESCAPABLE.indexOf(next) > -1) {   // \\ \* \[ ... -> that character
      pushText_(out, next, null, true);
      i += 2;
      continue;
    }

    var matched = false;

    for (var p = 0; p < PRESETS.length; p++) {   // presets before columns
      if (rest.indexOf(PRESETS[p]) === 0) {
        pushText_(out, presetValue_(PRESETS[p], fullName), null, true);
        i += 1 + PRESETS[p].length;
        matched = true;
        break;
      }
    }
    if (matched) continue;

    var letters = (rest.match(/^[A-Z]+/) || [""])[0];
    while (letters.length) {            // longest run that is a real column
      var index = columnIndexFromLetters_(letters);
      if (index >= FIRST_TEMPLATE_COL && index <= lastColumn) {
        pushText_(out, values[index - 1], null, true);
        i += 1 + letters.length;
        matched = true;
        break;
      }
      letters = letters.substring(0, letters.length - 1);
    }
    if (matched) continue;

    pushText_(out, "\\", null, false);  // unknown token: leave it alone
    i += 1;
  }

  return out;
}

/** The announcement's tokens: only \n and the escapes, since it has no student yet. */
function expandEscapes_(chars) {
  var out = [];
  for (var i = 0; i < chars.length; i++) {
    var ch = chars[i];
    var next = i + 1 < chars.length ? chars[i + 1] : null;
    if (ch.c === "\\" && !ch.literal && next) {
      if (next.c === "n") {
        out.push({ c: "\n", base: ch.base, literal: false });
        i += 1;
        continue;
      }
      if (ESCAPABLE.indexOf(next.c) > -1) {
        out.push({ c: next.c, base: next.base, literal: true });
        i += 1;
        continue;
      }
    }
    out.push(ch);
  }
  return out;
}


/* ---------- inline markers -> a RichTextValue ---------- */

var MARKERS = [["**", "bold"], ["~~", "strike"], ["__", "underline"], ["*", "italic"]];
var NO_STYLE = { bold: false, italic: false, underline: false, strike: false, link: null };

/*
 * A literal character the page would otherwise parse at render time (a
 * heading #, a quote >, `code`, a [link]) travels as a private-use stand-in
 * and becomes an HTML entity at the very end. Only on the way to HTML: a
 * cell must never hold one.
 */
var PROTECTED = { "#": "", ">": "", "`": "", "[": "" };
var RESTORED = { "": "&#35;", "": "&gt;", "": "&#96;", "": "&#91;" };

function markerAt_(chars, i) {
  for (var m = 0; m < MARKERS.length; m++) {
    var marker = MARKERS[m][0];
    var fits = true;
    for (var k = 0; k < marker.length; k++) {
      var ch = chars[i + k];
      if (!ch || ch.literal || ch.c !== marker.charAt(k)) { fits = false; break; }
    }
    if (fits) return { style: MARKERS[m][1], length: marker.length };
  }
  return null;
}

/**
 * Split into markers, links and plain characters. A marker left without a
 * partner is turned back into plain characters, so "2*3 = 6" prints as
 * written instead of italicizing the rest of the cell.
 */
function tokenizeMarkers_(chars) {
  var text = charsText_(chars);
  var tokens = [];
  var i = 0;

  while (i < chars.length) {
    var marker = markerAt_(chars, i);
    if (marker) {
      tokens.push({ kind: "marker", style: marker.style, at: i, length: marker.length });
      i += marker.length;
      continue;
    }

    // [label](url), but not ![alt](url) which stays for the page to render
    if (text.charAt(i) === "[" && !chars[i].literal && text.charAt(i - 1) !== "!") {
      var link = text.substring(i).match(/^\[([^\]]*)\]\(([^)\s]+)\)/);
      if (link) {
        tokens.push({
          kind: "link",
          label: chars.slice(i + 1, i + 1 + link[1].length),
          url: link[2]
        });
        i += link[0].length;
        continue;
      }
    }

    tokens.push({ kind: "char", ch: chars[i] });
    i += 1;
  }

  for (var m = 0; m < MARKERS.length; m++) {
    var style = MARKERS[m][1];
    var last = -1;
    var count = 0;
    for (var t = 0; t < tokens.length; t++) {
      if (tokens[t].kind === "marker" && tokens[t].style === style) { last = t; count++; }
    }
    if (count % 2 === 1) {
      var lonely = tokens[last];
      var plain = [];
      for (var k = 0; k < lonely.length; k++) plain.push({ kind: "char", ch: chars[lonely.at + k] });
      tokens.splice.apply(tokens, [last, 1].concat(plain));
    }
  }
  return tokens;
}

/**
 * Walk the tokens once, toggling style flags at each marker. Nesting works
 * because the flags are independent. Formatting the cell already had is
 * kept and combined with the markers.
 */
function buildRichText_(chars, forHtml) {
  var tokens = tokenizeMarkers_(chars);
  var plain = "";
  var spans = [];
  var state = { bold: false, italic: false, underline: false, strike: false };

  function push(ch, link) {
    var base = ch.base || NO_STYLE;
    var c = forHtml && ch.literal && PROTECTED[ch.c] ? PROTECTED[ch.c] : ch.c;
    spans.push({
      start: plain.length, end: plain.length + c.length,
      bold: state.bold || base.bold, italic: state.italic || base.italic,
      underline: state.underline || base.underline, strike: state.strike || base.strike,
      link: link || base.link || null
    });
    plain += c;
  }

  for (var t = 0; t < tokens.length; t++) {
    var token = tokens[t];
    if (token.kind === "marker") {
      state[token.style] = !state[token.style];
    } else if (token.kind === "link") {
      for (var k = 0; k < token.label.length; k++) push(token.label[k], token.url);
    } else {
      push(token.ch, null);
    }
  }

  var builder = SpreadsheetApp.newRichTextValue().setText(plain);
  if (!plain.length) return builder.build();

  // Merge neighbouring characters that share a style into one run.
  var runStart = 0;
  for (var s = 1; s <= spans.length; s++) {
    if (s < spans.length && sameStyle_(spans[s], spans[runStart])) continue;
    applyStyle_(builder, spans[runStart], spans[runStart].start, spans[s - 1].end);
    runStart = s;
  }
  return builder.build();
}

function sameStyle_(a, b) {
  return a.bold === b.bold && a.italic === b.italic &&
    a.underline === b.underline && a.strike === b.strike && a.link === b.link;
}

function applyStyle_(builder, style, start, end) {
  if (end <= start) return;
  builder.setTextStyle(start, end, SpreadsheetApp.newTextStyle()
    .setBold(style.bold)
    .setItalic(style.italic)
    .setUnderline(style.underline)
    .setStrikethrough(style.strike)
    .build());
  if (style.link) builder.setLinkUrl(start, end, style.link);
}


/** The personal message, expanded on the fly if the cell was never run. */
function renderMessage_(sheet, row) {
  var cell = sheet.getRange(row, MESSAGE_COL);
  var rich = cell.getRichTextValues()[0][0];
  var text = rich ? rich.getText() : "";
  if (!text) return "";

  if (hasTemplateMarkup_(text)) {
    var lastColumn = sheet.getLastColumn();
    var values = sheet.getRange(row, 1, 1, lastColumn).getDisplayValues()[0];
    if (!isOutputOf_(text, cell.getNote(), values, lastColumn)) {
      rich = buildRichText_(expandTokens_(text, values, lastColumn), true);
    }
  }
  return richToHtml_(rich);
}

/**
 * Whether a cell is exactly what its saved template expands to. Output can
 * hold literal markers — a \* in the template, a ** in a student's answer —
 * and re-reading those as markdown would mangle a finished message.
 */
function isOutputOf_(text, note, values, lastColumn) {
  if (!note) return false;
  return buildRichText_(expandTokens_(note, values, lastColumn), false).getText() === text;
}


/* ======================================================================
 * Rich text -> HTML
 *
 * Cell formatting (bold, italic, underline, strikethrough, links) comes
 * from the rich text runs. Headings, blockquotes, `code` and images cannot
 * be stored in a cell, so they stay as written and are parsed here.
 * ==================================================================== */

function escapeHtml_(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Only ever emit links a coach could have meant; never javascript: URLs. */
function safeUrl_(url) {
  return /^(https?:|mailto:)/i.test(url) ? escapeHtml_(url) : "";
}

function runToHtml_(run) {
  var text = escapeHtml_(run.getText());
  if (!text) return "";

  var style = run.getTextStyle();
  if (style.isBold()) text = "<b>" + text + "</b>";
  if (style.isItalic()) text = "<i>" + text + "</i>";
  if (style.isUnderline()) text = "<u>" + text + "</u>";
  if (style.isStrikethrough()) text = "<s>" + text + "</s>";

  var link = safeUrl_(run.getLinkUrl() || "");
  if (link) text = '<a href="' + link + '" rel="noopener">' + text + "</a>";
  return text;
}

/** Inline constructs a cell cannot hold, resolved at render time. */
function inlineLater_(html) {
  return html
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, function (whole, alt, url) {
      var src = safeUrl_(url);
      return src ? '<img src="' + src + '" alt="' + alt + '" loading="lazy">' : whole;
    })
    .replace(/\[([^\]]*)\]\(([^)\s]+)\)/g, function (whole, label, url) {
      var href = safeUrl_(url);
      return href ? '<a href="' + href + '" rel="noopener">' + label + "</a>" : whole;
    });
}

function blocksToHtml_(inline) {
  var lines = inline.split(/\r\n|\r|\n/);
  var html = "";
  var paragraph = [];
  var quote = [];

  function flushParagraph() {
    if (paragraph.length) html += "<p>" + paragraph.join("<br>") + "</p>";
    paragraph = [];
  }
  function flushQuote() {
    if (quote.length) html += "<blockquote>" + quote.join("<br>") + "</blockquote>";
    quote = [];
  }

  for (var i = 0; i < lines.length; i++) {
    var line = inlineLater_(lines[i]);

    var heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flushParagraph();
      flushQuote();
      // The page already owns <h1>; a coach's "#" starts at <h3>.
      var level = Math.min(heading[1].length + 2, 6);
      html += "<h" + level + ">" + heading[2] + "</h" + level + ">";
      continue;
    }

    var quoted = line.match(/^&gt;\s?(.*)$/);
    if (quoted) {
      flushParagraph();
      quote.push(quoted[1]);
      continue;
    }
    flushQuote();

    if (!line.trim()) {
      flushParagraph();
      continue;
    }
    paragraph.push(line);
  }

  flushParagraph();
  flushQuote();
  return html;
}

function richToHtml_(rich) {
  if (!rich) return "";
  var runs = rich.getRuns();
  var inline = "";
  for (var i = 0; i < runs.length; i++) inline += runToHtml_(runs[i]);
  return blocksToHtml_(inline).replace(/[-]/g, function (c) { return RESTORED[c]; });
}


/* ======================================================================
 * The day announcement, and the questions inside it
 *
 * C1 is markdown like a column D template — **bold**, \n, # headings and
 * the rest — minus the name tokens, since nobody has given an ID yet.
 *
 * It may also ask the room something. A coach writes an <input> tag where
 * the question should appear:
 *
 *   <input type="number" data-label="Your guess" min="0" max="6767" step="any" data-col="K" required>
 *
 * The tag is never inserted as HTML. It is read as a small declaration,
 * and the page builds a real, labelled control in its place. Types:
 *
 *   text, textarea   minlength, maxlength, placeholder, value
 *   number           min, max, step (default 1, or "any"), placeholder, value
 *   color            value
 *   radio, select    options="'Yes', 'No', *'Maybe'"   (* marks the default;
 *                    quotes optional; \' and \, escape inside an option)
 *   rating           min (default 1), max (default 5), data-low, data-high
 *   checkbox         option-k="Wed" option-l="Thu" option-l-checked,
 *                    one checkbox per column; or data-col for a single box
 *
 * Every type takes data-label (the question), data-col (the column its
 * answer is written to, G or later), required, and data-only="123|456"
 * to show it only to those student IDs.
 *
 * A malformed tag is built as well as it can be and never stops the page.
 * The cell turns red, and "Check code and announcement" says why.
 * ==================================================================== */

var FIELD_TYPES = ["text", "textarea", "number", "color", "radio", "select", "checkbox", "rating"];
var COMMON_ATTRS = ["type", "data-label", "data-col", "data-only", "required"];
var TYPE_ATTRS = {
  text: ["minlength", "maxlength", "placeholder", "value"],
  textarea: ["minlength", "maxlength", "placeholder", "value"],
  number: ["min", "max", "step", "placeholder", "value"],
  color: ["value"],
  radio: ["options"],
  select: ["options"],
  checkbox: ["checked"],
  rating: ["min", "max", "data-low", "data-high"]
};
var TEXT_LIMIT = 2000;     // longest text answer accepted
var RATING_STEPS = 11;     // 0 to 10 is the widest scale that fits a phone

/**
 * C1 as HTML, with an empty slot where each question goes, plus the
 * questions themselves.
 */
function readAnnouncement_(sheet) {
  var chars = charsFromRich_(sheet.getRange(ANNOUNCEMENT_CELL).getRichTextValue());
  var text = charsText_(chars);
  var tags = findInputTags_(text);

  var html = "";
  var fields = [];
  var from = 0;
  for (var t = 0; t < tags.length; t++) {
    html += segmentToHtml_(chars.slice(from, tags[t].start));
    fields.push(fieldFromTag_(tags[t], t));
    html += '<div class="ask" data-field="' + t + '"></div>';
    from = tags[t].end;
  }
  html += segmentToHtml_(chars.slice(from));

  return { html: html, fields: fields, text: text, tags: tags };
}

function segmentToHtml_(chars) {
  return richToHtml_(buildRichText_(expandEscapes_(chars), true));
}

function problem_(level, text) {
  return { level: level, text: text };
}

function findAttr_(attrs, name) {
  for (var i = 0; i < attrs.length; i++) if (attrs[i].name === name) return attrs[i];
  return null;
}

function unescape_(text) {
  return String(text).replace(/\\([\s\S])/g, "$1");
}


/* ---------- reading the tags ---------- */

function findInputTags_(text) {
  var tags = [];
  var pattern = /<input\b/gi;
  var match;
  while ((match = pattern.exec(text))) {
    if (escapedAt_(text, match.index)) continue; // \<input is shown as text
    var tag = readTag_(text, match.index);
    tags.push(tag);
    pattern.lastIndex = tag.end;
  }
  return tags;
}

function escapedAt_(text, index) {
  var count = 0;
  while (index - count - 1 >= 0 && text.charAt(index - count - 1) === "\\") count++;
  return count % 2 === 1;
}

/**
 * A tag lives on one line. Forgiving on purpose: a tag with no ">" before
 * the end of its line ends there, and a quote left open ends with it, so a
 * single typo cannot swallow the rest of the announcement.
 */
function readTag_(text, start) {
  var lineEnd = text.indexOf("\n", start);
  var tag = readAttributes_(text, start + 6, lineEnd < 0 ? text.length : lineEnd);
  if (!tag.closed) tag.problems.unshift(problem_("error", "is missing its closing >"));
  tag.start = start;
  return tag;
}

function readAttributes_(text, pos, limit) {
  var attrs = [];
  var problems = [];

  while (pos < limit) {
    var ch = text.charAt(pos);
    if (/\s/.test(ch) || ch === "/") { pos += 1; continue; }
    if (ch === ">") return { attrs: attrs, problems: problems, end: pos + 1, closed: true };

    var nameMatch = /^[^\s=>\/"']+/.exec(text.substring(pos, limit));
    if (!nameMatch) {
      problems.push(problem_("error", "has a stray " + ch));
      pos += 1;
      continue;
    }
    var name = nameMatch[0].toLowerCase();
    pos += nameMatch[0].length;

    var value = "";
    var p = pos;
    while (p < limit && /[ \t]/.test(text.charAt(p))) p += 1;
    if (text.charAt(p) === "=") {
      p += 1;
      while (p < limit && /[ \t]/.test(text.charAt(p))) p += 1;
      var quote = text.charAt(p);
      if (quote === '"' || quote === "'") {
        var q = p + 1;
        var closed = false;
        while (q < limit) {
          var c = text.charAt(q);
          if (c === "\\") { q += 2; continue; } // kept raw; options are split later
          if (c === quote) { closed = true; break; }
          if (c === "\n") break;
          q += 1;
        }
        q = Math.min(q, limit);
        value = text.substring(p + 1, q);
        pos = closed ? q + 1 : q;
        if (!closed) problems.push(problem_("error", "has a " + quote + " that never closes in " + name));
      } else {
        var bare = /^[^\s>]*/.exec(text.substring(p, limit))[0];
        value = bare;
        pos = p + bare.length;
      }
    }

    if (findAttr_(attrs, name)) {
      problems.push(problem_("warning", "has " + name + " twice; the first one is used"));
    } else {
      attrs.push({ name: name, value: value });
    }
  }
  return { attrs: attrs, problems: problems, end: limit, closed: false };
}

/**
 * Split options="'Yes', 'No', *'Maybe'". Quotes are optional; inside an
 * option a backslash escapes the next character, so 'Don\'t know' and
 * Red\, white work.
 */
function parseOptions_(raw, problems) {
  var options = [];
  var i = 0;

  function skipSpace() { while (i < raw.length && /\s/.test(raw.charAt(i))) i += 1; }

  while (i < raw.length) {
    skipSpace();
    if (i >= raw.length) break;

    var selected = false;
    if (raw.charAt(i) === "*") { selected = true; i += 1; skipSpace(); }

    var label = "";
    var quote = raw.charAt(i);
    if (quote === "'" || quote === '"') {
      i += 1;
      var closed = false;
      while (i < raw.length) {
        var c = raw.charAt(i);
        if (c === "\\" && i + 1 < raw.length) { label += raw.charAt(i + 1); i += 2; continue; }
        if (c === quote) { closed = true; i += 1; break; }
        label += c;
        i += 1;
      }
      if (!closed) problems.push(problem_("error", "has an option whose " + quote + " never closes"));
      skipSpace();
      if (i < raw.length && raw.charAt(i) !== ",") {
        problems.push(problem_("error", "has text after the option \"" + label + "\"; separate options with commas"));
        while (i < raw.length && raw.charAt(i) !== ",") i += 1;
      }
    } else {
      while (i < raw.length && raw.charAt(i) !== ",") {
        var d = raw.charAt(i);
        if (d === "\\" && i + 1 < raw.length) { label += raw.charAt(i + 1); i += 2; continue; }
        label += d;
        i += 1;
      }
      label = label.trim();
    }
    i += 1; // the comma

    if (!label) {
      problems.push(problem_("warning", "has an empty option, which is left out"));
      continue;
    }
    if (options.some(function (o) { return o.label === label; })) {
      problems.push(problem_("warning", "lists \"" + label + "\" twice; it is shown once"));
      continue;
    }
    options.push({ label: label, selected: selected });
  }
  return options;
}

function readColumn_(raw, problems, what) {
  var source = String(raw === null || raw === undefined ? "" : raw).trim();
  var letters = source.replace(/^\\/, "").toUpperCase(); // "\K" means K too
  if (!letters) {
    problems.push(problem_("error", "has no " + what + ", so its answers are not saved"));
    return null;
  }
  if (!/^[A-Z]{1,3}$/.test(letters)) {
    problems.push(problem_("error", "has " + what + "=\"" + source + "\", which is not a column"));
    return null;
  }
  if (columnIndexFromLetters_(letters) < FIRST_TEMPLATE_COL) {
    problems.push(problem_("error", "writes to column " + letters +
      ", but A–F belong to check-in itself; its answers are not saved"));
    return null;
  }
  return letters;
}

function readNumber_(raw, name, problems) {
  if (raw === null || String(raw).trim() === "") return null;
  var n = Number(raw);
  if (!isFinite(n)) {
    problems.push(problem_("error", "has " + name + "=\"" + raw + "\", which is not a number; it is ignored"));
    return null;
  }
  return n;
}

function readCount_(raw, name, problems) {
  var n = readNumber_(raw, name, problems);
  if (n !== null && (n < 0 || n !== Math.floor(n))) {
    problems.push(problem_("error", "has " + name + "=\"" + raw + "\"; it must be a whole number"));
    return null;
  }
  return n;
}

/** One tag -> one question. Never throws: every problem is recorded and skipped. */
function fieldFromTag_(tag, index) {
  var problems = tag.problems.slice();
  function has(name) { return !!findAttr_(tag.attrs, name); }
  function attr(name) {
    var found = findAttr_(tag.attrs, name);
    return found ? unescape_(found.value) : null;
  }

  var rawType = (attr("type") || "text").trim().toLowerCase();
  var type = rawType === "dropdown" ? "select" : rawType;
  if (FIELD_TYPES.indexOf(type) < 0) {
    problems.push(problem_("error", "has type=\"" + rawType + "\", which is not supported; it is shown as a text box"));
    type = "text";
  }

  var field = {
    i: index,
    type: type,
    label: (attr("data-label") || "").trim(),
    required: has("required"),
    col: null,
    only: null,
    problems: problems
  };

  if (has("data-only")) {
    field.only = String(attr("data-only")).split(/[|,\s]+/).map(digitsOnly_)
      .filter(function (id) { return id; });
    if (!field.only.length) {
      problems.push(problem_("error", "has a data-only with no IDs in it, so nobody sees it"));
    }
  }

  if (type === "checkbox") {
    readCheckboxes_(field, tag, attr, has);
  } else {
    field.col = readColumn_(attr("data-col"), problems, "data-col");
    if (!field.label) {
      problems.push(problem_("error", "has no data-label, so the question has no name; it is shown as \"Answer\""));
      field.label = "Answer";
    }
  }

  if (type === "text" || type === "textarea") {
    field.minlength = readCount_(attr("minlength"), "minlength", problems);
    field.maxlength = readCount_(attr("maxlength"), "maxlength", problems);
    if (field.maxlength === null || field.maxlength > TEXT_LIMIT) {
      if (field.maxlength > TEXT_LIMIT) {
        problems.push(problem_("warning", "has a maxlength over " + TEXT_LIMIT + "; it is capped there"));
      }
      field.maxlength = TEXT_LIMIT;
    }
    if (field.minlength !== null && field.minlength > field.maxlength) {
      problems.push(problem_("error", "has minlength above maxlength, so no answer fits; minlength is ignored"));
      field.minlength = null;
    }
    field.placeholder = attr("placeholder") || "";
    field.value = attr("value") || "";
  }

  if (type === "number") {
    field.min = readNumber_(attr("min"), "min", problems);
    field.max = readNumber_(attr("max"), "max", problems);
    var step = attr("step");
    if (step !== null && step.trim().toLowerCase() === "any") {
      field.step = null;
    } else {
      field.step = readNumber_(step, "step", problems);
      if (field.step !== null && field.step <= 0) {
        problems.push(problem_("error", "has a step that is not above 0; any number is accepted"));
        field.step = null;
      } else if (field.step === null) {
        field.step = 1; // as in HTML: whole numbers unless step says otherwise
      }
    }
    if (field.min !== null && field.max !== null && field.min > field.max) {
      problems.push(problem_("error", "has min above max, so no number fits; both are ignored"));
      field.min = field.max = null;
    }
    field.placeholder = attr("placeholder") || "";
    field.value = attr("value") || "";
  }

  if (type === "color") {
    field.value = (attr("value") || "#000000").trim().toLowerCase();
    if (!/^#[0-9a-f]{6}$/.test(field.value)) {
      problems.push(problem_("error", "has a value that is not a colour like #1a2b3c; black is used"));
      field.value = "#000000";
    }
  }

  if (type === "radio" || type === "select") {
    field.options = parseOptions_(found_(tag, "options"), problems);
    if (!field.options.length) {
      problems.push(problem_("error", "has no options to choose from"));
    }
    var defaults = field.options.filter(function (o) { return o.selected; });
    if (defaults.length > 1) {
      problems.push(problem_("warning", "marks more than one option with *; only the first is chosen"));
      for (var d = 1; d < defaults.length; d++) defaults[d].selected = false;
    }
  }

  if (type === "rating") {
    var low = readCount_(attr("min"), "min", problems);
    var high = readCount_(attr("max"), "max", problems);
    field.min = low === null ? 1 : low;
    field.max = high === null ? Math.max(5, field.min + 1) : high;
    var steps = field.max - field.min + 1;
    if (steps < 2 || steps > RATING_STEPS) {
      problems.push(problem_("error", "has a scale of " + steps + " steps; it must be 2 to " +
        RATING_STEPS + ", so 1 to 5 is used"));
      field.min = 1;
      field.max = 5;
    }
    field.low = attr("data-low") || "";
    field.high = attr("data-high") || "";
  }

  var allowed = COMMON_ATTRS.concat(TYPE_ATTRS[type]);
  tag.attrs.forEach(function (a) {
    if (allowed.indexOf(a.name) > -1) return;
    if (type === "checkbox" && /^option-[a-z]+(-checked)?$/.test(a.name)) return;
    problems.push(problem_("warning", "ignores " + a.name + ", which a " + type + " question does not use"));
  });

  return field;
}

/** Raw, still-escaped value: the options splitter handles its own backslashes. */
function found_(tag, name) {
  var a = findAttr_(tag.attrs, name);
  return a ? a.value : "";
}

function readCheckboxes_(field, tag, attr, has) {
  var problems = field.problems;
  field.checks = [];

  tag.attrs.forEach(function (a) {
    var match = /^option-([a-z]+)$/.exec(a.name);
    if (!match) return;
    var col = readColumn_(match[1], problems, a.name);
    if (!col) return;
    var label = unescape_(a.value).trim();
    if (!label) {
      problems.push(problem_("error", "has an empty " + a.name + "; it is shown as \"" + col + "\""));
      label = col;
    }
    field.checks.push({ col: col, label: label, checked: has("option-" + match[1] + "-checked") });
  });

  tag.attrs.forEach(function (a) {
    var match = /^option-([a-z]+)-checked$/.exec(a.name);
    if (match && !has("option-" + match[1])) {
      problems.push(problem_("warning", "has " + a.name + " but no option-" + match[1]));
    }
  });

  if (field.checks.length) {
    field.single = false;
    if (has("data-col")) problems.push(problem_("warning", "ignores data-col, because each option-… names its own column"));
    if (has("checked")) problems.push(problem_("warning", "ignores checked; use option-…-checked"));
    if (!field.label) problems.push(problem_("warning", "has no data-label, so the boxes have no question above them"));
    return;
  }

  // No option-… at all: one box, labelled by data-label, written to data-col.
  field.single = true;
  var single = readColumn_(attr("data-col"), problems, "data-col or option-…");
  if (!field.label) {
    problems.push(problem_("error", "has no data-label, so the box has no name; it is shown as \"Yes\""));
    field.label = "Yes";
  }
  if (single) field.checks.push({ col: single, label: field.label, checked: has("checked") });
}

/** What the page needs to build a question: no problems, no ID list. */
function publicField_(field) {
  var out = {};
  for (var key in field) {
    if (key !== "problems" && key !== "only") out[key] = field[key];
  }
  return out;
}

function columnsOf_(field) {
  if (field.type === "checkbox") return field.checks.map(function (c) { return c.col; });
  return field.col ? [field.col] : [];
}


/* ---------- answers ---------- */

function stepFits_(n, step, base) {
  if (step === null || step === undefined) return true;
  var q = (n - (base === null || base === undefined ? 0 : base)) / step;
  return Math.abs(q - Math.round(q)) < 1e-9 * Math.max(1, Math.abs(q));
}

/**
 * Every write the answers call for, or null if any answer is missing or
 * out of bounds. Questions not meant for this ID are skipped entirely.
 */
function planAnswers_(fields, id, answers) {
  answers = answers && typeof answers === "object" ? answers : {};
  var writes = [];
  for (var f = 0; f < fields.length; f++) {
    var field = fields[f];
    if (field.only && field.only.indexOf(id) < 0) continue;
    var planned = answerWrites_(field, answers);
    if (!planned) return null;
    writes = writes.concat(planned);
  }
  return writes;
}

function answerWrites_(field, answers) {
  if (field.type === "checkbox") {
    var any = false;
    var boxes = field.checks.map(function (check) {
      var on = answers[check.col] === true;
      any = any || on;
      return { col: check.col, value: on, kind: "checkbox" };
    });
    return field.required && field.checks.length && !any ? null : boxes;
  }

  if (!field.col) return []; // nowhere to write it; the check says so
  var raw = answers[field.col];
  var given = raw === null || raw === undefined ? "" : String(raw);
  var text = given.trim();

  if (!text) {
    return field.required ? null : [{ col: field.col, value: "", kind: "text" }];
  }

  var n = Number(text);
  switch (field.type) {
    case "number":
      if (!isFinite(n)) return null;
      if (field.min !== null && n < field.min) return null;
      if (field.max !== null && n > field.max) return null;
      if (!stepFits_(n, field.step, field.min)) return null;
      return [{ col: field.col, value: n, kind: "number" }];

    case "rating":
      if (n !== Math.floor(n) || n < field.min || n > field.max) return null;
      return [{ col: field.col, value: n, kind: "number" }];

    case "radio":
    case "select":
      var known = field.options.some(function (o) { return o.label === given; });
      return known ? [{ col: field.col, value: given, kind: "text" }] : null;

    case "color":
      if (!/^#[0-9a-f]{6}$/i.test(text)) return null;
      return [{ col: field.col, value: text.toLowerCase(), kind: "color" }];

    default: // text, textarea
      if (field.minlength && text.length < field.minlength) return null;
      if (text.length > field.maxlength) return null;
      return [{ col: field.col, value: text, kind: "text" }];
  }
}

function shownAs_(write) {
  if (write.kind === "checkbox") return write.value ? "TRUE" : "FALSE";
  return String(write.value);
}

/**
 * One read of the row's values and notes, one write per answer, one write
 * of the notes. As with E and F, a changed answer is kept in the cell's note.
 */
function writeAnswers_(sheet, row, writes, stamp) {
  if (!writes.length) return;

  var indexes = writes.map(function (w) { return columnIndexFromLetters_(w.col); });
  var first = Math.min.apply(null, indexes);
  var last = Math.max.apply(null, indexes);

  var maxColumns = sheet.getMaxColumns();
  if (last > maxColumns) sheet.insertColumnsAfter(maxColumns, last - maxColumns);

  var span = sheet.getRange(row, first, 1, last - first + 1);
  var shown = span.getDisplayValues()[0];
  var notes = span.getNotes()[0];
  var notesChanged = false;

  for (var k = 0; k < writes.length; k++) {
    var write = writes[k];
    var offset = indexes[k] - first;
    var previous = shown[offset];
    var worthKeeping = write.kind === "checkbox" ? previous === "TRUE" : !!previous;

    if (worthKeeping && previous !== shownAs_(write)) {
      var entry = (stamp ? stamp + " - " : "") + previous;
      notes[offset] = notes[offset] ? notes[offset] + "\n" + entry : entry;
      notesChanged = true;
    }

    var cell = sheet.getRange(row, indexes[k]);
    if (write.kind === "checkbox") {
      ensureCheckbox_(cell);
      cell.setValue(write.value);
    } else if (write.kind === "number") {
      cell.setValue(write.value);
    } else {
      cell.setValue(asText_(write.value));
      if (write.kind === "color") cell.setBackground(write.value);
    }
  }

  if (notesChanged) span.setNotes([notes]);
}

function ensureCheckbox_(cell) {
  var rule = cell.getDataValidation();
  var isBox = rule && rule.getCriteriaType() === SpreadsheetApp.DataValidationCriteria.CHECKBOX;
  if (!isBox) cell.insertCheckboxes();
}

/** "K: 412 · L: TRUE" for the Log, so re-submissions stay on record. */
function summarizeWrites_(writes) {
  return writes.map(function (w) { return w.col + ": " + shownAs_(w); }).join(" · ");
}


/* ======================================================================
 * Checking the code and the announcement
 * ==================================================================== */

/** Problems with B1 as students will meet them: a code they cannot type. */
function codeProblems_(raw) {
  var shown = String(raw === null || raw === undefined ? "" : raw).trim();
  if (!shown) return [problem_("error", "B1 is empty, so nobody can check in. Use New code only.")];

  var problems = [];
  var untypable = [];
  var upper = shown.toUpperCase();
  for (var i = 0; i < upper.length; i++) {
    var c = upper.charAt(i);
    if (/[\s\-]/.test(c) || TYPABLE.indexOf(c) > -1 || "ILO".indexOf(c) > -1) continue;
    if (untypable.indexOf(c) < 0) untypable.push(c);
  }
  if (untypable.length) {
    problems.push(problem_("error", "B1 contains " + untypable.join(" ") +
      ", which the code boxes will not accept."));
  }

  var typed = normalizeCode_(shown);
  if (typed.length !== CODE_LENGTH) {
    problems.push(problem_("error", "B1 comes to " + typed.length + " typable characters (" +
      (typed || "none") + "), but the page has exactly " + CODE_LENGTH + " boxes."));
  }
  return problems;
}

function rosterIds_(sheet) {
  var ids = {};
  var lastRow = sheet.getLastRow();
  if (lastRow < FIRST_STUDENT_ROW) return ids;
  sheet.getRange(FIRST_STUDENT_ROW, 2, lastRow - FIRST_STUDENT_ROW + 1, 1)
    .getDisplayValues()
    .forEach(function (row) { var id = digitsOnly_(row[0]); if (id) ids[id] = true; });
  return ids;
}

/** Everything wrong with B1 and C1, plus what each question will do. */
function dashboardReport_(sheet) {
  var code = sheet.getRange(CODE_CELL).getDisplayValue();
  var announcement = readAnnouncement_(sheet);
  var fields = announcement.fields;
  var text = announcement.text;
  var general = [];

  // Two questions writing to one column would overwrite each other.
  var owners = {};
  fields.forEach(function (field) {
    columnsOf_(field).forEach(function (col) {
      (owners[col] = owners[col] || []).push(field.i + 1);
    });
  });
  Object.keys(owners).sort().forEach(function (col) {
    var users = owners[col].filter(function (n, k, all) { return all.indexOf(n) === k; });
    if (owners[col].length > 1) {
      general.push(problem_("error", "Column " + col + " is written by " +
        (users.length > 1 ? "questions " + users.slice(0, -1).join(", ") + " and " + users[users.length - 1]
          : "question " + users[0] + " twice") +
        "; the last answer wins."));
    }
  });

  var roster = null;
  fields.forEach(function (field) {
    if (!field.only || !field.only.length) return;
    roster = roster || rosterIds_(sheet);
    var missing = field.only.filter(function (id) { return !roster[id]; });
    if (missing.length) {
      field.problems.push(problem_("error", "has data-only " + missing.join(", ") + ", " +
        (missing.length === 1 ? "which is" : "which are") + " not an ID in column B"));
    }
  });

  announcement.tags.forEach(function (tag, n) {
    if (/[“”‘’]/.test(text.substring(tag.start, tag.end))) {
      fields[n].problems.push(problem_("warning", "uses curly quotes; type straight \" or ' instead"));
    }
  });

  var others = {};
  var tagPattern = /<\/?([a-z][a-z0-9]*)\b/gi;
  var match;
  while ((match = tagPattern.exec(text))) {
    var name = match[1].toLowerCase();
    if (name !== "input" && !escapedAt_(text, match.index)) others[name] = true;
  }
  Object.keys(others).forEach(function (name) {
    general.push(problem_("warning", "<" + name + "> is shown as plain text; only <input> tags become questions."));
  });

  return {
    codeShown: code,
    code: codeProblems_(code),
    fields: fields,
    general: general,
    announcementHasErrors: general.concat.apply(general, fields.map(function (f) { return f.problems; }))
      .some(function (p) { return p.level === "error"; })
  };
}

function flag_(range, on) {
  var current = String(range.getBackground()).toLowerCase();
  if (on && current !== PROBLEM_FILL) range.setBackground(PROBLEM_FILL);
  if (!on && current === PROBLEM_FILL) range.setBackground(null);
}

function markProblems_(sheet, report) {
  flag_(sheet.getRange(CODE_CELL), report.code.some(function (p) { return p.level === "error"; }));
  flag_(sheet.getRange(ANNOUNCEMENT_CELL), report.announcementHasErrors);
}

function describeField_(field, headers) {
  var parts = [field.type];
  if (field.type === "number") {
    if (field.min !== null && field.max !== null) parts.push(field.min + " to " + field.max);
    else if (field.min !== null) parts.push("at least " + field.min);
    else if (field.max !== null) parts.push("at most " + field.max);
    parts.push(field.step === null ? "any decimal" : field.step === 1 ? "whole numbers" : "steps of " + field.step);
  }
  if (field.type === "text" || field.type === "textarea") {
    parts.push((field.minlength ? field.minlength + " to " : "up to ") + field.maxlength + " characters");
  }
  if (field.type === "radio" || field.type === "select") {
    parts.push(field.options.map(function (o) { return (o.selected ? "*" : "") + o.label; }).join(" / "));
  }
  if (field.type === "rating") parts.push(field.min + " to " + field.max);
  if (field.required) parts.push("required");
  if (field.only) parts.push("only for " + field.only.join(", "));

  var where = field.type === "checkbox"
    ? field.checks.map(function (c) { return c.col + " \"" + c.label + "\""; }).join(", ")
    : field.col;
  var heading = field.col && headers[field.col] ? " (headed \"" + headers[field.col] + "\")" : "";

  return (field.i + 1) + ". " + (field.label || "(no label)") + " → " +
    (where || "nowhere") + heading + "\n     " + parts.join(", ");
}

function problemLine_(p) {
  return (p.level === "error" ? "     ✗ " : "     ! ") + p.text;
}

/** Menu: check B1 and C1, turn them red if broken, and say why. */
function checkDashboard() {
  var sheet = SS.getSheetByName(DASHBOARD);
  var report = dashboardReport_(sheet);
  markProblems_(sheet, report);
  prepareCheckboxes_(sheet, report.fields);

  var lastColumn = sheet.getLastColumn();
  var headerRow = lastColumn ? sheet.getRange(HEADER_ROW, 1, 1, lastColumn).getDisplayValues()[0] : [];
  var headers = {};
  headerRow.forEach(function (value, k) { if (value) headers[columnLetter_(k + 1)] = value; });

  var lines = ["DAY CODE (B1)"];
  if (report.code.length) {
    report.code.forEach(function (p) { lines.push(problemLine_(p)); });
  } else {
    lines.push("     ✓ Students type " + normalizeCode_(report.codeShown) + ".");
  }

  lines.push("", "ANNOUNCEMENT (C1)");
  if (!report.fields.length) lines.push("     No questions.");
  report.fields.forEach(function (field) {
    lines.push(describeField_(field, headers));
    field.problems.forEach(function (p) { lines.push(problemLine_(p)); });
  });
  report.general.forEach(function (p) { lines.push(problemLine_(p).replace(/^ {5}/, "")); });

  var clean = !report.code.length && !report.general.length &&
    report.fields.every(function (f) { return !f.problems.length; });
  lines.push("", clean ? "Everything is ready." :
    "✗ stops a question from working as written. ! is worth a look but works.");

  SpreadsheetApp.getUi().alert("Code and announcement", lines.join("\n"),
    SpreadsheetApp.getUi().ButtonSet.OK);
}

/**
 * Put real checkboxes in every blank student cell of a checkbox question's
 * columns, so the sheet reads as a grid of boxes before anyone answers.
 */
function prepareCheckboxes_(sheet, fields) {
  var cols = [];
  fields.forEach(function (field) {
    if (field.type === "checkbox") cols = cols.concat(columnsOf_(field));
  });
  var lastRow = sheet.getLastRow();
  if (!cols.length || lastRow < FIRST_STUDENT_ROW) return;

  var count = lastRow - FIRST_STUDENT_ROW + 1;
  var maxColumns = sheet.getMaxColumns();
  var needed = Math.max.apply(null, cols.map(columnIndexFromLetters_));
  if (needed > maxColumns) sheet.insertColumnsAfter(maxColumns, needed - maxColumns);

  var ids = sheet.getRange(FIRST_STUDENT_ROW, 2, count, 1).getDisplayValues();
  var cells = [];
  cols.forEach(function (col) {
    var values = sheet.getRange(col + FIRST_STUDENT_ROW + ":" + col + lastRow).getDisplayValues();
    for (var r = 0; r < count; r++) {
      var v = values[r][0];
      if (digitsOnly_(ids[r][0]) && (v === "" || v === "TRUE" || v === "FALSE")) {
        cells.push(col + (FIRST_STUDENT_ROW + r));
      }
    }
  });
  if (cells.length) sheet.getRangeList(cells).insertCheckboxes();
}

/** Menu: empty the columns C1's questions write to, notes and colours too. */
function clearAnswers() {
  var sheet = SS.getSheetByName(DASHBOARD);
  var ui = SpreadsheetApp.getUi();
  var fields = readAnnouncement_(sheet).fields;
  var maxColumns = sheet.getMaxColumns();

  var cols = [];
  var colorCols = [];
  fields.forEach(function (field) {
    columnsOf_(field).forEach(function (col) {
      if (columnIndexFromLetters_(col) > maxColumns || cols.indexOf(col) > -1) return;
      cols.push(col);
      if (field.type === "color") colorCols.push(col);
    });
  });

  if (!cols.length) {
    ui.alert("The announcement in C1 has no questions, so there is nothing to clear.");
    return;
  }
  var answer = ui.alert("Clear announcement answers",
    "This empties column" + (cols.length > 1 ? "s " : " ") + cols.join(", ") +
    " from row " + FIRST_STUDENT_ROW + " down, notes included.", ui.ButtonSet.OK_CANCEL);
  if (answer !== ui.Button.OK) return;

  var lastRow = sheet.getLastRow();
  if (lastRow < FIRST_STUDENT_ROW) return;
  function block(col) { return col + FIRST_STUDENT_ROW + ":" + col + lastRow; }

  var list = sheet.getRangeList(cols.map(block));
  list.clearContent();
  list.clearNote();
  if (colorCols.length) sheet.getRangeList(colorCols.map(block)).setBackground(null);
}


/* ======================================================================
 * Web app entry points
 * ==================================================================== */

/** The public site at mc.uhsmathclub.org/hello. */
function doPost(e) {
  var body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (error) {
    body = {};
  }

  return ContentService.createTextOutput(JSON.stringify(api(body)))
    .setMimeType(ContentService.MimeType.JSON);
}

/** The fallback, for when Pages or DNS is down. */
function doGet() {
  return HtmlService.createTemplateFromFile("MATHCOUNTS")
    .evaluate()
    .setTitle("Rancho MATHCOUNTS 2026–27")
    .addMetaTag("viewport", "width=device-width, initial-scale=1");
}
