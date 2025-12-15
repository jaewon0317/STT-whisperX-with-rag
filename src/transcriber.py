"""
WhisperX 기반 음성 인식 모듈
화자분리(Speaker Diarization) 기능 포함
"""

import gc
import inspect
import os
import shutil
from pathlib import Path
from typing import Optional, Dict, Any

# Windows 심볼릭 링크 권한 문제 해결: 복사 모드 사용
os.environ["HF_HUB_LOCAL_DIR_AUTO_SYMLINK_THRESHOLD"] = "0"

# ffmpeg 경로 자동 추가 (Windows)
def _setup_ffmpeg():
    if shutil.which("ffmpeg"):
        return  # 이미 PATH에 있음

    # WinGet 설치 경로에서 찾기
    winget_path = Path.home() / "AppData/Local/Microsoft/WinGet/Packages"
    if winget_path.exists():
        for ffmpeg_dir in winget_path.glob("Gyan.FFmpeg*/*/bin"):
            if (ffmpeg_dir / "ffmpeg.exe").exists():
                os.environ["PATH"] = str(ffmpeg_dir) + ";" + os.environ.get("PATH", "")
                return

_setup_ffmpeg()

import torch

# torch.load 호환성 패치 (PyTorch 2.6+에서 weights_only 기본값 변경됨)
_original_torch_load = torch.load


def _patched_torch_load(*args, **kwargs):
    if kwargs.get('weights_only') is None:
        sig = inspect.signature(_original_torch_load)
        if 'weights_only' in sig.parameters:
            kwargs['weights_only'] = False
    return _original_torch_load(*args, **kwargs)


torch.load = _patched_torch_load

# WhisperX 지연 로딩
_whisperx = None


def _load_whisperx():
    global _whisperx
    if _whisperx is None:
        import whisperx
        _whisperx = whisperx
    return _whisperx


