// ============================================================
// Code.gs – AI 학생 질문 분류 시스템 (Google Apps Script)
// 스프레드시트: 학생 질문 데이터 저장
// ============================================================

const SPREADSHEET_ID = '1C7QvSfXDDxvy_IluJDYqi8WVh4byKmJfzUKJbuj1mIQ';
const SHEET_NAME = '학생질문';

// ----------------------------------------------------------
// doGet: URL ?page=student(기본) / ?page=teacher 로 HTML 서빙
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
// saveQuestion: 클라이언트에서 google.script.run 으로 호출
// ----------------------------------------------------------
function saveQuestion(questionData) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    let sheet = ss.getSheetByName(SHEET_NAME);

    if (!sheet) {
      sheet = ss.insertSheet(SHEET_NAME);
      const headers = [
        '타임스탬프', '학년', '반', '번호', '이름',
        '질문내용', '질문유형', '등급이름', '이모지', '내부점수', '표시점수'
      ];
      sheet.appendRow(headers);
      const hRange = sheet.getRange(1, 1, 1, headers.length);
      hRange.setBackground('#3B4A6B');
      hRange.setFontColor('#FFFFFF');
      hRange.setFontWeight('bold');
      sheet.setFrozenRows(1);
      sheet.setColumnWidth(6, 350); // 질문내용 열 넓히기
    }

    sheet.appendRow([
      new Date(),
      String(questionData.grade    || ''),
      String(questionData.classNum || ''),
      String(questionData.number   || ''),
      String(questionData.name     || ''),
      String(questionData.question || ''),
      String(questionData.type     || 'factual'),
      String(questionData.gradeName|| '병아리'),
      String(questionData.emoji    || '🐣'),
      Number(questionData.internalScore || 100),
      Number(questionData.displayScore  || 1)
    ]);

    return { success: true };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

// ----------------------------------------------------------
// getQuestions: 전체 질문 목록 반환 (점수 내림차순 정렬)
// ----------------------------------------------------------
function getQuestions() {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(SHEET_NAME);

    if (!sheet || sheet.getLastRow() <= 1) {
      return { success: true, data: [] };
    }

    const values = sheet.getDataRange().getValues();
    const rows   = values.slice(1); // 헤더 제외
    const tz     = Session.getScriptTimeZone();

    const questions = rows
      .filter(row => row[5]) // 질문 내용이 있는 행만
      .map((row, idx) => {
        let timeStr = '';
        try {
          timeStr = (row[0] instanceof Date)
            ? Utilities.formatDate(row[0], tz, 'M/d HH:mm')
            : String(row[0] || '');
        } catch (_) {}

        return {
          id:            idx + 1,
          timestamp:     timeStr,
          grade:         String(row[1]  || ''),
          classNum:      String(row[2]  || ''),
          number:        String(row[3]  || ''),
          name:          String(row[4]  || ''),
          question:      String(row[5]  || ''),
          type:          String(row[6]  || 'factual'),
          gradeName:     String(row[7]  || '병아리'),
          emoji:         String(row[8]  || '🐣'),
          internalScore: Number(row[9]) || 100,
          displayScore:  Number(row[10])|| 1
        };
      });

    // 내부 점수 내림차순, 동점이면 최신(id 높은) 순
    questions.sort((a, b) =>
      b.internalScore !== a.internalScore
        ? b.internalScore - a.internalScore
        : b.id - a.id
    );

    return { success: true, data: questions };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}
