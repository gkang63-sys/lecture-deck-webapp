/**
 * 강의 슬라이드 웹앱 (구글 버전)
 *
 * 흐름: 웹앱(단원·교재 내용 입력) → 제미나이 → 구글 슬라이드 → 퀴즈 폼 → 드라이브에 저장
 *
 * 화면(Index.html)이 아래 step 함수를 차례로 부른다.
 *  1 step1_start     폴더 만들기 + 입력 저장 + 덱 뼈대 (제미나이)
 *  2 step2_section   섹션별 슬라이드 내용 (제미나이, 섹션마다 한 번) ┐ 화면이 한꺼번에 부른다
 *    step2_quiz      확인 퀴즈 문항 (제미나이)                    ┘
 *  3 step3_assemble  원문 대조 검증 + 한 장 한 호흡으로 나누기 + 전체 순서 확정
 *  4 step4_build     교수용 구글 슬라이드
 *  5 step5_student   학생용 사본 (정답 장·강의 노트 제외)
 *  6 step6_quiz      구글 폼 퀴즈 (정답·배점·해설)
 *    step6b_html     HTML 덱 (오디오·영상·슬라이드 안 채점 — Claude 덱과 같은 모양)
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

function doGet(e) {
  if (e && e.parameter && e.parameter.deck) return deckPage_(e.parameter.deck); // HTML 덱 미리보기
  if (e && e.parameter && e.parameter.redo) return redoPage_(e.parameter.redo);  // 링크 한 번으로 마무리
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

/** 폴더와 입력 기록만 먼저 만든다 (금방 끝남). 뼈대가 실패해도 같은 폴더에서 다시 할 수 있게. */
function step0_folder(form) {
  const inp = cleanInput_(form);
  const folder = makeFolder_(inp);
  const st = {
    folderId: folder.getId(), folderUrl: folder.getUrl(), folderName: folder.getName(),
    input: inp, created: new Date().toISOString(), models: [], flags: [],
  };
  saveState_(st);
  return { folderId: st.folderId, folderUrl: st.folderUrl, folderName: st.folderName };
}

function step1_start(folderId) {
  const st = loadState_(folderId);
  const res = geminiJson_(outlinePrompt_(st.input), folderId, '뼈대');
  // 뼈대를 새로 짜면 예전 섹션·퀴즈 결과는 맞지 않으므로 지운다
  const files = DriveApp.getFolderById(folderId).getFiles();
  while (files.hasNext()) { const f = files.next(); if (/^(섹션_\d+|퀴즈)\.json$/.test(f.getName())) f.setTrashed(true); }
  st.flags = [];
  st.models = ['뼈대: ' + res.model];
  st.outline = checkOutline_(res.json, st.input, st.flags);
  st.sections = st.outline.sections.map(() => null);
  saveState_(st);
  return { title: st.outline.title_en, sections: st.outline.sections.map(s => s.name_en), model: res.model };
}

// ───────────────────────── 2. 섹션 내용 · 퀴즈 (동시에) ─────────────────────────
// 섹션마다 제미나이가 1–3분 걸린다. 화면이 섹션들과 퀴즈를 한꺼번에 부르므로,
// 서로 덮어쓰지 않게 각자 자기 파일(섹션_1.json …, 퀴즈.json)에만 쓰고 3단계에서 합친다.

function step2_section(folderId, i) {
  const st = loadState_(folderId);
  const sec = st.outline.sections[i];
  const res = geminiJson_(sectionPrompt_(st.input, st.outline, i), folderId, '섹션' + (i + 1));
  const raw = res.json;
  const flags = [];
  const slides = checkSectionSlides_(Array.isArray(raw) ? raw : raw.slides, st.input, sec, flags);
  savePart_(folderId, `섹션_${i + 1}.json`, { slides, flags, model: `${sec.name_en}: ${res.model}` });
  return { name: sec.name_en, count: slides.length, model: res.model };
}

function step2_quiz(folderId) {
  const st = loadState_(folderId);
  const res = geminiJson_(quizPrompt_(st.input, st.outline), folderId, '퀴즈');
  const raw = res.json;
  const flags = [];
  const quiz = checkQuiz_(Array.isArray(raw) ? raw : raw.quiz, st.input, flags);
  if (quiz.length < 5) flags.push(`[퀴즈] 원문으로 확인되는 문항이 ${quiz.length}개뿐입니다.`);
  savePart_(folderId, '퀴즈.json', { quiz, flags, model: '퀴즈: ' + res.model });
  return { count: quiz.length, model: res.model };
}

