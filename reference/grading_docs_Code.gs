/**
 * 영어 과제 AI 채점 도우미 — 구글 문서 제출판 (Google Forms + Docs + Sheets + Gemini)
 *
 * 흐름: 학생이 구글 문서·Word로 대본 작성 → 폼에서 파일 업로드
 *      → 제미나이 채점 → 학생별 피드백 문서 자동 생성 → 교사 검토 → 문서를 공유하고 링크를 메일로 발송
 *
 * 처음 한 번
 *  1) 스프레드시트 > 확장 프로그램 > Apps Script 에 이 코드를 붙여넣고 저장
 *  2) 시트를 새로고침하면 상단에 [🤖 AI 채점] 메뉴가 생김
 *  3) ① API 키 등록 → ② 채점기준·예시 만들기 → ③ 과제 제출 폼 만들기
 */

// 사용할 Gemini 모델 (앞에서부터 시도). 첫 모델이 붐비거나 없으면 다음 모델로 넘어갑니다.
// 모델 이름은 Google AI Studio의 모델 목록에서 확인할 수 있습니다.
const MODELS = ['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-flash-latest'];

const RUBRIC_SHEET = '채점기준';
const SAMPLE_SHEET = '제출물(문서 예시)';

// 결과 열 (오른쪽 끝에 자동으로 추가됨)
const COL = {
  words: '단어 수',
  items: '항목별 점수',
  minus: '별도 감점',
  score: 'AI 점수',
  doc: '피드백 문서',
  reason: '채점 근거(교사용)',
  check: '확인 사항',
  status: '상태',
};
const STATUS = { WAIT: '검토 대기', OK: '승인', SENT: '발송 완료', ERROR: '오류' };

// 입력 열을 찾을 때 쓰는 글자 (열 제목에 이 글자가 들어 있으면 그 열로 봄)
const FIND = {
  name: ['이름', 'name'],
  id: ['학번', 'student number'],
  email: ['이메일', 'email'],
  work: ['대본', 'script', '과제', '파일', 'file', '에세이', 'essay'],
  video: ['영상', 'video'],
};

// 글을 꺼낼 수 있는 파일 형식 (구글 문서로 바꿔서 읽음)
const CONVERTIBLE = {
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'Word',
  'application/msword': 'Word(.doc)',
  'application/pdf': 'PDF',
  'application/rtf': 'RTF',
};

// ───────────────────────── 메뉴 ─────────────────────────

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('🤖 AI 채점')
    .addItem('① Gemini API 키 등록', 'setApiKey')
    .addItem('② 채점기준·예시 만들기', 'createSampleSheets')
    .addItem('③ 과제 제출 폼 만들기', 'createSubmissionForm')
    .addSeparator()
    .addItem('④ 선택한 행 채점', 'gradeSelectedRows')
    .addItem('⑤ 채점 안 된 행 모두 채점', 'gradeAllPending')
    .addSeparator()
    .addItem('⑥ [승인] 행에 피드백 보내기', 'sendApprovedFeedback')
    .addSeparator()
    .addItem('폼 제출 시 자동 채점 켜기', 'enableAutoGrade')
    .addItem('자동 채점 끄기', 'disableAutoGrade')
    .addToUi();
}

