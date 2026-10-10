/**
 * 교재 파일 올리기 + 원문 읽기
 *
 * 선생님이 화면에서 고른 파일(교재 PDF·지면 사진, 교사용 지도서 PDF·사진, 교안 Word)을
 * 드라이브 강의자료/_올린 파일/ 에 보관하고, 글을 꺼내 입력 칸에 채운다.
 *  - Word(.docx): 구글 문서로 바꿔서 글을 그대로 꺼낸다 (제미나이 안 씀)
 *  - PDF·사진: 글자 층이 없는 스캔이 많아서 제미나이가 지면을 보고 받아 적는다
 * 받아 적은 글은 선생님이 화면에서 훑어보고 고친 뒤 [만들기]를 누른다. 이후 검증은 이 글을 원문으로 삼는다.
 * 지면 사진(jpg·png)은 교재 지면 장에 그대로 넣을 수 있게 쪽 번호와 함께 기억한다.
 */

const UPLOAD_FOLDER = '_올린 파일';

/** 큰 파일은 화면에서 잘라 보낸다: 조각을 임시 파일로 모았다가 finishUpload에서 합친다 */
function uploadChunk(uploadId, index, text) {
  tmpFolder_().createFile(`${uploadId}.${('000' + index).slice(-4)}`, text, MimeType.PLAIN_TEXT);
  return index;
}

function finishUpload(uploadId, name, mime, count) {
  const tmp = tmpFolder_();
  let b64 = '';
  for (let i = 0; i < count; i++) {
    const it = tmp.getFilesByName(`${uploadId}.${('000' + i).slice(-4)}`);
    if (!it.hasNext()) throw new Error(`파일 조각 ${i + 1}/${count}을 찾지 못했습니다. 다시 올려 주세요.`);
    const f = it.next();
    b64 += f.getBlob().getDataAsString();
    f.setTrashed(true);
  }
  const blob = Utilities.newBlob(Utilities.base64Decode(b64), mime || 'application/octet-stream', name);
  const file = uploadFolder_().createFile(blob);
  return { id: file.getId(), name, mime: blob.getContentType(), size: blob.getBytes().length };
}

/** 드라이브 링크로 넣을 때 */
function fileFromLink(link) {
  const id = (String(link).match(/[-\w]{25,}/) || [])[0];
  if (!id) throw new Error('드라이브 파일 링크가 아닙니다.');
  const f = DriveApp.getFileById(id);
  return { id, name: f.getName(), mime: f.getMimeType(), size: f.getSize() };
}

/**
 * 파일 하나에서 글을 꺼낸다.
 * role: 'book'(교재 지면) | 'guide'(교사용 지도서) | 'plan'(교안)
 * 돌려주는 값: {source, script, answers, plan, page, image}
 */
