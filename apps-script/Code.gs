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
 *               E student response, F leaving-early time
 *   Log         A name, B timestamp, C response.  Append-only.
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
var FIRST_STUDENT_ROW = 3;

var TIMEZONE = "America/Los_Angeles";
var STAMP_FORMAT = "M/d/yyyy h:mm:ss AM/PM";

/** Crockford base-32: no I, L, O (misread as 1, 1, 0) and no U. */
var CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
var CODE_LENGTH = 4;


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
    .addToUi();
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
  }

  rollCode_();
}

/** Re-roll the code mid-meeting without clearing anything. */
function newCodeOnly() {
  rollCode_();
}

function rollCode_() {
  var code = generateCode_();
  SS.getSheetByName(DASHBOARD).getRange(CODE_CELL).setValue(code);
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
    if (CROCKFORD.indexOf(character) > -1) out += character;
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

/** Step 1. Nothing here touches a student record. */
function gate(code) {
  if (!codeIsCorrect_(code)) return { ok: false, error: "code" };
  return {
    ok: true,
    announcement: cellToHtml_(SS.getSheetByName(DASHBOARD).getRange(ANNOUNCEMENT_CELL))
  };
}

/** Step 2. The code is re-checked before the ID is looked at. */
function checkIn(code, id, message, leaving) {
  if (!codeIsCorrect_(code)) return { ok: false, error: "code" };

  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
  } catch (error) {
    return { ok: false, error: "busy" };
  }

  try {
    var sheet = SS.getSheetByName(DASHBOARD);
    var row = findStudentRow_(sheet, id);
    if (!row) return { ok: false, error: "id" };

    var now = new Date();
    var name = sheet.getRange(row, 1).getDisplayValue();
    var response = String(message === null || message === undefined ? "" : message);

    sheet.getRange(row, 1).setFontWeight("bold");
    sheet.getRange(row, 3).setValue(now).setNumberFormat(STAMP_FORMAT);
    sheet.getRange(row, 5).setValue(response);
    sheet.getRange(row, 6).setValue(
      String(leaving === null || leaving === undefined ? "" : leaving)
    );

    // Log!B must be a real Date: the Attendance formulas compare INT() of it
    // against INT() of the date in row 1, and a text timestamp never matches.
    var log = SS.getSheetByName(LOG);
    log.appendRow([name, now, response]);
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
 *
 * Presets are matched before column letters, so \LastName is a preset and
 * not column L followed by "astName". An unknown token is left alone
 * rather than silently deleted.
 *
 * Inline markers become real cell formatting: **bold**, *italic*,
 * __underline__, ~~strike~~, [text](url). Headings, blockquotes, `code`
 * and ![images](url) are left as written and parsed when the page renders
 * them, because a spreadsheet cell cannot express them.
 * ==================================================================== */

var MESSAGE_COL = 4;              // Dashboard column D
var FIRST_TEMPLATE_COL = 7;       // \G is the first column a token may read
var PRESETS = ["FullName", "LegalName", "LastName", "Name"]; // longest first


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

  for (var row = rows.top; row <= rows.bottom; row++) {
    var cell = sheet.getRange(row, MESSAGE_COL);
    var note = cell.getNote();
    if (note) cell.setValue(note);
  }
}

function expandSelection_(saveNote) {
  var sheet = SS.getSheetByName(DASHBOARD);
  var rows = selectedMessageRows_(sheet);
  if (!rows) return;

  var lastColumn = sheet.getLastColumn();

  for (var row = rows.top; row <= rows.bottom; row++) {
    var cell = sheet.getRange(row, MESSAGE_COL);
    var rich = cell.getRichTextValues()[0][0];
    var text = rich ? rich.getText() : "";
    var note = cell.getNote();

    // A cell that still has markers is a fresh edit and wins over the note.
    // Otherwise the note is the template and the cell is last run's output.
    var source = hasTemplateMarkup_(text) ? text : (note || text);
    if (!source) continue;

    if (saveNote) cell.setNote(source);
    cell.setRichTextValue(buildRichText_(expandTokens_(source, sheet, row, lastColumn)));
  }
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
  return /\\[A-Za-z\\]/.test(text) ||
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

/**
 * One left-to-right pass. Everything is resolved in source order so that
 * \\\\Name yields a literal \\Name rather than a substituted name.
 */
function expandTokens_(source, sheet, row, lastColumn) {
  var values = sheet.getRange(row, 1, 1, lastColumn).getDisplayValues()[0];
  var fullName = values[0];
  var out = "";
  var i = 0;

  while (i < source.length) {
    if (source.charAt(i) !== "\\") {
      out += source.charAt(i);
      i += 1;
      continue;
    }

    var rest = source.substring(i + 1);

    if (rest.charAt(0) === "\\") {      // \\ -> a literal backslash
      out += "\\";
      i += 2;
      continue;
    }
    if (rest.charAt(0) === "n") {       // \n -> a line break
      out += "\n";
      i += 2;
      continue;
    }

    var matched = false;

    for (var p = 0; p < PRESETS.length; p++) {   // presets before columns
      if (rest.indexOf(PRESETS[p]) === 0) {
        out += presetValue_(PRESETS[p], fullName);
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
        out += values[index - 1];
        i += 1 + letters.length;
        matched = true;
        break;
      }
      letters = letters.substring(0, letters.length - 1);
    }
    if (matched) continue;

    out += "\\";                        // unknown token: leave it alone
    i += 1;
  }

  return out;
}


/* ---------- inline markers -> a RichTextValue ---------- */

/**
 * Walk the text once, toggling style flags as markers appear. Nesting works
 * because the flags are independent; an unclosed marker simply stays on for
 * the rest of the cell.
 */
function buildRichText_(text) {
  var plain = "";
  var spans = [];
  var state = { bold: false, italic: false, underline: false, strike: false, link: null };
  var i = 0;

  while (i < text.length) {
    var two = text.substr(i, 2);
    if (two === "**") { state.bold = !state.bold; i += 2; continue; }
    if (two === "~~") { state.strike = !state.strike; i += 2; continue; }
    if (two === "__") { state.underline = !state.underline; i += 2; continue; }
    if (text.charAt(i) === "*") { state.italic = !state.italic; i += 1; continue; }

    if (text.charAt(i) === "[") {
      // [label](url), but not ![alt](url) which stays for the page to render
      var link = text.substring(i).match(/^\[([^\]]*)\]\(([^)\s]+)\)/);
      if (link && text.charAt(i - 1) !== "!") {
        var start = plain.length;
        plain += link[1];
        spans.push({
          start: start, end: plain.length,
          bold: state.bold, italic: state.italic,
          underline: state.underline, strike: state.strike,
          link: link[2]
        });
        i += link[0].length;
        continue;
      }
    }

    spans.push({
      start: plain.length, end: plain.length + 1,
      bold: state.bold, italic: state.italic,
      underline: state.underline, strike: state.strike,
      link: state.link
    });
    plain += text.charAt(i);
    i += 1;
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
    rich = buildRichText_(expandTokens_(text, sheet, row, sheet.getLastColumn()));
  }
  return richToHtml_(rich);
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
  return blocksToHtml_(inline);
}

/** Convert one cell, formatting and all. */
function cellToHtml_(range) {
  return richToHtml_(range.getRichTextValues()[0][0]);
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

  var reply;
  if (body.action === "gate") {
    reply = gate(body.code);
  } else if (body.action === "checkin") {
    reply = checkIn(body.code, body.id, body.message, body.leaving);
  } else {
    reply = { ok: false, error: "bad_request" };
  }

  return ContentService.createTextOutput(JSON.stringify(reply))
    .setMimeType(ContentService.MimeType.JSON);
}

/** The fallback, for when Pages or DNS is down. */
function doGet() {
  return HtmlService.createTemplateFromFile("MATHCOUNTS")
    .evaluate()
    .setTitle("Rancho MATHCOUNTS 2026–27")
    .addMetaTag("viewport", "width=device-width, initial-scale=1");
}
