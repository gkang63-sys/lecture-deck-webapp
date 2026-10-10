/**
 * 강의 슬라이드 웹앱 (구글 버전)
 *
 * 흐름: 웹앱(단원·교재 내용 입력) → 제미나이 → 구글 슬라이드 → 퀴즈 폼 → 드라이브에 저장
 *
 * 화면(Index.html)이 아래 step 함수를 차례로 부른다.
 *  1 step1_start     폴더 만들기 + 입력 저장 + 덱 뼈대·퀴즈 (제미나이)
 *  2 step2_section   섹션별 슬라이드 내용 (제미나이, 섹션마다 한 번)
 *  3 step3_assemble  원문 대조 검증 + 한 장 한 호흡으로 나누기 + 전체 순서 확정
 *  4 step4_build     교수용 구글 슬라이드
 *  5 step5_student   학생용 사본 (정답 장·강의 노트 제외)
 *  6 step6_quiz      구글 폼 퀴즈 (정답·배점·해설)
 *  7 step7_finish    입력 기록 문서
 * Apps Script는 한 번 호출에 6분까지만 돌기 때문에 단계를 나눴다. 단계 사이의 상태는
 * 결과 폴더의 작업기록.json에 두므로, 한 단계가 실패하면 그 단계부터 다시 부르면 된다.
 */

const ROOT_FOLDER = '강의자료';
const STATE_FILE = '작업기록.json';

// 과목별 색 (english-lecture-deck 스킬의 과목색 그대로)
const COURSES = {
  ELS1: { name: '영어듣기와 말하기 1', en: 'English Listening & Speaking 1',
    brand: '#00A56A', deep: '#00754C', soft: '#E6F7F0', line: '#C7EBDC', light: '#6FE0B4' },
  ERW1: { name: '영어읽기와 쓰기 1', en: 'English Reading & Writing 1',
    brand: '#3D5AFE', deep: '#2438C4', soft: '#EDF0FF', line: '#DCE2FF', light: '#8FA4FF' },
};

// ───────────────────────── 화면 ─────────────────────────

