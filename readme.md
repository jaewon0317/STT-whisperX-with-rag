# WhisperX Note: 로컬 AI 기반 음성 회의록 및 RAG 시스템

## 1. 개요

### 1.1  배경 및 목적

음성 데이터의 텍스트 변환(Speech-to-Text, STT)은 회의록 작성, 강의 기록, 인터뷰 전사 등 다양한 분야에서 핵심적인 기술로 자리잡고 있다. 그러나 기존 클라우드 기반 STT 서비스는 다음과 같은 한계를 가진다:

1. **보안 문제**: 음성 데이터가 외부 서버로 전송되어 기업 기밀이나 개인정보 유출 위험 존재
2. **비용 문제**: API 호출 비용 및 클로바노트,Notion 등의 서비스의 유료 요금제 사용시에도 적은 사용량 문제
3. **기능 제한**: 화자 분리, 맞춤형 후처리 등 고급 기능 활용의 어려움

본 프로젝트는 **완전한 로컬 환경**에서 동작하는 음성 인식 및 챗봇 ＋ RAG(Retrieval-Augmented Generation) 기반 질의응답 시스템을 구현하여, 보안성과 비용 효율성을 동시에 확보하면서도 고성능 음성 처리 파이프라인을 제공하는 것을 목표로 한다.

### 1.2 시스템 주요 특징

| 특징 | 설명                            |
|------|-------------------------------|
| **완전 로컬 처리** | 모든 연산이 로컬에서 수행되어 데이터 유출 위험 없음 |
| **비용 절감** | API 호출 비용 없이 무제한 사용 가능        |
| **화자 분리** | 다중 화자 환경에서 발화자 자동 구분          |
| **RAG 기반 Q&A** | 전사 내용 및 문서 기반 지능형 질의응답        |
| **다국어 지원** | 한국어, 영어, 일본어, 중국어 등 여러 언어 지원  |

---

## 2. 핵심 모델 아키텍처

### 2.1 음성 인식 모델: Whisper → WhisperX

#### 2.1.1 OpenAI Whisper 모델

Whisper는 OpenAI가 2022년에 공개한 범용 음성 인식 모델로, 68만 시간의 다국어 음성 데이터로 학습되었다. Transformer 기반 Encoder-Decoder 구조를 채택하여 음성을 직접 텍스트로 변환하는 End-to-End 방식을 사용한다. 본 프로젝트는 가장 최근에 개발된 **Whisper large-v3-turbo**를 사용한다。

**Whisper 모델 구조:**
```
Audio Input → Log-Mel Spectrogram → Encoder (Transformer) → Decoder (Transformer) → Text Output
     ↓              ↓                      ↓                       ↓
  음성 파형    80채널 멜스펙트로그램    음성 특징 추출           토큰 단위 생성
```

**모델 크기별 성능:**

| 모델 | 파라미터 | 영어 WER | 다국어 WER | VRAM 요구량 |
|------|----------|----------|------------|-------------|
| tiny | 39M | 7.6% | - | ~1GB |
| base | 74M | 5.0% | - | ~1GB |
| small | 244M | 3.4% | - | ~2GB |
| medium | 769M | 2.9% | - | ~5GB |
| large-v3 | 1550M | 2.5% | 10.1% | ~10GB |
| **large-v3-turbo** | 809M | 2.5% | - | ~6GB |

#### 2.1.2 WhisperX: 고성능 음성 인식 프레임워크

WhisperX는 Max Bain 등이 개발한 오픈소스 프로젝트로, OpenAI Whisper를 기반으로 다음 기능을 확장하였다:

**주요 개선 사항:**

1. **Faster-Whisper 백엔드 적용**
   - CTranslate2 기반 최적화로 원본 대비 4배 빠른 추론 속도
   - INT8/FP16 양자화 지원으로 메모리 사용량 50% 감소
   - 본 프로젝트에서 사용하는 `large-v3-turbo` 모델은 Mobius Labs GmbH에서 최적화한 버전

2. **VAD(Voice Activity Detection) 통합**
   - Silero VAD를 활용한 음성 구간 자동 검출
   - 무음 구간 스킵으로 처리 효율성 향상

3. **단어 수준 타임스탬프 정렬**
   - Wav2Vec2 기반 강제 정렬(Forced Alignment)로 정확한 시간 정보 제공
   - 언어별 정렬 모델 자동 선택

