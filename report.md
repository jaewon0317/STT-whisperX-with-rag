# WhisperX Note - 프로젝트 보고서

## 1. 프로젝트 개요

### 1.1 프로젝트 명
**WhisperX Note** - 로컬 AI 기반 음성 인식 및 회의록 자동 생성 시스템

### 1.2 개발 목적
본 프로젝트는 회의, 강의, 인터뷰 등의 음성 데이터를 자동으로 텍스트로 변환하고, 이를 기반으로 구조화된 회의록을 생성하며, RAG(Retrieval-Augmented Generation) 기술을 활용하여 전사된 내용에 대해 자연어로 질의응답이 가능한 시스템을 구현하는 것을 목표로 한다.

### 1.3 주요 특징
- **완전한 로컬 실행**: 모든 처리가 로컬에서 이루어져 개인정보 보호 보장
- **최신 AI 모델 활용**: OpenAI Whisper 기반의 WhisperX 사용
- **화자 분리(Speaker Diarization)**: PyAnnote 기반 다중 화자 자동 식별
- **RAG 기반 지능형 Q&A**: 전사 내용에 대한 자연어 질의응답 지원
- **다중 문서 지원**: PDF, 코드 파일 등 다양한 문서 형식 처리
- **YouTube 오디오 다운로드**: YouTube 영상에서 직접 오디오 추출 및 전사

---

## 2. 시스템 아키텍처

### 2.1 전체 구조

```
┌─────────────────────────────────────────────────────────────────┐
│                        Frontend (Web UI)                         │
│                    HTML/CSS/JavaScript + Bootstrap               │
└─────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Backend (FastAPI Server)                     │
│                          src/app.py                              │
└─────────────────────────────────────────────────────────────────┘
                                 │
        ┌────────────────────────┼────────────────────────┐
        ▼                        ▼                        ▼
┌───────────────┐    ┌────────────────────┐    ┌─────────────────┐
│  Transcriber  │    │   Session Manager  │    │    RAG Chat     │
│  (WhisperX)   │    │  Document Manager  │    │  (LangChain +   │
│               │    │  Folder Manager    │    │   ChromaDB)     │
└───────────────┘    └────────────────────┘    └─────────────────┘
        │                        │                        │
        ▼                        ▼                        ▼
┌───────────────┐    ┌────────────────────┐    ┌─────────────────┐
│ Whisper Model │    │   JSON Metadata    │    │  Ollama (LLM)   │
│ + PyAnnote    │    │   Audio Files      │    │  + Embeddings   │
└───────────────┘    └────────────────────┘    └─────────────────┘
```

### 2.2 디렉토리 구조

```
stt/
├── src/                          # 소스 코드
│   ├── __init__.py
│   ├── app.py                    # FastAPI 메인 서버 (667줄)
│   ├── config.py                 # 설정 및 경로 관리
│   ├── transcriber.py            # WhisperX 음성 인식 모듈 (267줄)
│   ├── meeting_minutes.py        # 회의록 생성 모듈 (122줄)
│   ├── session_manager.py        # 세션 데이터 관리 (258줄)
│   ├── document_manager.py       # 문서 관리 모듈
│   ├── folder_manager.py         # 폴더 구조 관리
│   └── rag_chat.py               # RAG Q&A 시스템 (200줄)
├── static/
│   ├── css/style.css             # 커스텀 스타일 (482줄)
│   └── js/app.js                 # 프론트엔드 로직 (1719줄)
├── templates/
│   └── index.html                # 메인 HTML 템플릿 (553줄)
├── data/                         # 데이터 저장소 (gitignore)
│   ├── sessions/                 # 세션별 데이터
│   ├── documents/                # 업로드된 문서
│   ├── chroma_db/                # 벡터 데이터베이스
│   └── downloads/                # YouTube 다운로드
├── models/                       # AI 모델 캐시 (gitignore)
├── requirements.txt
└── report.md                     # 본 보고서
```

---

