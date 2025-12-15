"""
WhisperX Note - FastAPI 웹 서버
"""

import base64
import mimetypes
import subprocess
import tempfile
from pathlib import Path

from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Request
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from datetime import datetime
import uvicorn

from .config import STATIC_DIR, TEMPLATES_DIR, DOWNLOADS_DIR, ensure_dirs
from .transcriber import WhisperXTranscriber
from .meeting_minutes import MeetingMinutesGenerator
from .session_manager import SessionManager
from .document_manager import DocumentManager
from .folder_manager import FolderManager
from .rag_chat import get_rag

# 디렉토리 초기화
ensure_dirs()
DATA_DIR = Path("data")  # Ensure this exists or imported

app = FastAPI(title="WhisperX Note")

# Static files and templates
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
templates = Jinja2Templates(directory=TEMPLATES_DIR)

# Managers
session_manager = SessionManager()
document_manager = DocumentManager(DATA_DIR)
folder_manager = FolderManager(DATA_DIR)
minutes_generator = MeetingMinutesGenerator()


# 헬퍼 함수: 세션 재인덱싱
async def reindex_session(session_id: str) -> bool:
    """세션의 RAG 인덱스를 재생성합니다 (화자/텍스트 수정 후 호출)"""
    try:
        meta, result, _ = session_manager.load_session(session_id)
        if not result or "segments" not in result:
            return False
        
        def format_time(seconds):
            mins = int(seconds // 60)
            secs = int(seconds % 60)
            return f"{mins:02d}:{secs:02d}"
        
        full_text = "\n".join(
            f"[{format_time(seg.get('start', 0))} - {format_time(seg.get('end', 0))}] [{seg.get('speaker', 'SPEAKER')}] {seg.get('text', '')}"
            for seg in result["segments"]
        )
        
        rag = get_rag()
        rag.delete_index(session_id)
        success = rag.index_transcript(session_id, full_text)
        print(f"세션 재인덱싱 완료: {session_id}, 성공: {success}")
        return success
    except Exception as e:
        print(f"재인덱싱 오류: {e}")
        return False


@app.get("/")
async def index(request: Request):
    """메인 페이지"""
    return templates.TemplateResponse("index.html", {"request": request})


@app.get("/api/structure")
async def get_structure():
    """전체 구조(폴더, 세션, 문서) 조회"""
    return {
        "folders": folder_manager.list_folders(),
        "sessions": [
            {
                "id": s.get("id"), 
                "title": s.get("title", "무제"), 
                "date": s.get("created_at", ""),
                "folder_id": s.get("folder_id")
            }
            for s in session_manager.list_sessions()
        ],
        "documents": document_manager.list_documents()
    }

@app.post("/api/folders")
async def create_folder(name: str = Form(...), parent_id: str = Form(None)):
    """폴더 생성"""
    if parent_id == 'root': parent_id = None
    folder = folder_manager.create_folder(name, parent_id)
    return {"success": True, "folder": folder}

@app.put("/api/folders/{folder_id}")
async def update_folder(folder_id: str, name: str = Form(...)):
    """폴더 수정 (이름)"""
    folder = folder_manager.update_folder(folder_id, name=name)
    if folder:
        return {"success": True, "folder": folder}
    return {"success": False, "detail": "Folder not found"}

@app.delete("/api/folders/{folder_id}")
async def delete_folder(folder_id: str):
    """폴더 삭제"""
    # Note: Children will be orphaned (moved to root) by default implementation
    if folder_manager.delete_folder(folder_id):
        return {"success": True}
    return {"success": False, "detail": "Folder not found"}

@app.put("/api/move")
async def move_item(
    item_id: str = Form(...), 
    type: str = Form(...), 
    target_folder_id: str = Form(None)
):
    """아이템 이동 (드래그 앤 드롭)"""
    success = False
    
    # target_folder_id logic: 'root' -> None
    if target_folder_id == 'root': 
        target_folder_id = None
        
    if type == 'session':
        success = session_manager.update_folder(item_id, target_folder_id)
    elif type == 'document':
        success = document_manager.update_folder(item_id, target_folder_id)
    elif type == 'folder':
        # 폴더 이동
        try:
            result = folder_manager.update_folder(item_id, parent_id=target_folder_id)
            success = result is not None
        except ValueError as e:
            return {"success": False, "detail": str(e)}
            
    if success:
        return {"success": True}
    else:
        return {"success": False, "detail": "Move failed"}

@app.get("/api/sessions")
async def get_sessions():
    """세션 목록 조회"""
    sessions = session_manager.list_sessions()
    return {
        "sessions": [
            {"id": s.get("id"), "title": s.get("title", "무제"), "date": s.get("created_at", "")}
            for s in sessions
        ]
    }


@app.get("/api/session/{session_id}")
async def get_session(session_id: str):
    """세션 상세 조회"""
    try:
        meta, result, audio_path = session_manager.load_session(session_id)

        segments = result.get("segments", []) if result else []
        full_text = "\n".join(
            f"[{seg.get('speaker', 'SPEAKER')}] {seg.get('text', '')}"
            for seg in segments
        )

        # 회의록 생성
        parts = [p.strip() for p in (meta.get("participants") or "").split(",") if p.strip()]
        agendas = [a.strip() for a in (meta.get("agenda") or "").split("\n") if a.strip()]
        minutes = minutes_generator.generate(
            result or {},
            title=meta.get("title", "무제"),
            participants=parts,
            agenda=agendas
        )
        minutes_md = minutes_generator.to_markdown(minutes)

        # 화자 목록
        speakers = sorted(set(seg.get("speaker") for seg in segments if seg.get("speaker")))

        # 오디오 Base64
        audio_base64 = ""
        audio_mime = "audio/mpeg"
        audio_file = Path(audio_path)
        if audio_file.exists():
            audio_base64 = base64.b64encode(audio_file.read_bytes()).decode()
            audio_mime = mimetypes.guess_type(audio_path)[0] or "audio/mpeg"

        return {
            "meta": meta,
            "segments": segments,
            "transcript": full_text,
            "minutes": minutes_md,
            "speakers": speakers,
            "audio": {"base64": audio_base64, "mime": audio_mime}
        }
    except Exception as e:
        raise HTTPException(status_code=404, detail=str(e))


@app.put("/api/session/{session_id}/segment")
async def edit_segment(
    session_id: str,
    index: int = Form(...),
    field: str = Form(...),
    value: str = Form(...)
):
    """개별 세그먼트 편집"""
    try:
        meta, result, _ = session_manager.load_session(session_id)
        if not result:
            raise HTTPException(status_code=404, detail="세션을 찾을 수 없습니다")
        
        segments = result.get("segments", [])
        if index < 0 or index >= len(segments):
            raise HTTPException(status_code=400, detail="잘못된 세그먼트 인덱스")
        
        if field == "speaker":
            segments[index]["speaker"] = value
        elif field == "text":
            segments[index]["text"] = value
        else:
            raise HTTPException(status_code=400, detail="잘못된 필드")
        
        # 세션 결과 저장
        result["segments"] = segments
        session_manager.save_result(session_id, result)
        
        return {"success": True}
    except HTTPException:
        raise
    except Exception as e:
        return {"success": False, "detail": str(e)}


@app.post("/api/transcribe")
async def transcribe(
    audio: UploadFile = File(...),
    title: str = Form(""),
    participants: str = Form(""),
    agenda: str = Form(""),
    language: str = Form("한국어"),
    enable_diarization: bool = Form(False),
    hf_token: str = Form("")
):
    """오디오 전사 및 세션 저장"""
    try:
        # 임시 파일 저장
        suffix = Path(audio.filename).suffix
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp.write(await audio.read())
            temp_path = tmp.name

        # 언어 매핑
        lang_map = {"한국어": "ko", "영어": "en", "일본어": "ja", "중국어": "zh"}
        lang_code = lang_map.get(language, "ko")

        # 전사
        transcriber = WhisperXTranscriber(hf_token=hf_token if hf_token else None)
        result = transcriber.transcribe_with_segments(
            temp_path,
            language=lang_code,
            enable_diarization=enable_diarization
        )
        # 메모리 해제를 위해 모델 언로드
        transcriber.unload_model()

        # 세션 저장
        session_id = session_manager.save_session(
            audio_path=temp_path,
            result=result,
            title=title or "무제",
            participants=participants,
            agenda=agenda
        )

        # 임시 파일 삭제
        Path(temp_path).unlink(missing_ok=True)

        return {"success": True, "session_id": session_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/transcribe-file")
async def transcribe_file(request: Request):
    """서버에 있는 파일 전사 (YouTube 다운로드 후 사용)"""
    try:
        data = await request.json()
        file_path = data.get("file_path", "")
        title = data.get("title", "무제")
        participants = data.get("participants", "")
        agenda = data.get("agenda", "")
        language = data.get("language", "한국어")
        enable_diarization = data.get("enable_diarization", False)
        hf_token = data.get("hf_token", "")

        # 파일 존재 확인
        audio_path = Path(file_path)
        if not audio_path.exists():
            # downloads 폴더에서 찾기
            audio_path = DOWNLOADS_DIR / Path(file_path).name

        if not audio_path.exists():
            return {"success": False, "detail": f"파일을 찾을 수 없습니다: {file_path}"}

        # 언어 매핑
        lang_map = {"한국어": "ko", "영어": "en", "일본어": "ja", "중국어": "zh"}
        lang_code = lang_map.get(language, "ko")

        # 전사
        transcriber = WhisperXTranscriber(hf_token=hf_token if hf_token else None)
        result = transcriber.transcribe_with_segments(
            str(audio_path),
            language=lang_code,
            enable_diarization=enable_diarization
        )
        # 메모리 해제를 위해 모델 언로드
        transcriber.unload_model()

        # 세션 저장
        session_id = session_manager.save_session(
            audio_path=str(audio_path),
            result=result,
            title=title,
            participants=participants,
            agenda=agenda
        )

        return {"success": True, "session_id": session_id}
    except Exception as e:
        return {"success": False, "detail": str(e)}


@app.put("/api/session/{session_id}/title")
async def update_title(session_id: str, title: str = Form(...)):
    """세션 제목 수정"""
    try:
        session_manager.update_session_title(session_id, title)
        return {"success": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.put("/api/session/{session_id}/speaker")
async def update_speaker(session_id: str, old_name: str = Form(...), new_name: str = Form(...)):
    """화자 이름 변경"""
    try:
        success = session_manager.update_speaker_name(session_id, old_name, new_name)
        return {"success": success}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/api/session/{session_id}")
async def delete_session(session_id: str):
    """세션 삭제"""
    try:
        # RAG 인덱스 삭제
        rag = get_rag()
        rag.delete_index(session_id)

        # 세션 데이터 삭제
        session_manager.delete_session(session_id)
        
        return {"success": True}
    except Exception as e:
        return {"success": False, "detail": str(e)}


def _find_ffmpeg() -> str | None:
    """ffmpeg 경로 찾기"""
    import shutil
    # PATH에서 찾기
    ffmpeg = shutil.which("ffmpeg")
    if ffmpeg:
        return str(Path(ffmpeg).parent)

    # WinGet 설치 경로에서 찾기
    winget_path = Path.home() / "AppData/Local/Microsoft/WinGet/Packages"
    if winget_path.exists():
        for ffmpeg_exe in winget_path.glob("Gyan.FFmpeg*/*/bin/ffmpeg.exe"):
            return str(ffmpeg_exe.parent)
    return None


@app.post("/api/youtube")
async def download_youtube(request: Request):
    """YouTube 오디오 다운로드"""
    try:
        data = await request.json()
        url = data.get("url", "")

        if not url:
            raise HTTPException(status_code=400, detail="URL이 필요합니다")

        DOWNLOADS_DIR.mkdir(parents=True, exist_ok=True)

        cmd = [
            "yt-dlp",
            "-x",
            "--audio-format", "mp3",
            "--audio-quality", "192K",
            "-o", str(DOWNLOADS_DIR / "%(title)s.%(ext)s"),
            "--print", "after_move:filepath",
            url
        ]

        # ffmpeg 경로 추가
        ffmpeg_path = _find_ffmpeg()
        if ffmpeg_path:
            cmd.extend(["--ffmpeg-location", ffmpeg_path])

        result = subprocess.run(cmd, capture_output=True, timeout=300)

        if result.returncode != 0:
            try:
                stderr = result.stderr.decode('utf-8')
            except UnicodeDecodeError:
                stderr = result.stderr.decode('cp949', errors='replace')
            return {"success": False, "detail": stderr or "yt-dlp 오류"}

        try:
            stdout = result.stdout.decode('utf-8')
        except UnicodeDecodeError:
            stdout = result.stdout.decode('cp949', errors='replace')
        
        filename = stdout.strip().split('\n')[-1] if stdout.strip() else ""

        if filename:
            file_path = Path(filename)
            # 파일이 존재하거나, downloads 폴더에서 찾기
            if not file_path.exists():
                # 파일명만 추출해서 downloads 폴더에서 찾기
                file_path = DOWNLOADS_DIR / file_path.name

            if file_path.exists():
                title = file_path.stem
                return {
                    "success": True,
                    "filename": file_path.name,
                    "path": str(file_path),
                    "title": title
                }

        return {"success": False, "detail": f"파일을 찾을 수 없습니다: {filename}"}

    except subprocess.TimeoutExpired:
        return {"success": False, "detail": "다운로드 시간 초과 (5분)"}
    except Exception as e:
        return {"success": False, "detail": str(e)}


@app.post("/api/index/{session_id}")
async def index_session(session_id: str):
    """세션 전사 내용을 RAG 인덱스에 저장"""
    try:
        meta, result, _ = session_manager.load_session(session_id)

        if not result or "segments" not in result:
            return {"success": False, "detail": "전사 결과가 없습니다"}

        # 시간 정보 포함한 텍스트 생성
        def format_time(seconds):
            mins = int(seconds // 60)
            secs = int(seconds % 60)
            return f"{mins:02d}:{secs:02d}"
        
        full_text = "\n".join(
            f"[{format_time(seg.get('start', 0))} - {format_time(seg.get('end', 0))}] [{seg.get('speaker', 'SPEAKER')}] {seg.get('text', '')}"
            for seg in result["segments"]
        )

        rag = get_rag()
        # 기존 인덱스 삭제 후 재생성 (업데이트 반영)
        rag.delete_index(session_id)
        success = rag.index_transcript(session_id, full_text)

        return {"success": success, "indexed": success}
    except Exception as e:
        return {"success": False, "detail": str(e)}


@app.post("/api/chat")
async def chat(request: Request):
    """RAG 기반 채팅 (다중 세션 지원)"""
    try:
        data = await request.json()
        session_id = data.get("session_id")
        session_ids = data.get("session_ids", [])
        session_id = data.get("session_id")
        session_ids = data.get("session_ids", [])
        question = data.get("question", "")
        chat_id = data.get("chat_id")  # [NEW] chat_id supported

        # 단일 세션 ID가 들어오면 리스트로 변환 (하위 호환)
        if session_id and not session_ids:
            session_ids = [session_id]

        if not question:
            return {"success": False, "detail": "question이 필요합니다"}

        rag = get_rag()

        # 인덱스 확인 및 자동 생성 (모든 선택된 세션에 대해)
        # 인덱스 확인 및 자동 생성 (모든 선택된 세션/문서에 대해)
        for sid in session_ids:
            # 먼저 문서인지 확인
            doc = document_manager.get_document(sid)
            if doc:
                if not rag.is_indexed(sid):
                    # 문서라면 저장된 텍스트가 필요함.
                    # DocumentManager의 _extract_text는 이미 저장시에 수행됨.
                    # 여기서는 다시 읽어서 인덱싱하거나, 저장 시 인덱싱했어야 함.
                    # 하지만 편의상 여기서 재추출(또는 저장된 텍스트 필요). 
                    # DocumentManager 구조상 add_document가 텍스트를 반환하므로,
                    # 여기서는 간단히 파일에서 다시 읽거나, add_document 시점에 인덱싱하는 게 좋음.
                    # 여기서는 파일에서 다시 읽도록 처리 (간소화)
                    path = Path(doc['path'])
                    # 간단히 다시 추출 시도 (성능상 비효율적일 수 있으나 안전함)
                    text = document_manager._extract_text(path) 
                    rag.index_transcript(sid, text)
                continue

            # 세션 확인
            if not rag.is_indexed(sid):
                meta, result, _ = session_manager.load_session(sid)
                if result and "segments" in result:
                    full_text = "\n".join(
                        f"[{seg.get('start', 0):.1f}s ~ {seg.get('end', 0):.1f}s] [{seg.get('speaker', 'SPEAKER')}] {seg.get('text', '')}"
                        for seg in result["segments"]
                    )
                    rag.index_transcript(sid, full_text)

        answer = rag.query(question, session_ids)

        # [NEW] Save history (Support Global Chat)
        # If session_ids is empty, treat as "global" session
        main_sid = session_ids[0] if session_ids else "global"
        
        # If no chat_id provided, use the most recent or create defaults
        # However, frontend should provide chat_id.
        # For backward compatibility or if chat_id is missing, we might need logic.
        # But let's assume frontend sends chat_id if utilizing multi-chat.
        
        if chat_id:
            # global 세션 폴더 자동 생성 (load/save 내부에서 처리됨)
            history = session_manager.load_chat_history(main_sid, chat_id)
            history.append({
                "role": "user", 
                "content": question, 
                "timestamp": datetime.now().isoformat()
            })
            history.append({
                "role": "assistant", 
                "content": answer, 
                "timestamp": datetime.now().isoformat()
            })
            session_manager.save_chat_history(main_sid, chat_id, history)

        return {"success": True, "answer": answer}

    except Exception as e:
        return {"success": False, "detail": str(e)}


@app.get("/api/session/{session_id}/chats")
async def list_chats(session_id: str):
    """채팅 목록 조회"""
    chats = session_manager.list_chat_histories(session_id)
    return {"chats": chats}


@app.post("/api/session/{session_id}/chats")
async def create_chat(session_id: str):
    """새 채팅 생성"""
    chat_id = session_manager.create_new_chat(session_id)
    return {"chat_id": chat_id}


@app.get("/api/session/{session_id}/chat/{chat_id}")
async def get_chat_history(session_id: str, chat_id: str):
    """특정 채팅 기록 조회"""
    history = session_manager.load_chat_history(session_id, chat_id)
    return {"history": history}


@app.delete("/api/session/{session_id}/chat/{chat_id}")
async def delete_chat_history(session_id: str, chat_id: str):
    """특정 채팅 기록 삭제"""
    success = session_manager.delete_chat_history(session_id, chat_id)
    return {"success": success}


@app.get("/api/documents")
async def get_documents():
    """문서 목록 조회"""
    docs = document_manager.list_documents()
    return {"documents": docs}


@app.post("/api/documents")
async def upload_document(file: UploadFile = File(...)):
    """문서 업로드 및 인덱싱"""
    try:
        # 임시 파일 저장 -> DocumentManager로 이동
        with tempfile.NamedTemporaryFile(delete=False, suffix=Path(file.filename).suffix) as tmp:
            content = await file.read()
            tmp.write(content)
            tmp_path = Path(tmp.name)

        # 문서 등록
        result = document_manager.add_document(tmp_path, file.filename)
        doc_info = result['info']
        text_content = result['text']

        # 즉시 RAG 인덱싱
        rag = get_rag()
        rag.index_transcript(doc_info['id'], text_content)

        # 임시 파일 삭제
        tmp_path.unlink()

        return {"success": True, "document": doc_info}
    except Exception as e:
        return {"success": False, "detail": str(e)}


@app.delete("/api/documents/{doc_id}")
async def delete_document(doc_id: str):
    """문서 삭제"""
    try:
        success = document_manager.delete_document(doc_id)
        if success:
            rag = get_rag()
            rag.delete_index(doc_id)
            return {"success": True}
        else:
            return {"success": False, "detail": "문서를 찾을 수 없습니다"}
    except Exception as e:
        return {"success": False, "detail": str(e)}


@app.get("/api/documents/{doc_id}/content")
async def get_document_content(doc_id: str):
    """문서 내용 조회 (텍스트 파일용)"""
    try:
        doc = document_manager.get_document(doc_id)
        if not doc:
            return {"success": False, "detail": "문서를 찾을 수 없습니다"}
        
        file_path = Path(doc['path'])
        suffix = file_path.suffix.lower()
        
        # 텍스트로 읽을 수 있는 파일 확장자
        text_extensions = ['.txt', '.py', '.js', '.html', '.css', '.md', '.json', '.yaml', '.yml', '.c', '.cpp', '.h', '.java', '.xml', '.csv', '.log']
        
        if suffix == '.pdf':
            # PDF는 base64로 인코딩하여 반환 (브라우저 미리보기용)
            import base64
            pdf_data = base64.b64encode(file_path.read_bytes()).decode('utf-8')
            return {
                "success": True,
                "content": pdf_data,
                "filename": doc['filename'],
                "type": "pdf"
            }
        
        if suffix in text_extensions or suffix == '':
            try:
                content = file_path.read_text(encoding='utf-8', errors='replace')
                return {
                    "success": True,
                    "content": content,
                    "filename": doc['filename'],
                    "type": suffix.replace('.', '') or 'txt'
                }
            except Exception as e:
                return {"success": False, "detail": f"파일 읽기 오류: {str(e)}"}
        else:
            return {"success": False, "detail": f"지원하지 않는 파일 형식입니다: {suffix}"}
    except Exception as e:
        return {"success": False, "detail": str(e)}


@app.get("/api/index/{session_id}/status")
async def check_index_status(session_id: str):
    """세션 인덱스 상태 확인"""
    rag = get_rag()
    return {"indexed": rag.is_indexed(session_id)}


def main():
    """서버 실행"""
    uvicorn.run(app, host="127.0.0.1", port=7860)


if __name__ == "__main__":
    main()