```python
# WhisperX 처리 파이프라인
class WhisperXTranscriber:
    def transcribe_with_segments(self, audio_path, language="ko", enable_diarization=False):
        # 1. 오디오 로드 및 전사
        result = self.model.transcribe(audio, language=language)

        # 2. 단어 수준 정렬 (Forced Alignment)
        model_a, metadata = whisperx.load_align_model(language_code=language)
        result = whisperx.align(result["segments"], model_a, metadata, audio)

        # 3. 화자 분리 (선택적)
        if enable_diarization:
            diarize_segments = self.diarize_model(audio)
            result = whisperx.assign_word_speakers(diarize_segments, result)

        return result
```

### 2.2 화자 분리 모델: PyAnnote

#### 2.2.1 모델 개요

PyAnnote.audio는 CNRS(프랑스 국립과학연구센터)에서 개발한 화자 분리(Speaker Diarization) 프레임워크로, "누가 언제 말했는가"를 자동으로 분석한다.

**화자 분리 파이프라인:**

```
Audio → Voice Activity Detection → Speaker Embedding → Clustering → Speaker Labels
  ↓              ↓                        ↓                ↓             ↓
원본 음성    음성 구간 검출         화자 특징 벡터화      유사도 군집화   SPEAKER_00, 01...
```

#### 2.2.2 사용 모델

| 모델 | 버전 | 용도 | 출처 |
|------|------|------|------|
| pyannote/speaker-diarization | 3.1 | 화자 분리 파이프라인 | HuggingFace |
| pyannote/segmentation | 3.0 | 음성 구간 분할 | HuggingFace |
| speechbrain/spkrec-ecapa-voxceleb | - | 화자 임베딩 | SpeechBrain |

**화자 임베딩 원리:**
- ECAPA-TDNN(Emphasized Channel Attention, Propagation and Aggregation in TDNN) 아키텍처 사용
- 화자의 음성을 192차원 벡터로 인코딩
- 코사인 유사도 기반 동일 화자 판별

### 2.3 임베딩 모델: Nomic Embed Text

#### 2.3.1 모델 선정 배경

RAG 시스템의 핵심은 질문과 관련된 문서를 정확히 검색하는 것으로, 이를 위해 텍스트를 고차원 벡터로 변환하는 임베딩 모델이 필수적이다.

**Nomic Embed Text 특징:**

| 항목 | 사양 |
|------|------|
| 모델명 | nomic-embed-text |
| 임베딩 차원 | 768 |
| 최대 토큰 | 8192 |
| MTEB 벤치마크 | 상위권 (오픈소스 중) |
| 로컬 실행 | Ollama 통해 지원 |

#### 2.3.2 임베딩 생성 과정

```python
from langchain_ollama import OllamaEmbeddings

embeddings = OllamaEmbeddings(model="nomic-embed-text")

# 텍스트 → 768차원 벡터
text = "회의에서 논의된 주요 안건은 예산 증액입니다."
vector = embeddings.embed_query(text)  # shape: (768,)
```

### 2.4 대규모 언어 모델(LLM): EXAONE 3.0

#### 2.4.1 모델 개요

EXAONE(Expert AI for EveryONE)은 LG AI Research에서 개발한 한국어 특화 대규모 언어 모델이다.

**EXAONE 3.0 특징:**

| 항목 | 사양 |
|------|-----|
| 모델명 | EXAONE-3.0-7.8B-Instruct |
| 파라미터 | 7.8B (78억개) |
| 양자화 | Q5_K_M (5비트) |
| 컨텍스트 길이 | 4096 토큰 |
| 한국어 성능 | 상위권 |

#### 2.4.2 모델 선정 이유

1. **한국어 최적화**: 한국어 데이터로 추가 학습되어 자연스러운 한국어 생성
2. **로컬 실행**: Ollama를 통해 로컬에서 실행 가능
3. **적절한 크기**: 7.8B 파라미터로 16GB VRAM에서 원활히 동작
4. **지시 수행 능력**: Instruct 버전으로 질문-답변 태스크에 최적화

---

## 3. RAG(Retrieval-Augmented Generation) 시스템 구현

### 3.1 RAG 아키텍처 개요

RAG는 외부 지식을 검색(Retrieval)하여 언어 모델의 생성(Generation)을 보강하는 기법이다. 본 시스템에서는 전사된 회의 내용과 업로드된 문서를 지식 베이스로 활용한다.

