/**
 * THE PAPER ASKS ITS OWN QUESTIONS.
 *
 * This product asked forty of them through `window.alert`, `window.confirm` and
 * `window.prompt`, every one titled "localhost:3000 says". That is not only
 * ugly. Three things follow from it that matter to a newsroom:
 *
 *   * The best writing in the product is delivered by the operating system.
 *     `deletionQuestion()` names the edition by the date as the masthead sets
 *     it, the page count, how many blocks carry copy, that it cannot be undone
 *     and that reporters' filings survive - and arrives as unstyled OS text
 *     with no way to emphasise the date and no way to make the destructive
 *     button look destructive.
 *   * `window.prompt` renders a ONE-LINE input, and two of this product's
 *     paste routes ask a desk to put a TABLE in it ("one reading to a line",
 *     "one row to the line"). A desk can see about forty characters of what
 *     they pasted and cannot edit it.
 *   * `alert()` and `confirm()` block the browser's main thread until
 *     dismissed. In this product that thread is also running autosave, the
 *     compositor and the caret. An alert left open on a desk that walked away
 *     is an edition that is not saving.
 *
 * WHAT THIS IS BUILT FROM, AND WHY IT NEEDED NOTHING NEW.
 *
 * The two halves of a working dialog already existed in this codebase, on two
 * different surfaces, and neither surface had both:
 *
 *                        workspace panels   e-paper map editor
 *   role / aria-modal    -                  yes
 *   labelled title       2 of 3             yes
 *   Escape closes        YES                -
 *   focus restored       YES                -
 *   focus moved in       -                  -
 *   focus trapped        -                  -
 *
 * So the markup is the map editor's, the Escape and focus-restore behaviour is
 * the workspace panels', and the last two rows - moving focus in and keeping
 * it there - are the only genuinely new thing here.
 *
 * NOTHING THE CALLER SUPPLIES IS EVER PARSED AS HTML. Every caller string goes
 * in through `textContent`. This product has had stored XSS once already, from
 * trusting an upload's declared type; a question the desk is asked is not a
 * place to reintroduce it.
 */

const FOCUSABLE = 'button:not([disabled]),select:not([disabled]),input:not([disabled]),textarea:not([disabled]),a[href],[tabindex]:not([tabindex="-1"])';

let openCount = 0;

/** Paragraph-per-line, so a question can carry more than one sentence. */
function bodyInto(host, body) {
  if (body == null || body === "") return;
  if (body instanceof Node) { host.append(body); return; }
  for (const line of String(body).split("\n")) {
    const p = document.createElement("p");
    p.className = "sahas-dialog-line";
    p.textContent = line;
    host.append(p);
  }
}

/**
 * One dialog. Resolves with `{ action, field }` - the value of whichever
 * action closed it (or `cancelValue` if Escape, the backdrop or Close did),
 * and the field's text READ BEFORE THE NODE IS REMOVED. Returning both is what
 * lets `askPrompt` exist without reaching into this function's internals.
 *
 * `actions` are given primary-first; the first one is where a desk's eye ends
 * up and is the one focus lands on when there is no field.
 */
