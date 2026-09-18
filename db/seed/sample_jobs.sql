-- Seed sample job listings for AgentJob.dev
-- Fictional companies only (not real orgs), so no real employer is misrepresented.
-- Run this in the Supabase SQL Editor (or via psql/Supabase CLI) against the
-- production project. Each call uses the existing admin_create_job RPC, so it
-- only inserts rows into public.jobs — it does not create or alter any tables.

select public.admin_create_job(
  jsonb_build_object(
    'title', 'Senior Agent Orchestration Engineer',
    'company', 'Cascade Systems',
    'company_url', 'https://cascadesystems.example.com',
    'location', 'Remote (US)',
    'workplace_type', 'remote',
    'job_type', 'full_time',
    'category_slug', 'agent-orchestration',
    'tags', jsonb_build_array('LangGraph', 'Python', 'Temporal', 'Multi-Agent'),
    'description', E'## About the role\n\nCascade Systems is looking for a Senior Agent Orchestration Engineer to design and operate the multi-agent workflows powering our internal automation platform.\n\n### What you will do\n- Design agent graphs and handoff protocols using LangGraph\n- Build durable, resumable workflows on top of Temporal\n- Define evaluation harnesses for agent reliability and cost\n- Partner with product to scope new agent-driven features\n\n### What we are looking for\n- 4+ years of backend engineering experience, strong Python\n- Hands-on experience building or operating LLM agents in production\n- Comfort with distributed systems concepts (retries, idempotency, observability)\n\nCompensation: $170,000 - $220,000 plus equity. Fully remote (US timezones).',
    'apply_url', 'https://jobs.cascadesystems.example.com/agent-orchestration-eng',
    'salary_min', 170000,
    'salary_max', 220000
  ),
  true,
  30
);

select public.admin_create_job(
  jsonb_build_object(
    'title', 'Multi-Agent Systems Engineer',
    'company', 'Meridian AI Labs',
    'company_url', 'https://meridianailabs.example.com',
    'location', 'Remote (Global)',
    'workplace_type', 'remote',
    'job_type', 'full_time',
    'category_slug', 'multi-agent-systems',
    'tags', jsonb_build_array('AutoGen', 'CrewAI', 'Python', 'Distributed Systems'),
    'description', E'## About Meridian AI Labs\n\nWe build multi-agent research assistants used by analysts at mid-market financial firms.\n\n### Responsibilities\n- Architect coordination protocols between planner, retriever, and executor agents\n- Improve agent-to-agent communication reliability and failure recovery\n- Own our internal agent simulation/testing framework\n\n### Requirements\n- Experience with at least one multi-agent framework (AutoGen, CrewAI, or custom)\n- Strong systems design fundamentals\n- Comfortable working across time zones with a distributed team\n\nCompensation: $150,000 - $195,000.',
    'apply_url', 'https://meridianailabs.example.com/careers/multi-agent-systems-eng'
  ),
  false,
  30
);

select public.admin_create_job(
  jsonb_build_object(
    'title', 'Tool-Use Backend Engineer (Contract)',
    'company', 'Solstice Robotics',
    'company_url', 'https://solsticerobotics.example.com',
    'location', 'Remote (US/Canada)',
    'workplace_type', 'remote',
    'job_type', 'contract',
    'category_slug', 'tool-use-backends',
    'tags', jsonb_build_array('Function Calling', 'TypeScript', 'API Design'),
    'description', E'## Contract role\n\nSolstice Robotics needs a backend engineer to build and harden the tool-use layer connecting our agents to internal robotics control APIs.\n\n### What you will do\n- Design typed tool schemas and validation for agent function calls\n- Build sandboxed execution and permissioning around tool calls\n- Write integration tests simulating malformed/adversarial tool outputs\n\n### Requirements\n- Strong TypeScript/Node backend experience\n- Experience with LLM tool/function calling patterns\n- Available for a 3-6 month contract, 20-30 hrs/week\n\nCompensation: $90 - $140/hr depending on experience.',
    'apply_url', 'https://solsticerobotics.example.com/careers/tool-use-backend-contract',
    'salary_min', 90,
    'salary_max', 140
  ),
  false,
  30
);

select public.admin_create_job(
  jsonb_build_object(
    'title', 'Local LLM Infrastructure Engineer',
    'company', 'Northbeam AI',
    'company_url', 'https://northbeamai.example.com',
    'location', 'Austin, TX (Onsite)',
    'workplace_type', 'onsite',
    'job_type', 'full_time',
    'category_slug', 'local-llm-infra',
    'tags', jsonb_build_array('vLLM', 'GPU Infra', 'Quantization', 'Kubernetes'),
    'description', E'## About the role\n\nNorthbeam AI runs agent workloads entirely on self-hosted open-weight models for data-sensitive enterprise customers. We need an engineer to own the inference infrastructure.\n\n### What you will do\n- Operate and scale vLLM/TGI inference clusters on Kubernetes\n- Optimize quantization and batching for cost/latency tradeoffs\n- Build internal tooling for model rollout and rollback\n\n### Requirements\n- Experience running GPU inference infrastructure at scale\n- Familiarity with vLLM, TensorRT-LLM, or similar serving stacks\n- Comfortable being onsite in Austin 4 days/week\n\nCompensation: $160,000 - $210,000.',
    'apply_url', 'https://northbeamai.example.com/careers/local-llm-infra',
    'salary_min', 160000,
    'salary_max', 210000
  ),
  false,
  30
);