## 3. 핵심 기술 스택

### 3.1 Backend

| 기술 | 버전 | 용도 |
|------|------|------|
| Python | 3.10+ | 메인 프로그래밍 언어 |
| FastAPI | 0.104+ | 비동기 웹 프레임워크 |
| WhisperX | latest | 음성 인식 (Whisper 기반) |
| PyAnnote | 3.0+ | 화자 분리 (Speaker Diarization) |
| LangChain | 0.1+ | RAG 파이프라인 구축 |
| ChromaDB | 0.4+ | 벡터 데이터베이스 |
| Ollama | latest | 로컬 LLM 서버 |
| PyTorch | 2.0+ | 딥러닝 프레임워크 |
| yt-dlp | latest | YouTube 오디오 다운로드 |

### 3.2 Frontend

| 기술 | 버전 | 용도 |
|------|------|------|
| HTML5 | - | 마크업 |
| CSS3 | - | 스타일링 (다크 테마) |
| JavaScript (ES6+) | - | 클라이언트 로직 |
| Bootstrap | 5.3.2 | UI 컴포넌트 |
| Bootstrap Icons | 1.11.1 | 아이콘 |
| Marked.js | latest | 마크다운 렌더링 |

### 3.3 AI 모델

| 모델 | 용도 | 설명 |
|------|------|------|
| whisper-large-v3-turbo | 음성 인식 | OpenAI Whisper 기반, 다국어 지원 |
| pyannote/speaker-diarization-3.1 | 화자 분리 | HuggingFace 모델 |
| nomic-embed-text | 텍스트 임베딩 | 벡터 검색용 |
| exaone (또는 llama3.2) | LLM | 질의응답 생성 |

---

## 4. 주요 기능 상세

### 4.1 음성 인식 (Speech-to-Text)

#### 4.1.1 구현 클래스: `WhisperXTranscriber`

```python
class WhisperXTranscriber:
    """WhisperX를 사용한 음성 인식 및 화자분리"""

    def transcribe_with_segments(
        self,
        audio_path: str,
        language: str = "ko",
        enable_diarization: bool = False
    ) -> Dict[str, Any]:
        """세그먼트 형식으로 전사 결과 반환"""
```

#### 4.1.2 지원 기능
- **다국어 지원**: 한국어(ko), 영어(en), 일본어(ja), 중국어(zh)
- **단어 수준 정렬**: 각 단어의 정확한 시작/종료 타임스탬프 제공
- **화자 분리**: PyAnnote 모델을 통한 다중 화자 자동 식별
- **GPU 가속**: CUDA 지원 시 float16 연산으로 빠른 처리

#### 4.1.3 처리 파이프라인

```
오디오 입력 → WhisperX 전사 → 단어 정렬(Alignment) → 화자 분리(선택) → 결과 반환
```

### 4.2 회의록 자동 생성

#### 4.2.1 구현 클래스: `MeetingMinutesGenerator`

```python
class MeetingMinutesGenerator:
    """회의록 생성"""

    def generate(
        self,
        transcription_result: Dict[str, Any],
        title: str = "회의록",
        participants: Optional[List[str]] = None,
        agenda: Optional[List[str]] = None
    ) -> Dict[str, Any]:
```

#### 4.2.2 생성 항목
- 회의 제목 및 일시
- 소요 시간 자동 계산
- 참석자 목록
- 안건 정리
- 타임스탬프별 녹취록
- 마크다운/JSON 형식 출력

### 4.3 RAG 기반 질의응답

#### 4.3.1 구현 클래스: `TranscriptRAG`

```python
class TranscriptRAG:
    """전사 텍스트 기반 RAG 시스템"""

    def query(self, question: str, session_ids: list[str]) -> str:
        """RAG 기반 질문 답변 (다중 세션 지원)"""
```

#### 4.3.2 RAG 파이프라인