export function openDialog({
  title,
  body = "",
  actions = [],
  field = null,
  cancelValue = null,
  width = 520,
} = {}) {
  return new Promise((resolve) => {
    const restoreTo = document.activeElement;
    const titleId = `sahasDialogTitle${(openCount += 1)}`;

    const backdrop = document.createElement("div");
    backdrop.className = "sahas-dialog-backdrop";

    const shell = document.createElement("div");
    shell.className = "sahas-dialog";
    shell.setAttribute("role", "dialog");
    shell.setAttribute("aria-modal", "true");
    shell.setAttribute("aria-labelledby", titleId);
    shell.style.maxWidth = `${width}px`;

    const head = document.createElement("header");
    head.className = "sahas-dialog-head";
    const h = document.createElement("h2");
    h.id = titleId;
    h.textContent = String(title ?? "");
    const close = document.createElement("button");
    close.type = "button";
    close.className = "sahas-dialog-close";
    close.setAttribute("aria-label", "Close");
    close.textContent = "×";
    head.append(h, close);

    const main = document.createElement("div");
    main.className = "sahas-dialog-body";
    bodyInto(main, body);

    // The field, when there is one. A `multiline` field is a TEXTAREA, which is
    // the whole reason this exists: the chart and table paste routes hand a
    // desk a table and a one-line box.
    let input = null;
    if (field) {
      const label = document.createElement("label");
      label.className = "sahas-dialog-field";
      const span = document.createElement("span");
      span.textContent = String(field.label ?? "");
      input = document.createElement(field.multiline ? "textarea" : "input");
      if (!field.multiline) input.type = field.type || "text";
      if (field.multiline) input.rows = field.rows || 7;
      input.value = String(field.value ?? "");
      if (field.placeholder) input.placeholder = String(field.placeholder);
      label.append(span, input);
      main.append(label);
      if (field.help) {
        const help = document.createElement("p");
        help.className = "sahas-dialog-help";
        help.textContent = String(field.help);
        main.append(help);
      }
    }

    const foot = document.createElement("footer");
    foot.className = "sahas-dialog-actions";

    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      // Read the field BEFORE the node goes; afterwards there is nothing to
      // read, which is the bug this shape exists to make impossible.
      const fieldValue = input ? input.value : null;
      document.removeEventListener("keydown", onKey, true);
      backdrop.remove();
      // Back to the control that opened it - the workspace panels' own rule,
      // and the half the map editor never had.
      if (restoreTo && document.contains(restoreTo) && restoreTo.focus) {
        restoreTo.focus({ preventScroll: true });
      }
      resolve({ action: value, field: fieldValue });
    };

    const buttons = [];
    for (const action of actions) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = `sahas-dialog-btn ${action.destructive ? "is-destructive" : action.primary ? "is-primary" : "is-quiet"}`;
      b.textContent = String(action.label ?? "");
      b.addEventListener("click", () => finish(action.value));
      buttons.push(b);
      foot.append(b);
    }
    close.addEventListener("click", () => finish(cancelValue));

    shell.append(head, main, foot);
    backdrop.append(shell);
    document.body.append(backdrop);

    // Dismissal, three ways, all meaning the same thing.
    backdrop.addEventListener("mousedown", (event) => {
      if (event.target === backdrop) finish(cancelValue);
    });

    /**
     * Escape closes, and Tab may not leave. The trap is the one thing neither
     * existing surface had: the Newsdesk panel puts 63 controls on screen with
     * focus still behind it, so a keyboard user has to Tab through the whole
     * page underneath to reach the panel sitting on top of it.
     */
    function onKey(event) {
      if (!document.contains(shell)) return;
      if (event.key === "Escape") { event.preventDefault(); finish(cancelValue); return; }
      if (event.key !== "Tab") return;
      const stops = [...shell.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null);
      if (!stops.length) return;
      const first = stops[0];
      const last = stops[stops.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !shell.contains(active))) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && (active === last || !shell.contains(active))) {
        event.preventDefault(); first.focus();
      }
    }
    document.addEventListener("keydown", onKey, true);

    // Focus goes IN: to the field if there is one, else to the primary action,
    // else to Close. A dialog whose focus stays outside it is a dialog a
    // keyboard cannot reach.
    const target = input || buttons.find((b) => b.className.includes("is-primary")) || buttons[0] || close;
    target.focus({ preventScroll: true });
    if (input && input.select) input.select();
  });
}

/** Yes or no. `destructive` makes the confirming button look like what it does. */
export async function askConfirm({ title, body = "", confirm = "OK", cancel = "Cancel", destructive = false } = {}) {
  const { action } = await openDialog({
    title,
    body,
    cancelValue: false,
    actions: [
      { label: confirm, value: true, primary: !destructive, destructive },
      { label: cancel, value: false },
    ],
  });
  return action === true;
}

/**
 * A string, or null if the desk backed out. `multiline` gives a real textarea -
 * which is the whole point: a table pasted into a one-line box welds into one
 * row, and the desk can see about forty characters of what they pasted.
 */
export async function askPrompt({ title, body = "", label = "", value = "", multiline = false, placeholder = "", help = "", confirm = "Save", cancel = "Cancel", width } = {}) {
  const { action, field } = await openDialog({
    title,
    body,
    width: width || (multiline ? 620 : 520),
    cancelValue: null,
    field: { label, value, multiline, placeholder, help },
    actions: [
      { label: confirm, value: "ok", primary: true },
      { label: cancel, value: null },
    ],
  });
  return action === "ok" ? field : null;
}

/** Something the desk has to read and acknowledge. */
export async function askMessage({ title, body = "", ok = "OK" } = {}) {
  await openDialog({ title, body, cancelValue: undefined, actions: [{ label: ok, value: undefined, primary: true }] });
}