class WhisperXTranscriber:
    """WhisperX를 사용한 음성 인식 및 화자분리"""

    LANG_MAP = {
        "korean": "ko", "ko": "ko",
        "english": "en", "en": "en",
        "japanese": "ja", "ja": "ja",
        "chinese": "zh", "zh": "zh",
    }

    def __init__(
        self,
        model_size: str = "large-v3-turbo",
        hf_token: Optional[str] = None,
        device: Optional[str] = None,
        compute_type: Optional[str] = None
    ):
        self.model_size = model_size
        self.device = device or ("cuda" if torch.cuda.is_available() else "cpu")
        self.compute_type = compute_type or ("float16" if self.device == "cuda" else "int8")

        # HF 토큰 설정
        self.hf_token = hf_token
        if not self.hf_token:
            self._load_hf_token()

        self.model = None
        self.diarize_model = None

    def _load_hf_token(self):
        """설정 파일에서 HF 토큰 로드"""
        from .config import get_hf_token
        token = get_hf_token()
        if token:
            self.hf_token = token
            print("저장된 HuggingFace 토큰을 로드했습니다.")

    def load_model(self) -> None:
        """WhisperX 모델 로드"""
        from .config import MODELS_DIR
        wx = _load_whisperx()
        print(f"WhisperX 모델 로딩: {self.model_size} ({self.device}, {self.compute_type})")
        print(f"모델 저장 경로: {MODELS_DIR}")
        self.model = wx.load_model(
            self.model_size,
            self.device,
            compute_type=self.compute_type,
            download_root=str(MODELS_DIR)
        )
        print("WhisperX 모델 로딩 완료")

    def unload_model(self) -> None:
        """모델 언로드 및 메모리 해제"""
        if self.model:
            del self.model
            self.model = None
            print("WhisperX 모델 언로드")
        
        if self.diarize_model:
            del self.diarize_model
            self.diarize_model = None
            print("Diarization 모델 언로드")
        
        gc.collect()
        if self.device == "cuda":
            torch.cuda.empty_cache()

    def load_diarization_model(self) -> bool:
        """화자분리 모델 로드"""
        if not self.hf_token:
            print("화자분리를 위해 HuggingFace 토큰이 필요합니다.")
            return False

        try:
            print("화자분리 모델 로딩 중...")
            from whisperx.diarize import DiarizationPipeline
            self.diarize_model = DiarizationPipeline(
                use_auth_token=self.hf_token,
                device=self.device
            )
            print("화자분리 모델 로딩 완료")
            return True
        except Exception as e:
            print(f"화자분리 모델 로드 실패: {e}")
            return False

    def transcribe(self, audio_path: str, language: str = "ko", batch_size: int = 16) -> Dict[str, Any]:
        """기본 전사"""
        wx = _load_whisperx()
        if self.model is None:
            self.load_model()

        audio = wx.load_audio(audio_path)
        return self.model.transcribe(audio, batch_size=batch_size, language=language)

    def transcribe_with_alignment(self, audio_path: str, language: str = "ko", batch_size: int = 16) -> Dict[str, Any]:
        """단어 수준 정렬 포함 전사"""
        wx = _load_whisperx()
        result = self.transcribe(audio_path, language, batch_size)
        audio = wx.load_audio(audio_path)

        try:
            model_a, metadata = wx.load_align_model(language_code=language, device=self.device)
            result = wx.align(result["segments"], model_a, metadata, audio, self.device, return_char_alignments=False)
            del model_a
            gc.collect()
            if self.device == "cuda":
                torch.cuda.empty_cache()
        except Exception as e:
            print(f"정렬 실패: {e}")

        return result

    def transcribe_with_diarization(
        self,
        audio_path: str,
        language: str = "ko",
        batch_size: int = 16,
        min_speakers: Optional[int] = None,
        max_speakers: Optional[int] = None
    ) -> Dict[str, Any]:
        """화자분리 포함 전사"""
        wx = _load_whisperx()
        result = self.transcribe_with_alignment(audio_path, language, batch_size)

        if self.hf_token:
            if self.diarize_model is None:
                self.load_diarization_model()

            if self.diarize_model:
                try:
                    audio = wx.load_audio(audio_path)
                    diarize_kwargs = {}
                    if min_speakers:
                        diarize_kwargs["min_speakers"] = min_speakers
                    if max_speakers:
                        diarize_kwargs["max_speakers"] = max_speakers

                    diarize_segments = self.diarize_model(audio, **diarize_kwargs)
                    result = wx.assign_word_speakers(diarize_segments, result)
                except Exception as e:
                    print(f"화자분리 실패: {e}")

        return result

    def transcribe_with_segments(
        self,
        audio_path: str,
        language: str = "ko",
        enable_diarization: bool = False,
        min_speakers: Optional[int] = None,
        max_speakers: Optional[int] = None
    ) -> Dict[str, Any]:
        """세그먼트 형식으로 전사 결과 반환"""
        lang_code = self.LANG_MAP.get(language.lower(), language)

        if enable_diarization and self.hf_token:
            result = self.transcribe_with_diarization(
                audio_path, lang_code, min_speakers=min_speakers, max_speakers=max_speakers
            )
        else:
            result = self.transcribe_with_alignment(audio_path, lang_code)

        segments = []
        for seg in result.get("segments", []):
            segment_data = {
                "start": seg.get("start"),
                "end": seg.get("end"),
                "text": seg.get("text", "")
            }
            if "speaker" in seg:
                segment_data["speaker"] = seg["speaker"]
            segments.append(segment_data)

        full_text = " ".join(seg.get("text", "") for seg in result.get("segments", []))

        return {
            "full_text": full_text.strip(),
            "segments": segments,
            "language": lang_code
        }


# 별칭
WhisperTranscriber = WhisperXTranscriber


def format_timestamp(seconds: Optional[float]) -> str:
    """초를 MM:SS 형식으로 변환"""
    if seconds is None:
        return "??:??"
    return f"{int(seconds // 60):02d}:{int(seconds % 60):02d}"


def format_transcription(result: Dict[str, Any]) -> str:
    """전사 결과를 읽기 좋은 형식으로 포맷"""
    lines = ["=" * 60, "회의록 전사 결과", "=" * 60, ""]

    if result.get("segments"):
        lines.extend(["[타임스탬프별 내용]", "-" * 40])
        for seg in result["segments"]:
            start, end = format_timestamp(seg.get("start")), format_timestamp(seg.get("end"))
            speaker = seg.get("speaker", "")
            header = f"[{start} - {end}] {speaker}" if speaker else f"[{start} - {end}]"
            lines.extend([header, f"  {seg.get('text', '').strip()}", ""])

    lines.extend(["-" * 40, "[전체 내용]", result.get("full_text", ""), "=" * 60])
    return "\n".join(lines)
