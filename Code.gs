// ============================================================
// Code.gs – AI 학생 질문 분류 시스템 (Gemini API 연동)
// ============================================================

const SPREADSHEET_ID = '1C7QvSfXDDxvy_IluJDYqi8WVh4byKmJfzUKJbuj1mIQ';

// API 키는 프로젝트 설정 → 스크립트 속성(GEMINI_API_KEY)에서 읽어옴
function getGeminiKey_() {
  return PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
}

// ----------------------------------------------------------
// doGet: ?page=student(기본) / ?page=teacher
// ----------------------------------------------------------
function doGet(e) {
  const page = (e && e.parameter && e.parameter.page) ? e.parameter.page : 'student';
  if (page === 'teacher') {
    return HtmlService.createHtmlOutputFromFile('teacher')
      .setTitle('교사 대시보드 | AI 질문 분류 시스템')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }
  return HtmlService.createHtmlOutputFromFile('student')
    .setTitle('AI 질문 분류기 | 학생 페이지')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ----------------------------------------------------------
// 시트명 생성: "2학년" + "1" → "2-1"
// ----------------------------------------------------------
function buildSheetName_(grade, classNum) {
  const g = String(grade || '').replace('학년', '').trim();
  const c = String(classNum || '').trim();
  return g + '-' + c;
}

// ----------------------------------------------------------
// 학년-반 시트 가져오기 (없으면 자동 생성)
// ----------------------------------------------------------
function getOrCreateClassSheet_(ss, sheetName) {
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    const headers = [
      '타임스탬프', '학년', '반', '번호', '이름',
      '질문내용', '피드백', '질문유형', '등급이름', '이모지', '내부점수', '표시점수'
    ];
    sheet.appendRow(headers);
    const hRange = sheet.getRange(1, 1, 1, headers.length);
    hRange.setBackground('#3B4A6B');
    hRange.setFontColor('#FFFFFF');
    hRange.setFontWeight('bold');
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(1, 140);
    sheet.setColumnWidth(6, 320);
    sheet.setColumnWidth(7, 420);
  }
  return sheet;
}

// ----------------------------------------------------------
// Gemini API 호출: 질문 분류 + 피드백 생성
// ----------------------------------------------------------
function classifyWithGemini_(question, name) {
  const apiKey = getGeminiKey_();
  if (!apiKey) throw new Error('GEMINI_API_KEY 스크립트 속성이 설정되지 않았습니다.');
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=' + apiKey;

  const prompt =
    '당신은 학생의 질문 수준을 분석하는 교육 전문가입니다.\n\n' +
    '학생 이름: ' + name + '\n' +
    '학생 질문: "' + question + '"\n\n' +

    '[질문 수준 3단계]\n' +
    '1. factual(병아리): 하나의 정답이 있는 사실 확인 질문. "무엇?", "언제?", "누가?", "어디?" 등\n' +
    '2. conceptual(사춘기닭): 원리·이유·관계·과정을 탐구하는 질문. "왜?", "어떻게?", "차이는?", "원인은?" 등\n' +
    '3. debatable(시조새): 정답이 없고 가치 판단·토론이 필요한 질문. "옳은가?", "해야 하는가?", "어떤 것이 더 나은가?" 등\n\n' +

    '[분석 요청]\n' +
    '① type: 위 세 수준 중 하나로 분류\n' +
    '② feedback: 이 질문이 해당 수준으로 분류된 이유를, 질문의 구체적인 표현·구조·의도를 짚어서 설명 (2~3문장, ' + name + ' 학생에게 직접 말하는 친근한 톤)\n' +
    '③ tips: 이 질문을 한 단계 더 높은 수준으로 바꾸는 방법 설명 (debatable이면 질문을 더 풍부하게 만드는 방법) (2문장)\n' +
    '④ example: ③의 방법을 적용해서 이 질문을 직접 변형한 업그레이드 예시 질문 1개 (질문 형식으로, 짧고 구체적으로)\n\n' +

    '[출력] 아래 JSON만 출력 (다른 텍스트 없이):\n' +
    '{\n' +
    '  "type": "factual" 또는 "conceptual" 또는 "debatable",\n' +
    '  "feedback": "이 질문이 해당 수준인 이유 설명",\n' +
    '  "tips": "업그레이드 방법 설명",\n' +
    '  "example": "변형된 예시 질문"\n' +
    '}';

  const payload = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0,           // 일관된 분류를 위해 0으로 고정
      maxOutputTokens: 600,
      responseMimeType: 'application/json' // 순수 JSON만 반환하도록 강제
    }
  };

  const response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  const resJson = JSON.parse(response.getContentText());
  if (resJson.error) throw new Error('Gemini 오류: ' + resJson.error.message);

  const rawText = resJson.candidates[0].content.parts[0].text;

  // JSON 추출: 마크다운 코드블록 또는 앞뒤 텍스트가 있어도 처리
  let cleaned = rawText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (jsonMatch) cleaned = jsonMatch[0];

  const result = JSON.parse(cleaned);

  // type 값 검증: 허용 값 외에는 키워드로 재분류
  if (!['factual','conceptual','debatable'].includes(result.type)) {
    result.type = classifyByKeyword_(rawText).type;
  }
  return result;
}

