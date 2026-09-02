/**
 * THE REPORTER'S OWN SCREENS, IN MARATHI.
 *
 * The desk chrome staying in English is a defensible decision: an editor works
 * beside a Scribus install, a CMYK profile and an English keyboard, and every
 * piece of production vocabulary in this product is English.
 *
 * The reporter's screens are a different screen with different people in front
 * of it, and the audit put it plainly: these are used by district journalists
 * to write Marathi copy, they are the people in this product least likely to
 * be reading English comfortably, and theirs is the only surface whose users
 * cannot ask anyone for help. Measured before this existed, every string on it
 * was English - CREATE NEWS, Heading, Subtitle, Description / Context,
 * Category, Location, Tags, Upload Images, Save as Draft, Submit for Approval,
 * Tips - and the placeholders too.
 *
 * ONE CATALOGUE, and it is the only place these words are written. A string
 * spelled twice is the duplicated-catalogue failure this project has been
 * bitten by three times; a string spelled twice in a language the person
 * fixing it does not read is worse.
 *
 * WHAT IS DELIBERATELY NOT TRANSLATED:
 *
 *   * a reporter's own copy, which is theirs;
 *   * the four status keys, which are database values;
 *   * anything on a desk screen. can("makeUp") decides which dashboard a
 *     person gets, and this catalogue is imported by the reporter's alone.
 */

/** Devanagari numerals, so a reporter's screen counts the way the paper does. */
export function devanagari(value) {
  return String(value ?? "").replace(/[0-9]/g, (d) => "०१२३४५६७८९"[Number(d)]);
}

export const MR = {
  // --- the header and the menu ---
  greeting: "नमस्कार",
  role: "वार्ताहर",
  logout: "बाहेर पडा",
  menu: "मेनू",

  create: "बातमी लिहा",
  drafts: "माझे मसुदे",
  submitted: "पाठवलेल्या",
  approved: "स्वीकारलेल्या",
  rejected: "परत आलेल्या",
  profile: "माझी माहिती",

  // --- the profile screen ---
  // The one reporter screen the Marathi pass missed. Its heading read
  // "PROFILE" and its three labels read Name / Email / Role, on a screen whose
  // own menu button has said माझी माहिती since that pass landed - so the
  // sidebar and the page it opens disagreed about what the screen is called,
  // which is the "one screen, one name" fault this file already records for
  // Past News.
  profileName: "नाव",
  profileEmail: "ईमेल",
  profileRole: "भूमिका",

  // --- the writing form ---
  createHeading: "नवी बातमी",
  editHeading: "बातमी दुरुस्त करा",
  fieldHeadline: "मथळा",
  fieldSubtitle: "उपमथळा",
  fieldStory: "बातमी",
  fieldCategory: "विषय",
  fieldLocation: "ठिकाण",
  fieldTags: "खुणा",
  fieldImages: "छायाचित्रे",

  phHeadline: "बातमीचा मुख्य मथळा",
  phSubtitle: "मथळ्याखालची एक ओळ",
  phStory: "बातमी इथे लिहा…",
  phCategory: "राजकारण, स्थानिक, क्रीडा…",
  phLocation: "गाव किंवा शहर",
  phTags: "स्वल्पविरामाने वेगळ्या खुणा",

  pickImages: "+ छायाचित्रे निवडा (जास्तीत जास्त १०)",
  removeImage: "हे छायाचित्र काढा",
  imagesChosen: (n) => `${devanagari(n)} नवी छायाचित्रे निवडली`,
  imageLimit: "एका बातमीला जास्तीत जास्त १० छायाचित्रे जोडता येतात.",
  // Nothing said this, and it is the one thing a reporter must know before
  // pressing save: sending new files replaces the whole list on the story.
  imagesReplace: "नवी छायाचित्रे पाठवल्यास बातमीवरची आधीची छायाचित्रे त्यांच्या जागी येतील.",

  saveDraft: "मसुदा म्हणून ठेवा",
  updateDraft: "मसुदा अद्ययावत करा",
  submit: "संपादकांकडे पाठवा",
  updateSubmit: "दुरुस्त करून पुन्हा पाठवा",

  savedDraft: "मसुदा म्हणून ठेवला.",
  savedSubmitted: "संपादकांकडे पाठवली.",
  saveFailed: "बातमी ठेवता आली नाही.",

  // --- what the form says when it is not filled in ---
  //
  // The old validation was a native alert reading "Title required" - and the
  // field is labelled मथळा. It named a field the form does not have, in a
  // language the form is not in, and the focus never moved, so the reporter
  // was told something was wrong, told the wrong name for it, and left to
  // find it.
  needHeadline: "मथळ्याशिवाय बातमी पाठवता येत नाही.",
  needStory: "बातमी लिहिल्याशिवाय पाठवता येत नाही.",

  // --- the queues ---
  emptyQueue: "इथे सध्या काही नाही.",
  emptyDrafts: "अजून एकही मसुदा नाही. डावीकडून बातमी लिहा हे निवडा.",
  tapToEdit: "दुरुस्त करण्यासाठी बातमीवर टिचकी मारा",

  status: {
    draft: "मसुदा",
    pending: "संपादकांकडे",
    approved: "स्वीकारली",
    rejected: "परत आली",
  },

  // --- the note a reporter could never see ---
  //
  // R.1, and of everything in the audit the one that costs a newsroom a
  // person: a story was refused, the desk wrote down why, the database held
  // it - and the reporter's own screen rendered the note nowhere.
  whyBack: "संपादकांचा अभिप्राय",
  whyBackNone: "संपादकांनी कारण लिहिलेले नाही. त्यांना विचारा.",
  fixAndResend: "दुरुस्त करून पुन्हा पाठवा",

  // --- leaving with work unsaved ---
  unsaved: "लिहिलेली बातमी अजून ठेवलेली नाही.",

  tips: "सूचना",
  tipDraft: "मसुदा नंतर दुरुस्त करता येतो. पाठवल्यावर तो संपादकांकडे जातो.",
  tipEditing: "केलेले बदल मसुदा म्हणूनच ठेवले जातील.",
};

/**
 * A date the way this newsroom writes one. The reporter's cards read
 * `9/1/2026` before this - US month-first order, on a screen with no English
 * on it at all.
 */
export function reporterDate(value) {
  const when = new Date(value);
  if (Number.isNaN(when.getTime())) return "";
  return devanagari(
    new Intl.DateTimeFormat("mr-IN", { day: "numeric", month: "long", year: "numeric" }).format(when),
  );
}
