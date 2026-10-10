/**
 * 영어 과제 AI 채점 도우미 (Google Forms + Sheets + Gemini)
 *
 * 흐름: 구글 폼(과제 제출) -> 시트 -> 제미나이(루브릭 채점) -> 교사 검토 -> 지메일로 피드백 발송
 *
 * 처음 한 번
 *  1) 새 스프레드시트 > 확장 프로그램 > Apps Script 에 이 코드를 붙여넣고 저장
 *  2) 시트를 새로고침하면 상단에 [🤖 AI 채점] 메뉴가 생김
 *  3) ① API 키 등록 → ② 채점기준·예시 시트 만들기 → ③ 과제 제출 폼 만들기
 */

// 사용할 Gemini 모델 (앞에서부터 시도). 첫 모델이 붐비거나 없으면 다음 모델로 넘어갑니다.
// 모델 이름은 Google AI Studio의 모델 목록에서 확인할 수 있습니다.
const MODELS = ['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-flash-latest'];

const RUBRIC_SHEET = '채점기준';
const SAMPLE_SHEET = '제출물(예시)';

// 결과 열 (오른쪽 끝에 자동으로 추가됨)
const COL = {
  words: '단어 수',
  items: '항목별 점수',
  minus: '별도 감점',
  score: 'AI 점수',
  reason: '채점 근거(교사용)',
  feedback: 'AI 피드백(학생용)',
  status: '상태',
};
const STATUS = { WAIT: '검토 대기', OK: '승인', SENT: '발송 완료', ERROR: '오류' };

// 입력 열을 찾을 때 쓰는 글자 (열 제목에 이 글자가 들어 있으면 그 열로 봄)
const FIND = {
  name: ['이름', 'name'],
  id: ['학번', 'student number'],
  email: ['이메일', 'email'],
  work: ['대본', 'script', '과제', '글쓰기', '에세이', 'essay'],
  video: ['영상', 'video'],
};

// ───────────────────────── 메뉴 ─────────────────────────

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('🤖 AI 채점')
    .addItem('① Gemini API 키 등록', 'setApiKey')
    .addItem('② 채점기준·예시 시트 만들기', 'createSampleSheets')
    .addItem('③ 과제 제출 폼 만들기', 'createSubmissionForm')
    .addSeparator()
    .addItem('④ 선택한 행 채점', 'gradeSelectedRows')
    .addItem('⑤ 채점 안 된 행 모두 채점', 'gradeAllPending')
    .addSeparator()
    .addItem('⑥ [승인] 행에 피드백 메일 보내기', 'sendApprovedFeedback')
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

// ───────────────────────── ② 채점기준·예시 시트 ─────────────────────────

