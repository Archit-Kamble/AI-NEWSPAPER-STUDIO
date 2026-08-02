const PAGE_WIDTH = 660;
const PAGE_HEIGHT = 1060;

const templates = {
  front: {
    key: 'front',
    name: 'Front Page',
    sections: [
      { key: 'lead', x: 20, y: 115, width: 395, height: 445 },
      { key: 'top-side', x: 425, y: 115, width: 215, height: 210 },
      { key: 'mid-side', x: 425, y: 335, width: 215, height: 225 },
      { key: 'bottom-left', x: 20, y: 570, width: 300, height: 270 },
      { key: 'bottom-right', x: 330, y: 570, width: 310, height: 270 },
      { key: 'briefs', x: 20, y: 850, width: 620, height: 190 }
    ]
  },
  local: {
    key: 'local',
    name: 'Local News',
    sections: [
      { key: 'banner', x: 20, y: 115, width: 620, height: 170 },
      { key: 'left-column', x: 20, y: 295, width: 195, height: 500 },
      { key: 'centre-column', x: 225, y: 295, width: 205, height: 500 },
      { key: 'right-top', x: 440, y: 295, width: 200, height: 245 },
      { key: 'right-bottom', x: 440, y: 550, width: 200, height: 245 },
      { key: 'footer', x: 20, y: 805, width: 620, height: 235 }
    ]
  },
  opinion: {
    key: 'opinion',
    name: 'Opinion',
    sections: [
      { key: 'editorial', x: 20, y: 115, width: 620, height: 270 },
      { key: 'opinion-one', x: 20, y: 395, width: 195, height: 645 },
      { key: 'opinion-two', x: 225, y: 395, width: 205, height: 645 },
      { key: 'opinion-three', x: 440, y: 395, width: 200, height: 645 }
    ]
  },
  photo: {
    key: 'photo',
    name: 'Photo Feature',
    sections: [
      { key: 'photo-lead', x: 20, y: 115, width: 405, height: 500 },
      { key: 'photo-top', x: 435, y: 115, width: 205, height: 240 },
      { key: 'photo-bottom', x: 435, y: 365, width: 205, height: 250 },
      { key: 'caption-story', x: 20, y: 625, width: 620, height: 415 }
    ]
  }
};

function getTemplate(templateKey) {
  return templates[templateKey] || templates.front;
}

module.exports = { PAGE_WIDTH, PAGE_HEIGHT, getTemplate, templates };
