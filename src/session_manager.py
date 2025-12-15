"""
세션 관리 모듈
회의 세션 생성, 저장, 로드, 수정 기능
"""

import json
import shutil
import uuid
from datetime import datetime
from pathlib import Path
from typing import Optional, Tuple, Dict, Any, List

from .config import SESSIONS_DIR



class SessionManager:
    """회의 세션 관리"""

    def __init__(self, base_dir: Optional[Path] = None):
        self.base_dir = Path(base_dir) if base_dir else SESSIONS_DIR
        self.base_dir.mkdir(parents=True, exist_ok=True)

    def update_folder(self, session_id: str, folder_id: Optional[str]) -> bool:
        """세션의 폴더 이동"""
        session_dir = self._get_session_dir(session_id)
        meta_path = session_dir / "metadata.json"
        
        if not meta_path.exists():
            return False
            
        try:
            meta = self._load_json(meta_path)
            meta["folder_id"] = folder_id if folder_id != "root" else None
            self._save_json(meta_path, meta)
            return True
        except Exception as e:
            print(f"Error updating session folder: {e}")
            return False

    def _get_session_dir(self, session_id: str) -> Path:
        return self.base_dir / session_id

    def _load_json(self, path: Path) -> Dict[str, Any]:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)

    def _save_json(self, path: Path, data: Dict[str, Any]) -> None:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

    def create_session(
        self,
        audio_path: str,
        title: str,
        participants: str,
        agenda: str,
        language: str
    ) -> Tuple[str, Dict[str, Any]]:
        """새 세션 생성"""
        session_id = str(uuid.uuid4())
        session_dir = self._get_session_dir(session_id)
        session_dir.mkdir(parents=True, exist_ok=True)

        # 오디오 파일 복사
        src_path = Path(audio_path)
        dest_path = session_dir / f"audio{src_path.suffix}"
        shutil.copy2(src_path, dest_path)

        # 메타데이터 저장
        metadata = {
            "id": session_id,
            "title": title or "제목 없음",
            "participants": participants,
            "agenda": agenda,
            "language": language,
            "created_at": datetime.now().isoformat(),
            "audio_file": dest_path.name
        }
        self._save_json(session_dir / "metadata.json", metadata)

        return session_id, metadata

    def save_session(
        self,
        audio_path: str,
        result: Dict[str, Any],
        title: str = "",
        participants: str = "",
        agenda: str = ""
    ) -> str:
        """세션 생성 및 전사 결과 저장"""
        session_id, _ = self.create_session(audio_path, title, participants, agenda, result.get("language", "ko"))
        self.save_result(session_id, result)
        return session_id

    def save_result(self, session_id: str, result: Dict[str, Any]) -> None:
        """전사 결과 저장"""
        session_dir = self._get_session_dir(session_id)
        if not session_dir.exists():
            raise ValueError(f"세션을 찾을 수 없습니다: {session_id}")
        self._save_json(session_dir / "result.json", result)

    def list_sessions(self) -> List[Dict[str, Any]]:
        """세션 목록 조회 (최신순)"""
        sessions = []
        for meta_path in self.base_dir.glob("*/metadata.json"):
            try:
                sessions.append(self._load_json(meta_path))
            except Exception as e:
                print(f"세션 메타데이터 로드 오류: {e}")

        sessions.sort(key=lambda x: x.get("created_at", ""), reverse=True)
        return sessions

    def load_session(self, session_id: str) -> Tuple[Dict[str, Any], Optional[Dict[str, Any]], Optional[str]]:
        """세션 상세 정보 로드"""
        session_dir = self._get_session_dir(session_id)
        metadata = self._load_json(session_dir / "metadata.json")

        result = None
        result_path = session_dir / "result.json"
        if result_path.exists():
            result = self._load_json(result_path)

        audio_path = str((session_dir / metadata["audio_file"]).resolve())

        return metadata, result, audio_path

    def update_session_title(self, session_id: str, new_title: str) -> None:
        """세션 제목 수정"""
        session_dir = self._get_session_dir(session_id)
        meta_path = session_dir / "metadata.json"
        metadata = self._load_json(meta_path)
        metadata["title"] = new_title
        self._save_json(meta_path, metadata)

    def update_speaker_name(self, session_id: str, old_name: str, new_name: str) -> bool:
        """화자 이름 변경"""
        session_dir = self._get_session_dir(session_id)
        result_path = session_dir / "result.json"

        if not result_path.exists():
            return False

        result = self._load_json(result_path)
        updated = False

        for seg in result.get("segments", []):
            if seg.get("speaker") == old_name:
                seg["speaker"] = new_name
                updated = True

        if updated:
            self._save_json(result_path, result)

        return updated

    def delete_session(self, session_id: str) -> None:
        """세션 삭제"""
        session_dir = self._get_session_dir(session_id)
        if session_dir.exists():
            shutil.rmtree(session_dir)

    def get_display_list(self) -> List[Tuple[str, str]]:
        """UI용 세션 목록 (라벨, ID)"""
        sessions = self.list_sessions()
        result = []
        for s in sessions:
            dt = datetime.fromisoformat(s["created_at"])
            label = f"{s['title']} ({dt.strftime('%Y-%m-%d %H:%M')})"
            result.append((label, s["id"]))
        return result

    def _get_chats_dir(self, session_id: str) -> Path:
        # Handle 'global' session specially - store in base_dir/global/chats
        if session_id == "global":
            global_dir = self.base_dir / "global" / "chats"
            global_dir.mkdir(parents=True, exist_ok=True)
            return global_dir
        return self._get_session_dir(session_id) / "chats"

    def list_chat_histories(self, session_id: str) -> List[Dict[str, Any]]:
        """채팅 목록 조회"""
        chats_dir = self._get_chats_dir(session_id)

        # Migration: Check for legacy chat.json (skip for 'global')
        if session_id != "global":
            legacy_path = self._get_session_dir(session_id) / "chat.json"
            if legacy_path.exists():
                chats_dir.mkdir(exist_ok=True)
                # Create a new chat for legacy content
                chat_id = str(uuid.uuid4())
                new_path = chats_dir / f"{chat_id}.json"
                shutil.move(str(legacy_path), str(new_path))

        if not chats_dir.exists():
            return []

        chats = []
        for chat_file in chats_dir.glob("*.json"):
            try:
                # 파일 수정 시간 등을 기준으로 정렬?
                # 아니면 파일 내용의 마지막 timestamp?
                # 간단히 파일 메타데이터 사용
                stat = chat_file.stat()
                chats.append({
                    "id": chat_file.stem,
                    "updated_at": datetime.fromtimestamp(stat.st_mtime).isoformat(),
                    "created_at": datetime.fromtimestamp(stat.st_ctime).isoformat()
                })
            except Exception:
                pass
        
        # 최신순 정렬
        chats.sort(key=lambda x: x["updated_at"], reverse=True)
        return chats

    def create_new_chat(self, session_id: str) -> str:
        """새 채팅 생성"""
        chats_dir = self._get_chats_dir(session_id)
        chats_dir.mkdir(exist_ok=True)
        
        chat_id = str(uuid.uuid4())
        chat_path = chats_dir / f"{chat_id}.json"
        self._save_json(chat_path, []) # Empty list
        
        return chat_id

    def save_chat_history(self, session_id: str, chat_id: str, messages: List[Dict[str, Any]]) -> None:
        """채팅 기록 저장"""
        chats_dir = self._get_chats_dir(session_id)
        if not chats_dir.exists():
            chats_dir.mkdir(parents=True, exist_ok=True)
        
        chat_path = chats_dir / f"{chat_id}.json"
        self._save_json(chat_path, messages)

    def load_chat_history(self, session_id: str, chat_id: str) -> List[Dict[str, Any]]:
        """채팅 기록 로드"""
        # chat_id가 없으면 가장 최신(또는 default) 로드 로직은 호출측에서 처리 권장
        chats_dir = self._get_chats_dir(session_id)
        chat_path = chats_dir / f"{chat_id}.json"
        
        if chat_path.exists():
            try:
                return self._load_json(chat_path)
            except Exception as e:
                print(f"Error loading chat history: {e}")
        return []

    def delete_chat_history(self, session_id: str, chat_id: str) -> bool:
        """특정 채팅 기록 삭제"""
        chats_dir = self._get_chats_dir(session_id)
        chat_path = chats_dir / f"{chat_id}.json"
        
        if chat_path.exists():
            try:
                chat_path.unlink()
                return True
            except Exception:
                return False
        return False