// ───────────────────────── 3. 조립 ─────────────────────────

function step3_assemble(folderId) {
  const st = loadState_(folderId);
  const parts = st.outline.sections.map((s, i) => loadPart_(folderId, `섹션_${i + 1}.json`));
  const missing = parts.map((p, i) => (p ? null : st.outline.sections[i].name_en)).filter(Boolean);
  if (missing.length) throw new Error('아직 내용이 없는 섹션이 있습니다: ' + missing.join(', '));
  const quiz = loadPart_(folderId, '퀴즈.json');
  if (!quiz) throw new Error('퀴즈 문항이 아직 없습니다.');
  st.sections = parts.map(p => p.slides);
  st.outline.quiz = quiz.quiz;
  st.flags = st.flags.filter(f => /^\[(표현 모음|과제)\]/.test(f))
    .concat(...parts.map(p => p.flags), quiz.flags);
  st.models = st.models.filter(m => m.indexOf('뼈대') === 0).concat(parts.map(p => p.model), [quiz.model]);
  st.deck = assembleDeck_(st);
  st.audioJobs = audioJobsFor_(st);
  const n = st.deck.length;
  if (n < 45 || n > 60) st.flags.push(`[분량] ${n}장 — 60분 차시 기준(45–60장)을 벗어났습니다. 원문 양에 따라 달라질 수 있습니다.`);
  saveState_(st);
  return {
    total: n,
    questions: st.deck.filter(s => s.kind === 'question').length,
    answers: st.deck.filter(s => s.answer).length,
    videos: st.deck.filter(s => s.kind === 'video').length,
    audio: st.audioJobs.length,
    flags: st.flags,
  };
}

/** 오디오 할 일: 대본 전체(듣기 장) + 대본 장마다 그 장의 줄 */
function audioJobsFor_(st) {
  const jobs = [];
  st.audioMerge = [];
  if (st.input.audioFull) {
    try { linkOwnAudio_(st.folderId, st.input.audioFull); } catch (e) { st.flags.push('[음원] 듣기 음원 링크를 열 수 없습니다: ' + e.message); }
  } else if (st.deck.some(s => s.kind === 'listen')) {
    const own = loadPart_(st.folderId, '오디오_full.json');
    if (own && own.own) DriveApp.getFolderById(st.folderId).getFilesByName('오디오_full.json').next().setTrashed(true); // 링크를 지웠으면 합성 음성으로
    const sp = splitAudioJob_('full', '듣기_대본_전체', st.input.script.split(/\n+/));
    sp.jobs.forEach(j => jobs.push(j));
    if (sp.merge) st.audioMerge.push(sp.merge);
  }
  st.deck.forEach((s, i) => {
    if (s.kind !== 'script') return;
    const lines = s.lines.filter(l => l.en.indexOf(NEED) < 0).map(l => (l.spk ? l.spk + ': ' : '') + l.en);
    if (lines.length) jobs.push(audioJob_(s.audioKey, `대본_${i + 1}장`, lines));
  });
  return jobs;
}

