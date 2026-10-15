# 강의 슬라이드 웹앱 (구글 버전)

제주대 영어영문학과 교양영어(영어듣기와 말하기 1 · 영어읽기와 쓰기 1) 강의 프레젠테이션 제작을 구글 도구로 옮긴 웹앱입니다. 구글 강사 교육 과제 "나의 웹앱"으로 만들었습니다.

```
웹앱(단원·교재 내용 입력) → 제미나이 → 구글 슬라이드 → 퀴즈 폼 → 드라이브에 저장
```

- 소개 페이지: https://lecture-deck-webapp.vercel.app (`site/index.html`, Vercel)
- 웹앱: 각자 배포한 Apps Script 웹앱 주소(`…/exec`, 아래 「설치」 4번 `clasp create-deployment`로 받음)를 씁니다. 구글 계정이 있으면 누구나 열 수 있고, 결과물은 여는 사람의 드라이브에 저장됩니다.

## 무엇을 하나

- 단원 정보와 교재 원문을 넣습니다. 붙여넣기 외에 PDF·사진·Word를 올리면 제미나이가 지면을 받아 적습니다.
- 제미나이가 원문만 근거로 60분 차시 덱을 설계합니다. 영어가 위·한국어 해설이 아래, 한 장에 한 호흡, 섹션마다 교재 지면 장 먼저, 문항은 한 문항 한 장, 덱 끝에 과제 섹션.
- 결과는 드라이브 `강의자료/<과목>_<WeekN-M>_<제목>/`에 저장됩니다.
  - 구글 슬라이드 교수용(정답 장·발표자 노트) / 학생용(정답 장 제외)
  - 확인 퀴즈 구글 폼(퀴즈 모드, 정답·배점·해설)
  - HTML 덱: 슬라이드 안 채점 연습, 학생 모드, 오디오·영상 자동 삽입 (JNUclass에 그대로 올리는 파일)
  - 듣기 음성(제미나이 TTS), 섹션 복습 영상(브라우저 녹화), 입력 기록 문서

## 원문을 지키는 방법

교재 본문·듣기 대본·정답은 사용자가 넣은 글만 씁니다. 프롬프트 규칙에 더해, 코드가 대본 줄·정답 근거·퀴즈 근거를 원문과 글자 단위로 대조해 없으면 `[원문 필요]` 자리표시자로 바꾸거나 빼고 경고를 남깁니다.

## 구성

| 파일 | 하는 일 |
|---|---|
| `src/Code.gs` | 웹앱 진입점, 단계별 실행(폴더 → 뼈대 → 섹션·퀴즈 동시 생성 → 조립 → 슬라이드 → 학생용 → 폼 → HTML 덱 → 기록) |
| `src/Gemini.gs` | 제미나이 호출(모델 순서·재시도·시간 예산), 프롬프트, 원문 대조 검증 |
| `src/Deck.gs` | 덱 조립과 구글 슬라이드 그리기(Slides API batchUpdate) |
| `src/HtmlDeck.gs`, `src/DeckTemplate.html` | HTML 덱 (english-lecture-deck 디자인·채점 스크립트 재사용) |
| `src/Files.gs` | 교재 파일 올리기, PDF·사진 받아쓰기, Word 글 꺼내기 |
| `src/Media.gs` | 영상 링크, 제미나이 TTS → WAV, 긴 음성 나눠 만들어 잇기 |
| `src/Video.gs` | 섹션 복습 영상 대본·낭독·저장 (녹화는 `Index.html`의 캔버스 + MediaRecorder) |
| `src/Index.html` | 입력 화면, 진행 상황, 결과, 이전 결과 다시 열기 |

## 설치 (Apps Script + clasp)

1. `npm i -g @google/clasp` → `clasp login`
2. https://script.google.com/home/usersettings 에서 Google Apps Script API 켜기
3. `clasp create-script --type standalone --rootDir src` (또는 기존 프로젝트의 `.clasp.json`)
4. `clasp push` → `clasp create-deployment`
5. 웹앱을 열어 권한을 허용하고, 화면 위 칸에 Gemini API 키를 저장합니다. 키는 Script Properties에만 저장되며 코드에는 없습니다.

## 알아 둘 점

- 제미나이는 교사용 지도서를 원문 그대로 받아 적지 않습니다(저작권 보호). 지도서 대본·정답은 직접 붙여넣습니다.
- 구글 슬라이드는 코드로 오디오를 넣을 수 없어 ▶ 버튼으로 연결합니다. HTML 덱에는 플레이어가 들어갑니다.
- 무료 등급은 입력이 구글 서비스 개선에 쓰일 수 있으므로 실제 학생 정보는 넣지 않습니다.
