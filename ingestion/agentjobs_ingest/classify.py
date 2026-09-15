"""Rule-based relevance, category and tag classification.

Relevance needs two independent signals so generic "AI" or go-to-market roles
stay off the board:
  1. the title names an engineering/research role (and not a sales/recruiting one)
  2. the posting is about LLM agents: a core term in the title, or enough
     distinct core/supporting terms in the body.
"""

from __future__ import annotations

import re
from dataclasses import dataclass


def _terms(*patterns: str) -> list[re.Pattern[str]]:
    return [re.compile(rf"(?<![a-z0-9]){pattern}(?![a-z0-9])", re.IGNORECASE) for pattern in patterns]


ENGINEERING_TITLE = re.compile(
    r"\b(engineer(ing)?|developer|architect|scientist|researcher|research\s+engineer|swe|sre|"
    r"member\s+of\s+(the\s+)?technical\s+staff|mts|programmer|tech(nical)?\s+lead)\b",
    re.IGNORECASE,
)

EXCLUDED_TITLE = re.compile(
    r"\b(sales|account\s+(executive|manager)|recruit(er|ing)|talent|marketing|"
    r"customer\s+success|support\s+engineer|partnerships?|business\s+development|"
    r"product\s+designer|copywriter|legal|counsel|finance|accountant)\b",
    re.IGNORECASE,
)

CORE_TERMS = _terms(
    r"agents?",
    r"agentic",
    r"multi[-\s]?agents?",
    r"llms?",
    r"large\s+language\s+models?",
    r"langgraph",
    r"langchain",
    r"llama\s?index",
    r"autogen",
    r"crew\s?ai",
    r"semantic\s+kernel",
    r"tool[-\s](use|calling)",
    r"function[-\s]calling",
    r"mcp",
    r"model\s+context\s+protocol",
    r"vllm",
    r"llama\.cpp",
    r"ollama",
    r"llm\s+inference",
)

SUPPORT_TERMS = _terms(
    r"rag",
    r"retrieval[-\s]augmented",
    r"embeddings?",
    r"vector\s+(database|store|search)",
    r"prompt\s+engineering",
    r"fine[-\s]?tun(e|ing)",
    r"evals?",
    r"guardrails?",
    r"inference",
    r"generative\s+ai",
    r"genai",
    r"foundation\s+models?",
    r"openai",
    r"anthropic",
    r"claude",
    r"gpt-?\d?",
    r"transformers?",
    r"pytorch",
)

AI_TITLE = re.compile(r"\b(ai|a\.i\.|ml|machine\s+learning|applied\s+ai)\b", re.IGNORECASE)

# Calibrated so company boilerplate ("we build large language models") alone
# does not qualify an unrelated role: it takes three distinct core terms, or two
# core terms plus supporting context, or an AI-titled role with real signal.
RELEVANCE_THRESHOLD = 6.0


@dataclass(frozen=True, slots=True)
class Relevance:
    relevant: bool
    score: float
    reason: str


def _distinct_hits(patterns: list[re.Pattern[str]], text: str) -> int:
    return sum(1 for pattern in patterns if pattern.search(text))


def assess_relevance(title: str, body: str) -> Relevance:
    if not ENGINEERING_TITLE.search(title):
        return Relevance(False, 0.0, "not an engineering title")
    if EXCLUDED_TITLE.search(title):
        return Relevance(False, 0.0, "excluded title")

    core_in_title = _distinct_hits(CORE_TERMS, title)
    if core_in_title:
        return Relevance(True, 10.0 + core_in_title, "core term in title")

    score = 2.0 * _distinct_hits(CORE_TERMS, body) + 0.5 * _distinct_hits(SUPPORT_TERMS, body)
    if AI_TITLE.search(title):
        score += 1.5
    if score >= RELEVANCE_THRESHOLD:
        return Relevance(True, score, "body signals")
    return Relevance(False, score, "insufficient agent/LLM signal")


