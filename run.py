#!/usr/bin/env python3
"""
WhisperX Note - 로컬 AI 기반 음성 회의록 시스템

사용법:
    python run.py              # 웹 서버 실행
    python run.py --cli FILE   # CLI 모드로 파일 처리
"""

import argparse
import sys
from pathlib import Path


def run_web():
    """웹 서버 실행"""
    print("=" * 50)
    print("WhisperX Note")
    print("로컬 AI 기반 음성 회의록 시스템")
    print("=" * 50)
    print()
    print("서버 시작 중...")
    print("브라우저에서 http://127.0.0.1:7860 접속")
    print()

    from src.app import main
    main()


def run_cli(audio_path: str, output_path: str = None, language: str = "korean"):
    """CLI 모드로 오디오 파일 처리"""
    from src.transcriber import WhisperXTranscriber, format_transcription
    from src.meeting_minutes import MeetingMinutesGenerator

    audio_file = Path(audio_path)
    if not audio_file.exists():
        print(f"오류: 파일을 찾을 수 없습니다 - {audio_path}")
        sys.exit(1)

    print(f"처리 중: {audio_path}")
    print(f"언어: {language}")
    print()

    # 전사
    transcriber = WhisperXTranscriber()
    transcriber.load_model()
    result = transcriber.transcribe_with_segments(audio_path, language=language)

    # 결과 출력
    print(format_transcription(result))

    # 회의록 생성 및 저장
    if output_path:
        generator = MeetingMinutesGenerator()
        minutes = generator.generate(result, title=audio_file.name)

        output_file = Path(output_path)
        if output_file.suffix == ".json":
            generator.save_json(minutes, output_path)
        else:
            if output_file.suffix != ".md":
                output_path = str(output_file) + ".md"
            generator.save_markdown(minutes, output_path)

        print(f"\n회의록 저장됨: {output_path}")


def main():
    parser = argparse.ArgumentParser(
        description="WhisperX Note - 로컬 AI 기반 음성 회의록 시스템",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
예시:
  python run.py                              # 웹 서버 실행
  python run.py --cli meeting.mp3            # CLI로 파일 처리
  python run.py --cli meeting.mp3 -o output.md -l korean
        """
    )

    parser.add_argument("--cli", metavar="FILE", help="CLI 모드로 오디오 파일 처리")
    parser.add_argument("-o", "--output", help="출력 파일 경로 (CLI 모드)")
    parser.add_argument(
        "-l", "--language",
        default="korean",
        choices=["korean", "english", "japanese", "chinese"],
        help="인식 언어 (기본: korean)"
    )

    args = parser.parse_args()

    if args.cli:
        run_cli(args.cli, args.output, args.language)
    else:
        run_web()


if __name__ == "__main__":
    main()
