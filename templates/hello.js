/* Rancho MATHCOUNTS — student check-in.
   Step 1 is a gate: the student ID field does not exist until the day code
   is accepted, so a wrong code learns nothing. All copy lives in #strings. */
(function () {
  "use strict";

  var ENDPOINT = window.MC_ENDPOINT || "";
  var CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  var ID_KEY = "mc-student-id";

  var gate = document.getElementById("gate");
  var checkin = document.getElementById("checkin");
  var result = document.getElementById("result");
  var strings = document.getElementById("strings");
  var codeBoxes = [].slice.call(document.querySelectorAll("#code-boxes input"));
  var idBoxes = [].slice.call(document.querySelectorAll("#id-boxes input"));

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
    return CROCKFORD.indexOf(ch) > -1 ? ch : "";
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

  /* ---------- transport ---------- */

  function post(payload) {
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

    post({ action: "gate", code: code }).then(function (data) {
      busy(gateSubmit, false);
      if (!data.ok) {
        show(gateError, "code-wrong");
        return;
      }
      dayCode = code;
      openCheckin(data.announcement || "");
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

  leaving.addEventListener("change", function () {
    leavingTime.hidden = !leaving.checked;
    if (leaving.checked) leavingTime.focus();
  });

  document.getElementById("erase").addEventListener("click", function () {
    try { localStorage.removeItem(ID_KEY); } catch (e) {}
    fill(idBoxes, "", normalizeDigit);
    savedHint.hidden = true;
    idBoxes[0].focus();
  });

  function openCheckin(announcementHtml) {
    gate.hidden = true;
    checkin.hidden = false;

    var slot = document.getElementById("day-announcement");
    if (announcementHtml) {
      slot.innerHTML = announcementHtml;
      slot.hidden = false;
    }

    var saved = "";
    try { saved = localStorage.getItem(ID_KEY) || ""; } catch (e) {}
    if (saved) {
      fill(idBoxes, saved, normalizeDigit);
      savedHint.hidden = false;
    }

    document.getElementById("checkin-heading").focus();
  }

  checkin.addEventListener("submit", function (event) {
    event.preventDefault();
    var id = readValue(idBoxes);

    if (id.length < idBoxes.length) {
      show(checkinError, "id-short");
      return;
    }

    show(checkinError, "loading");
    busy(checkinSubmit, true);

    post({
      action: "checkin",
      code: dayCode,
      id: id,
      message: document.getElementById("message").value,
      leaving: leaving.checked ? leavingTime.value : ""
    }).then(function (data) {
      busy(checkinSubmit, false);
      if (!data.ok) {
        show(checkinError, data.error === "code" ? "code-wrong" : "id-unknown");
        return;
      }
      try { localStorage.setItem(ID_KEY, id); } catch (e) {}
      openResult(data.name || "", data.message || "");
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
