"""
RAG Chat 모듈 - 전사 텍스트 기반 Q&A 챗봇
LangChain + ChromaDB + Ollama 사용
"""

import shutil
from pathlib import Path
from typing import Optional

from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_community.vectorstores import Chroma
from langchain_ollama import OllamaEmbeddings, ChatOllama

from .config import CHROMA_DIR


class TranscriptRAG:
    """전사 텍스트 기반 RAG 시스템"""

    def __init__(
        self,
        persist_dir: Optional[Path] = None,
        model_name: str = "llama3.2:3b",
        embedding_model: str = "nomic-embed-text"
    ):
        self.persist_dir = Path(persist_dir) if persist_dir else CHROMA_DIR
        self.persist_dir.mkdir(parents=True, exist_ok=True)

        self.model_name = model_name
        self.embedding_model = embedding_model

        self.text_splitter = RecursiveCharacterTextSplitter(
            chunk_size=500,
            chunk_overlap=50,
            separators=["\n\n", "\n", ".", "!", "?", ",", " "]
        )

        self.embeddings = OllamaEmbeddings(model=embedding_model)
        self.llm = ChatOllama(model="exaone", temperature=0.3)

        self._stores: dict = {}

    def _get_collection_name(self, session_id: str) -> str:
        return f"session_{session_id.replace('-', '_')}"

    def _get_persist_path(self, session_id: str) -> Path:
        return self.persist_dir / self._get_collection_name(session_id)

    def index_transcript(self, session_id: str, text: str) -> bool:
        """전사 텍스트를 벡터 인덱스에 저장"""
        try:
            chunks = self.text_splitter.split_text(text)
            if not chunks:
                return False

            collection_name = self._get_collection_name(session_id)
            persist_path = str(self._get_persist_path(session_id))

            vectorstore = Chroma.from_texts(
                texts=chunks,
                embedding=self.embeddings,
                collection_name=collection_name,
                persist_directory=persist_path
            )

            self._stores[session_id] = vectorstore
            return True

        except Exception as e:
            print(f"인덱싱 오류: {e}")
            return False

    def delete_index(self, session_id: str) -> None:
        """세션의 벡터 인덱스 삭제"""
        try:
            # 메모리 캐시 제거
            if session_id in self._stores:
                del self._stores[session_id]

            # 디스크 데이터 제거
            persist_path = self._get_persist_path(session_id)
            if persist_path.exists():
                import shutil
                shutil.rmtree(persist_path)
                print(f"인덱스 삭제 완료: {session_id}")
        except Exception as e:
            print(f"인덱스 삭제 오류: {e}")

    def _get_vectorstore(self, session_id: str) -> Optional[Chroma]:
        """세션의 벡터스토어 가져오기"""
        if session_id in self._stores:
            return self._stores[session_id]

        persist_path = self._get_persist_path(session_id)
        if not persist_path.exists():
            return None

        try:
            vectorstore = Chroma(
                collection_name=self._get_collection_name(session_id),
                embedding_function=self.embeddings,
                persist_directory=str(persist_path)
            )
            self._stores[session_id] = vectorstore
            return vectorstore
        except Exception as e:
            print(f"벡터스토어 로드 오류: {e}")
            return None

    def query(self, question: str, session_ids: list[str]) -> str:
        """RAG 기반 질문 답변 (다중 세션 지원)"""
        
        # 1. 문서/세션 ID가 없으면 일반 대화 모드
        if not session_ids:
            prompt = f"""
            당신은 유능한 AI 어시스턴트입니다. 
            사용자의 질문에 친절하고 정확하게 답변해주세요.
            
            질문: {question}
            답변:
            """
            try:
                response = self.llm.invoke(prompt)
                return response.content
            except Exception as e:
                return f"오류가 발생했습니다: {e}"

        docs = []
        
        # 각 세션에서 관련 문서 검색
        for session_id in session_ids:
            vectorstore = self._get_vectorstore(session_id)
            if vectorstore:
                # 각 세션에서 상위 3개씩 검색 (세션이 많아지면 조절 필요)
                session_docs = vectorstore.similarity_search(question, k=3)
                docs.extend(session_docs)

        if not docs:
            # 검색 결과가 없으면 일반 답변 시도
            prompt = f"""
            관련된 문서를 찾을 수 없지만, 일반적인 지식을 바탕으로 답변해드리겠습니다.
            
            질문: {question}
            답변:
            """
            try:
                response = self.llm.invoke(prompt)
                return response.content
            except Exception as e:
                return f"오류가 발생했습니다: {e}"

        try:
            # 컨텍스트 조합
            context = "\n\n".join(doc.page_content for doc in docs)

            prompt = f"""당신은 제공된 문서를 분석하는 AI 도우미입니다.
아래 제공된 여러 출처(회의록, 문서, 코드 등)의 내용을 기반으로 질문에 답변해주세요.
내용이 여러 출처에 걸쳐 있다면, 이를 종합하여 설명해주세요.
답변은 정확하고 도움이 되어야 하며, 제공된 문맥에 없는 내용은 지어내지 마세요.
한국어로 답변해주세요.

참고 자료:
{context}

질문: {question}

답변:"""

            response = self.llm.invoke(prompt)
            return response.content

        except Exception as e:
            return f"오류가 발생했습니다: {e}"

    def is_indexed(self, session_id: str) -> bool:
        """세션이 인덱싱되어 있는지 확인"""
        return self._get_persist_path(session_id).exists()

    def delete_index(self, session_id: str) -> bool:
        """세션 인덱스 삭제"""
        persist_path = self._get_persist_path(session_id)

        if persist_path.exists():
            shutil.rmtree(persist_path)
            self._stores.pop(session_id, None)
            return True
        return False


# 싱글톤 인스턴스
_rag_instance: Optional[TranscriptRAG] = None


def get_rag() -> TranscriptRAG:
    """RAG 인스턴스 가져오기 (싱글톤)"""
    global _rag_instance
    if _rag_instance is None:
        _rag_instance = TranscriptRAG()
    return _rag_instance
