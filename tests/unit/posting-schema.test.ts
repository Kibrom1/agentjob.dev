import { describe, expect, it } from "vitest";
import {
  POSTING_STEPS,
  firstStepWithError,
  parsePosting,
  parseTags,
  postingInputFromFormData,
  toEmployerPayload,
  toJobPayload,
  validateStep,
  type RawPostingInput,
} from "@/lib/posting/schema";

const valid: RawPostingInput = {
  company_name: "  Orbit Labs ",
  company_url: "https://orbit.example",
  company_logo_url: "",
  contact_email: " Founder@Orbit.Example ",
  title: "Staff Agent Engineer",
  category_slug: "agent-orchestration",
  job_type: "full_time",
  workplace_type: "remote",
  location: "Remote (EU)",
  tags: "LangGraph, python, Python , MCP",
  description: "Build the planner and tool-calling runtime for our production agents, end to end.",
  salary_min: "150,000",
  salary_max: "190000",
  salary_currency: "EUR",
  apply_target: "https://orbit.example/careers/1",
  featured: "on",
};

describe("parsePosting", () => {
  it("normalises a valid submission", () => {
    const result = parsePosting(valid);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toMatchObject({
      company_name: "Orbit Labs",
      company_logo_url: undefined,
      contact_email: "founder@orbit.example",
      tags: ["LangGraph", "python", "MCP"],
      salary_min: 150_000,
      salary_max: 190_000,
      featured: true,
    });
  });

  it("turns an email apply target into a mailto link", () => {
    const result = parsePosting({ ...valid, apply_target: "Jobs@Orbit.Example" });
    expect(result.success && result.data.apply_target).toBe("mailto:jobs@orbit.example");
  });

  it.each([
    ["apply_target", "javascript:alert(1)"],
    ["apply_target", "not a url"],
    ["company_logo_url", "http://insecure.example/logo.png"],
    ["company_url", "ftp://orbit.example"],
    ["contact_email", "nope"],
    ["title", "ab"],
    ["category_slug", "Bad Slug"],
    ["job_type", "gig"],
    ["workplace_type", "moon"],
    ["description", "too short"],
    ["salary_min", "12.5k"],
    ["salary_max", "99999999999"],
    ["salary_currency", "BTC"],
    ["tags", "ok, bad tag!"],
    ["location", "   "],
  ] as const)("rejects invalid %s (%s)", (field, value) => {
    const result = parsePosting({ ...valid, [field]: value });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errors[field]).toBeTruthy();
  });

  it("rejects more than 12 tags", () => {
    const tags = Array.from({ length: 13 }, (_, i) => `tag${i}`).join(",");
    const result = parsePosting({ ...valid, tags });
    expect(!result.success && result.errors.tags).toMatch(/at most 12/);
  });

  it("requires max salary >= min salary", () => {
    const result = parsePosting({ ...valid, salary_min: "200000", salary_max: "100000" });
    expect(!result.success && result.errors.salary_max).toMatch(/greater than or equal/);
  });

  it("treats missing optional fields as empty", () => {
    const { salary_min: _a, salary_max: _b, tags: _c, featured: _d, company_url: _e, ...rest } = valid;
    const result = parsePosting(rest);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.salary_min).toBeNull();
      expect(result.data.tags).toEqual([]);
      expect(result.data.featured).toBe(false);
    }
  });

  it("builds RPC payloads without leaking the contact email into the job", () => {
    const result = parsePosting(valid);
    if (!result.success) throw new Error("expected valid");
    const job = toJobPayload(result.data);
    expect(job).not.toHaveProperty("contact_email");
    expect(job.company).toBe("Orbit Labs");
    expect(job.company_logo_url).toBeNull();
    expect(toEmployerPayload(result.data)).toEqual({
      company_name: "Orbit Labs",
      email: "founder@orbit.example",
      website_url: "https://orbit.example",
      logo_url: null,
    });
  });
});

describe("step validation", () => {
  it("only reports errors for fields on the current step", () => {
    const errors = validateStep(0, { company_name: "", contact_email: "bad", title: "" });
    expect(Object.keys(errors).sort()).toEqual(["company_name", "contact_email"]);
  });

  it("checks the salary range on the compensation step", () => {
    const step = POSTING_STEPS.findIndex((s) => s.id === "apply");
    const errors = validateStep(step, { ...valid, salary_min: "5", salary_max: "1" });
    expect(errors.salary_max).toMatch(/greater than or equal/);
  });

  it("returns no errors for an unknown step", () => {
    expect(validateStep(99, {})).toEqual({});
  });

  it("finds the first step with an error", () => {
    expect(firstStepWithError({ description: "x" })).toBe(2);
    expect(firstStepWithError({ apply_target: "x", title: "y" })).toBe(1);
    expect(firstStepWithError({})).toBe(0);
  });
});

describe("helpers", () => {
  it("parses and de-duplicates tags case-insensitively", () => {
    expect(parseTags(" LangGraph,, langgraph ,Tool   Use , MCP")).toEqual(["LangGraph", "Tool Use", "MCP"]);
  });

  it("reads only known string fields from FormData", () => {
    const form = new FormData();
    form.set("title", "Agent Engineer");
    form.set("unknown", "x");
    form.set("company_logo_url", new File(["x"], "logo.png"));
    expect(postingInputFromFormData(form)).toEqual({ title: "Agent Engineer" });
  });
});