select public.admin_create_job(
  jsonb_build_object(
    'title', 'Retrieval & Agent Memory Engineer',
    'company', 'Fernweg Data',
    'company_url', 'https://ferndwegdata.example.com',
    'location', 'Remote (US)',
    'workplace_type', 'remote',
    'job_type', 'full_time',
    'category_slug', 'retrieval-memory',
    'tags', jsonb_build_array('Vector DBs', 'RAG', 'Python', 'Embeddings'),
    'description', E'## About the role\n\nFernweg Data builds long-horizon research agents that need durable, queryable memory across sessions.\n\n### What you will do\n- Design retrieval pipelines and memory schemas for agent context\n- Evaluate and tune embedding models and vector store configurations\n- Build memory compaction/summarization strategies for long-running agents\n\n### Requirements\n- Experience with RAG pipelines and vector databases in production\n- Strong Python skills\n- Bonus: experience with agent memory frameworks\n\nCompensation: $145,000 - $185,000.',
    'apply_url', 'https://ferndwegdata.example.com/careers/retrieval-memory-eng'
  ),
  true,
  30
);

select public.admin_create_job(
  jsonb_build_object(
    'title', 'Agent Evals & Observability Engineer',
    'company', 'Clearwater Analytics AI',
    'company_url', 'https://clearwateranalyticsai.example.com',
    'location', 'Remote (US)',
    'workplace_type', 'remote',
    'job_type', 'full_time',
    'category_slug', 'evals-observability',
    'tags', jsonb_build_array('Evals', 'Observability', 'OpenTelemetry', 'Python'),
    'description', E'## About the role\n\nClearwater Analytics AI needs an engineer to build the evaluation and observability stack for our production agent fleet.\n\n### What you will do\n- Build automated eval suites for agent regressions (accuracy, cost, latency)\n- Instrument agent traces end-to-end with OpenTelemetry\n- Build dashboards and alerting for agent failure modes in production\n\n### Requirements\n- Experience building eval harnesses or observability tooling\n- Familiarity with OpenTelemetry or similar tracing standards\n- Strong Python skills\n\nCompensation: $155,000 - $200,000.',
    'apply_url', 'https://clearwateranalyticsai.example.com/careers/evals-observability'
  ),
  false,
  30
);

select public.admin_create_job(
  jsonb_build_object(
    'title', 'Agent Platform Engineer',
    'company', 'Lattice Works',
    'company_url', 'https://latticeworks.example.com',
    'location', 'Remote (US/EU)',
    'workplace_type', 'remote',
    'job_type', 'full_time',
    'category_slug', 'agent-platform',
    'tags', jsonb_build_array('Platform Engineering', 'Kubernetes', 'Go', 'Multi-Tenant'),
    'description', E'## About the role\n\nLattice Works provides an agent-hosting platform for other companies to deploy and scale their own AI agents. We need a platform engineer to build the multi-tenant control plane.\n\n### What you will do\n- Build multi-tenant isolation and quota enforcement for hosted agents\n- Own deployment, scaling, and rollback tooling for the agent runtime\n- Design the internal API surface partner teams build against\n\n### Requirements\n- Strong platform/infra engineering background (Go or similar)\n- Experience with Kubernetes-based multi-tenant systems\n- Comfortable owning a system end-to-end\n\nCompensation: $150,000 - $195,000.',
    'apply_url', 'https://latticeworks.example.com/careers/agent-platform-eng',
    'salary_min', 150000,
    'salary_max', 195000
  ),
  false,
  30
);

select public.admin_create_job(
  jsonb_build_object(
    'title', 'AI Agent Orchestration Intern',
    'company', 'Driftwood AI',
    'company_url', 'https://driftwoodai.example.com',
    'location', 'Remote (US)',
    'workplace_type', 'remote',
    'job_type', 'internship',
    'category_slug', 'agent-orchestration',
    'tags', jsonb_build_array('Python', 'LangGraph', 'Internship'),
    'description', E'## About the internship\n\nDriftwood AI is offering a paid summer internship to work alongside our agent orchestration team.\n\n### What you will do\n- Help build and test multi-step agent workflows (LangGraph-based)\n- Contribute to an internal tool for visualizing agent execution graphs\n- Ship a small, well-scoped feature end-to-end during the internship\n\n### What we are looking for\nOpen to students or recent grads with some Python experience and curiosity about how agent systems actually fail in production. You will write tests for agent failure modes, and present findings at the end of the internship.',
    'apply_url', 'https://driftwoodai.example.com/careers/orchestration-intern'
  ),
  false,
  30
);

select count(*) as newly_created_jobs from public.jobs where source = 'admin';
