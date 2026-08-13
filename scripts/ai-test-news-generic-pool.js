// Deliberately messy disposable newsroom inbox for composition regression.
// It is derived from the synthetic material, but source identities and input
// order are unrelated to the old fixture.  Production code must only see the
// generic newsroomSource contract.
const base = require('./ai-test-news-pool');

// Two low-value GENERAL records are intentionally omitted.  The changed pool
// remains oversubscribed on LOCAL and BACK but has at most 15 assignments, so
// the explicit 32-call disposable safety budget can still cover two complete
// treatments per selected source.
const removed = new Set(['src-features-community', 'src-general-farm', 'src-general-culture']);
const renamed = base.filter((item) => !removed.has(item.id)).map((item, index) => ({
  ...item,
  id: `desk-${String(index + 41).padStart(3, '0')}`,
  sourceId: `desk-${String(index + 41).padStart(3, '0')}`,
  editorial_priority: ((Number(item.editorial_priority) + index) % 5) + 1,
}));

const extra = [
  { id: 'desk-901', sourceId: 'desk-901', title: 'वस्तीतील पाणीमीटर तपासणी मोहिमेला सुरुवात', body: 'शहरातील निवडक वस्त्यांमध्ये पाणीमीटर तपासणी मोहीम सुरू करण्यात आली. तक्रारी नोंदवण्यासाठी स्वतंत्र वेळ देण्यात आला असून तपासणीचा अहवाल विभागनिहाय प्रसिद्ध केला जाईल.', description: 'शहरातील निवडक वस्त्यांमध्ये पाणीमीटर तपासणी मोहीम सुरू करण्यात आली. तक्रारी नोंदवण्यासाठी स्वतंत्र वेळ देण्यात आला असून तपासणीचा अहवाल विभागनिहाय प्रसिद्ध केला जाईल.', category: 'स्थानिक', location: 'सातारा', story_type: 'STANDARD', editorial_priority: 4, desired_page_role: 'LOCAL', tags: 'स्थानिक', reporter_name: '' },
  { id: 'desk-902', sourceId: 'desk-902', title: 'नगररचना बैठकीत पादचारी मार्गाचा प्रस्ताव', body: 'नगररचना बैठकीत पादचारी मार्गाचा प्रस्ताव मांडण्यात आला. नागरिकांच्या सूचना पुढील आठवड्यापर्यंत स्वीकारल्या जातील.', description: 'नगररचना बैठकीत पादचारी मार्गाचा प्रस्ताव मांडण्यात आला. नागरिकांच्या सूचना पुढील आठवड्यापर्यंत स्वीकारल्या जातील.', category: 'स्थानिक', location: '', story_type: 'STANDARD', editorial_priority: 3, desired_page_role: 'LOCAL', tags: 'स्थानिक', reporter_name: 'डेस्क' },
  { id: 'desk-903', sourceId: 'desk-903', title: 'जिल्हा नियोजन समितीची बैठक सोमवारी', body: 'जिल्हा नियोजन समितीची बैठक सोमवारी होणार आहे.', description: 'जिल्हा नियोजन समितीची बैठक सोमवारी होणार आहे.', category: 'राज्य', location: 'सातारा', story_type: 'STANDARD', editorial_priority: 2, desired_page_role: 'GENERAL', tags: '', reporter_name: '' },
  { id: 'desk-904', sourceId: 'desk-904', title: 'ग्रंथालयात रविवारी वाचन सत्र', body: 'नगर ग्रंथालयात रविवारी सकाळी वाचन सत्र होईल.', description: 'नगर ग्रंथालयात रविवारी सकाळी वाचन सत्र होईल.', category: 'नागरी', location: '', story_type: 'BRIEF', editorial_priority: 2, desired_page_role: 'GENERAL', tags: 'नागरी', reporter_name: '' },
];

// Intentional non-semantic ordering.  normalizeNewsroomSources must erase it.
module.exports = [extra[2], ...renamed.slice(7).reverse(), extra[0], ...renamed.slice(0, 7), extra[3], extra[1]];