**RAG 파이프라인:**

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              RAG 시스템 아키텍처                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  [인덱싱 단계]                                                               │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────────────┐       │
│  │ 전사 텍스트 │ →  │ 텍스트    │ →  │ 임베딩    │ → │  ChromaDB      │       │
│  │ /문서     │    │ 청킹      │    │ 생성      │  │   벡터 저장소     │       │
│  └──────────┘    └──────────┘    └──────────┘    └──────────────────┘       │
│       ↓              ↓              ↓                    ↓                  │
│   원본 데이터    500자 단위     768차원 벡터      영구 저장 (세션별)           │
│                 50자 오버랩                                                  │
│                                                                             │
│  [검색 단계]                                                                 │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────────────┐       │
│  │ 사용자    │ →  │ 질문      │ →  │ 유사도    │ →  │ 상위 k개          │      │
│  │ 질문      │    │ 임베딩    │    │ 검색      │    │ 문서 청크 반환    │      │
│  └──────────┘    └──────────┘    └──────────┘    └──────────────────┘       │
│                                                                             │
│  [생성 단계]                                                                 │
│  ┌──────────────────────────────┐    ┌──────────────────────────────┐       │
│  │ 프롬프트 구성                  │ →  │ EXAONE LLM                    │      │
│  │ (검색된 컨텍스트 + 질문)        │    │ 답변 생성                     │      │
│  └──────────────────────────────┘    └──────────────────────────────┘       │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 3.2 LangChain 프레임워크 활용

LangChain은 LLM 애플리케이션 개발을 위한 프레임워크로, 본 프로젝트에서는 다음 컴포넌트를 활용한다:

#### 3.2.1 텍스트 분할 (Text Splitting)

긴 텍스트를 의미 단위로 분할하여 검색 효율성을 높인다.

```python
from langchain_text_splitters import RecursiveCharacterTextSplitter

text_splitter = RecursiveCharacterTextSplitter(
    chunk_size=500,        # 청크 최대 크기 (문자 수)
    chunk_overlap=50,      # 청크 간 중복 (문맥 유지)
    separators=["\n\n", "\n", ".", "!", "?", ",", " "]  # 분할 우선순위
)

chunks = text_splitter.split_text(transcript_text)
```

**분할 전략:**
- 문단 → 문장 → 단어 순으로 자연스러운 경계에서 분할
- 50자 오버랩으로 문맥 손실 최소화
- 타임스탬프 정보 포함으로 원본 위치 추적 가능

#### 3.2.2 벡터 저장소 (ChromaDB)

```python
from langchain_community.vectorstores import Chroma

# 벡터 저장소 생성
vectorstore = Chroma.from_texts(
    texts=chunks,
    embedding=OllamaEmbeddings(model="nomic-embed-text"),
    collection_name=f"session_{session_id}",
    persist_directory=f"./data/chroma_db/session_{session_id}"
)

# 유사도 검색
relevant_docs = vectorstore.similarity_search(question, k=3)
```

#### 3.2.3 프롬프트 엔지니어링

```python
prompt = f"""당신은 제공된 문서를 분석하는 AI 도우미입니다.
아래 제공된 여러 출처(회의록, 문서, 코드 등)의 내용을 기반으로 질문에 답변해주세요.
내용이 여러 출처에 걸쳐 있다면, 이를 종합하여 설명해주세요.
답변은 정확하고 도움이 되어야 하며, 제공된 문맥에 없는 내용은 지어내지 마세요.
한국어로 답변해주세요.

참고 자료:
{context}

질문: {question}

답변:"""
```

### 3.3 다중 세션 통합 검색

본 시스템의 차별점은 **여러 세션과 문서를 동시에 검색**할 수 있다는 점이다.

```python
def query(self, question: str, session_ids: list[str]) -> str:
    docs = []

    # 각 세션/문서에서 관련 내용 검색
    for session_id in session_ids:
        vectorstore = self._get_vectorstore(session_id)
        if vectorstore:
            session_docs = vectorstore.similarity_search(question, k=3)
            docs.extend(session_docs)

    # 검색된 모든 문서를 컨텍스트로 활용
    context = "\n\n".join(doc.page_content for doc in docs)

    # LLM으로 종합 답변 생성
    response = self.llm.invoke(prompt.format(context=context, question=question))
    return response.content
```

---

## 4. 활용 시나리오 및 기대 효과

### 4.1 교육 분야: 강의 녹음 분석

**시나리오:**
대학생이 교수의 강의를 녹음하고, 관련 강의 자료(PDF)를 함께 업로드하여 학습에 활용

