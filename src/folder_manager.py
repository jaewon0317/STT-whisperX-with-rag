import json
import uuid
from pathlib import Path
from datetime import datetime
from typing import List, Dict, Optional

class FolderManager:
    """폴더 구조 관리 클래스"""

    def __init__(self, base_dir: Path):
        self.base_dir = base_dir
        self.base_dir.mkdir(parents=True, exist_ok=True)
        self.metadata_file = self.base_dir / "folders.json"
        self._load_metadata()

    def _load_metadata(self):
        if self.metadata_file.exists():
            try:
                with open(self.metadata_file, 'r', encoding='utf-8') as f:
                    self.folders = json.load(f)
            except Exception:
                self.folders = {}
        else:
            self.folders = {}

    def _save_metadata(self):
        with open(self.metadata_file, 'w', encoding='utf-8') as f:
            json.dump(self.folders, f, ensure_ascii=False, indent=2)

    def create_folder(self, name: str, parent_id: Optional[str] = None) -> Dict:
        folder_id = str(uuid.uuid4())
        created_at = datetime.now().isoformat()
        
        folder_info = {
            "id": folder_id,
            "name": name,
            "parent_id": parent_id,
            "created_at": created_at
        }
        
        self.folders[folder_id] = folder_info
        self._save_metadata()
        return folder_info

    def update_folder(self, folder_id: str, name: Optional[str] = None, parent_id: Optional[str] = None) -> Optional[Dict]:
        if folder_id not in self.folders:
            return None
        
        if name is not None:
            self.folders[folder_id]["name"] = name
        
        # Handle parent_id update (folder move)
        # Note: parent_id argument being None means "don't change", not "set to root"
        # Use "root" string to explicitly move to root
        if parent_id is not None:
            # Prevent setting parent to self
            if parent_id == folder_id:
                raise ValueError("Cannot set parent to self")
            
            # Convert "root" to None for storage
            new_parent_id = None if parent_id == "root" else parent_id
            
            # Check for circular reference (prevent moving folder into its own descendant)
            if new_parent_id is not None:
                # Check if new_parent_id is a descendant of folder_id
                current = new_parent_id
                visited = set()
                while current:
                    if current in visited:
                        break  # Prevent infinite loop
                    if current == folder_id:
                        raise ValueError("Cannot move folder into its own descendant")
                    visited.add(current)
                    parent_folder = self.folders.get(current)
                    current = parent_folder.get("parent_id") if parent_folder else None
            
            self.folders[folder_id]["parent_id"] = new_parent_id
            
        self._save_metadata()
        return self.folders[folder_id]

    def delete_folder(self, folder_id: str) -> bool:
        if folder_id in self.folders:
            del self.folders[folder_id]
            
            # Orphaned children handling?
            # Strategy: Move children to Root (parent_id = None)
            for fid, info in self.folders.items():
                if info.get("parent_id") == folder_id:
                    info["parent_id"] = None
            
            self._save_metadata()
            return True
        return False

    def list_folders(self) -> List[Dict]:
        return list(self.folders.values())

    def get_folder(self, folder_id: str) -> Optional[Dict]:
        return self.folders.get(folder_id)