/** 결과 화면의 [영상 넣고 다시 만들기]: 영상 링크만 바꾸고 조립부터 다시 — 제미나이 글 생성은 다시 부르지 않는다 */
function setVideos(folderId, f) {
  const st = loadState_(folderId);
  f = f || {};
  st.input.videos = parseVideos_(f);
  st.input.videoOverview = String(f.videoOverview || '');
  st.input.videoSections = String(f.videoSections || '');
  st.input.audioFull = String(f.audioFull || '').trim();
  saveState_(st);
  return { overview: !!st.input.videos.overview, sections: st.input.videos.sections.filter(Boolean).length };
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
  ctx.audio = audioMap_(folderId, st.audioJobs);
  const reqs = [];
  st.deck.forEach((s, i) => renderSlide_(ctx, s, i, reqs));
  reqs.push({ deleteObject: { objectId: pres.slides[0].objectId } }); // 새 파일에 딸려 오는 빈 장
  batch_(pres.presentationId, reqs);
  (reqs.videos || []).forEach((v, k) => {
    try { batch_(pres.presentationId, [v.req]); } catch (e) {
      const id = `${v.pid}_vl${k}`;
      batch_(pres.presentationId, [
        { createShape: { objectId: id, shapeType: 'ROUND_RECTANGLE', elementProperties: { pageObjectId: v.pid, size: { width: pt_(v.w), height: pt_(60) },
          transform: { scaleX: 1, scaleY: 1, translateX: v.x, translateY: v.y + v.h / 2 - 30, unit: 'PT' } } } },
        { insertText: { objectId: id, text: '▶  영상 열기 (드라이브에서 재생)' } },
        { updateShapeProperties: { objectId: id, shapeProperties: { link: { url: v.link }, contentAlignment: 'MIDDLE' }, fields: 'link,contentAlignment' } },
        { updateTextStyle: { objectId: id, textRange: { type: 'ALL' }, style: { fontFamily: 'Inter', bold: true, fontSize: pt_(16) }, fields: 'fontFamily,bold,fontSize' } },
        { updateParagraphStyle: { objectId: id, textRange: { type: 'ALL' }, style: { alignment: 'CENTER' }, fields: 'alignment' } },
      ]);
    }
  });

  // 강의 노트(발표자 노트)
  const got = Slides.Presentations.get(pres.presentationId,
    { fields: 'slides(objectId,slideProperties(notesPage(notesProperties(speakerNotesObjectId))))' });
  const notes = [];
  got.slides.forEach((sl, i) => {
    const text = String((st.deck[i] && st.deck[i].notes) || '').trim() || '—';
    notes.push({ insertText: { objectId: sl.slideProperties.notesPage.notesProperties.speakerNotesObjectId, text, insertionIndex: 0 } });
  });
  batch_(pres.presentationId, notes);
  const images = placePageImages_(pres.presentationId, st.deck);
  return { url: st.teacherUrl, total: st.deck.length, images };
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
  const first = body.getParagraphs()[0]; // setText는 문단을 돌려주지 않으므로 나눠 부른다
  first.setText(`입력 기록 — ${st.folderName}`);
  first.setHeading(DocumentApp.ParagraphHeading.HEADING1);
  p(`만든 때: ${Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm')}`);
  p(`흐름: 웹앱(단원·교재 내용 입력) → 제미나이 → 구글 슬라이드 → 퀴즈 폼 → 드라이브에 저장`);
  h('결과');
  p(`교수용 슬라이드 (${st.deck.length}장): ${st.teacherUrl}`);
  p(`학생용 슬라이드 (정답 장 제외): ${st.studentUrl}`);
  p(`퀴즈 폼 (학생용 링크): ${st.formUrl}`);
  p(`퀴즈 폼 (편집): ${st.formEditUrl}`);
  if (st.htmlUrl) p(`HTML 덱 (교수용·학생용, JNUclass에 올리는 파일): ${st.htmlUrl} · ${st.htmlStudentUrl}`);
  h('입력');
  [['과목', course.name], ['주차·차시', `Week ${inp.week}-${inp.session} · ${inp.kind}`], ['교재', `${inp.book} ${inp.pages}`],
    ['단원', inp.unit], ['절 제목', inp.title], ['섹션', inp.sections.join(' / ')], ['학습 목표', inp.goals],
    ['지난 시간', inp.lastClass], ['과제 안내', inp.assignment], ['목표 장수', inp.target]]
    .forEach(([k, v]) => p(`${k}: ${v || '—'}`));
  h('교재 원문'); p(inp.source);
  h('듣기 대본'); p(inp.script);
  h('정답'); p(inp.answers);
  h('교안·지도서 해설'); p(inp.plan);
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
    htmlView: st.htmlView, htmlStudentView: st.htmlStudentView, htmlUrl: st.htmlUrl, htmlStudentUrl: st.htmlStudentUrl,
    total: st.deck.length, flags: st.flags,
  };
}

// ───────────────────────── 링크 한 번으로 마무리 (?redo=폴더ID) ─────────────────────────
// 빠진 음성 조각만 만들어 잇고 → 슬라이드·학생용·HTML 덱·기록을 다시 만든다. 글 생성·퀴즈 폼은 그대로 둔다.