// ----------------------------------------------------------
// 키워드 기반 폴백 분류 (Gemini API 실패 시)
// ----------------------------------------------------------
function classifyByKeyword_(question) {
  const t = question;

  // 논쟁적 키워드 — 어근 단위로 광범위하게 설정
  // '옳은가', '옳은 선택인가', '옳은지' 모두 '옳은'으로 잡음
  const DKW = [
    '해야 하', '해야 할', '해야 되', '이어야 하', '해야만',
    '찬성', '반대',
    '옳은', '그른', '잘못된',
    '윤리', '도덕', '가치 판단', '가치 있',
    '바람직', '적절한', '정당한', '합리적인', '불합리',
    '공정한', '불공정', '허용', '금지해야',
    '어떻게 생각', '어떤 입장', '어느 쪽',
    '더 나은가', '더 좋은가', '더 나쁜가',
    '해도 되는', '해도 될까', '해도 되나',
    '필요한가', '필요할까', '필요한지',
    '선택인가', '선택해야', '결정인가',
    '지속해야', '유지해야', '폐지해야', '도입해야',
    '동의', '반론', '논쟁', '논란'
  ];

  // 개념적 키워드
  const CKW = [
    '왜 ', '왜?', '왜요', '어째서', '무슨 이유',
    '어떻게 되', '어떻게 작동', '어떻게 이루', '어떻게 만',
    '어떻게 해서', '어떻게 생각',
    '이유는', '이유가', '원인은', '원인이',
    '원리는', '원리가', '메커니즘', '작동 방식',
    '차이는', '차이가', '차이점', '다른 점',
    '관계는', '관계가', '어떤 관계',
    '영향을', '영향은', '의미는', '의미가',
    '역할은', '역할이', '구조는', '과정은',
    '비교하면', '공통점', '유사점',
    // 인과·과정·변화를 묻는 표현
    '어쩌다', '어떤 계기', '어떤 과정', '어떤 이유',
    '무슨 일이', '무슨 계기', '무슨 이유',
    '왜 그런', '왜 그렇게', '왜 그게', '왜 이런', '왜 이렇게',
    '어떤 일이', '어떤 사건',
    '어떻게 변', '어떻게 극복', '어떻게 해결', '어떻게 성장',
    '어떻게 알게', '어떻게 느끼', '어떻게 달라',
    '되었을까', '됐을까', '되었나', '됐나',
    '잃게 된', '찾게 된', '갖게 된', '알게 된',
    '변하게 된', '바뀌게 된', '겪게 된',
    '겪었을까', '느꼈을까', '생각했을까', '선택했을까'
  ];

  let d = 0, c = 0;
  DKW.forEach(function(k){ if(t.includes(k)) d++; });
  CKW.forEach(function(k){ if(t.includes(k)) c++; });

  // 가치 판단 형용사 단독으로도 강하게 debatable 점수 부여
  // "옳은 선택인가", "정당한 행동인가" 등 포함
  ['옳','그른','바람직','적절','정당','공정','불공정','윤리','도덕','합리'].forEach(function(adj){
    if(t.includes(adj)) d += 2;
  });

  const type = (d > 0 && d >= c) ? 'debatable' : (c > 0 ? 'conceptual' : 'factual');
  const MSG = {
    factual:   {
      feedback: '사실을 확인하는 기초 질문입니다. 모든 깊은 탐구는 이렇게 시작돼요!',
      tips: '"왜?" 또는 "어떻게?"를 붙여보세요. 사실 뒤에 숨은 원리를 탐구하면 한 단계 높은 질문이 됩니다.',
      example: ''
    },
    conceptual: {
      feedback: '원리와 관계를 탐구하는 깊이 있는 질문입니다. 비판적 사고가 돋보여요!',
      tips: '"이것이 옳은가?", "어느 것이 더 나은가?"처럼 가치 판단을 더하면 논쟁적 질문으로 발전해요.',
      example: ''
    },
    debatable: {
      feedback: '정답이 없는 최고 수준의 논쟁적 질문입니다! 다양한 관점에서 토론이 가능해요.',
      tips: '찬성·반대 근거를 각각 정리하고 경제·윤리·사회적 관점으로 나눠 분석해보세요.',
      example: ''
    }
  };
  return { type: type, feedback: MSG[type].feedback, tips: MSG[type].tips, example: '' };
}