function createSampleSheets() {
  const ss = SpreadsheetApp.getActive();

  if (!ss.getSheetByName(RUBRIC_SHEET)) {
    const r = ss.insertSheet(RUBRIC_SHEET);
    r.getRange('A1:B7').setValues([
      ['과제명', 'Week 4 Speaking Task: Introduce a Person (예시 — 이번 주 과제로 바꾸세요)'],
      ['과제 설명', '주변 인물 한 명을 인터뷰하고, 그 사람의 흥미로운 점 하나를 골라 1–2분 발표 대본을 쓴다. 현재 시제로 인물을 묘사하고, 교재의 도입 표현과 성격 어휘를 사용한다.'],
      ['분량', '약 150–250단어 (절대 경계가 아님. 148단어나 261단어를 기계적으로 감점하지 않음)'],
      ['피드백 말투', '쉬운 영어(CEFR A2–B1), 따뜻하고 구체적으로. 고칠 점에는 학생 문장을 고친 예시를 한 개 넣는다.'],
      ['영상 미제출 감점', 0.5],
      ['만점 유보 감점', 0.25],
      ['채점 원칙', '같은 사유로 두 항목에서 감점하지 않는다. 0.25 단위로 매기고 감점마다 근거 문장을 인용한다. 과제 안내에 없는 요건으로 감점하지 않는다. 목표 시제 요건은 인물을 묘사하는 문장에만 적용한다(닫는 문장의 예측, 기간을 말하는 현재완료는 위반 아님).'],
    ]);
    r.getRange('A9:C9').setValues([['채점 항목', '배점', '보는 것']]);
    r.getRange('A10:C13').setValues([
      ['영어 사용', 4, '문법·어휘의 정확성과 자연스러움, 목표 시제의 일관성'],
      ['초점과 구성', 3, '흥미로운 점 하나를 잡아 구체적으로 전개했는가 / 열고-기본정보-전개-닫는 순서 / 묻지 않은 내용이 섞이지 않았는가'],
      ['표현', 2, '지정 도입 표현 0.5 · 지정 어휘 0.5 · 성격 어휘 0.5 · 문장 변화 0.5'],
      ['완성도', 1, '분량 0.5 · 이름·학번 기재 0.25 · 지정 제출물 제출 0.25 (폼으로 받았으므로 이름·학번 칸과 대본 제출은 인정)'],
    ]);
    r.getRange('A1:A7').setFontWeight('bold').setBackground('#e8f0fe');
    r.getRange('A9:C9').setFontWeight('bold').setBackground('#e8f0fe');
    r.getRange('B1:C13').setWrap(true);
    r.setColumnWidth(1, 130); r.setColumnWidth(2, 460); r.setColumnWidth(3, 420);
  }

  if (!ss.getSheetByName(SAMPLE_SHEET)) {
    const s = ss.insertSheet(SAMPLE_SHEET, 0);
    s.getRange('A1:F1').setValues([['타임스탬프', '이름', '학번', '이메일', '발표 대본', '발표 영상 링크']]);
    s.getRange('A2:F4').setValues([
      [new Date(), '김하늘 (예시)', '20260001', 'student1@example.com',
        "Hello, everyone. Today I'd like to introduce my friend Minji. She is twenty years old and she studies nursing at Jeju National University. " +
        "The most interesting thing about Minji is her hobby. She swims in the sea every morning, even in winter! " +
        "She says cold water makes her feel awake and positive. She is very brave and patient. " +
        "When I tried it with her, I could stay in the water for only one minute, but she stays for twenty minutes. " +
        "She also picks up trash on the beach after she swims, because she wants to protect the ocean. " +
        "I think she is a very responsible person. In the future, she wants to be a nurse on a small island. " +
        "I think she will be a wonderful nurse. Thank you for listening.",
        'https://youtu.be/example1'],
      [new Date(), '이도윤 (예시)', '20260002', 'student2@example.com',
        "My father. He is 50 years old. He work in a hotel. He is kind and funny. He like fishing. " +
        "Last year he catched a big fish. Every weekend he go to the sea. I like my father. Thank you.",
        'https://drive.google.com/example2'],
      [new Date(), '박서연 (예시)', '20260003', 'student3@example.com',
        "Hi, I want to introduce my grandmother. Her name is Kim Okja and she lives in Seogwipo. " +
        "She is seventy-eight years old, but she is still very active. The most interesting thing about her is that she was a haenyeo for fifty years. " +
        "A haenyeo is a woman diver who catches seafood without any oxygen tank. She can hold her breath for two minutes. " +
        "She is strong, hardworking, and very generous. She always gives seafood to our neighbors. " +
        "Now she doesn't dive anymore, but she teaches young people about haenyeo culture at a small museum. " +
        "I am proud of her. I hope many people learn about haenyeo culture. Thank you.",
        ''],
    ]);
    s.getRange('A1:F1').setFontWeight('bold').setBackground('#e8f0fe');
    s.setColumnWidth(5, 420);
    s.getRange('E:E').setWrap(true);
    s.setFrozenRows(1);
    ensureColumns_(s);
  }

  SpreadsheetApp.getUi().alert(
    '[채점기준] 시트와 [제출물(예시)] 시트를 만들었습니다.\n\n' +
    '1. [채점기준]의 과제명·과제 설명·항목을 이번 주 과제에 맞게 고치세요.\n' +
    '2. [제출물(예시)] 시트를 연 채로 ⑤번 메뉴를 실행해 채점을 시험해 보세요.');
}

// ───────────────────────── ③ 과제 제출 폼 ─────────────────────────