function doGet() {
  return HtmlService.createTemplateFromFile('Index').evaluate()
    .setTitle('강의 슬라이드 만들기')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function getSettings() {
  return { hasKey: !!PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY') };
}

/** 화면의 [API 키 저장] — 키는 이 스크립트의 Script Properties에만 저장된다 */
function saveApiKey(key) {
  key = String(key || '').trim();
  if (!/^[\w-]{20,}$/.test(key)) throw new Error('API 키 모양이 아닙니다. AI Studio에서 복사한 키를 그대로 붙여넣어 주세요.');
  PropertiesService.getScriptProperties().setProperty('GEMINI_API_KEY', key);
  return getSettings();
}

// ───────────────────────── 1. 시작 + 뼈대 ─────────────────────────

function step1_start(form) {
  const inp = cleanInput_(form);
  const folder = makeFolder_(inp);
  const st = {
    folderId: folder.getId(), folderUrl: folder.getUrl(), folderName: folder.getName(),
    input: inp, created: new Date().toISOString(), models: [], flags: [],
  };
  saveState_(st);
  const res = callGemini_(outlinePrompt_(inp));
  st.models.push('뼈대: ' + res.model);
  st.outline = checkOutline_(parseJson_(res.text), inp, st.flags);
  st.sections = st.outline.sections.map(() => null);
  saveState_(st);
  return {
    folderId: st.folderId, folderUrl: st.folderUrl, folderName: st.folderName,
    title: st.outline.title_en, sections: st.outline.sections.map(s => s.name_en),
    quiz: st.outline.quiz.length, model: res.model,
  };
}

// ───────────────────────── 2. 섹션 내용 ─────────────────────────

function step2_section(folderId, i) {
  const st = loadState_(folderId);
  const sec = st.outline.sections[i];
  const res = callGemini_(sectionPrompt_(st.input, st.outline, i));
  const raw = parseJson_(res.text);
  st.flags = st.flags.filter(f => f.indexOf(`[${sec.name_en}]`) !== 0); // 다시 만들면 예전 경고는 지움
  st.sections[i] = checkSectionSlides_(Array.isArray(raw) ? raw : raw.slides, st.input, sec, st.flags);
  st.models.push(`${sec.name_en}: ${res.model}`);
  saveState_(st);
  return { name: sec.name_en, count: st.sections[i].length, model: res.model };
}

// ───────────────────────── 3. 조립 ─────────────────────────

function step3_assemble(folderId) {
  const st = loadState_(folderId);
  if (st.sections.some(s => !s)) throw new Error('아직 내용이 없는 섹션이 있습니다. 2단계를 먼저 끝내 주세요.');
  st.deck = assembleDeck_(st);
  const n = st.deck.length;
  st.flags = st.flags.filter(f => f.indexOf('[분량]') !== 0);
  if (n < 45 || n > 60) st.flags.push(`[분량] ${n}장 — 60분 차시 기준(45–60장)을 벗어났습니다. 원문 양에 따라 달라질 수 있습니다.`);
  saveState_(st);
  return {
    total: n,
    questions: st.deck.filter(s => s.kind === 'question').length,
    answers: st.deck.filter(s => s.answer).length,
    flags: st.flags,
  };
}

// ───────────────────────── 4. 교수용 슬라이드 ─────────────────────────

function step4_build(folderId) {
  const st = loadState_(folderId);
  const folder = DriveApp.getFolderById(folderId);
  if (st.teacherId) trash_(st.teacherId); // 다시 만들 때는 예전 것을 휴지통으로
  const name = `${st.folderName}_교수용`;
  const pres = Slides.Presentations.create({
    title: name,
    pageSize: { width: { magnitude: 720, unit: 'PT' }, height: { magnitude: 405, unit: 'PT' } },
  });
  DriveApp.getFileById(pres.presentationId).moveTo(folder);
  st.teacherId = pres.presentationId;
  st.teacherUrl = `https://docs.google.com/presentation/d/${pres.presentationId}/edit`;
  saveState_(st);

  const ctx = ctx_(st);
  const reqs = [];
  st.deck.forEach((s, i) => renderSlide_(ctx, s, i, reqs));
  reqs.push({ deleteObject: { objectId: pres.slides[0].objectId } }); // 새 파일에 딸려 오는 빈 장
  batch_(pres.presentationId, reqs);

  // 강의 노트(발표자 노트)
  const got = Slides.Presentations.get(pres.presentationId,
    { fields: 'slides(objectId,slideProperties(notesPage(notesProperties(speakerNotesObjectId))))' });
  const notes = [];
  got.slides.forEach((sl, i) => {
    const text = String((st.deck[i] && st.deck[i].notes) || '').trim() || '—';
    notes.push({ insertText: { objectId: sl.slideProperties.notesPage.notesProperties.speakerNotesObjectId, text, insertionIndex: 0 } });
  });
  batch_(pres.presentationId, notes);
  return { url: st.teacherUrl, total: st.deck.length };
}

// ───────────────────────── 5. 학생용 사본 ─────────────────────────

function step5_student(folderId) {
  const st = loadState_(folderId);
  if (st.studentId) trash_(st.studentId);
  const copy = DriveApp.getFileById(st.teacherId).makeCopy(`${st.folderName}_학생용`, DriveApp.getFolderById(folderId));
  const id = copy.getId();
  const pres = Slides.Presentations.get(id,
    { fields: 'slides(objectId,slideProperties(notesPage(notesProperties(speakerNotesObjectId))))' });

  // 정답 장 찾기: 사본도 슬라이드 ID가 같다. 혹시 다르면 순서로 찾는다.
  const ansIds = st.deck.map((s, i) => (s.answer ? slideId_(i) : null)).filter(Boolean);
  let isAns = sl => ansIds.indexOf(sl.objectId) > -1;
  if (pres.slides.filter(isAns).length !== ansIds.length) {
    const byIndex = pres.slides.map((sl, i) => !!(st.deck[i] && st.deck[i].answer));
    isAns = sl => byIndex[pres.slides.indexOf(sl)];
  }
  const keep = pres.slides.filter(sl => !isAns(sl));
  const reqs = pres.slides.filter(isAns).map(sl => ({ deleteObject: { objectId: sl.objectId } }));
  const total = st.deck.length;
  keep.forEach((sl, k) => {
    const old = pres.slides.indexOf(sl);
    reqs.push({ replaceAllText: { containsText: { text: `${old + 1} / ${total}`, matchCase: true },
      replaceText: `${k + 1} / ${keep.length}`, pageObjectIds: [sl.objectId] } });
    reqs.push({ deleteText: { objectId: sl.slideProperties.notesPage.notesProperties.speakerNotesObjectId, textRange: { type: 'ALL' } } });
  });
  batch_(id, reqs);
  st.studentId = id;
  st.studentUrl = `https://docs.google.com/presentation/d/${id}/edit`;
  saveState_(st);
  return { url: st.studentUrl, total: keep.length, removed: total - keep.length };
}

// ───────────────────────── 6. 퀴즈 폼 ─────────────────────────

function step6_quiz(folderId) {
  const st = loadState_(folderId);
  const inp = st.input, o = st.outline, course = COURSES[inp.course];
  if (st.formId) trash_(st.formId);
  const form = FormApp.create(`${course.name} Week ${inp.week}-${inp.session} 확인 퀴즈 — ${o.title_en}`);
  form.setIsQuiz(true)
    .setCollectEmail(false)
    .setDescription(`${o.title_en} · ${inp.book} ${inp.pages}\n` +
      '오늘 수업 내용을 확인하는 퀴즈입니다. 문항마다 하나를 고르세요. 제출하면 바로 점수와 해설을 볼 수 있습니다.');
  o.quiz.forEach((q, n) => {
    const it = form.addMultipleChoiceItem();
    it.setTitle(`${n + 1}. ${q.q}`)
      .setHelpText(q.q_ko || '')
      .setChoices(q.options.map(op => it.createChoice(op, op === q.answer)))
      .setPoints(q.points)
      .setRequired(true)
      .setFeedbackForCorrect(FormApp.createFeedback().setText('정답입니다. ' + (q.explain_ko || '')).build())
      .setFeedbackForIncorrect(FormApp.createFeedback().setText(`정답: ${q.answer}. ${q.explain_ko || ''}`).build());
  });
  DriveApp.getFileById(form.getId()).moveTo(DriveApp.getFolderById(folderId));
  st.formId = form.getId();
  st.formEditUrl = form.getEditUrl();
  st.formUrl = form.getPublishedUrl();
  try { st.formShort = form.shortenFormUrl(st.formUrl); } catch (e) { st.formShort = st.formUrl; }

  // 두 덱의 마무리 장에 퀴즈 링크를 넣는다
  [st.teacherId, st.studentId].filter(Boolean).forEach(id => batch_(id, [
    { replaceAllText: { containsText: { text: '{{QUIZ}}', matchCase: true }, replaceText: st.formShort } }]));
  saveState_(st);
  return { editUrl: st.formEditUrl, url: st.formUrl, count: o.quiz.length,
    points: o.quiz.reduce((a, q) => a + q.points, 0) };
}

// ───────────────────────── 7. 입력 기록 ─────────────────────────

function step7_finish(folderId) {
  const st = loadState_(folderId);
  const inp = st.input, course = COURSES[inp.course];
  if (st.recordId) trash_(st.recordId);
  const doc = DocumentApp.create(`${st.folderName}_입력기록`);
  const body = doc.getBody();
  const h = t => body.appendParagraph(t).setHeading(DocumentApp.ParagraphHeading.HEADING2);
  const p = t => body.appendParagraph(String(t || '—'));
  body.getParagraphs()[0].setText(`입력 기록 — ${st.folderName}`).setHeading(DocumentApp.ParagraphHeading.HEADING1);
  p(`만든 때: ${Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm')}`);
  p(`흐름: 웹앱(단원·교재 내용 입력) → 제미나이 → 구글 슬라이드 → 퀴즈 폼 → 드라이브에 저장`);
  h('결과');
  p(`교수용 슬라이드 (${st.deck.length}장): ${st.teacherUrl}`);
  p(`학생용 슬라이드 (정답 장 제외): ${st.studentUrl}`);
  p(`퀴즈 폼 (학생용 링크): ${st.formUrl}`);
  p(`퀴즈 폼 (편집): ${st.formEditUrl}`);
  h('입력');
  [['과목', course.name], ['주차·차시', `Week ${inp.week}-${inp.session} · ${inp.kind}`], ['교재', `${inp.book} ${inp.pages}`],
    ['단원', inp.unit], ['절 제목', inp.title], ['섹션', inp.sections.join(' / ')], ['학습 목표', inp.goals],
    ['지난 시간', inp.lastClass], ['과제 안내', inp.assignment], ['목표 장수', inp.target]]
    .forEach(([k, v]) => p(`${k}: ${v || '—'}`));
  h('교재 원문'); p(inp.source);
  h('듣기 대본'); p(inp.script);
  h('정답'); p(inp.answers);
  h('검증 결과 (원문 대조)');
  if (st.flags.length) st.flags.forEach(f => body.appendListItem(f)); else p('경고 없음 — 대본·정답·퀴즈 근거가 모두 원문에서 확인되었습니다.');
  h('사용한 모델'); st.models.forEach(m => body.appendListItem(m));
  doc.saveAndClose();
  DriveApp.getFileById(doc.getId()).moveTo(DriveApp.getFolderById(folderId));
  st.recordId = doc.getId();
  st.recordUrl = doc.getUrl();
  st.finished = new Date().toISOString();
  saveState_(st);
  return {
    folderUrl: st.folderUrl, folderName: st.folderName, teacherUrl: st.teacherUrl, studentUrl: st.studentUrl,
    formUrl: st.formUrl, formEditUrl: st.formEditUrl, recordUrl: st.recordUrl,
    total: st.deck.length, flags: st.flags,
  };
}

// ───────────────────────── 입력·폴더·상태 ─────────────────────────

function cleanInput_(f) {
  f = f || {};
  const s = k => String(f[k] == null ? '' : f[k]).trim();
  const course = COURSES[s('course')] ? s('course') : 'ELS1';
  const week = parseInt(s('week'), 10);
  if (!week) throw new Error('주차를 숫자로 넣어 주세요.');
  if (s('source').length < 50) throw new Error('교재 원문을 붙여넣어 주세요 (50자 이상).');
  if (!s('title')) throw new Error('절 제목(교재에 적힌 제목)을 넣어 주세요.');
  return {
    course, week, session: parseInt(s('session'), 10) || 1, kind: s('kind') || '듣기 차시',
    unit: s('unit'), title: s('title'), book: s('book'), pages: s('pages'),
    sections: s('sections').split(/\n+/).map(x => x.trim()).filter(Boolean),
    source: s('source'), script: s('script'), answers: s('answers'),
    goals: s('goals'), lastClass: s('lastClass'), assignment: s('assignment'),
    target: Math.min(60, Math.max(30, parseInt(s('target'), 10) || 48)),
  };
}

function makeFolder_(inp) {
  const it = DriveApp.getRootFolder().getFoldersByName(ROOT_FOLDER);
  const root = it.hasNext() ? it.next() : DriveApp.getRootFolder().createFolder(ROOT_FOLDER);
  const base = `${inp.course}_Week${inp.week}-${inp.session}_${inp.title}`
    .replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, '_').slice(0, 90);
  let name = base, n = 2;
  while (root.getFoldersByName(name).hasNext()) name = `${base}_${n++}`;
  return root.createFolder(name);
}

function loadState_(folderId) {
  const it = DriveApp.getFolderById(folderId).getFilesByName(STATE_FILE);
  if (!it.hasNext()) throw new Error('작업기록 파일이 없습니다. 처음부터 다시 시작해 주세요.');
  return JSON.parse(it.next().getBlob().getDataAsString('UTF-8'));
}

function saveState_(st) {
  const folder = DriveApp.getFolderById(st.folderId);
  const it = folder.getFilesByName(STATE_FILE);
  const text = JSON.stringify(st, null, 1);
  if (it.hasNext()) it.next().setContent(text);
  else folder.createFile(STATE_FILE, text, MimeType.PLAIN_TEXT);
}

function trash_(id) {
  try { DriveApp.getFileById(id).setTrashed(true); } catch (e) { /* 이미 없으면 무시 */ }
}

/** Slides API batchUpdate — 요청이 많으면 나눠 보낸다 */
function batch_(presId, reqs) {
  for (let i = 0; i < reqs.length; i += 400) {
    Slides.Presentations.batchUpdate({ requests: reqs.slice(i, i + 400) }, presId);
  }
}
