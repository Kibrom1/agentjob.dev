import pytest

from agentjobs_ingest.classify import assess_relevance, classify_category, extract_tags


@pytest.mark.parametrize(
    "title",
    [
        "Senior Software Engineer, Agents",
        "Staff Engineer - Multi-Agent Systems",
        "LLM Inference Engineer",
        "Member of Technical Staff, Tool Use",
        "Founding Engineer (MCP)",
    ],
)
def test_core_term_in_engineering_title_is_relevant(title):
    assert assess_relevance(title, "").relevant


@pytest.mark.parametrize(
    "title",
    [
        "Account Executive, AI Agents",
        "Technical Recruiter, LLM",
        "Product Marketing Manager, Agents",
        "Head of Partnerships",
        "Support Engineer, Agents",
    ],
)
def test_non_engineering_or_excluded_titles_are_rejected(title):
    assert not assess_relevance(title, "LLM agents with LangGraph and MCP").relevant


def test_company_boilerplate_alone_does_not_qualify():
    body = "Anthropic builds large language models like Claude. You will own billing and invoicing."
    result = assess_relevance("Software Engineer, Payments", body)
    assert not result.relevant
    assert result.score < 6


def test_body_signals_qualify_an_ai_titled_role():
    body = "Ship LLM features, build agents, RAG pipelines, evals and fine-tuning workflows."
    assert assess_relevance("Applied AI Engineer", body).relevant


def test_body_signals_qualify_generic_title_with_strong_evidence():
    body = "Build agentic workflows with LangGraph, tool calling and LLM routing."
    assert assess_relevance("Senior Backend Engineer", body).relevant


def test_word_boundaries_prevent_false_matches():
    # "reagents", "fragment", "trust" must not trip agent / rag / rust
    body = "Lab reagents inventory; fragment caching; trust and safety tooling."
    assert not assess_relevance("Software Engineer", body).relevant
    assert "Rust" not in extract_tags("Software Engineer", body)
    assert "RAG" not in extract_tags("Software Engineer", body)


@pytest.mark.parametrize(
    ("title", "body", "expected"),
    [
        ("Inference Engineer", "vLLM, CUDA kernels, quantization", "local-llm-infra"),
        ("Research Engineer, Evals", "build evaluation harnesses and guardrails", "evals-observability"),
        ("Engineer, Retrieval", "RAG, embeddings and vector search", "retrieval-memory"),
        ("Engineer, Multi-Agent Systems", "agents collaborate via CrewAI and AutoGen", "multi-agent-systems"),
        ("Engineer, Tool Use", "MCP servers, sandboxes and function calling", "tool-use-backends"),
        ("Senior Engineer, Agents", "LangGraph orchestration and planning", "agent-orchestration"),
        ("Platform Engineer, Agents SDK", "developer tools and SDKs", "agent-platform"),
        ("LLM Engineer", "", "agent-platform"),
    ],
)
def test_category_rules(title, body, expected):
    assert classify_category(title, body) == expected


def test_title_outweighs_body_for_category():
    body = "We also use RAG and embeddings in places."
    assert classify_category("Inference Engineer", body) == "local-llm-infra"


def test_tags_are_curated_ordered_and_capped():
    text = (
        "LangGraph LangChain LlamaIndex AutoGen CrewAI MCP multi-agent RAG evals vLLM llama.cpp Ollama "
        "CUDA PyTorch fine-tuning pgvector Pinecone Kubernetes Python TypeScript golang Rust"
    )
    tags = extract_tags("Engineer", text)
    assert len(tags) == 12
    assert tags[:3] == ["LangGraph", "LangChain", "LlamaIndex"]
    assert len(set(tag.lower() for tag in tags)) == len(tags)
