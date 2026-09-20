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
      message: cellToHtml_(sheet.getRange(row, 4))
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
 * Rich text -> HTML
 * ==================================================================== */

function escapeHtml_(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Convert one cell's rich text to HTML, escaping everything a coach typed.
 * Links are allowed only for http, https, and mailto, so a pasted
 * "javascript:" URL cannot become a live link on the public site.
 */
function cellToHtml_(range) {
  var value = range.getRichTextValues()[0][0];
  if (!value) return "";

  var html = value.getRuns().map(function (run) {
    var text = escapeHtml_(run.getText());
    if (!text) return "";

    var style = run.getTextStyle();
    if (style.isBold()) text = "<b>" + text + "</b>";
    if (style.isItalic()) text = "<i>" + text + "</i>";
    if (style.isUnderline()) text = "<u>" + text + "</u>";
    if (style.isStrikethrough()) text = "<s>" + text + "</s>";

    var link = run.getLinkUrl();
    if (link && /^(https?:|mailto:)/i.test(link)) {
      text = '<a href="' + escapeHtml_(link) + '" rel="noopener">' + text + "</a>";
    }
    return text;
  }).join("");

  return html.replace(/\r\n|\r|\n/g, "<br>");
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