```
┌─────────────┐    ┌──────────────┐    ┌─────────────┐
│  텍스트     │ → │  청킹        │ → │  임베딩     │
│  (전사본)   │    │  (500자)     │    │  (nomic)    │
└─────────────┘    └──────────────┘    └─────────────┘
                                              │
                                              ▼
┌─────────────┐    ┌──────────────┐    ┌─────────────┐
│  LLM 응답   │ ← │  프롬프트    │ ← │  유사도     │
│  (exaone)   │    │  생성        │    │  검색       │
└─────────────┘    └──────────────┘    └─────────────┘
```

#### 4.3.3 주요 특징
- **다중 세션 검색**: 여러 회의록/문서를 동시에 참조하여 답변 생성
- **문맥 기반 응답**: 검색된 관련 내용을 바탕으로 정확한 답변 제공
- **한국어 최적화**: 한국어 프롬프트 및 응답 생성

### 4.4 문서 관리 시스템

#### 4.4.1 지원 파일 형식

| 카테고리 | 확장자 |
|----------|--------|
| 문서 | PDF, TXT, MD |
| 코드 | PY, JS, HTML, CSS, JSON, YAML, C, CPP, H, JAVA |
| 데이터 | JSON, XML, CSV |

#### 4.4.2 문서 처리 흐름

```
파일 업로드 → 텍스트 추출 → 메타데이터 저장 → 벡터 인덱싱 → RAG 검색 가능
```

### 4.5 YouTube 오디오 다운로드

#### 4.5.1 구현 방식
```python
# yt-dlp를 사용한 오디오 추출
cmd = [
    "yt-dlp",
    "-x",                          # 오디오만 추출
    "--audio-format", "mp3",       # MP3 형식
    "--audio-quality", "192K",     # 192kbps 품질
    "-o", output_path,
    url
]
```

#### 4.5.2 지원 기능
- YouTube URL 입력 시 자동 오디오 추출
- 영상 제목 자동 추출 및 세션 제목으로 사용
- ffmpeg를 통한 오디오 변환

---

## 5. API 명세

### 5.1 세션 관리 API

| Method | Endpoint | 설명 |
|--------|----------|------|
| GET | `/api/sessions` | 세션 목록 조회 |
| GET | `/api/session/{id}` | 세션 상세 조회 |
| POST | `/api/transcribe` | 오디오 파일 전사 |
| POST | `/api/transcribe-file` | 서버 파일 전사 |
| PUT | `/api/session/{id}/title` | 제목 수정 |
| PUT | `/api/session/{id}/speaker` | 화자 이름 변경 |
| PUT | `/api/session/{id}/segment` | 세그먼트 편집 |
| DELETE | `/api/session/{id}` | 세션 삭제 |

### 5.2 폴더/문서 API

| Method | Endpoint | 설명 |
|--------|----------|------|
| GET | `/api/structure` | 전체 구조 조회 |
| POST | `/api/folders` | 폴더 생성 |
| PUT | `/api/folders/{id}` | 폴더 수정 |
| DELETE | `/api/folders/{id}` | 폴더 삭제 |
| POST | `/api/documents` | 문서 업로드 |
| GET | `/api/documents/{id}/content` | 문서 내용 조회 |
| DELETE | `/api/documents/{id}` | 문서 삭제 |
| PUT | `/api/move` | 항목 이동 (드래그앤드롭) |

### 5.3 채팅/RAG API

| Method | Endpoint | 설명 |
|--------|----------|------|
| POST | `/api/chat` | RAG 기반 질의응답 |
| POST | `/api/index/{id}` | 세션 인덱싱 |
| GET | `/api/index/{id}/status` | 인덱스 상태 확인 |
| POST | `/api/youtube` | YouTube 다운로드 |

---

## 6. 사용자 인터페이스

### 6.1 메인 화면 구성

