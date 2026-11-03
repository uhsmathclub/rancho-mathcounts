/* Rancho MATHCOUNTS — student check-in.
   Step 1 is a gate: the student ID field does not exist until the day code
   is accepted, so a wrong code learns nothing. All copy lives in #strings.

   One script for both front ends. The public page posts JSON to the Apps
   Script endpoint; the Apps Script fallback calls the same handler over
   google.script.run. build.py copies this file into apps-script/Hello.html,
   so the two can no longer drift apart. Needs form.js loaded first. */
(function () {
  "use strict";

  var ENDPOINT = window.MC_ENDPOINT || "";
  /* Crockford base-32, plus U: the generator never draws a U, but a coach
     may write a themed code into the sheet by hand. */
  var TYPABLE = "0123456789ABCDEFGHJKMNPQRSTUVWXYZ";
  var ID_KEY = "mc-student-id";

  var gate = document.getElementById("gate");
  var checkin = document.getElementById("checkin");
  var result = document.getElementById("result");
  var strings = document.getElementById("strings");
  var codeBoxes = [].slice.call(document.querySelectorAll("#code-boxes input"));
  var idGroup = document.getElementById("id-boxes");
  var idBoxes = [].slice.call(idGroup.querySelectorAll("input"));

  /* ---------- copy ---------- */

  function show(slot, key) {
    var source = strings.querySelector('[data-key="' + key + '"]');
    slot.replaceChildren(source ? source.cloneNode(true) : document.createTextNode(""));
    // "Checking you in..." shares the slot but is not a failure.
    slot.className = key === "loading" ? "error error--busy" : "error";
  }

  function clear(slot) {
    slot.replaceChildren();
    slot.className = "error";
  }

  /* ---------- digit groups ---------- */

  function normalizeCode(ch) {
    ch = ch.toUpperCase();
    if (ch === "I" || ch === "L") return "1";
    if (ch === "O") return "0";
    return TYPABLE.indexOf(ch) > -1 ? ch : "";
  }

  function normalizeDigit(ch) {
    return ch >= "0" && ch <= "9" ? ch : "";
  }

  function readValue(boxes) {
    return boxes.map(function (box) { return box.value; }).join("");
  }

  function fill(boxes, text, normalize) {
    var cleaned = "";
    for (var i = 0; i < text.length && cleaned.length < boxes.length; i++) {
      if (text.charAt(i) === "-") continue;
      cleaned += normalize(text.charAt(i));
    }
    boxes.forEach(function (box, index) { box.value = cleaned.charAt(index) || ""; });
    return cleaned;
  }

  function wire(boxes, normalize) {
    boxes.forEach(function (box, index) {
      box.addEventListener("input", function () {
        var raw = box.value;
        box.value = normalize(raw.charAt(raw.length - 1) || "");
        if (box.value && index < boxes.length - 1) boxes[index + 1].focus();
      });

      box.addEventListener("keydown", function (event) {
        if (event.key === "Backspace" && !box.value && index > 0) {
          event.preventDefault();
          boxes[index - 1].value = "";
          boxes[index - 1].focus();
        } else if (event.key === "ArrowLeft" && index > 0) {
          event.preventDefault();
          boxes[index - 1].focus();
        } else if (event.key === "ArrowRight" && index < boxes.length - 1) {
          event.preventDefault();
          boxes[index + 1].focus();
        }
      });

      box.addEventListener("paste", function (event) {
        event.preventDefault();
        var text = (event.clipboardData || window.clipboardData).getData("text");
        var filled = fill(boxes, text, normalize);
        boxes[Math.min(filled.length, boxes.length - 1)].focus();
      });

      box.addEventListener("focus", function () { box.select(); });
    });
  }

  wire(codeBoxes, normalizeCode);
  wire(idBoxes, normalizeDigit);
  codeBoxes[0].focus(); // the fallback's sandboxed frame ignores autofocus

  /* ---------- transport ---------- */

  function api(payload) {
    if (window.google && google.script && google.script.run) {
      return new Promise(function (resolve, reject) {
        google.script.run.withSuccessHandler(resolve).withFailureHandler(reject).api(payload);
      });
    }
    /* text/plain keeps this a simple request, so Apps Script never sees a
       CORS preflight it cannot answer. */
    return fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload)
    }).then(function (response) { return response.json(); });
  }

  function busy(button, isBusy) {
    button.disabled = isBusy;
  }

  /* ---------- step 1 ---------- */

  var dayCode = "";
  var gateError = document.getElementById("gate-error");
  var gateSubmit = document.getElementById("gate-submit");

  gate.addEventListener("submit", function (event) {
    event.preventDefault();
    var code = readValue(codeBoxes);

    if (code.length < codeBoxes.length) {
      show(gateError, "code-short");
      return;
    }

    clear(gateError);
    busy(gateSubmit, true);

    api({ action: "gate", code: code }).then(function (data) {
      busy(gateSubmit, false);
      if (!data.ok) {
        show(gateError, "code-wrong");
        return;
      }
      dayCode = code;
      openCheckin(data.announcement || "", data.fields || []);
    }).catch(function () {
      busy(gateSubmit, false);
      show(gateError, "offline");
    });
  });

  /* ---------- step 2 ---------- */

  var checkinError = document.getElementById("checkin-error");
  var checkinSubmit = document.getElementById("checkin-submit");
  var savedHint = document.getElementById("saved-hint");
  var leaving = document.getElementById("leaving");
  var leavingTime = document.getElementById("leaving-time");
  var leavingWhen = document.getElementById("leaving-when");
  var form = null; // the questions in today's announcement

  leaving.addEventListener("change", function () {
    leavingWhen.hidden = !leaving.checked;
    leavingTime.required = leaving.checked;
    if (!leaving.checked) leavingTime.value = "";
    if (leaving.checked) leavingTime.focus();
  });

  document.getElementById("erase").addEventListener("click", function () {
    try { localStorage.removeItem(ID_KEY); } catch (e) {}
    fill(idBoxes, "", normalizeDigit);
    savedHint.hidden = true;
    idChanged();
    idBoxes[0].focus();
  });

  /* Questions with data-only appear once all nine digits are in, and only
     for the IDs they name. The server decides; the page never holds the
     list. One lookup per ID, however often it is retyped. */
  var lookups = {};
  var revealedFor = "";

  function lookup(id) {
    if (!form || !form.hasRestricted()) return Promise.resolve();
    if (!lookups[id]) {
      lookups[id] = api({ action: "fields", code: dayCode, id: id }).then(function (data) {
        return data && data.ok ? data.fields || [] : [];
      }, function () {
        delete lookups[id]; // try again next time
        return [];
      });
    }
    return lookups[id].then(function (fields) {
      if (readValue(idBoxes) !== id || revealedFor === id) return;
      form.reveal(fields);
      revealedFor = id;
    });
  }

  function idChanged() {
    if (!form || !form.hasRestricted()) return;
    var id = readValue(idBoxes);
    if (revealedFor && revealedFor !== id) {
      form.hideRestricted();
      revealedFor = "";
    }
    if (id.length === idBoxes.length) lookup(id);
  }

  ["input", "keydown", "paste"].forEach(function (type) {
    idGroup.addEventListener(type, function () { setTimeout(idChanged, 0); });
  });

  function openCheckin(announcementHtml, fields) {
    gate.hidden = true;
    checkin.hidden = false;

    var slot = document.getElementById("day-announcement");
    form = window.MCForm.render(slot, announcementHtml, fields);
    slot.hidden = !announcementHtml;

    var saved = "";
    try { saved = localStorage.getItem(ID_KEY) || ""; } catch (e) {}
    if (saved) {
      fill(idBoxes, saved, normalizeDigit);
      savedHint.hidden = false;
      idChanged();
    }

    document.getElementById("checkin-heading").focus();
  }

  /* Report the first unanswered or out-of-range question and go to it. */
  function questionsOk() {
    var problem = form.validate();
    if (!problem) return true;
    show(checkinError, problem.key);
    problem.element.focus();
    return false;
  }

  function serverError(error) {
    if (error === "code") show(checkinError, "code-wrong");
    else if (error === "id") show(checkinError, "id-unknown");
    else if (error === "answers") show(checkinError, "answer-server");
    else if (error === "busy") show(checkinError, "busy");
    else show(checkinError, "offline");
  }

  checkin.addEventListener("submit", function (event) {
    event.preventDefault();
    var id = readValue(idBoxes);

    if (id.length < idBoxes.length) {
      show(checkinError, "id-short");
      return;
    }

    if (leaving.checked && !leavingTime.value) {
      show(checkinError, "time-missing");
      leavingTime.focus();
      return;
    }

    if (!questionsOk()) return;

    show(checkinError, "loading");
    busy(checkinSubmit, true);

    // A data-only question may still be on its way for this ID; wait for
    // it, and check again if it brought a question that needs an answer.
    lookup(id).then(function () {
      if (!questionsOk()) {
        busy(checkinSubmit, false);
        return;
      }
      return api({
        action: "checkin",
        code: dayCode,
        id: id,
        message: document.getElementById("message").value,
        leaving: leaving.checked ? leavingTime.value : "",
        answers: form.answers()
      }).then(function (data) {
        busy(checkinSubmit, false);
        if (!data.ok) {
          serverError(data.error);
          return;
        }
        try { localStorage.setItem(ID_KEY, id); } catch (e) {}
        openResult(data.name || "", data.message || "");
      });
    }).catch(function () {
      busy(checkinSubmit, false);
      show(checkinError, "offline");
    });
  });

  /* ---------- step 3 ---------- */

  function openResult(name, personalHtml) {
    checkin.hidden = true;
    result.hidden = false;

    var heading = document.getElementById("result-heading");
    ["en", "zh", "ko"].forEach(function (lang) {
      var template = heading.getAttribute("data-template-" + lang) || "";
      heading.dataset[lang] = template.replace("{name}", name);
    });
    heading.textContent = heading.dataset[document.documentElement.dataset.lang || "en"];

    if (personalHtml) {
      document.getElementById("result-line").hidden = false;
      document.getElementById("personal-message").innerHTML = personalHtml;
    }

    heading.focus();
  }
})();