**활용 과정:**

```
1. 강의 녹음 파일 업로드 → 자동 전사 (화자 분리로 교수/학생 질문 구분)
2. 강의 자료 PDF 업로드 → 텍스트 추출 및 인덱싱
3. AI 챗봇 질의:
   - "교수님이 가장 강조한 내용은?"
   - "시험에 나온다고 언급한 부분은?"
   - "강의자료 3장과 관련해서 교수님이 추가 설명한 내용은?"
```

**기대 효과:**
- 수업 핵심 내용 빠른 파악
- 강의와 자료 간 연계 학습
- 복습 시간 단축

### 4.2 기업 분야: 회의록 자동화

**시나리오:**
기업에서 주간 회의를 녹음하고 자동 회의록 생성 및 후속 조치 관리

**활용 과정:**

```
1. 회의 녹음 → 화자별 발언 자동 분리
2. 회의록 자동 생성:
   - 참석자별 발언 정리
   - 타임스탬프 포함
   - 마크다운 형식 출력
3. AI 챗봇 질의:
   - "이번 회의에서 결정된 사항은?"
   - "김철수 팀장이 제안한 내용을 요약해줘"
   - "저번 회의와의 차이점은?"
```

**보안 이점:**

| 기존 클라우드 STT | 본 시스템 (로컬) |
| :--- | :--- |
| 음성 데이터 외부 전송 | **모든 처리 로컬에서 수행** |
| 서버 해킹 시 유출 위험 | **네트워크 연결 불필요** |
| 기업 기밀 노출 가능성 | **완전한 데이터 통제** |
| API 로그 저장 | **처리 기록 로컬 보관** |

### 4.3 연구 분야: 인터뷰 분석

**시나리오:**
질적 연구자가 심층 인터뷰를 전사하고 주제 분석 수행

**활용 과정:**

```
1. 복수 인터뷰 녹음 파일 업로드
2. 각 인터뷰별 화자 분리 (면접자/피면접자)
3. 다중 세션 검색으로 패턴 분석:
   - "모든 인터뷰에서 공통적으로 언급된 어려움은?"
   - "참여자들이 제안한 해결책을 정리해줘"
```

### 4.4 비용 비교 분석


**연간 비용 추정 (주 5회, 1시간 회의 기준):**

| 서비스 | 연간 비용 |
|--------|-----------|
| Google Cloud STT | ~$374 |
| AWS Transcribe | ~$374 |
| OpenAI Whisper API | ~$94 |
| **본 시스템** | **$0** |

---

## 5. 시스템 구성 요소

