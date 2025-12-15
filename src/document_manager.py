import json
import uuid
import shutil
from pathlib import Path
from datetime import datetime
from typing import List, Dict, Optional
import pypdf

class DocumentManager:
    """업로드된 문서(PDF, TXT, 코드 등)를 관리하고 텍스트를 추출하는 클래스"""

    def __init__(self, base_dir: Path):
        self.base_dir = base_dir / "documents"
        self.base_dir.mkdir(parents=True, exist_ok=True)
        self.metadata_file = self.base_dir / "documents.json"
        self._load_metadata()

    def update_folder(self, doc_id: str, folder_id: Optional[str]) -> bool:
        if doc_id not in self.documents:
            return False
        
        self.documents[doc_id]["folder_id"] = folder_id if folder_id != "root" else None
        self._save_metadata()
        return True

    def _load_metadata(self):
        if self.metadata_file.exists():
            try:
                with open(self.metadata_file, 'r', encoding='utf-8') as f:
                    self.documents = json.load(f)
            except Exception:
                self.documents = {}
        else:
            self.documents = {}

    def _save_metadata(self):
        with open(self.metadata_file, 'w', encoding='utf-8') as f:
            json.dump(self.documents, f, ensure_ascii=False, indent=2)

    def add_document(self, file_path: Path, original_filename: str) -> Dict:
        """파일을 저장하고 텍스트를 추출하여 등록"""
        doc_id = str(uuid.uuid4())
        saved_path = self.base_dir / f"{doc_id}_{original_filename}"
        
        # 파일 복사/이동
        shutil.copy2(file_path, saved_path)

        # 텍스트 추출
        text_content = self._extract_text(saved_path)
        if not text_content:
            text_content = "" # 빈 텍스트라도 허용 (에러 방지)

        created_at = datetime.now().isoformat()
        
        doc_info = {
            "id": doc_id,
            "filename": original_filename,
            "path": str(saved_path),
            "created_at": created_at,
            "type": saved_path.suffix.lower().replace('.', ''),
            "size": saved_path.stat().st_size
        }

        self.documents[doc_id] = doc_info
        self._save_metadata()

        return {
            "info": doc_info,
            "text": text_content
        }

    def _extract_text(self, file_path: Path) -> str:
        """파일 확장자에 따라 텍스트 추출"""
        suffix = file_path.suffix.lower()
        
        try:
            if suffix == '.pdf':
                return self._extract_pdf(file_path)
            elif suffix in ['.txt', '.py', '.js', '.html', '.css', '.md', '.json', '.yaml', '.yml', '.c', '.cpp', '.h', '.java']:
                return file_path.read_text(encoding='utf-8', errors='replace')
            else:
                # 기본적으로 텍스트로 시도
                return file_path.read_text(encoding='utf-8', errors='replace')
        except Exception as e:
            print(f"Error extracting text from {file_path}: {e}")
            return ""

    def _extract_pdf(self, file_path: Path) -> str:
        text = ""
        with open(file_path, 'rb') as f:
            reader = pypdf.PdfReader(f)
            for page in reader.pages:
                text += page.extract_text() + "\n"
        return text

    def get_document(self, doc_id: str) -> Optional[Dict]:
        return self.documents.get(doc_id)

    def list_documents(self) -> List[Dict]:
        # 최신순 정렬
        docs = list(self.documents.values())
        docs.sort(key=lambda x: x['created_at'], reverse=True)
        return docs

    def delete_document(self, doc_id: str) -> bool:
        if doc_id not in self.documents:
            return False

        doc_info = self.documents[doc_id]
        path = Path(doc_info['path'])
        
        if path.exists():
            try:
                path.unlink()
            except Exception as e:
                print(f"Error deleting file {path}: {e}")

        del self.documents[doc_id]
        self._save_metadata()
        return True