function createSubmissionForm() {
  const ss = SpreadsheetApp.getActive();
  const rubric = readRubric_();

  const form = FormApp.create(rubric.title + ' — 제출');
  form.setDescription(
    'Copy your whole script from Word and paste it below. Then add your video link.\n' +
    'Word로 쓴 대본 전체를 복사해서 아래에 붙여넣고, 발표 영상 링크를 넣어 주세요.\n\n' +
    `Length: ${rubric.length}`);
  try {
    form.setEmailCollectionType(FormApp.EmailCollectionType.VERIFIED);
  } catch (e) {
    form.setCollectEmail(true);
  }
  form.setLimitOneResponsePerUser(false);
  form.setAllowResponseEdits(true);

  form.addTextItem().setTitle('이름 (Name)').setRequired(true);
  form.addTextItem().setTitle('학번 (Student Number)').setRequired(true);
  form.addParagraphTextItem()
    .setTitle('발표 대본 (Script)')
    .setHelpText('Paste your whole script here. 제목·이름은 빼고 발표할 본문만 붙여넣으세요.')
    .setRequired(true);
  form.addTextItem()
    .setTitle('발표 영상 링크 (Video link)')
    .setHelpText('YouTube(일부 공개) 또는 Google Drive 링크. 공유 설정을 "링크가 있는 모든 사용자"로 해 주세요.')
    .setRequired(false);

  form.setDestination(FormApp.DestinationType.SPREADSHEET, ss.getId());

  const html = HtmlService.createHtmlOutput(
    '<div style="font-family:sans-serif;line-height:1.7">' +
    '<p>폼을 만들고 이 스프레드시트에 연결했습니다. 응답 시트가 새로 생겼습니다.</p>' +
    `<p><b>학생용 링크</b> (Classroom·JNUclass에 붙여넣기)<br><a href="${form.getPublishedUrl()}" target="_blank">${form.getPublishedUrl()}</a></p>` +
    `<p><b>폼 편집</b><br><a href="${form.getEditUrl()}" target="_blank">폼 편집 화면 열기</a></p>` +
    '<p style="color:#666">파일(docx·mp4)로도 받고 싶으면 폼 편집 화면에서 "파일 업로드" 질문을 직접 추가하세요.<br>' +
    '이 경우 학생은 구글 계정 로그인이 필요합니다.</p></div>')
    .setWidth(520).setHeight(330);
  SpreadsheetApp.getUi().showModalDialog(html, '과제 제출 폼 완성');
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
  SpreadsheetApp.getActive().toast(`${n}개 행을 채점했습니다. 피드백을 검토하고 [상태]를 '승인'으로 바꾸세요.`, 'AI 채점', 8);
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
    // Apps Script는 한 번에 6분까지만 실행되므로 5분이 지나면 멈춤
    if (Date.now() - started > 5 * 60 * 1000) { left++; continue; }
    if (gradeRow_(sheet, row)) n++;
  }
  const msg = left ? `${n}개 채점. 시간이 부족해 ${left}개가 남았습니다. ⑤번을 한 번 더 실행하세요.` : `${n}개 행을 채점했습니다.`;
  SpreadsheetApp.getActive().toast(msg, 'AI 채점', 10);
}