### 5.1 전체 아키텍처

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          클라이언트 (웹 브라우저)                          │
│                     HTML/CSS/JavaScript (Bootstrap 5)                    │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │ HTTP REST API
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         FastAPI 웹 서버                                  │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐       │
│  │ 전사 API    │ │ 세션 API    │ │ RAG API     │ │ 문서 API     │       │
│  │ /transcribe │ │ /session/*  │ │ /chat       │ │ /documents  │       │
│  └──────┬──────┘ └──────┬──────┘ └──────┬──────┘ └──────┬──────┘       │
└─────────┼───────────────┼───────────────┼───────────────┼───────────────┘
          │               │               │               │
          ▼               ▼               ▼               ▼
┌─────────────────┐ ┌─────────────┐ ┌─────────────────────────────────────┐
│ WhisperX        │ │ Session     │ │           RAG 시스템                 │
│ Transcriber     │ │ Manager     │ │  ┌─────────────┐  ┌─────────────┐   │
│ ┌─────────────┐ │ │             │ │  │ ChromaDB    │  │ EXAONE LLM  │   │
│ │ Whisper     │ │ │ JSON 기반   │ │  │ 벡터 DB      │  │ (Ollama)    │   │
│ │ large-v3    │ │ │ 파일 저장    │ │  └─────────────┘  └─────────────┘   │
│ │ turbo       │ │ │             │ │  ┌─────────────┐                    │
│ └─────────────┘ │ │             │ │  │ Nomic       │                    │
│ ┌─────────────┐ │ │             │ │  │ Embeddings  │                    │
│ │ PyAnnote    │ │ │             │ │  └─────────────┘                    │
│ │ Diarization │ │ │             │ │                                     │
│ └─────────────┘ │ │             │ │                                     │
└─────────────────┘ └─────────────┘ └─────────────────────────────────────┘
```

### 5.2 프로젝트 구조

```
stt/
├── run.py                  # 메인 실행 스크립트
├── requirements.txt        # Python 의존성
├── .hf_token               # HuggingFace 토큰
│
├── src/                    # 소스 코드
│   ├── app.py              # FastAPI 웹 서버
│   ├── config.py           # 설정 관리
│   ├── transcriber.py      # WhisperX 음성 인식
│   ├── meeting_minutes.py  # 회의록 생성
│   ├── session_manager.py  # 세션 관리
│   ├── document_manager.py # 문서 관리
│   ├── folder_manager.py   # 폴더 관리
│   └── rag_chat.py         # RAG 챗봇
│
├── templates/              # HTML 템플릿
├── static/                 # CSS, JavaScript
├── data/                   # 데이터 저장소
│   ├── sessions/           # 세션 데이터
│   ├── documents/          # 업로드 문서
│   └── chroma_db/          # 벡터 DB
└── models/                 # 모델 캐시
```

### 5.3 사용 기술 스택

| 분류 | 기술 | 버전 | 용도 |
|------|------|------|------|
| **음성 인식** | WhisperX | latest | STT + 정렬 |
| | Faster-Whisper | latest | 최적화 추론 |
| | PyAnnote | 3.1 | 화자 분리 |
| **RAG** | LangChain | ≥0.1.0 | RAG 프레임워크 |
| | ChromaDB | ≥0.4.0 | 벡터 DB |
| **LLM** | Ollama | latest | 로컬 LLM 서빙 |
| | EXAONE | 3.0-7.8B | 한국어 LLM |
| | Nomic Embed | latest | 텍스트 임베딩 |
| **웹** | FastAPI | ≥0.104 | REST API |
| | Uvicorn | ≥0.24 | ASGI 서버 |
| | Jinja2 | ≥3.1 | 템플릿 엔진 |
| **기타** | PyTorch | ≥2.0 | 딥러닝 프레임워크 |
| | yt-dlp | latest | YouTube 다운로드 |

---

## 6. 설치 및 실행

### 6.1 시스템 요구사항

| 항목 | 최소 사양 | 권장 사양 |
|------|-----------|-----------|
| CPU | 4코어 | 8코어+ |
| RAM | 16GB | 32GB |
| GPU | - | NVIDIA RTX 3060+ (8GB VRAM) |
| 저장공간 | 20GB | 50GB+ |
| OS | Windows 10/11, Linux, macOS | - |

### 6.2 설치 절차

```bash
# 1. 저장소 클론
git clone 
cd whisperx-note

# 2. Python 환경 설정 (Conda 권장)
conda create -n stt python=3.10
conda activate stt

# 3. PyTorch 설치 (CUDA 버전에 맞게)
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu118

# 4. 의존성 설치
pip install -r requirements.txt

# 5. Ollama 설치 및 모델 다운로드
ollama pull exaone:latest
ollama pull nomic-embed-text

# 6. HuggingFace 토큰 설정 (화자 분리용)
echo "hf_your_token" > .hf_token
```

### 6.3 실행

```bash
# 웹 서버 실행
python run.py

# 브라우저에서 http://127.0.0.1:7860 접속
```

---

## 7. 결론 및 향후 발전 방향

### 7.1 결론

본 프로젝트는 완전한 로컬 환경에서 동작하는 음성 인식 및 RAG 기반 질의응답 시스템을 구현하였다. OpenAI Whisper를 기반으로 한 WhisperX, PyAnnote 화자 분리, LangChain RAG 프레임워크, EXAONE 한국어 LLM을 통합하여 다음을 달성하였다:

1. **보안성**: 모든 데이터 처리가 로컬에서 수행되어 기업/개인 민감 정보 보호
2. **비용 효율성**: API 호출 및 유료 계정 없이 무제한 사용 가능
3. **고성능**: GPU 가속으로 빠른 처리 속도
4. **확장성**: 다중 세션/문서 통합 검색으로 지식 베이스 확장
5. **기능**: 챗봇을 활용한 요약 및 질문 가능 

### 7.2 향후 발전 방향

1. **실시간 스트리밍 전사**: WebSocket 기반 실시간 음성 인식
2. **화자 식별**: 사전 등록된 화자 음성으로 자동 이름 매핑
3. **요약 기능 강화**: 자동 핵심 요약, 액션 아이템 추출

---

**GitHub Repository**: https://github.com/
