# AI NEWSPAPER STUDIO — PROJECT VISION (READ BEFORE WRITING CODE)

This document is more important than any individual prompt.

Whenever there is a conflict between an implementation detail and this document, follow this document. It outranks `CLAUDE.md`; `CLAUDE.md` describes how the code is built, this describes what we are building and why.

You are not just building an editor.

You are building a complete AI-powered Newspaper Production Operating System used daily by professional newspaper companies.

Do not optimize for code elegance if it makes the production workflow worse.

**The workflow is the product.**

---

## What are we building?

We are building software that allows an editor to produce an entire newspaper with AI assistance.

The operator should be able to finish an entire newspaper without leaving the application.

The software should eventually support:

- Reporter management
- Story management
- Layout management
- AI article generation
- AI headline generation
- AI article expansion
- AI article shortening
- AI fitting
- Image editing
- Background removal
- Automatic newspaper composition
- Preview
- PDF export
- Printing
- Publishing

Think **Adobe InDesign meets AI**.

Not Canva. Not a CMS. Not a text editor.

---

## Always think like a newspaper editor

Never ask:

> "What component should I build?"

Instead ask:

> "What would an editor naturally do next?"

Every UI decision should reduce clicks.

---

## The production workflow

Everything revolves around this workflow.

```
Create today's edition
  ↓
Choose page
  ↓
Choose layout
  ↓
Select one news block
  ↓
Fill that block
  ↓
Return
  ↓
Fill next block
  ↓
Return
  ↓
Repeat
  ↓
Preview entire page
  ↓
Preview newspaper
  ↓
Export
  ↓
Print
  ↓
Publish
```

Never break this flow.

Never force unnecessary navigation.

---

## Section workflow

Every section follows exactly this lifecycle.

```
Click empty section
  ↓
Choose reporter story  OR  Write manually
  ↓
Save
  ↓
Automatically open External Editor
  ↓
Work on image
  ↓
Background removal
  ↓
Crop
  ↓
Scale
  ↓
Position
  ↓
AI calculates remaining space
  ↓
AI generates article
  ↓
User reviews
  ↓
Save
  ↓
Return to layout
  ↓
Section becomes filled
```

The editor should never wonder:

> "Where do I go next?"

The software should naturally guide the workflow.

---

## External Editor

The External Editor is NOT another page.

It is the **second stage of newspaper production**.

It should appear below the page. The page scrolls naturally.

```
Page
  ↓
Inspector
  ↓
External Editor
  ↓
End of page
```

Do not try to fit everything into one screen.

Professional software uses scrolling.

---

## Layout philosophy

**The layout is sacred.**

Do not redesign it.

Do not invent image placeholders.

Do not split blocks yourself.

The layout defines only:

- available rectangle
- available width
- available height

Nothing more.

Later:

The editor chooses image size, image position, crop, and article length.

AI fills whatever space remains.

---

## AI philosophy

AI does NOT replace the editor. AI assists the editor.

The AI should eventually perform:

```
Headline generation → Subheadline generation → Caption generation →
Body generation → Expand → Shorten → Rewrite → Fit remaining area →
Grammar correction → Tone change → Translation → Summarization →
SEO → Fact extraction → Keyword extraction
```

Every AI action should feel like an assistant.

Never take control away from the editor.

---

## Think in workflows, not components

Wrong thinking:

> "I'll build another panel."

Correct thinking:

> "What is the editor trying to accomplish?"

---

## Future vision

Eventually one editor should be able to produce an entire newspaper using AI.

The production should look like this:

```
Reporter writes story
  ↓
Editor opens edition
  ↓
Chooses story
  ↓
Chooses image
  ↓
Background removed
  ↓
Image positioned
  ↓
AI fits article
  ↓
Headline generated
  ↓
Caption generated
  ↓
Save
  ↓
Repeat
  ↓
Whole page complete
  ↓
Whole newspaper complete
  ↓
Preview
  ↓
Print-ready PDF
  ↓
Publish
```

This is the experience we are building.

---

## Design philosophy

Every screen should feel: **clean, spacious, premium, calm, professional**.

Never congested. Never overwhelming.

Avoid unnecessary buttons. Avoid duplicate inputs. Avoid repeated information.

---

## Performance philosophy

Editors use this software for hours. Everything should feel instant.

Prefer: smooth scrolling, lazy loading, optimistic updates, keyboard shortcuts, minimal waiting.

---

## Architecture philosophy

Before adding a feature ask:

1. Does this improve the newspaper production workflow?
2. Does this reduce clicks?
3. Does this feel like professional publishing software?
4. Will this still make sense when producing a 32-page newspaper?

If any answer is "No", redesign before implementing.

---

## What NOT to do

- Do NOT redesign workflows because they seem technically cleaner.
- Do NOT move UI elements unless it improves the editor's workflow.
- Do NOT create duplicate inputs.
- Do NOT add tabs just because they seem organized.
- Do NOT refactor large areas unless necessary.
- Do NOT optimize for developer convenience over editor productivity.

---

## What is expected from Claude

When asked for a feature:

1. First verify that it matches the production workflow above.
2. If it conflicts, **explain the conflict before coding**.
3. Prefer small, incremental changes over large rewrites.
4. Keep the long-term vision in mind.

You are not just writing code — you are helping build a production-grade AI newspaper operating system.

Before implementing any major UI change, ask yourself:

> "Would an editor at a real newspaper instinctively know what to do next?"

If the answer is no, simplify the workflow before writing code.