/** 한 행을 채점해 결과 열에 기록. 성공하면 true */
function gradeRow_(sheet, row) {
  const cols = ensureColumns_(sheet);
  const get = c => (c ? String(sheet.getRange(row, c).getValue()).trim() : '');
  const name = get(cols.name);
  const studentId = get(cols.id);
  const work = get(cols.work);
  if (!work) return false;

  const rubric = readRubric_();
  const words = (work.match(/[A-Za-z][A-Za-z'’-]*/g) || []).length;
  const set = (c, v) => sheet.getRange(row, cols[c]).setValue(v);

  try {
    const r = parseJson_(callGemini_(buildPrompt_(rubric, name, studentId, words, work)));

    // 항목 점수: 0.25 단위로 맞추고 배점을 넘지 않게
    const lines = [], reasons = [];
    let subtotal = 0;
    rubric.items.forEach((item, i) => {
      const got = (r.items || []).find(x => x.name === item.name) || (r.items || [])[i] || {};
      const s = clamp_(quarter_(Number(got.score) || 0), 0, item.points);
      subtotal += s;
      lines.push(`${item.name} ${s}/${item.points}`);
      reasons.push(`[${item.name} ${s}/${item.points}] ${got.reason || ''}`);
    });

    // 별도 감점: 계산은 코드가 직접 (AI에게 맡기지 않음)
    const minus = [];
    const noVideo = cols.video && !get(cols.video);
    if (noVideo && rubric.videoPenalty) minus.push(['영상 미제출', rubric.videoPenalty]);
    if (subtotal === rubric.max && rubric.perfectHold) minus.push(['만점 유보', rubric.perfectHold]);
    const final = Math.max(0, subtotal - minus.reduce((a, m) => a + m[1], 0));

    const fb = r.feedback || {};
    const minusEn = minus.map(m => m[0] === '영상 미제출'
      ? `- Video not submitted: -${m[1]}`
      : `- Full-score hold: -${m[1]} (This is our course policy, not a problem in your work.)`);
    const feedback = [
      `Hi ${name || 'there'},`,
      '',
      `Score: ${final} / ${rubric.max}`,
      lines.map(l => '- ' + l).join('\n') + (minusEn.length ? '\n' + minusEn.join('\n') : ''),
      '',
      `What you did well: ${fb.strength || ''}`,
      `To improve: ${fb.improve || ''}`,
      `Tip for next time: ${fb.tip || ''}`,
    ].join('\n');

    set('words', words);
    set('items', lines.join(' / '));
    set('minus', minus.length ? minus.map(m => `${m[0]} -${m[1]}`).join(', ') : '없음');
    set('score', final);
    set('reason', reasons.join('\n'));
    set('feedback', feedback);
    set('status', STATUS.WAIT);
    return true;
  } catch (err) {
    set('reason', '채점 실패: ' + err.message);
    set('status', STATUS.ERROR);
    return false;
  }
}

function buildPrompt_(rubric, name, studentId, words, work) {
  return [
    '당신은 한국 대학의 교양영어 강사입니다. 아래 채점 기준대로 학생의 영어 발표 대본(또는 글)을 채점하세요.',
    '',
    `[과제명] ${rubric.title}`,
    `[과제 설명] ${rubric.task}`,
    `[분량] ${rubric.length} — 이 학생의 본문은 약 ${words}단어 (자동 계산, 참고용)`,
    `[채점 원칙] ${rubric.principles}`,
    '[채점 항목]',
    rubric.items.map(i => `- ${i.name} (${i.points}점): ${i.desc}`).join('\n'),
    '',
    '주의: 영상 제출 여부와 만점 유보는 프로그램이 따로 처리하니 항목 점수에 반영하지 마세요.',
    `[학생] 이름: ${name || '(없음)'} / 학번: ${studentId || '(없음)'}`,
    '[학생 대본]',
    work,
    '',
    '다음 JSON 형식으로만 답하세요. 점수는 0.25 단위입니다.',
    '{',
    '  "items": [ {"name": "항목 이름(위와 똑같이)", "score": 숫자, "reason": "감점 근거를 한국어로, 학생 문장을 따옴표로 인용"} ],',
    `  "feedback": { "strength": "잘한 점 1가지", "improve": "고칠 점 1가지 + 학생 문장을 고친 예시", "tip": "다음 과제 팁 1가지" }`,
    '}',
    `feedback은 학생에게 보내는 글입니다. 이렇게 쓰세요: ${rubric.tone}`,
    '고친 예시는 학생 문장의 문법·표현만 고치고, 학생 글에 없는 사실·일화·이름·숫자는 절대 지어내지 마세요. 내용을 보태라고 할 때는 무엇을 보탤지 질문으로 제안하세요(예: "What does she do on a typical day?").',
  ].join('\n');
}

// ───────────────────────── ⑥ 메일 발송 ─────────────────────────

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
  if (!targets.length) return ui.alert("[상태]가 '승인'인 행이 없습니다.\n피드백을 검토하고(필요하면 직접 고치고) '승인'으로 바꿔 주세요.");

  const ok = ui.alert('메일 발송', `${targets.length}명에게 피드백 메일을 보냅니다. 계속할까요?`, ui.ButtonSet.YES_NO);
  if (ok !== ui.Button.YES) return;

  const title = readRubric_().title;
  targets.forEach(row => {
    MailApp.sendEmail({
      to: String(sheet.getRange(row, cols.email).getValue()),
      subject: `[Feedback] ${title}`,
      body: String(sheet.getRange(row, cols.feedback).getValue()),
    });
    sheet.getRange(row, cols.status).setValue(STATUS.SENT);
  });
  ui.alert(`${targets.length}통을 보냈습니다.`);
}

// ───────────────────────── 자동 채점 ─────────────────────────

function enableAutoGrade() {
  disableAutoGrade(true);
  ScriptApp.newTrigger('onFormSubmitGrade')
    .forSpreadsheet(SpreadsheetApp.getActive())
    .onFormSubmit()
    .create();
  SpreadsheetApp.getUi().alert('이제 폼이 제출될 때마다 자동으로 채점됩니다.\n메일은 교사가 검토·승인한 뒤 ⑥번으로 보냅니다.');
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
  Object.values(COL).forEach(h => {
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
  [cols.reason, cols.feedback].forEach(c => {
    sheet.setColumnWidth(c, 360);
    sheet.getRange(2, c, rows, 1).setWrap(true);
  });
  return cols;
}

function checkSheet_(sheet) {
  const ui = SpreadsheetApp.getUi();
  if (sheet.getName() === RUBRIC_SHEET) {
    ui.alert('[채점기준]이 아니라 학생 제출물이 있는 시트(폼 응답 시트)를 열고 실행하세요.');
    return false;
  }
  const headers = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getValues()[0].map(h => String(h).toLowerCase());
  if (!headers.some(h => FIND.work.some(w => h.includes(w)))) {
    ui.alert("이 시트에서 학생 글이 든 열을 찾지 못했습니다.\n그 열의 제목에 '대본' 또는 '과제'라는 글자를 넣어 주세요.");
    return false;
  }
  return true;
}
