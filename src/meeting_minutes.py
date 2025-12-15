"""
회의록 생성 모듈
전사된 텍스트를 구조화된 회의록 형식으로 변환
"""

import json
from datetime import datetime
from pathlib import Path
from typing import Dict, Any, List, Optional


class MeetingMinutesGenerator:
    """회의록 생성"""

    def generate(
        self,
        transcription_result: Dict[str, Any],
        title: str = "회의록",
        participants: Optional[List[str]] = None,
        agenda: Optional[List[str]] = None
    ) -> Dict[str, Any]:
        """전사 결과로부터 회의록 생성"""
        minutes = {
            "title": title,
            "date": datetime.now().strftime("%Y-%m-%d %H:%M"),
            "duration": "",
            "participants": participants or [],
            "agenda": agenda or [],
            "transcript": "",
            "segments": [],
            "summary": "",
            "action_items": [],
            "notes": ""
        }

        # 전사 결과 처리
        if "full_text" in transcription_result:
            minutes["transcript"] = transcription_result["full_text"]
            minutes["segments"] = transcription_result.get("segments", [])
        else:
            minutes["transcript"] = transcription_result.get("text", "")

        # 회의 시간 계산
        if minutes["segments"]:
            last_segment = minutes["segments"][-1]
            if last_segment.get("end"):
                minutes["duration"] = self._format_duration(last_segment["end"])

        return minutes

    def _format_duration(self, seconds: float) -> str:
        """초를 시:분:초 형식으로 변환"""
        hours = int(seconds // 3600)
        mins = int((seconds % 3600) // 60)
        secs = int(seconds % 60)

        if hours > 0:
            return f"{hours}시간 {mins}분 {secs}초"
        elif mins > 0:
            return f"{mins}분 {secs}초"
        return f"{secs}초"

    def _format_timestamp(self, seconds: Optional[float]) -> str:
        """초를 MM:SS 또는 HH:MM:SS 형식으로 변환"""
        if seconds is None:
            return "??:??"

        hours = int(seconds // 3600)
        mins = int((seconds % 3600) // 60)
        secs = int(seconds % 60)

        if hours > 0:
            return f"{hours:02d}:{mins:02d}:{secs:02d}"
        return f"{mins:02d}:{secs:02d}"

    def to_markdown(self, minutes: Dict[str, Any]) -> str:
        """회의록을 마크다운 형식으로 변환"""
        lines = [
            f"# {minutes['title']}",
            "",
            f"**일시:** {minutes['date']}"
        ]

        if minutes["duration"]:
            lines.append(f"**소요시간:** {minutes['duration']}")

        if minutes["participants"]:
            lines.append(f"**참석자:** {', '.join(minutes['participants'])}")

        lines.append("")

        if minutes["agenda"]:
            lines.append("## 안건")
            for i, item in enumerate(minutes["agenda"], 1):
                lines.append(f"{i}. {item}")
            lines.append("")

        lines.extend(["## 녹취록", "", minutes["transcript"], ""])

        if minutes["action_items"]:
            lines.append("## 액션 아이템")
            for item in minutes["action_items"]:
                lines.append(f"- [ ] {item}")
            lines.append("")

        if minutes["notes"]:
            lines.extend(["## 비고", minutes["notes"], ""])

        return "\n".join(lines)

    def to_json(self, minutes: Dict[str, Any]) -> str:
        """회의록을 JSON 형식으로 변환"""
        return json.dumps(minutes, ensure_ascii=False, indent=2)

    def save_markdown(self, minutes: Dict[str, Any], filepath: str) -> None:
        """회의록을 마크다운 파일로 저장"""
        Path(filepath).write_text(self.to_markdown(minutes), encoding="utf-8")

    def save_json(self, minutes: Dict[str, Any], filepath: str) -> None:
        """회의록을 JSON 파일로 저장"""
        Path(filepath).write_text(self.to_json(minutes), encoding="utf-8")