// ----------------------------------------------------------
// submitQuestion: 학생 질문 제출 → AI 분류 → 시트 저장 → 결과 반환
// ----------------------------------------------------------
function submitQuestion(data) {
  try {
    const name     = String(data.name     || '');
    const question = String(data.question || '');

    // 1. Gemini API로 분류 (실패 시 에러 반환 — 키워드 폴백 사용 안 함)
    let aiResult;
    try {
      aiResult = classifyWithGemini_(question, name);
    } catch (aiErr) {
      Logger.log('Gemini API 실패: ' + aiErr);
      return { success: false, error: 'AI 분류에 실패했습니다. 잠시 후 다시 시도해 주세요.\n(상세: ' + aiErr.message + ')' };
    }

    // 2. 유형별 메타데이터
    const TYPE_META = {
      factual:    { gradeName:'병아리',   emoji:'🐣', displayScore:1, internalBase:100 },
      conceptual: { gradeName:'사춘기닭', emoji:'🐓', displayScore:3, internalBase:300 },
      debatable:  { gradeName:'시조새',   emoji:'🦕', displayScore:5, internalBase:500 }
    };
    const meta = TYPE_META[aiResult.type] || TYPE_META.factual;
    const lenBonus      = Math.min(Math.floor(question.length / 15), 15);
    const internalScore = meta.internalBase + lenBonus;

    // 3. 시트 저장
    const ss        = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheetName = buildSheetName_(data.grade, data.classNum);
    const sheet     = getOrCreateClassSheet_(ss, sheetName);

    const feedbackSaved =
      '[' + meta.gradeName + ' 등급] ' + (aiResult.feedback || '') +
      '\n\n💡 개선 팁: ' + (aiResult.tips || '');

    sheet.appendRow([
      new Date(),
      String(data.grade    || ''),
      String(data.classNum || ''),
      String(data.number   || ''),
      name,
      question,
      feedbackSaved,
      aiResult.type || 'factual',
      meta.gradeName,
      meta.emoji,
      internalScore,
      meta.displayScore
    ]);

    // 4. 클라이언트에 결과 반환
    return {
      success:      true,
      type:         aiResult.type    || 'factual',
      gradeName:    meta.gradeName,
      emoji:        meta.emoji,
      displayScore: meta.displayScore,
      feedback:     aiResult.feedback || '',
      tips:         aiResult.tips     || '',
      example:      aiResult.example  || ''
    };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

// ----------------------------------------------------------
// getQuestions: 모든 학년-반 시트에서 질문 수집, 점수 내림차순 정렬
// ----------------------------------------------------------
function getQuestions() {
  try {
    const ss     = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheets = ss.getSheets();
    const tz     = Session.getScriptTimeZone();
    const allQ   = [];

    sheets.forEach(function(sheet) {
      const sName = sheet.getName();
      if (!/^\d+-\d+$/.test(sName)) return;
      if (sheet.getLastRow() <= 1)   return;

      const values = sheet.getDataRange().getValues();
      const rows   = values.slice(1);

      rows.forEach(function(row, idx) {
        if (!row[5]) return;

        let timeStr = '';
        try {
          timeStr = (row[0] instanceof Date)
            ? Utilities.formatDate(row[0], tz, 'M/d HH:mm')
            : String(row[0] || '');
        } catch (_) {}

        allQ.push({
          sheetName:     sName,
          rowNum:        idx + 2,
          timestamp:     timeStr,
          grade:         String(row[1]  || ''),
          classNum:      String(row[2]  || ''),
          number:        String(row[3]  || ''),
          name:          String(row[4]  || ''),
          question:      String(row[5]  || ''),
          feedback:      String(row[6]  || ''),
          type:          String(row[7]  || 'factual'),
          gradeName:     String(row[8]  || '병아리'),
          emoji:         String(row[9]  || '🐣'),
          internalScore: Number(row[10]) || 100,
          displayScore:  Number(row[11]) || 1
        });
      });
    });

    allQ.sort(function(a, b) {
      return b.internalScore !== a.internalScore
        ? b.internalScore - a.internalScore
        : (b.timestamp > a.timestamp ? 1 : -1);
    });

    return { success: true, data: allQ };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

// ----------------------------------------------------------
// deleteQuestion: 교사 삭제 기능
// ----------------------------------------------------------
function deleteQuestion(sheetName, rowNum) {
  try {
    const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) return { success: false, error: '시트를 찾을 수 없습니다: ' + sheetName };
    if (rowNum < 2 || rowNum > sheet.getLastRow()) return { success: false, error: '유효하지 않은 행 번호입니다.' };
    sheet.deleteRow(rowNum);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}