```
┌────────────────────────────────────────────────────────────────────┐
│  [로고] WhisperX Note                                              │
├─────────┬─────────────────────────────────────────────┬────────────┤
│ 사이드바 │              탭 바 (홈, 세션1, 세션2...)      │  채팅 패널 │
│         │──────────────────────────────────────────────│            │
│ 폴더    │                                              │  AI       │
│  └세션  │           메인 콘텐츠 영역                    │  어시스턴트│
│  └문서  │                                              │            │
│         │  - 홈: 새 회의록 생성 폼                      │  [질문]   │
│         │  - 세션: 전사 뷰어 + 오디오 플레이어          │  [응답]   │
│         │  - 문서: 문서 뷰어                           │            │
├─────────┴─────────────────────────────────────────────┴────────────┤
│                     [◀ 이전] [오디오 플레이어] [다음 ▶]             │
└────────────────────────────────────────────────────────────────────┘
```

### 6.2 UI/UX 특징
- **다크 테마**: 눈의 피로를 줄이는 어두운 색상 기반
- **반응형 레이아웃**: 사이드바, 채팅 패널 크기 조절 가능
- **탭 기반 네비게이션**: 여러 세션/문서를 동시에 열어 작업
- **드래그 앤 드롭**: 파일 업로드 및 폴더 구조 정리
- **실시간 동기화**: 오디오 재생 위치와 전사 텍스트 하이라이트 연동

### 6.3 주요 컬러 팔레트

| 변수명 | 색상 코드 | 용도 |
|--------|-----------|------|
| `--bg-primary` | #181818 | 메인 배경 |
| `--bg-secondary` | #1e1e1e | 카드/패널 배경 |
| `--bg-tertiary` | #2d2d2d | 호버/강조 배경 |
| `--accent` | #f59e0b | 포인트 색상 (주황) |
| `--text-primary` | #e5e5e5 | 본문 텍스트 |
| `--text-secondary` | #9ca3af | 부제목/보조 텍스트 |

---

## 7. 데이터 저장 구조

### 7.1 세션 데이터

```
data/sessions/{session_id}/
├── metadata.json        # 세션 메타데이터
├── result.json          # 전사 결과 (segments)
├── audio.mp3            # 원본 오디오
└── chats/               # 채팅 기록
    └── {chat_id}.json
```

#### metadata.json 예시
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "title": "2024년 1분기 기획 회의",
  "participants": "김철수, 이영희, 박민수",
  "agenda": "신규 프로젝트 논의",
  "language": "ko",
  "created_at": "2024-12-14T10:30:00",
  "audio_file": "audio.mp3",
  "folder_id": null
}
```

#### result.json 구조
```json
{
  "full_text": "전체 전사 텍스트...",
  "segments": [
    {
      "start": 0.0,
      "end": 3.5,
      "text": "안녕하세요, 회의를 시작하겠습니다.",
      "speaker": "SPEAKER_00"
    }
  ],
  "language": "ko"
}
```

### 7.2 벡터 데이터베이스

```
data/chroma_db/session_{session_id}/
├── chroma.sqlite3       # SQLite 메타데이터
└── embeddings/          # 벡터 임베딩 데이터
```

---

## 8. 성능 최적화

### 8.1 메모리 관리
```python
def unload_model(self) -> None:
    """모델 언로드 및 메모리 해제"""
    if self.model:
        del self.model
        self.model = None
    gc.collect()
    if self.device == "cuda":
        torch.cuda.empty_cache()
```

- 전사 완료 후 모델 자동 언로드
- GPU 메모리 명시적 해제
- 가비지 컬렉션 강제 실행

### 8.2 Windows 호환성 처리
```python
# 심볼릭 링크 권한 문제 해결
os.environ["HF_HUB_LOCAL_DIR_AUTO_SYMLINK_THRESHOLD"] = "0"

# ffmpeg 자동 경로 탐색
def _setup_ffmpeg():
    winget_path = Path.home() / "AppData/Local/Microsoft/WinGet/Packages"
    for ffmpeg_dir in winget_path.glob("Gyan.FFmpeg*/*/bin"):
        if (ffmpeg_dir / "ffmpeg.exe").exists():
            os.environ["PATH"] = str(ffmpeg_dir) + ";" + os.environ["PATH"]