# Ordered by priority: earlier categories win ties.
CATEGORY_RULES: list[tuple[str, list[re.Pattern[str]]]] = [
    (
        "local-llm-infra",
        _terms(r"vllm", r"llama\.cpp", r"ollama", r"tensorrt(-llm)?", r"triton", r"cuda", r"gpus?", r"quantiz(ation|ed)",
               r"model\s+serving", r"inference", r"on[-\s]device", r"kernels?"),
    ),
    (
        "evals-observability",
        _terms(r"evals?", r"evaluations?", r"observability", r"guardrails?", r"red[-\s]team(ing)?", r"safety",
               r"tracing", r"benchmarks?"),
    ),
    (
        "retrieval-memory",
        _terms(r"rag", r"retrieval", r"vector\s+(database|store|search)", r"embeddings?", r"search", r"memory",
               r"knowledge\s+graphs?", r"pgvector"),
    ),
    (
        "multi-agent-systems",
        _terms(r"multi[-\s]?agents?", r"agent\s+swarms?", r"crew\s?ai", r"autogen", r"agent[-\s]to[-\s]agent",
               r"collaborative\s+agents"),
    ),
    (
        "tool-use-backends",
        _terms(r"tool[-\s](use|calling)", r"function[-\s]calling", r"mcp", r"model\s+context\s+protocol",
               r"sandbox(es|ing)?", r"integrations?", r"browser\s+automation", r"computer\s+use"),
    ),
    (
        "agent-orchestration",
        _terms(r"langgraph", r"orchestration", r"workflows?", r"planning", r"agents?", r"agentic", r"temporal"),
    ),
    (
        "agent-platform",
        _terms(r"platform", r"sdks?", r"dev\s?tools", r"developer\s+tools", r"frameworks?", r"infrastructure",
               r"apis?"),
    ),
]

DEFAULT_CATEGORY = "agent-platform"


def classify_category(title: str, body: str) -> str:
    best_slug = DEFAULT_CATEGORY
    best_score = 0.0
    for slug, patterns in CATEGORY_RULES:
        score = 3.0 * _distinct_hits(patterns, title) + _distinct_hits(patterns, body)
        if score > best_score:
            best_slug, best_score = slug, score
    return best_slug


TAG_RULES: list[tuple[str, re.Pattern[str]]] = [
    (display, pattern)
    for display, pattern in (
        ("LangGraph", r"langgraph"),
        ("LangChain", r"langchain"),
        ("LlamaIndex", r"llama\s?index"),
        ("AutoGen", r"autogen"),
        ("CrewAI", r"crew\s?ai"),
        ("MCP", r"mcp|model\s+context\s+protocol"),
        ("Multi-Agent", r"multi[-\s]?agents?"),
        ("RAG", r"rag|retrieval[-\s]augmented"),
        ("Evals", r"evals?|evaluation\s+harness"),
        ("vLLM", r"vllm"),
        ("llama.cpp", r"llama\.cpp"),
        ("Ollama", r"ollama"),
        ("CUDA", r"cuda"),
        ("PyTorch", r"pytorch"),
        ("Fine-tuning", r"fine[-\s]?tun(e|ing)"),
        ("pgvector", r"pgvector"),
        ("Pinecone", r"pinecone"),
        ("Temporal", r"temporal\.io|temporal\s+workflows?"),
        ("Ray", r"ray\s+(serve|cluster|core)|anyscale"),
        ("Kubernetes", r"kubernetes|k8s"),
        ("Python", r"python"),
        ("TypeScript", r"typescript"),
        ("Go", r"golang|go\s+\(golang\)"),
        ("Rust", r"rust"),
    )
    for pattern in [re.compile(rf"(?<![a-z0-9]){pattern}(?![a-z0-9])", re.IGNORECASE)]
]

MAX_TAGS = 12


def extract_tags(title: str, body: str) -> list[str]:
    text = f"{title}\n{body}"
    return [display for display, pattern in TAG_RULES if pattern.search(text)][:MAX_TAGS]