function extractFile(fileId, role) {
  const file = DriveApp.getFileById(fileId);
  const mime = file.getMimeType(), name = file.getName();
  if (mime === MimeType.GOOGLE_DOCS) return { plan: DocumentApp.openById(fileId).getBody().getText() };
  if (/wordprocessingml|msword/.test(mime) || /\.docx?$/i.test(name)) return wordToText_(fileId, role);
  if (mime === MimeType.PLAIN_TEXT) return assign_(role, file.getBlob().getDataAsString('UTF-8'));
  if (mime !== MimeType.PDF && !/^image\//.test(mime)) {
    throw new Error(`${name}: 읽을 수 없는 형식입니다. PDF·사진(jpg·png)·Word로 올려 주세요.`);
  }
  let blob = file.getBlob();
  if (blob.getBytes().length > 15 * 1024 * 1024) throw new Error(`${name}: 15MB가 넘습니다. 쪽을 나눠 올려 주세요.`);

  const res = callGemini_(readPrompt_(role), [blob]);
  const r = parseJson_(res.text);
  const out = {
    source: str_(r.source), script: str_(r.script), answers: str_(r.answers), plan: str_(r.notes),
    page: str_(r.page), model: res.model,
  };
  if (role === 'book' && /^image\//.test(mime)) out.image = { id: fileId, page: out.page, name };
  return out;
}

function readPrompt_(role) {
  const common = [
    '첨부한 지면을 보고 글을 받아 적으세요. 이 글은 강의 슬라이드의 "원문"으로 쓰이고, 슬라이드의 인용·정답이 이 글과 글자 단위로 대조됩니다.',
    '- 보이는 글자를 한 글자도 바꾸지 않습니다. 고쳐 쓰거나 요약하거나 빠진 곳을 짐작해 채우지 않습니다.',
    '- 읽을 수 없는 곳은 [읽을 수 없음]이라고 씁니다.',
    '- 쪽 번호가 보이면 그 쪽 글 앞에 [p.10]처럼 표시합니다.',
    '- 제목·지시문·문항 번호·보기·표는 지면의 순서대로 줄을 나눠 씁니다. 표는 칸을 " | "로 나눕니다.',
    '- 사진·그림은 [사진: 짧은 설명]으로 한 줄만 씁니다.',
  ];
  if (role === 'guide') {
    return common.concat([
      '이 지면은 교사용 지도서입니다. 다음 세 가지로 나눠 담으세요.',
      '- script: AUDIO SCRIPT 전문. 트랙 번호(예: 1.04)와 화자 이름을 그대로.',
      '- answers: ANSWERS 상자 전문. 어느 연습(예: Global listening 2, Close listening 3)의 정답인지 앞에 붙여서.',
      '- notes: Background information, Cultural awareness, Supporting critical thinking, Exam tip 등 참고 상자와 수업 진행 지시 전문.',
      '다음 JSON으로만 답하세요: {"page": "보이는 쪽 번호들 (예: pp.20–23)", "script": "...", "answers": "...", "notes": "..."}',
    ]).join('\n');
  }
  if (role === 'plan') {
    return common.concat([
      '이 지면은 교사가 만든 교안입니다. 전문을 notes에 담으세요.',
      '다음 JSON으로만 답하세요: {"page": "", "notes": "..."}',
    ]).join('\n');
  }
  return common.concat([
    '이 지면은 학생용 교재입니다. 전문을 source에 담으세요. 듣기 대본이 지면에 인쇄되어 있으면 그것도 source에 그대로 둡니다.',
    '다음 JSON으로만 답하세요: {"page": "이 지면의 쪽 번호 (예: p.10, 두 쪽이면 pp.10–11, 안 보이면 빈칸)", "source": "..."}',
  ]).join('\n');
}

/** Word는 구글 문서로 바꿔서 글을 꺼내고, 바꾼 임시 문서는 휴지통으로 */
function wordToText_(fileId, role) {
  const res = UrlFetchApp.fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/copy?supportsAllDrives=true`, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    payload: JSON.stringify({ name: '[임시] 교안 변환', mimeType: MimeType.GOOGLE_DOCS }),
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() !== 200) throw new Error('Word 파일을 바꾸지 못했습니다: ' + res.getContentText().slice(0, 150));
  const tmpId = JSON.parse(res.getContentText()).id;
  try {
    return assign_(role, DocumentApp.openById(tmpId).getBody().getText());
  } finally {
    DriveApp.getFileById(tmpId).setTrashed(true);
  }
}

function assign_(role, text) {
  text = String(text || '').replace(/\n{3,}/g, '\n\n').trim();
  return role === 'book' ? { source: text } : { plan: text };
}

/** 화면이 보낸 지면 사진 목록(JSON) */
function parseImages_(v) {
  try {
    const arr = typeof v === 'string' ? JSON.parse(v || '[]') : (v || []);
    return arr.filter(x => x && x.id).map(x => ({ id: String(x.id), page: String(x.page || ''), name: String(x.name || '') }));
  } catch (e) { return []; }
}

function uploadFolder_() {
  const it = DriveApp.getRootFolder().getFoldersByName(ROOT_FOLDER);
  const root = it.hasNext() ? it.next() : DriveApp.getRootFolder().createFolder(ROOT_FOLDER);
  const up = root.getFoldersByName(UPLOAD_FOLDER);
  return up.hasNext() ? up.next() : root.createFolder(UPLOAD_FOLDER);
}

function tmpFolder_() {
  const up = uploadFolder_();
  const it = up.getFoldersByName('_조각');
  return it.hasNext() ? it.next() : up.createFolder('_조각');
}

/** 쪽 번호 글자("p.10", "pp.10–11", "10-11")를 숫자 목록으로 */
function pageNums_(s) {
  const m = String(s || '').match(/\d+/g);
  if (!m) return [];
  const a = parseInt(m[0], 10), b = m[1] ? parseInt(m[1], 10) : a;
  if (b < a || b - a > 20) return m.map(Number);
  const out = [];
  for (let n = a; n <= b; n++) out.push(n);
  return out;
}