```

### 8.3 싱글톤 패턴 적용
```python
_rag_instance: Optional[TranscriptRAG] = None

def get_rag() -> TranscriptRAG:
    """RAG 인스턴스 가져오기 (싱글톤)"""
    global _rag_instance
    if _rag_instance is None:
        _rag_instance = TranscriptRAG()
    return _rag_instance
```

---

## 9. 실행 방법

### 9.1 필수 요구사항
- Python 3.10 이상
- CUDA 지원 GPU (권장, CPU도 가능)
- Ollama 설치 및 실행
- ffmpeg 설치

### 9.2 설치 과정

```bash
# 1. 저장소 클론
git clone <repository_url>
cd stt

# 2. 가상환경 생성 및 활성화
python -m venv venv
venv\Scripts\activate  # Windows

# 3. 의존성 설치
pip install -r requirements.txt

# 4. Ollama 모델 다운로드
ollama pull exaone
ollama pull nomic-embed-text

# 5. 서버 실행
python -m src.app
```

### 9.3 접속
- 브라우저에서 `http://127.0.0.1:7860` 접속

---

## 10. 향후 개선 방향

### 10.1 기능 개선
- [ ] 실시간 스트리밍 전사 지원
- [ ] 다중 사용자 동시 접속 지원
- [ ] 회의록 요약 및 액션 아이템 자동 추출 (LLM 활용)
- [ ] 전사 결과 편집 기능 강화
- [ ] 내보내기 형식 다양화 (DOCX, PDF 등)

### 10.2 성능 개선
- [ ] WebSocket을 통한 실시간 진행률 표시
- [ ] 대용량 오디오 파일 청크 단위 처리
- [ ] 벡터 검색 결과 캐싱

### 10.3 UI/UX 개선
- [ ] 모바일 반응형 디자인 강화
- [ ] 키보드 단축키 지원
- [ ] 다국어 UI 지원

---

## 11. 참고 자료

### 11.1 사용된 오픈소스 프로젝트
- [WhisperX](https://github.com/m-bain/whisperX) - 음성 인식
- [PyAnnote Audio](https://github.com/pyannote/pyannote-audio) - 화자 분리
- [LangChain](https://github.com/langchain-ai/langchain) - RAG 프레임워크
- [ChromaDB](https://github.com/chroma-core/chroma) - 벡터 데이터베이스
- [Ollama](https://github.com/ollama/ollama) - 로컬 LLM 서버
- [FastAPI](https://github.com/tiangolo/fastapi) - 웹 프레임워크
- [yt-dlp](https://github.com/yt-dlp/yt-dlp) - YouTube 다운로더

### 11.2 참고 논문
- Radford, A., et al. (2022). "Robust Speech Recognition via Large-Scale Weak Supervision" (Whisper)
- Bredin, H., et al. (2020). "pyannote.audio: neural building blocks for speaker diarization"

---

## 12. 결론

WhisperX Note는 최신 AI 기술을 활용하여 음성 데이터를 효율적으로 텍스트로 변환하고, 이를 기반으로 다양한 부가 기능을 제공하는 통합 회의록 관리 시스템이다. 로컬 실행 방식을 채택하여 개인정보 보호를 보장하면서도, 화자 분리, RAG 기반 질의응답 등 고급 기능을 제공한다.

본 프로젝트는 FastAPI, WhisperX, LangChain, ChromaDB 등 최신 기술 스택을 활용하여 구현되었으며, 모듈화된 구조로 설계되어 확장성과 유지보수성이 뛰어나다. 향후 실시간 전사, 자동 요약 등의 기능을 추가하여 더욱 완성도 높은 시스템으로 발전시킬 수 있을 것으로 기대된다.

---

**작성일**: 2024년 12월 14일
**프로젝트 버전**: 1.0.0
