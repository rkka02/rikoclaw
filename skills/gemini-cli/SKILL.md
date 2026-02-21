---
name: gemini-cli
description: |
  Call Google Gemini models via gemini CLI. Use when the user asks to query Gemini, get a second LLM opinion, compare models, or benchmark.
  Gemini CLI를 통해 Google Gemini 모델 호출. "gemini한테 물어봐", "gemini 불러", "gemini로 해봐", "second opinion" 등의 키워드에 반응.
  Triggers on keywords like "gemini", "제미나이", "second opinion", "다른 모델", "비교", "benchmark".
---

# Gemini CLI

## 경로

```
gemini
```

## 기본 사용법

```bash
# 비대화형 (한 번 질문)
gemini -p "질문 내용"

# 모델 지정
gemini -m <모델명> -p "질문 내용"
```

## 사용 가능한 모델

| 모델명 | 설명 | 비고 |
|--------|------|------|
| `gemini-2.5-flash` | 기본 모델 (빠름) | `-m` 생략 시 기본값 |
| `gemini-2.5-pro` | Pro 모델 (복잡한 작업) | |
| `gemini-3-flash-preview` | 최신 3.0 Flash 프리뷰 | rate limit 빡빡할 수 있음 |

## 주의사항

- **비대화형 모드(`-p`)만 사용할 것.** 파이프(`echo | gemini`)는 불안정함.
- gemini-3-flash-preview는 무료 티어 quota가 작아서 `quota exhausted` 에러 발생 가능. 재시도하면 됨.
- 응답이 길어지면 에이전트 모드로 빠져서 타임아웃 걸릴 수 있음. 짧은 프롬프트 + `perl -e 'alarm 15; exec @ARGV' --` 타임아웃 래퍼 사용 권장.
- 버전: `gemini --version` (현재 0.29.2)

## 예시

```bash
# 기본 질문
gemini -p "Swift에서 async/await 패턴 설명해줘"

# 모델 지정
gemini -m gemini-2.5-pro -p "이 코드 리뷰해줘: ..."

# 타임아웃 포함 (15초)
perl -e 'alarm 15; exec @ARGV' -- gemini -m gemini-3-flash-preview -p "한 줄로 대답해. 질문"
```
