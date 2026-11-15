import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (name: string) => readFileSync(join(process.cwd(), "supabase", "migrations", name), "utf8");
const optIn = read("20261116000000_digest_double_opt_in.sql");
const waitlist = read("20261116000100_employer_waitlist.sql");

describe("digest double opt-in migration", () => {
  it("grandfathers existing subscribers as confirmed", () => {
    expect(optIn).toMatch(/update public\.subscribers set confirmed_at = created_at where confirmed_at is null/);
  });

  it("only mails confirmed subscribers", () => {
    const fn = optIn.slice(optIn.indexOf("function public.next_digest_recipients"));
    expect(fn).toContain("s.confirmed_at is not null");
  });

  it("keeps token-returning RPC away from anon/authenticated", () => {
    expect(optIn).toMatch(/revoke execute on function[\s\S]*request_digest_confirmation[\s\S]*from public, anon, authenticated/);
    expect(optIn).toMatch(/grant execute on function public\.request_digest_confirmation\(text, text, integer\) to service_role;/);
    expect(optIn).not.toMatch(/request_digest_confirmation\(text, text, integer\) to [^;]*anon/);
  });
});

describe("employer waitlist migration", () => {
  it("enables RLS, adds no policies and grants service_role only", () => {
    expect(waitlist).toContain("enable row level security");
    expect(waitlist).not.toMatch(/create policy/i);
    expect(waitlist).toMatch(/revoke all on public\.employer_waitlist from public, anon, authenticated/);
    expect(waitlist).toMatch(/grant all on public\.employer_waitlist to service_role/);
    expect(waitlist).not.toMatch(/grant [^;]*to [^;]*(anon|authenticated)/);
  });
});