function setApiKey() {
  const ui = SpreadsheetApp.getUi();
  const res = ui.prompt('Gemini API 키 등록',
    'Google AI Studio(aistudio.google.com)에서 발급한 API 키를 붙여넣으세요.\n키는 이 스크립트에만 저장됩니다.',
    ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  const key = res.getResponseText().trim();
  if (!key) return ui.alert('키가 비어 있습니다.');
  PropertiesService.getScriptProperties().setProperty('GEMINI_API_KEY', key);
  ui.alert('저장했습니다.');
}

// ───────────────────────── ② 채점기준·예시 ─────────────────────────

const SAMPLES = [
  { name: '김하늘', id: '20260001', email: 'student1@example.com', video: 'https://youtu.be/example1', paras: [
    "Hello, everyone. Today I'd like to introduce my friend Minji. She is twenty years old and she studies nursing at Jeju National University.",
    'The most interesting thing about Minji is her hobby. She swims in the sea every morning, even in winter! She says cold water makes her feel awake and positive. She is very brave and patient. When I tried it with her, I could stay in the water for only one minute, but she stays for twenty minutes.',
    'She also picks up trash on the beach after she swims, because she wants to protect the ocean. I think she is a very responsible person. In the future, she wants to be a nurse on a small island. I think she will be a wonderful nurse. Thank you for listening.',
  ] },
  { name: '이도윤', id: '20260002', email: 'student2@example.com', video: 'https://drive.google.com/example2', paras: [
    'My father. He is 50 years old. He work in a hotel. He is kind and funny.',
    'He like fishing. Last year he catched a big fish. Every weekend he go to the sea. I like my father. Thank you.',
  ] },
  { name: '박서연', id: '20260003', email: 'student3@example.com', video: '', paras: [
    'Hi, I want to introduce my grandmother. Her name is Kim Okja and she lives in Seogwipo. She is seventy-eight years old, but she is still very active.',
    'The most interesting thing about her is that she was a haenyeo for fifty years. A haenyeo is a woman diver who catches seafood without any oxygen tank. She can hold her breath for two minutes. She is strong, hardworking, and very generous. She always gives seafood to our neighbors.',
    "Now she doesn't dive anymore, but she teaches young people about haenyeo culture at a small museum. I am proud of her. I hope many people learn about haenyeo culture. Thank you.",
  ] },
];

function createSampleSheets() {
  const ss = SpreadsheetApp.getActive();

  if (!ss.getSheetByName(RUBRIC_SHEET)) {
    const r = ss.insertSheet(RUBRIC_SHEET);
    r.getRange('A1:B7').setValues([
      ['과제명', 'Week 4 Speaking Task: Introduce a Person (예시 — 이번 주 과제로 바꾸세요)'],
      ['과제 설명', '주변 인물 한 명을 인터뷰하고, 그 사람의 흥미로운 점 하나를 골라 1–2분 발표 대본을 쓴다. 현재 시제로 인물을 묘사하고, 교재의 도입 표현과 성격 어휘를 사용한다.'],
      ['분량', '약 150–250단어 (절대 경계가 아님. 148단어나 261단어를 기계적으로 감점하지 않음)'],
      ['피드백 말투', '쉬운 영어(CEFR A2–B1), 따뜻하고 구체적으로. 칭찬은 근거와 함께, 지적은 대안과 함께.'],
      ['영상 미제출 감점', 0.5],
      ['만점 유보 감점', 0.25],
      ['채점 원칙', '같은 사유로 두 항목에서 감점하지 않는다. 0.25 단위로 매기고 감점마다 근거 문장을 인용한다. 과제 안내에 없는 요건으로 감점하지 않는다. 목표 시제 요건은 인물을 묘사하는 문장에만 적용한다(닫는 문장의 예측, 기간을 말하는 현재완료는 위반 아님). 문법 오류와 문체 개선을 구분한다. 의도나 작성 도구를 추정하지 않는다.'],
    ]);
    r.getRange('A9:C9').setValues([['채점 항목', '배점', '보는 것']]);
    r.getRange('A10:C13').setValues([
      ['영어 사용 (Use of English)', 4, '문법·어휘의 정확성과 자연스러움, 목표 시제의 일관성'],
      ['초점과 구성 (Focus & Organization)', 3, '흥미로운 점 하나를 잡아 구체적으로 전개했는가 / 열고-기본정보-전개-닫는 순서 / 묻지 않은 내용이 섞이지 않았는가'],
      ['표현 (Expressions)', 2, '지정 도입 표현 0.5 · 지정 어휘 0.5 · 성격 어휘 0.5 · 문장 변화 0.5'],
      ['완성도 (Completeness)', 1, '분량 0.5 · 본문에 이름·학번 0.25 · 지정 제출물 제출 0.25'],
    ]);
    r.getRange('A1:A7').setFontWeight('bold').setBackground('#e8f0fe');
    r.getRange('A9:C9').setFontWeight('bold').setBackground('#e8f0fe');
    r.getRange('B1:C13').setWrap(true);
    r.setColumnWidth(1, 200); r.setColumnWidth(2, 460); r.setColumnWidth(3, 420);
  }

  if (!ss.getSheetByName(SAMPLE_SHEET)) {
    const folder = getFolder_('예시 제출물');
    const rows = SAMPLES.map(s => {
      const doc = DocumentApp.create(`${s.id}_${s.name}_Week4_Script`);
      const body = doc.getBody();
      body.getParagraphs()[0].setText('Introduce a Person');
      body.appendParagraph(`Name: ${s.name}`);
      body.appendParagraph(`Student Number: ${s.id}`);
      s.paras.forEach(p => body.appendParagraph(p).setIndentFirstLine(28));
      doc.saveAndClose();
      DriveApp.getFileById(doc.getId()).moveTo(folder);
      return [new Date(), s.email, s.name + ' (예시)', s.id, doc.getUrl(), s.video];
    });
    const sh = ss.insertSheet(SAMPLE_SHEET, 0);
    sh.getRange('A1:F1').setValues([['타임스탬프', '이메일', '이름', '학번', '대본 파일', '발표 영상 링크']]);
    sh.getRange(2, 1, rows.length, 6).setValues(rows);
    sh.getRange('A1:F1').setFontWeight('bold').setBackground('#e8f0fe');
    sh.setFrozenRows(1);
    ensureColumns_(sh);
  }

  SpreadsheetApp.getUi().alert(
    `[채점기준] 시트와 [${SAMPLE_SHEET}] 시트를 만들었습니다.\n` +
    "예시 학생 3명의 대본은 드라이브의 '예시 제출물' 폴더에 구글 문서로 들어 있습니다.\n\n" +
    `[${SAMPLE_SHEET}] 시트를 연 채로 ⑤번 메뉴를 실행해 채점을 시험해 보세요.`);
}

// ───────────────────────── ③ 과제 제출 폼 ─────────────────────────

function createSubmissionForm() {
  const ss = SpreadsheetApp.getActive();
  const rubric = readRubric_();

  const form = FormApp.create(rubric.title + ' — 제출');
  form.setDescription(
    'Upload your script file (Google Docs or Word). Then add your video link.\n' +
    '대본 파일(구글 문서 또는 Word)을 올리고, 발표 영상 링크를 넣어 주세요.\n\n' +
    `Length: ${rubric.length}`);
  try {
    form.setEmailCollectionType(FormApp.EmailCollectionType.VERIFIED);
  } catch (e) {
    form.setCollectEmail(true);
  }
  form.setAllowResponseEdits(true);
  form.addTextItem().setTitle('이름 (Name)').setRequired(true);
  form.addTextItem().setTitle('학번 (Student Number)').setRequired(true);
  form.addTextItem()
    .setTitle('발표 영상 링크 (Video link)')
    .setHelpText('YouTube(일부 공개) 또는 Google Drive 링크. 공유 설정을 "링크가 있는 모든 사용자"로 해 주세요.')
    .setRequired(false);
  form.setDestination(FormApp.DestinationType.SPREADSHEET, ss.getId());

  const html = HtmlService.createHtmlOutput(
    '<div style="font-family:sans-serif;line-height:1.7;font-size:14px">' +
    '<p>폼을 만들고 이 스프레드시트에 연결했습니다. <b>파일 업로드 질문은 구글이 코드로 만들 수 없게 막아 두어서, 한 번만 직접 추가</b>해 주세요.</p>' +
    `<p><b>1.</b> <a href="${form.getEditUrl()}" target="_blank">폼 편집 화면 열기</a></p>` +
    '<p><b>2.</b> 오른쪽 ⊕(질문 추가) → 질문 유형을 <b>파일 업로드</b>로 바꾸기 → "계속"<br>' +
    '<b>3.</b> 질문 제목: <b>대본 파일 (Script file)</b> · 필수 켜기<br>' +
    '<b>4.</b> 특정 파일 형식만 허용 → <b>문서, PDF</b> · 최대 파일 수 1 · 최대 크기 10MB</p>' +
    `<p><b>학생용 링크</b> (JNUclass에 붙여넣기)<br><a href="${form.getPublishedUrl()}" target="_blank">${form.getPublishedUrl()}</a></p>` +
    '<p style="color:#666">학생은 구글 계정으로 로그인해야 파일을 올릴 수 있습니다. 올린 파일은 내 드라이브의 폼 폴더에 자동으로 모입니다.</p></div>')
    .setWidth(560).setHeight(430);
  SpreadsheetApp.getUi().showModalDialog(html, '과제 제출 폼 — 마지막 한 단계');
}

// ───────────────────────── ④⑤ 채점 ─────────────────────────

function gradeSelectedRows() {
  const sheet = SpreadsheetApp.getActiveSheet();
  if (!checkSheet_(sheet)) return;
  const range = sheet.getActiveRange();
  let n = 0;
  for (let row = Math.max(range.getRow(), 2); row <= range.getLastRow(); row++) {
    if (gradeRow_(sheet, row)) n++;
  }
  SpreadsheetApp.getActive().toast(`${n}개 행을 채점했습니다. 피드백 문서를 검토하고 [상태]를 '승인'으로 바꾸세요.`, 'AI 채점', 8);
}

function gradeAllPending() {
  const sheet = SpreadsheetApp.getActiveSheet();
  if (!checkSheet_(sheet)) return;
  const cols = ensureColumns_(sheet);
  const started = Date.now();
  let n = 0, left = 0;
  for (let row = 2; row <= sheet.getLastRow(); row++) {
    const status = sheet.getRange(row, cols.status).getValue();
    if (status !== '' && status !== STATUS.ERROR) continue;
    // Apps Script는 한 번에 6분까지만 실행되므로 4분 30초가 지나면 멈춤
    if (Date.now() - started > 270 * 1000) { left++; continue; }
    if (gradeRow_(sheet, row)) n++;
  }
  const msg = left ? `${n}개 채점. 시간이 부족해 ${left}개가 남았습니다. ⑤번을 한 번 더 실행하세요.` : `${n}개 행을 채점했습니다.`;
  SpreadsheetApp.getActive().toast(msg, 'AI 채점', 10);
}

/** 한 행을 채점해 결과 열과 피드백 문서를 만듦. 성공하면 true */
function gradeRow_(sheet, row) {
  const cols = ensureColumns_(sheet);
  const get = c => (c ? String(sheet.getRange(row, c).getValue()).trim() : '');
  const set = (c, v) => sheet.getRange(row, cols[c]).setValue(v);
  const raw = get(cols.work);
  if (!raw) return false;

  const name = get(cols.name).replace(/\s*\(예시\)$/, '');
  const studentId = get(cols.id);
  const rubric = readRubric_();

  try {
    const sub = readSubmission_(raw);
    const words = (bodyText_(sub.text).match(/[A-Za-z][A-Za-z'’-]*/g) || []).length;
    const r = parseJson_(callGemini_(buildPrompt_(rubric, name, studentId, words, sub)));

    // 항목 점수: 0.25 단위로 맞추고 배점을 넘지 않게
    const scored = rubric.items.map((item, i) => {
      const got = (r.items || []).find(x => x.name === item.name) || (r.items || [])[i] || {};
      return { name: item.name, points: item.points, score: clamp_(quarter_(Number(got.score) || 0), 0, item.points), reason: got.reason || '' };
    });
    const subtotal = scored.reduce((a, s) => a + s.score, 0);

    // 별도 감점: 계산은 코드가 직접 (AI에게 맡기지 않음)
    const minus = [];
    if (cols.video && !get(cols.video) && rubric.videoPenalty) minus.push({ ko: '영상 미제출', en: 'Video not submitted', v: rubric.videoPenalty });
    if (subtotal === rubric.max && rubric.perfectHold) minus.push({ ko: '만점 유보', en: 'Full-score hold (course policy)', v: rubric.perfectHold });
    const final = Math.max(0, subtotal - minus.reduce((a, m) => a + m.v, 0));

    // 검증: 수정 대본이 원문과 맞는지, 인용이 원문에 있는지
    const checks = verify_(sub.text, r);
    if (r.checks) checks.unshift(r.checks);

    // 피드백 문서 (다시 채점하면 예전 문서는 휴지통으로)
    const oldUrl = docUrl_(sheet, row, cols);
    const doc = makeFeedbackDoc_({ rubric, name, studentId, words, scored, subtotal, minus, final, r });
    trashDoc_(oldUrl);

    set('words', words);
    set('items', scored.map(s => `${s.name.replace(/\s*\(.*\)$/, '')} ${s.score}/${s.points}`).join(' / '));
    set('minus', minus.length ? minus.map(m => `${m.ko} -${m.v}`).join(', ') : '없음');
    set('score', final);
    sheet.getRange(row, cols.doc).setRichTextValue(
      SpreadsheetApp.newRichTextValue().setText('피드백 문서 열기').setLinkUrl(doc.url).build());
    set('reason', scored.map(s => `[${s.name.replace(/\s*\(.*\)$/, '')} ${s.score}/${s.points}] ${s.reason}`).join('\n'));
    set('check', [`제출 형식: ${sub.format}`].concat(checks).join('\n'));
    set('status', STATUS.WAIT);
    return true;
  } catch (err) {
    set('check', '채점 실패: ' + err.message);
    set('status', STATUS.ERROR);
    return false;
  }
}

function buildPrompt_(rubric, name, studentId, words, sub) {
  return [
    '당신은 한국 대학의 교양영어 강사입니다. 아래 채점 기준대로 학생의 영어 발표 대본(또는 글)을 채점하고 피드백을 쓰세요.',
    '',
    `[과제명] ${rubric.title}`,
    `[과제 설명] ${rubric.task}`,
    `[분량] ${rubric.length} — 이 학생의 본문은 약 ${words}단어 (자동 계산, 참고용)`,
    `[채점 원칙] ${rubric.principles}`,
    '[채점 항목]',
    rubric.items.map(i => `- ${i.name} (${i.points}점): ${i.desc}`).join('\n'),
    '',
    '주의: 영상 제출 여부와 만점 유보는 프로그램이 따로 처리하니 항목 점수에 반영하지 마세요.',
    `[학생] 이름: ${name || '(없음)'} / 학번: ${studentId || '(없음)'} / 제출 형식: ${sub.format}`,
    '[학생 제출물 원문]',
    '"""',
    sub.text,
    '"""',
    '',
    '다음 JSON 형식으로만 답하세요. 점수는 0.25 단위입니다.',
    '{',
    '  "items": [ {"name": "항목 이름(위와 똑같이)", "score": 숫자, "reason": "감점 근거를 한국어로, 학생 문장을 큰따옴표로 인용"} ],',
    '  "summary": "학생에게 주는 한 문단 요약 (영어)",',
    '  "well": "잘된 점 한 문단 (영어). 학생 문장을 큰따옴표로 그대로 인용하고 왜 효과적인지 설명",',
    '  "improve": "고칠 점 한 문단 (영어). 구체적으로, 대안과 함께",',
    '  "changes": ["수정 대본에서 바꾼 곳과 이유 (영어)", "..."],',
    '  "revised": [ [ {"t": "글 조각", "k": "keep|add|del"} ] ],',
    '  "checks": "교사가 확인할 점 (한국어). 없으면 빈 문자열"',
    '}',
    '',
    '규칙:',
    '- revised는 제목·이름·학번 줄을 뺀 발표 본문만 담습니다. 원문 문단마다 배열 하나, 원문 문단 순서대로.',
    '- revised에서 keep과 del 조각을 순서대로 이으면 원문 본문과 한 글자도 달라지면 안 됩니다. 고칠 말은 del, 새로 쓸 말은 add로 나눕니다.',
    '- 학생 글에 없는 사실·일화·이름·숫자는 절대 지어내지 마세요. 정보를 보태야 하면 add로 "______"를 넣고 changes에 "Revision task"라고 적으세요.',
    '- 큰따옴표는 학생 원문을 그대로 인용할 때만 씁니다. 고쳐 쓴 예시는 "→" 뒤에 따옴표 없이 씁니다.',
    '- 다른 학생과 비교하지 마세요.',
    `- summary, well, improve, changes는 학생에게 보내는 글입니다. 이렇게 쓰세요: ${rubric.tone}`,
  ].join('\n');
}

// ───────────────────────── 제출 파일 읽기 ─────────────────────────

/** 칸의 내용이 드라이브·문서 링크면 파일을 열어 글을 꺼내고, 아니면 붙여넣은 글로 봄 */
function readSubmission_(raw) {
  const ids = /https?:\/\//.test(raw) ? (raw.match(/[-\w]{25,}/g) || []) : [];
  if (!ids.length) return { text: raw, format: '붙여넣기' };
  const parts = ids.map(readFile_);
  return { text: parts.map(p => p.text).join('\n\n'), format: parts.map(p => `${p.format} (${p.name})`).join(', ') };
}

function readFile_(id) {
  const file = DriveApp.getFileById(id);
  const mime = file.getMimeType();
  const name = file.getName();
  if (mime === MimeType.GOOGLE_DOCS) {
    return { text: DocumentApp.openById(id).getBody().getText(), format: '구글 문서', name };
  }
  if (mime === MimeType.PLAIN_TEXT) {
    return { text: file.getBlob().getDataAsString('UTF-8'), format: '텍스트', name };
  }
  if (!CONVERTIBLE[mime]) {
    if (/\.hwpx?$/i.test(name)) throw new Error(`한글 파일(${name})은 읽을 수 없습니다. Word나 구글 문서로 다시 받아 주세요. (형식 감점 대상)`);
    throw new Error(`읽을 수 없는 파일 형식입니다(${name}). Word·구글 문서·PDF로 다시 받아 주세요.`);
  }
  // Word·PDF는 임시 구글 문서로 바꿔서 읽고, 임시 문서는 휴지통으로
  const res = UrlFetchApp.fetch(`https://www.googleapis.com/drive/v3/files/${id}/copy?supportsAllDrives=true`, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    payload: JSON.stringify({ name: '[임시] ' + name, mimeType: MimeType.GOOGLE_DOCS }),
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() !== 200) throw new Error(`파일을 변환하지 못했습니다(${name}): ` + res.getContentText().slice(0, 120));
  const tmpId = JSON.parse(res.getContentText()).id;
  try {
    return { text: DocumentApp.openById(tmpId).getBody().getText(), format: CONVERTIBLE[mime], name };
  } finally {
    DriveApp.getFileById(tmpId).setTrashed(true);
  }
}

/** 단어 수를 셀 발표 본문만 남김: 문장부호로 끝나는 줄, 이름·학번·제목 줄 제외 */
function bodyText_(text) {
  return String(text).split(/\r?\n/).map(l => l.trim())
    .filter(l => /[.!?]["'”’)]?$/.test(l) && !/^(name|student\s*number|title|이름|학번)\s*[:：]/i.test(l))
    .join('\n');
}

/** Claude 채점 스킬의 검증을 옮김: 수정 대본 복원, 인용 대조 */
function verify_(original, r) {
  const norm = s => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
  const src = norm(original);
  const checks = [];
  const restored = (r.revised || []).map(p => (p || []).filter(s => s.k !== 'add').map(s => s.t || '').join('')).join(' ');
  if (!norm(restored) || !src.includes(norm(restored))) {
    checks.push('수정 대본에서 표시를 걷어 낸 글이 원문과 다릅니다. 피드백 문서의 Revised Script를 직접 확인하세요.');
  }
  const text = [r.summary, r.well, r.improve].concat((r.items || []).map(i => i.reason)).join(' ');
  const quotes = (text.match(/["“]([^"”]{8,})["”]/g) || []).map(q => q.slice(1, -1));
  const bad = quotes.filter(q => /[a-z]/i.test(q) && !src.includes(norm(q)));
  if (bad.length) checks.push('원문에 없는 인용: ' + bad.slice(0, 3).map(q => `"${q}"`).join(', '));
  return checks;
}

// ───────────────────────── 피드백 문서 ─────────────────────────

function makeFeedbackDoc_(f) {
  const NAVY = '#1F3864', BLUE = '#2E75B6', GRAY = '#666666';
  const doc = DocumentApp.create(`Feedback_${f.name || 'student'}_${f.rubric.title}`.slice(0, 120));
  const body = doc.getBody();
  body.setMarginLeft(64).setMarginRight(64);

  const para = (text, o) => {
    o = o || {};
    const p = o.first ? body.getParagraphs()[0].setText(text) : body.appendParagraph(text);
    p.setSpacingBefore(o.before || 0).setSpacingAfter(o.after === undefined ? 6 : o.after);
    if (o.indent) p.setIndentFirstLine(28);
    if (text) {
      const t = p.editAsText();
      if (o.size) t.setFontSize(o.size);
      if (o.bold) t.setBold(true);
      if (o.italic) t.setItalic(true);
      if (o.color) t.setForegroundColor(o.color);
    }
    return p;
  };
  const heading = text => para(text, { size: 13, bold: true, color: NAVY, before: 14, after: 6 });

  para(f.rubric.title, { first: true, size: 9, color: BLUE, after: 2 });
  para('Instructor Comment', { size: 20, bold: true, color: NAVY, after: 2 });
  para(`${f.name || ''} · Student No. ${f.studentId || '—'} · ${f.words} words`, { size: 10, color: GRAY, after: 10 });
  para(`Score: ${f.final} / ${f.rubric.max}`, { size: 14, bold: true, color: NAVY, after: 8 });
  if (f.r.summary) para(f.r.summary, { after: 10 });

  const rows = [['Criterion', 'Points', 'Score']]
    .concat(f.scored.map(s => [s.name, String(s.points), String(s.score)]))
    .concat([['Script subtotal', String(f.rubric.max), String(f.subtotal)]])
    .concat(f.minus.map(m => [m.en, '', '-' + m.v]))
    .concat([['Total', String(f.rubric.max), String(f.final)]]);
  const table = body.appendTable(rows);
  table.setBorderColor('#C9D3E3');
  for (let i = 0; i < table.getNumRows(); i++) {
    const tr = table.getRow(i);
    const strong = i === 0 || i === table.getNumRows() - 1;
    for (let j = 0; j < tr.getNumCells(); j++) {
      const cell = tr.getCell(j);
      cell.editAsText().setFontSize(10).setBold(strong);
      if (i === 0) cell.setBackgroundColor('#E8EEF7');
    }
  }

  heading('Comments');
  if (f.r.well) para(f.r.well, { indent: true, after: 0 });
  if (f.r.improve) para(f.r.improve, { indent: true, after: 0 });
  if (f.minus.some(m => m.ko === '만점 유보')) {
    para('About the full-score hold: this is our course policy, not a problem in your work.', { italic: true, before: 6 });
  }

  if ((f.r.changes || []).length) {
    heading('What changed, and why');
    f.r.changes.forEach(c => body.appendListItem(String(c)).setGlyphType(DocumentApp.GlyphType.BULLET).setSpacingAfter(2));
  }

  heading('Revised Script');
  para('Bold blue = added or changed words · Strikethrough = words to remove. ' +
    'Each paragraph begins with an indent, with no blank line between paragraphs.', { size: 9, italic: true, color: GRAY, after: 6 });
  (f.r.revised || []).forEach(segs => {
    const p = body.appendParagraph('').setIndentFirstLine(28).setSpacingAfter(0);
    (segs || []).forEach(s => {
      if (!s.t) return;
      const t = p.appendText(String(s.t));
      if (s.k === 'add') t.setBold(true).setForegroundColor(BLUE);
      else if (s.k === 'del') t.setStrikethrough(true).setForegroundColor('#999999');
    });
  });
  para(`Length: ${f.words} words (script body only).`, { size: 9, color: GRAY, before: 10 });

  body.editAsText().setFontFamily('Georgia');
  table.editAsText().setFontFamily('Georgia');
  doc.saveAndClose();
  DriveApp.getFileById(doc.getId()).moveTo(getFolder_('피드백 문서 - ' + f.rubric.title.slice(0, 40)));
  return { id: doc.getId(), url: doc.getUrl() };
}

// ───────────────────────── ⑥ 피드백 보내기 ─────────────────────────

function sendApprovedFeedback() {
  const ui = SpreadsheetApp.getUi();
  const sheet = SpreadsheetApp.getActiveSheet();
  if (!checkSheet_(sheet)) return;
  const cols = ensureColumns_(sheet);
  if (!cols.email) return ui.alert("'이메일'이라는 글자가 들어간 열을 찾지 못했습니다.");

  const targets = [];
  for (let row = 2; row <= sheet.getLastRow(); row++) {
    if (sheet.getRange(row, cols.status).getValue() === STATUS.OK) targets.push(row);
  }
  if (!targets.length) return ui.alert("[상태]가 '승인'인 행이 없습니다.\n피드백 문서를 검토하고(필요하면 문서를 직접 고치고) '승인'으로 바꿔 주세요.");

  const ok = ui.alert('피드백 보내기',
    `${targets.length}명에게 피드백 문서를 '보기 권한'으로 공유하고, 문서 링크를 메일로 보냅니다. 계속할까요?`, ui.ButtonSet.YES_NO);
  if (ok !== ui.Button.YES) return;

  const rubric = readRubric_();
  let sent = 0;
  targets.forEach(row => {
    const email = String(sheet.getRange(row, cols.email).getValue()).trim();
    const name = String(sheet.getRange(row, cols.name).getValue()).replace(/\s*\(예시\)$/, '');
    const score = sheet.getRange(row, cols.score).getValue();
    const url = docUrl_(sheet, row, cols);
    try {
      shareQuietly_((url.match(/[-\w]{25,}/) || [])[0], email);
      MailApp.sendEmail({
        to: email,
        subject: `[Feedback] ${rubric.title}`,
        body: `Hi ${name},\n\nYour feedback for "${rubric.title}" is ready.\n` +
          `Score: ${score} / ${rubric.max}\n\nOpen your feedback document:\n${url}\n\n` +
          '(Open it while signed in to the Google account you used to submit.)',
      });
      sheet.getRange(row, cols.status).setValue(STATUS.SENT);
      sent++;
    } catch (err) {
      sheet.getRange(row, cols.check).setValue('발송 실패: ' + err.message);
    }
  });
  ui.alert(`${sent}명에게 보냈습니다.` + (sent < targets.length ? ` ${targets.length - sent}명은 [확인 사항]을 보세요.` : ''));
}

/** 알림 메일 없이 보기 권한만 줌 (안내 메일은 우리가 따로 보냄) */
function shareQuietly_(fileId, email) {
  if (!fileId) throw new Error('피드백 문서 링크가 없습니다. 먼저 채점하세요.');
  const res = UrlFetchApp.fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}/permissions?sendNotificationEmail=false&supportsAllDrives=true`, {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
      payload: JSON.stringify({ role: 'reader', type: 'user', emailAddress: email }),
      muteHttpExceptions: true,
    });
  if (res.getResponseCode() !== 200) {
    throw new Error(`${email}에게 문서를 공유하지 못했습니다(구글 계정이 아닌 주소일 수 있음).`);
  }
}

// ───────────────────────── 자동 채점 ─────────────────────────

function enableAutoGrade() {
  disableAutoGrade(true);
  ScriptApp.newTrigger('onFormSubmitGrade')
    .forSpreadsheet(SpreadsheetApp.getActive())
    .onFormSubmit()
    .create();
  SpreadsheetApp.getUi().alert('이제 폼이 제출될 때마다 자동으로 채점됩니다.\n피드백은 교사가 검토·승인한 뒤 ⑥번으로 보냅니다.');
}

function disableAutoGrade(silent) {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'onFormSubmitGrade')
    .forEach(t => ScriptApp.deleteTrigger(t));
  if (silent !== true) SpreadsheetApp.getUi().alert('자동 채점을 껐습니다.');
}

function onFormSubmitGrade(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30 * 1000);
  try {
    gradeRow_(e.range.getSheet(), e.range.getRow());
  } finally {
    lock.releaseLock();
  }
}

// ───────────────────────── 공통 함수 ─────────────────────────

function callGemini_(prompt) {
  const key = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!key) throw new Error('API 키가 없습니다. 메뉴 ①에서 등록하세요.');
  const payload = JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { responseMimeType: 'application/json' },
  });
  let lastError = '';
  for (const model of MODELS) {
    // 서버가 붐빌 때(429·503)는 잠깐 기다렸다가 두 번 더 시도하고, 그래도 안 되면 다음 모델로
    for (const wait of [0, 3000, 8000]) {
      if (wait) Utilities.sleep(wait);
      const res = UrlFetchApp.fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
          method: 'post',
          contentType: 'application/json',
          headers: { 'x-goog-api-key': key },
          payload,
          muteHttpExceptions: true,
        });
      const code = res.getResponseCode();
      const data = JSON.parse(res.getContentText());
      if (code === 200) {
        return data.candidates[0].content.parts.filter(p => !p.thought).map(p => p.text || '').join('');
      }
      lastError = `[${model}] ` + ((data.error && data.error.message) || ('HTTP ' + code));
      if (code === 400 || code === 401 || code === 403) throw new Error(lastError); // 키 문제는 다시 시도해도 같음
      if (code !== 429 && code !== 503) break; // 모델 이름이 없는 경우(404) 등은 바로 다음 모델로
    }
  }
  throw new Error(lastError);
}

function parseJson_(text) {
  return JSON.parse(text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, ''));
}

function quarter_(x) { return Math.round(x * 4) / 4; }
function clamp_(x, lo, hi) { return Math.min(hi, Math.max(lo, x)); }

/** 스프레드시트와 같은 폴더 안에 이름이 같은 하위 폴더를 찾거나 만듦 */
function getFolder_(name) {
  const parents = DriveApp.getFileById(SpreadsheetApp.getActive().getId()).getParents();
  const base = parents.hasNext() ? parents.next() : DriveApp.getRootFolder();
  const found = base.getFoldersByName(name);
  return found.hasNext() ? found.next() : base.createFolder(name);
}

function docUrl_(sheet, row, cols) {
  const cell = sheet.getRange(row, cols.doc);
  const rich = cell.getRichTextValue();
  return (rich && rich.getLinkUrl()) || String(cell.getValue());
}

function trashDoc_(url) {
  const id = (String(url).match(/[-\w]{25,}/) || [])[0];
  if (!id) return;
  try { DriveApp.getFileById(id).setTrashed(true); } catch (e) { /* 이미 없으면 무시 */ }
}

function readRubric_() {
  const r = SpreadsheetApp.getActive().getSheetByName(RUBRIC_SHEET);
  if (!r) throw new Error('[채점기준] 시트가 없습니다. 메뉴 ②를 먼저 실행하세요.');
  const rows = r.getDataRange().getValues();
  const setting = label => {
    const hit = rows.find(x => String(x[0]).trim() === label);
    return hit ? hit[1] : '';
  };
  const head = rows.findIndex(x => String(x[0]).trim() === '채점 항목');
  const items = rows.slice(head + 1)
    .filter(x => String(x[0]).trim() && Number(x[1]) > 0)
    .map(x => ({ name: String(x[0]).trim(), points: Number(x[1]), desc: String(x[2]) }));
  if (head < 0 || !items.length) throw new Error("[채점기준] 시트에서 '채점 항목' 표를 찾지 못했습니다.");
  return {
    title: String(setting('과제명')) || '영어 과제',
    task: String(setting('과제 설명')),
    length: String(setting('분량')),
    tone: String(setting('피드백 말투')),
    principles: String(setting('채점 원칙')),
    videoPenalty: Number(setting('영상 미제출 감점')) || 0,
    perfectHold: Number(setting('만점 유보 감점')) || 0,
    items,
    max: items.reduce((a, i) => a + i.points, 0),
  };
}

/** 입력 열 위치를 찾고, 결과 열이 없으면 오른쪽 끝에 추가 */
function ensureColumns_(sheet) {
  const headers = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getValues()[0].map(String);
  const results = Object.values(COL);
  results.forEach(h => {
    if (!headers.includes(h)) {
      sheet.getRange(1, headers.length + 1).setValue(h).setFontWeight('bold').setBackground('#fce8b2');
      headers.push(h);
    }
  });
  const find = words => headers.findIndex(h =>
    !results.includes(h) && words.some(w => h.toLowerCase().includes(w))) + 1;

  const cols = { name: find(FIND.name), id: find(FIND.id), email: find(FIND.email), work: find(FIND.work), video: find(FIND.video) };
  Object.keys(COL).forEach(k => { cols[k] = headers.indexOf(COL[k]) + 1; });

  const rows = Math.max(sheet.getMaxRows() - 1, 1);
  sheet.getRange(2, cols.status, rows, 1).setDataValidation(
    SpreadsheetApp.newDataValidation()
      .requireValueInList([STATUS.WAIT, STATUS.OK, STATUS.SENT, STATUS.ERROR], true)
      .setAllowInvalid(true).build());
  [cols.reason, cols.check].forEach(c => {
    sheet.setColumnWidth(c, 320);
    sheet.getRange(2, c, rows, 1).setWrap(true);
  });
  sheet.getRange(2, 1, rows, sheet.getLastColumn()).setVerticalAlignment('top');
  return cols;
}

function checkSheet_(sheet) {
  const ui = SpreadsheetApp.getUi();
  if (sheet.getName() === RUBRIC_SHEET) {
    ui.alert('[채점기준]이 아니라 학생 제출물이 있는 시트(폼 응답 시트)를 열고 실행하세요.');
    return false;
  }
  const headers = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getValues()[0].map(h => String(h).toLowerCase());
  if (!headers.some(h => !Object.values(COL).includes(h) && FIND.work.some(w => h.includes(w)))) {
    ui.alert("이 시트에서 학생 대본(파일)이 든 열을 찾지 못했습니다.\n그 열의 제목에 '대본' 또는 '파일'이라는 글자를 넣어 주세요.");
    return false;
  }
  return true;
}
