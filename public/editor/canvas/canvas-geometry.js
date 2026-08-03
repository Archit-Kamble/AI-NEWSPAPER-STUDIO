export function sectionRect(section, pageWidth, pageHeight) {
  return {
    leftPct: (section.x_px / pageWidth) * 100,
    topPct: (section.y_px / pageHeight) * 100,
    widthPct: (section.width_px / pageWidth) * 100,
    heightPct: (section.height_px / pageHeight) * 100,
  };
}
