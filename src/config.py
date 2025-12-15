"""
프로젝트 설정 및 경로 관리
"""

from pathlib import Path

# 프로젝트 루트 디렉토리
ROOT_DIR = Path(__file__).parent.parent

# 데이터 디렉토리
DATA_DIR = ROOT_DIR / "data"
SESSIONS_DIR = DATA_DIR / "sessions"
CHROMA_DIR = DATA_DIR / "chroma_db"
OUTPUTS_DIR = DATA_DIR / "outputs"
DOWNLOADS_DIR = DATA_DIR / "downloads"

# 모델 디렉토리
MODELS_DIR = ROOT_DIR / "models"

# 웹 리소스 디렉토리
STATIC_DIR = ROOT_DIR / "static"
TEMPLATES_DIR = ROOT_DIR / "templates"

# HuggingFace 토큰 파일
HF_TOKEN_FILE = ROOT_DIR / ".hf_token"


def ensure_dirs():
    """필요한 디렉토리 생성"""
    for dir_path in [DATA_DIR, SESSIONS_DIR, CHROMA_DIR, OUTPUTS_DIR, DOWNLOADS_DIR, MODELS_DIR]:
        dir_path.mkdir(parents=True, exist_ok=True)


def get_hf_token() -> str | None:
    """HuggingFace 토큰 로드"""
    if HF_TOKEN_FILE.exists():
        token = HF_TOKEN_FILE.read_text().strip()
        return token if token else None
    return None