function redoPage_(folderId) {
  const log = [];
  const t0 = Date.now();
  try {
    const st = loadState_(folderId);
    let made = 0, fail = 0;
    (st.audioJobs || []).forEach((j, k) => {
      if (Date.now() - t0 > 150 * 1000 || loadPart_(folderId, `오디오_${j.key}.json`)) return;
      try { step3_audio(folderId, k); made++; } catch (e) { fail++; log.push('음성 실패: ' + j.title + ' — ' + e.message); }
    });
    const m = step3_audioMerge(folderId);
    log.push(`음성 ${made}개 새로 만듦${fail ? ', ' + fail + '개 실패' : ''} · 이어 붙인 전체 음성 ${m.merged}개`);
    const b = step4_build(folderId); log.push(`교수용 슬라이드 ${b.total}장`);
    const s = step5_student(folderId); log.push(`학생용 ${s.total}장`);
    const st2 = loadState_(folderId);
    if (st2.formShort) [st2.teacherId, st2.studentId].forEach(id => batch_(id, [
      { replaceAllText: { containsText: { text: '{{QUIZ}}', matchCase: true }, replaceText: st2.formShort } }]));
    const h = step6b_html(folderId); log.push(`HTML 덱 ${h.slides}장 · ${h.mb}MB · 음원 ${h.audio}개`);
    const r = step7_finish(folderId);
    const a = (href, t) => `<p><a href="${href}" target="_blank" style="font-size:18px">${t} ↗</a></p>`;
    return HtmlService.createHtmlOutput(`<div style="font-family:sans-serif;max-width:640px;margin:40px auto;line-height:1.7">
      <h2>마무리 완료 — ${escH_(r.folderName)}</h2><ul>${log.map(x => '<li>' + escH_(x) + '</li>').join('')}</ul>
      ${a(r.htmlView, 'HTML 덱 열기 (교수용)')}${a(r.htmlStudentView, 'HTML 덱 열기 (학생용)')}${a(r.teacherUrl, '구글 슬라이드 (교수용)')}${a(r.studentUrl, '구글 슬라이드 (학생용)')}${a(r.folderUrl, '드라이브 폴더')}</div>`).setTitle('마무리 완료');
  } catch (e) {
    return HtmlService.createHtmlOutput(`<div style="font-family:sans-serif;max-width:640px;margin:40px auto"><h2>멈췄습니다</h2><p>${escH_(e.message)}</p><ul>${log.map(x => '<li>' + escH_(x) + '</li>').join('')}</ul><p>이 페이지를 새로고침하면 이어서 다시 합니다.</p></div>`);
  }
}

// ───────────────────────── 이전 결과 다시 열기 ─────────────────────────

/** 강의자료/ 아래 최근 결과 폴더 (작업기록이 있는 것만) */
function listJobs() {
  const it = DriveApp.getRootFolder().getFoldersByName(ROOT_FOLDER);
  if (!it.hasNext()) return [];
  const out = [], fs = it.next().getFolders();
  while (fs.hasNext()) {
    const f = fs.next();
    if (f.getName().charAt(0) === '_' || !f.getFilesByName(STATE_FILE).hasNext()) continue;
    out.push({ id: f.getId(), name: f.getName(), t: f.getDateCreated().getTime() });
  }
  return out.sort((a, b) => b.t - a.t).slice(0, 15)
    .map(x => ({ id: x.id, name: x.name, date: Utilities.formatDate(new Date(x.t), 'Asia/Seoul', 'MM-dd HH:mm') }));
}

function openJob(folderId) {
  const st = loadState_(folderId);
  if (!st.outline || !st.deck) throw new Error('이 폴더는 조립 단계까지 끝나지 않았습니다. 처음부터 다시 만들어 주세요.');
  return {
    folderId, folderUrl: st.folderUrl, folderName: st.folderName,
    sections: st.outline.sections.map(s => s.name_en),
    videoOverview: st.input.videoOverview || '', videoSections: st.input.videoSections || '', audioFull: st.input.audioFull || '',
    result: st.finished ? {
      folderUrl: st.folderUrl, folderName: st.folderName, teacherUrl: st.teacherUrl, studentUrl: st.studentUrl,
      formUrl: st.formUrl, formEditUrl: st.formEditUrl, recordUrl: st.recordUrl, total: st.deck.length, flags: st.flags,
      htmlView: st.htmlView, htmlStudentView: st.htmlStudentView, htmlUrl: st.htmlUrl, htmlStudentUrl: st.htmlStudentUrl,
    } : null,
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
    source: s('source'), script: s('script'), answers: s('answers'), plan: s('plan'),
    pageImages: parseImages_(f.pageImages), videos: parseVideos_(f), audioFull: s('audioFull'),
    videoOverview: s('videoOverview'), videoSections: s('videoSections'),
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

function savePart_(folderId, name, obj) {
  const folder = DriveApp.getFolderById(folderId);
  const it = folder.getFilesByName(name);
  const text = JSON.stringify(obj);
  if (it.hasNext()) it.next().setContent(text); else folder.createFile(name, text, MimeType.PLAIN_TEXT);
}

function loadPart_(folderId, name) {
  const it = DriveApp.getFolderById(folderId).getFilesByName(name);
  return it.hasNext() ? JSON.parse(it.next().getBlob().getDataAsString('UTF-8')) : null;
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
