import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ getPublicDbClient: () => ({ rpc }) }));

import { confirmByToken } from "@/lib/digest/confirm";

const TOKEN = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("confirmByToken", () => {
  it("rejects malformed tokens without calling the database", async () => {
    expect(await confirmByToken("not-a-token")).toBe("invalid");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("confirms a known token", async () => {
    rpc.mockResolvedValueOnce({ data: true, error: null });
    expect(await confirmByToken(TOKEN)).toBe("confirmed");
    expect(rpc).toHaveBeenCalledWith("confirm_digest_subscription", { p_token: TOKEN });
  });

  it("reports unknown, expired or unsubscribed tokens as invalid", async () => {
    rpc.mockResolvedValueOnce({ data: false, error: null });
    expect(await confirmByToken(TOKEN)).toBe("invalid");
  });

  it("reports database failures as errors", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: "XX000", message: "boom" } });
    expect(await confirmByToken(TOKEN)).toBe("error");
    rpc.mockRejectedValueOnce(new Error("network"));
    expect(await confirmByToken(TOKEN)).toBe("error");
  });
});
