# Bundled typefaces and their licences

Every face in `public/assets/fonts/` is under the **SIL Open Font License 1.1**,
which permits bundling, redistribution and commercial use, including in a
printed newspaper and in the PDFs this system embeds them into.

| file | family | source | licence |
|---|---|---|---|
| `NotoSerifDevanagari-Regular.ttf`, `-Bold.ttf` | Noto Serif Devanagari | Google Noto | OFL 1.1 |
| `NotoSansDevanagari-Regular.ttf`, `-Bold.ttf` | Noto Sans Devanagari | Google Noto | OFL 1.1 |
| `TiroDevanagariMarathi-Regular.ttf` | Tiro Devanagari Marathi | Tiro Typeworks | OFL 1.1 |
| `Mukta-Regular.ttf`, `-Bold.ttf` | Mukta | Ek Type | OFL 1.1 |
| `Khand-Regular.ttf`, `-Bold.ttf` | Khand | Indian Type Foundry | OFL 1.1 |
| `RozhaOne-Regular.ttf` | Rozha One | Indian Type Foundry | OFL 1.1 |
| `MuktaDisplay-Regular.ttf`, `-Medium.ttf`, `-SemiBold.ttf`, `-Bold.ttf`, `-ExtraBold.ttf` | Mukta, with the vertical metrics (hhea, OS/2 typo and win) set to 0.96 / 0.15 em - outlines unchanged | Ek Type | OFL 1.1 (modified; Mukta declares no Reserved Font Name) |
| `Rajdhani-SemiBold.ttf`, `-Bold.ttf` | Rajdhani | Indian Type Foundry | OFL 1.1 |
| `NotoSansDevanagariCondensed-Medium.ttf`, `-SemiBold.ttf` | Noto Sans Devanagari, static instances of the variable font at wdth 80, wght 500 / 600 (fontTools `varLib.instancer`), vertical metrics set to 0.90 / 0.15 em | Google Noto | OFL 1.1 |

Taken from the Google Fonts repository (`github.com/google/fonts/ofl/...`),
which is the upstream distribution for all six.

**Take the full file, never the webfont subset.** Fetching these through the
Google Fonts CSS API returns a *subsetted* face - the first attempt here
produced 34-60 KB files that carried Latin and no Devanagari at all, and every
one of them measured `क` at the 0.5 em "not found" fallback while returning
real advances for `A`. The full faces are 316-440 KB. A subset would compose,
shape and print without ever raising an error, in the wrong widths.

**Tiro Devanagari Marathi and Rozha One have one cut each.** Their 700 maps to
the same file rather than to a synthesised bold: a synthesised Devanagari bold
thickens the shirorekha unevenly and reads as a printing fault.
