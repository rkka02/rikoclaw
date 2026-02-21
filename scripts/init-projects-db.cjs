#!/usr/bin/env node
/**
 * 부수입 프로젝트 관리 DB 초기화
 *
 * 설계 원칙:
 * - 수익(revenue)이 중심. 모든 프로젝트는 결국 수익으로 귀결.
 * - 프로젝트 추가/삭제/카테고리 확장 자유롭게.
 * - activity_log로 전체 타임라인 자동 추적.
 * - 마크다운 파일은 전략/아이디어/메모용으로 유지. DB는 상태/숫자/이력.
 */

const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'data', 'projects.db');

function initDB() {
  const db = new Database(DB_PATH);

  // WAL 모드 + 외래키 활성화
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    -------------------------------------------------------------------
    -- 1. projects: 모든 프로젝트 (블로그, 앱, 외주, 뭐든)
    --    category는 자유 텍스트. 나중에 'youtube', 'saas' 뭐든 추가 가능.
    -------------------------------------------------------------------
    CREATE TABLE IF NOT EXISTS projects (
      id            TEXT PRIMARY KEY,
      name          TEXT NOT NULL,
      category      TEXT NOT NULL,              -- 'blog', 'app', 'freelance', 'course', ...
      status        TEXT NOT NULL DEFAULT 'idea',
        -- idea → planning → dev → mvp → launched → growing → paused → archived
      description   TEXT,
      url           TEXT,
      started_at    TEXT,                        -- ISO date
      launched_at   TEXT,
      archived_at   TEXT,
      metadata      TEXT,                        -- JSON. 자유 확장. 앱이면 bundle_id, 블로그면 platform 등
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -------------------------------------------------------------------
    -- 2. milestones: 프로젝트별 마일스톤/할일
    -------------------------------------------------------------------
    CREATE TABLE IF NOT EXISTS milestones (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id    TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      title         TEXT NOT NULL,
      status        TEXT NOT NULL DEFAULT 'pending',  -- pending, in_progress, done, blocked
      due_date      TEXT,
      done_at       TEXT,
      notes         TEXT,
      sort_order    INTEGER NOT NULL DEFAULT 0,
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_milestones_project ON milestones(project_id);

    -------------------------------------------------------------------
    -- 3. revenue: 수익/지출 기록 — 핵심 테이블
    --    amount: 양수 = 수익, 음수 = 비용(서버비, 개발자계정 등)
    --    currency: 기본 KRW. 해외 수익 대비 확장 가능.
    -------------------------------------------------------------------
    CREATE TABLE IF NOT EXISTS revenue (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id    TEXT REFERENCES projects(id) ON DELETE SET NULL,  -- NULL이면 프로젝트 무관 수익/지출
      date          TEXT NOT NULL,               -- YYYY-MM-DD
      amount        INTEGER NOT NULL,            -- 원 단위. 음수 = 지출
      currency      TEXT NOT NULL DEFAULT 'KRW',
      type          TEXT NOT NULL,               -- 'ad', 'subscription', 'iap', 'freelance', 'salary', 'cost', 'other'
      description   TEXT,
      recurring     INTEGER NOT NULL DEFAULT 0,  -- 1이면 정기 수익/지출
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_revenue_date ON revenue(date);
    CREATE INDEX IF NOT EXISTS idx_revenue_project ON revenue(project_id);

    -------------------------------------------------------------------
    -- 4. blog_posts: 블로그 글 이력
    -------------------------------------------------------------------
    CREATE TABLE IF NOT EXISTS blog_posts (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id    TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      title         TEXT NOT NULL,
      status        TEXT NOT NULL DEFAULT 'draft',  -- idea, draft, review, published, archived
      url           TEXT,
      keywords      TEXT,                        -- JSON array
      views         INTEGER NOT NULL DEFAULT 0,
      published_at  TEXT,
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_blog_posts_project ON blog_posts(project_id);

    -------------------------------------------------------------------
    -- 5. app_metrics: 앱별 일간 지표 (출시 후 추적)
    -------------------------------------------------------------------
    CREATE TABLE IF NOT EXISTS app_metrics (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id    TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      date          TEXT NOT NULL,               -- YYYY-MM-DD
      downloads     INTEGER NOT NULL DEFAULT 0,
      active_users  INTEGER NOT NULL DEFAULT 0,
      rating        REAL,
      reviews       INTEGER NOT NULL DEFAULT 0,
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(project_id, date)                   -- 하루에 한 레코드
    );
    CREATE INDEX IF NOT EXISTS idx_app_metrics_project_date ON app_metrics(project_id, date);

    -------------------------------------------------------------------
    -- 6. activity_log: 전체 타임라인
    --    프로젝트 생성, 상태 변경, 마일스톤 완료, 글 발행, 수익 기록 등 전부
    -------------------------------------------------------------------
    CREATE TABLE IF NOT EXISTS activity_log (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id    TEXT REFERENCES projects(id) ON DELETE SET NULL,
      action        TEXT NOT NULL,               -- 'project_created', 'status_changed', 'milestone_done', 'post_published', 'revenue_added', ...
      detail        TEXT,                        -- 자유 텍스트 or JSON
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_activity_log_created ON activity_log(created_at);
    CREATE INDEX IF NOT EXISTS idx_activity_log_project ON activity_log(project_id);

    -------------------------------------------------------------------
    -- 뷰: 월별 수익 요약 (가장 많이 볼 뷰)
    -------------------------------------------------------------------
    CREATE VIEW IF NOT EXISTS v_monthly_revenue AS
    SELECT
      strftime('%Y-%m', date) AS month,
      project_id,
      p.name AS project_name,
      p.category,
      SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END) AS income,
      SUM(CASE WHEN amount < 0 THEN amount ELSE 0 END) AS expense,
      SUM(amount) AS net
    FROM revenue r
    LEFT JOIN projects p ON r.project_id = p.id
    GROUP BY month, project_id;

    -------------------------------------------------------------------
    -- 뷰: 프로젝트 대시보드 (상태 + 총 수익)
    -------------------------------------------------------------------
    CREATE VIEW IF NOT EXISTS v_project_dashboard AS
    SELECT
      p.id,
      p.name,
      p.category,
      p.status,
      p.launched_at,
      COALESCE(rev.total_income, 0)  AS total_income,
      COALESCE(rev.total_expense, 0) AS total_expense,
      COALESCE(rev.total_net, 0)     AS total_net,
      COALESCE(ms.total, 0)         AS milestones_total,
      COALESCE(ms.done, 0)          AS milestones_done,
      COALESCE(bp.post_count, 0)    AS blog_post_count
    FROM projects p
    LEFT JOIN (
      SELECT project_id,
        SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END) AS total_income,
        SUM(CASE WHEN amount < 0 THEN amount ELSE 0 END) AS total_expense,
        SUM(amount) AS total_net
      FROM revenue GROUP BY project_id
    ) rev ON p.id = rev.project_id
    LEFT JOIN (
      SELECT project_id,
        COUNT(*) AS total,
        SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS done
      FROM milestones GROUP BY project_id
    ) ms ON p.id = ms.project_id
    LEFT JOIN (
      SELECT project_id, COUNT(*) AS post_count
      FROM blog_posts WHERE status = 'published'
      GROUP BY project_id
    ) bp ON p.id = bp.project_id
    ORDER BY total_net DESC;
  `);

  console.log('✓ 테이블 6개 + 뷰 2개 생성 완료');
  return db;
}

function seedData(db) {
  // ── 프로젝트 ──
  const insertProject = db.prepare(`
    INSERT OR IGNORE INTO projects (id, name, category, status, description, url, started_at, launched_at, metadata)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const projects = [
    // 블로그
    ['blog-issues-today', '오늘뭔일', 'blog', 'in_progress',
     '이슈/트렌드/테크 쉽게 풀어쓰기. 구글 검색 유입 타겟.',
     'https://issues-today.tistory.com', '2026-02-06', null,
     JSON.stringify({ platform: 'tistory', adsense: false })],

    ['blog-rikka', '릿카직스', 'blog', 'in_progress',
     '수학/물리/CS 심화 콘텐츠.',
     'https://rikka.tistory.com', null, null,
     JSON.stringify({ platform: 'tistory', adsense: false })],

    // 앱 — MVP 완료
    ['app-noise-monitor', '소음측정기', 'app', 'mvp',
     '층간소음 실시간 측정 + 생활 비유 + 기록/분석',
     null, '2026-02-06', null,
     JSON.stringify({ bundle_id: 'com.makisbea.noisemonitor', tech: 'SwiftUI + AVAudioEngine + SwiftData + WidgetKit' })],

    ['app-unit-converter', '단위변환기', 'app', 'mvp',
     'AdMob 연동 단위변환기',
     null, '2026-02-06', null,
     JSON.stringify({ tech: 'SwiftUI' })],

    // 앱 — 아이디어
    ['app-subscription-tracker', '구독료 트래커', 'app', 'idea',
     '넷플릭스/멜론/쿠팡 등 모든 구독 서비스 한 곳에서 관리',
     null, null, null,
     JSON.stringify({ dev_days: 5, pricing: '무료(3개) + 프리미엄 월 1,900원', aso: '구독관리, 구독료, 구독정리' })],

    ['app-parking-timer', '주차 위치+타이머', 'app', 'idea',
     '지하주차장 층/구역 사진 저장 + 무료주차 시간 카운트다운',
     null, null, null,
     JSON.stringify({ dev_days: 5, pricing: '무료 + 프로 2,900원 1회', aso: '주차위치, 주차위치저장, 주차타이머' })],

    ['app-fasting-timer', '간헐적 단식 타이머', 'app', 'idea',
     '16:8, 18:6 등 단식 스케줄 관리 + 타이머',
     null, null, null,
     JSON.stringify({ dev_days: 5, pricing: '무료(16:8) + 프로 월 2,900원', aso: '간헐적단식, 단식타이머, 16시간단식' })],

    ['app-water-reminder', '물 마시기 리마인더', 'app', 'idea',
     '수분 섭취 추적 + 리마인더',
     null, null, null,
     JSON.stringify({ dev_days: 5, pricing: '무료 + 프로 4,900원 1회', aso: '물마시기, 수분섭취, 물알림' })],

    ['app-focus-timer', '포커스 타이머+백색소음', 'app', 'idea',
     '뽀모도로 + 카페/자연 백색소음 결합',
     null, null, null,
     JSON.stringify({ dev_days: 7, pricing: '무료(5가지) + 프로 4,900원 1회', aso: '뽀모도로, 백색소음, 집중타이머' })],

    ['app-budget-widget', '가계부 위젯', 'app', 'idea',
     'Interactive Widget으로 앱 안 열고 2탭 지출 기록',
     null, null, null,
     JSON.stringify({ dev_days: 7, pricing: '무료 + 프로 월 1,900원', aso: '가계부, 지출관리, 가계부위젯' })],

    ['app-emotion-diary', '감정 일기', 'app', 'idea',
     '한 줄 일기 + 감정 트래킹 + Year in Pixels',
     null, null, null,
     JSON.stringify({ dev_days: 7, pricing: '무료 + 프로 월 1,900원', aso: '감정일기, 무드트래커, 하루일기' })],

    ['app-voice-memo', 'AI 음성 메모', 'app', 'idea',
     '음성→텍스트+AI 요약+카테고리 분류',
     null, null, null,
     JSON.stringify({ dev_days: 7, pricing: '무료(하루 5건) + 프로 월 2,900원', aso: '음성메모, AI메모, 음성녹음' })],

    ['app-parcel-tracker', '택배 통합 조회', 'app', 'idea',
     'Live Activity 배송 현황. 모든 택배사 통합',
     null, null, null,
     JSON.stringify({ dev_days: 10, pricing: '무료 + 프로 월 1,900원', aso: '택배조회, 배송추적, 택배알림' })],

    ['app-habit-tracker', '습관 트래커', 'app', 'idea',
     '매일 습관 체크 + 스트릭 + Apple Watch 연동',
     null, null, null,
     JSON.stringify({ dev_days: 10, pricing: '무료 + 프로 4,900원 1회', aso: '습관, 습관트래커, 루틴관리' })],
  ];

  const insertMany = db.transaction(() => {
    for (const p of projects) {
      insertProject.run(...p);
    }
  });
  insertMany();
  console.log(`✓ 프로젝트 ${projects.length}개 삽입`);

  // ── 마일스톤 ──
  const insertMilestone = db.prepare(`
    INSERT OR IGNORE INTO milestones (project_id, title, status, done_at, notes, sort_order)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const milestones = [
    // 소음측정기
    ['app-noise-monitor', 'MVP 완성', 'done', '2026-02-06', null, 1],
    ['app-noise-monitor', '실기기(중고 iPhone) 구매', 'pending', null, '~2.7만원 예산', 2],
    ['app-noise-monitor', 'dB 보정값 조정', 'pending', null, 'AudioMeterService +100.0 하드코딩 → 실기기 비교', 3],
    ['app-noise-monitor', '개인정보 처리방침 URL', 'pending', null, 'Notion/GitHub Pages', 4],
    ['app-noise-monitor', '스크린샷 촬영', 'pending', null, null, 5],
    ['app-noise-monitor', '앱스토어 제출', 'pending', null, 'Archive → App Store Connect → 심사', 6],

    // 단위변환기
    ['app-unit-converter', 'MVP 완성', 'done', '2026-02-06', null, 1],
    ['app-unit-converter', 'AdMob 연동', 'pending', null, null, 2],
    ['app-unit-converter', '개인정보 처리방침 URL', 'pending', null, null, 3],
    ['app-unit-converter', '앱스토어 제출', 'pending', null, null, 4],

    // 오늘뭔일 블로그
    ['blog-issues-today', '첫 글 게시', 'pending', null, null, 1],
    ['blog-issues-today', '글 10개 달성', 'pending', null, '애드센스 승인 최소 조건', 2],
    ['blog-issues-today', '애드센스 승인', 'pending', null, null, 3],

    // 릿카직스
    ['blog-rikka', '애드센스 승인', 'pending', null, null, 1],
  ];

  const insertMilestones = db.transaction(() => {
    for (const m of milestones) {
      insertMilestone.run(...m);
    }
  });
  insertMilestones();
  console.log(`✓ 마일스톤 ${milestones.length}개 삽입`);

  // ── 비용 기록 (이미 발생한 것) ──
  const insertRevenue = db.prepare(`
    INSERT INTO revenue (project_id, date, amount, type, description, recurring)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const costs = [
    // 애플 개발자 계정 연 $99 ≈ 약 132,000원 (이미 보유)
    [null, '2025-01-01', -132000, 'cost', '애플 개발자 계정 연회비 ($99)', 1],
  ];

  const insertCosts = db.transaction(() => {
    for (const c of costs) {
      insertRevenue.run(...c);
    }
  });
  insertCosts();
  console.log(`✓ 비용 기록 ${costs.length}건 삽입`);

  // ── 활동 로그: 프로젝트 생성 기록 ──
  const insertLog = db.prepare(`
    INSERT INTO activity_log (project_id, action, detail, created_at)
    VALUES (?, ?, ?, ?)
  `);

  const insertLogs = db.transaction(() => {
    insertLog.run(null, 'system', '프로젝트 관리 DB 초기화', new Date().toISOString());
    for (const p of projects) {
      insertLog.run(p[0], 'project_created', `${p[1]} (${p[2]}) — ${p[3]}`, new Date().toISOString());
    }
  });
  insertLogs();
  console.log(`✓ 활동 로그 ${projects.length + 1}건 삽입`);

  db.close();
  console.log('\n=== DB 초기화 완료 ===');
  console.log(`위치: ${DB_PATH}`);
}

// 실행
const db = initDB();
seedData(db);
