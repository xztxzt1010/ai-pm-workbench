// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";

import { ProjectDecisionPanel } from "@/components/project-decision-panel";
import {
  createProductDecision,
  createProductDecisionVersion,
  listProductDecisions,
  reviewProductDecision,
  type ProductDecisionRecord,
} from "@/services/product-decision-service";

vi.mock("@/services/product-decision-service", () => ({
  createProductDecision: vi.fn(),
  createProductDecisionVersion: vi.fn(),
  listProductDecisions: vi.fn(),
  reviewProductDecision: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    info: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  },
}));

const proposedRecord: ProductDecisionRecord = {
  id: "decision-1",
  projectId: "p1",
  status: "proposed",
  versionNumber: 1,
  title: "采用本地优先",
  context: "隐私要求",
  decision: "本地保存",
  alternativesJson: "[]",
  evidenceJson: "[]",
  objectionsJson: "[]",
  impact: "降低泄漏风险",
  reviewDate: "2026-08-01",
  createdBy: "user",
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
};

function stubRandomUuid() {
  const target = globalThis as {
    crypto?: { randomUUID?: () => string };
  };
  if (!target.crypto) {
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: { randomUUID: () => "uuid-1" },
    });
  } else if (typeof target.crypto.randomUUID !== "function") {
    Object.defineProperty(target.crypto, "randomUUID", {
      configurable: true,
      value: () => "uuid-1",
    });
  } else {
    vi.spyOn(target.crypto, "randomUUID").mockReturnValue("uuid-1");
  }
}

const scrollIntoView = vi.fn();

function fillRequiredForm() {
  fireEvent.change(screen.getByLabelText("决策标题（必填）"), {
    target: { value: "采用本地优先" },
  });
  fireEvent.change(screen.getByLabelText("复查日期"), {
    target: { value: "2026-08-01" },
  });
  fireEvent.change(screen.getByLabelText("背景与问题（必填）"), {
    target: { value: "隐私要求" },
  });
  fireEvent.change(screen.getByLabelText("决策结论（必填）"), {
    target: { value: "本地保存" },
  });
  fireEvent.change(screen.getByLabelText("影响与后续（必填）"), {
    target: { value: "降低泄漏风险" },
  });
}

describe("ProjectDecisionPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    scrollIntoView.mockClear();
    stubRandomUuid();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });
    vi.mocked(listProductDecisions).mockResolvedValue([]);
  });

  afterEach(() => cleanup());

  it("shows a proposed guidance toast and scrolls to the new record after creating a decision", async () => {
    vi.mocked(createProductDecision).mockResolvedValue(proposedRecord);
    render(
      <ProjectDecisionPanel projectId="p1" desktopRuntime readOnly={false} />,
    );
    await screen.findByRole("button", { name: "保存决策" });
    fillRequiredForm();
    fireEvent.click(screen.getByRole("button", { name: "保存决策" }));
    await waitFor(() =>
      expect(createProductDecision).toHaveBeenCalledTimes(1),
    );
    expect(toast.success).toHaveBeenCalledWith(
      "决策已保存为待确认提议；点击确认后进入正式决策",
    );
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledTimes(1));
    expect(scrollIntoView.mock.instances[0]).toBe(
      document.getElementById("project-decision-decision-1"),
    );
    expect(scrollIntoView.mock.calls[0][0]).toEqual({
      behavior: "smooth",
      block: "center",
    });
  });

  it("keeps the returned proposed status and never auto-confirms the decision", async () => {
    vi.mocked(createProductDecision).mockResolvedValue(proposedRecord);
    render(
      <ProjectDecisionPanel projectId="p1" desktopRuntime readOnly={false} />,
    );
    fillRequiredForm();
    fireEvent.click(screen.getByRole("button", { name: "保存决策" }));
    await waitFor(() =>
      expect(createProductDecision).toHaveBeenCalledTimes(1),
    );
    expect(reviewProductDecision).not.toHaveBeenCalled();
    expect(await screen.findByText("待确认")).toBeInTheDocument();
    expect(screen.queryByText("已确认")).not.toBeInTheDocument();
  });

  it("does not show success or scroll when saving fails", async () => {
    vi.mocked(createProductDecision).mockRejectedValue(
      new Error("数据库不可用"),
    );
    render(
      <ProjectDecisionPanel projectId="p1" desktopRuntime readOnly={false} />,
    );
    fillRequiredForm();
    fireEvent.click(screen.getByRole("button", { name: "保存决策" }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("数据库不可用"),
    );
    expect(toast.success).not.toHaveBeenCalled();
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("keeps real status and still auto-scrolls when saving a new version", async () => {
    const confirmedRecord: ProductDecisionRecord = {
      ...proposedRecord,
      status: "confirmed",
      versionNumber: 2,
      title: "已确认的决策",
    };
    vi.mocked(listProductDecisions).mockResolvedValue([confirmedRecord]);
    vi.mocked(createProductDecisionVersion).mockResolvedValue({
      ...confirmedRecord,
      versionNumber: 3,
    });
    render(
      <ProjectDecisionPanel projectId="p1" desktopRuntime readOnly={false} />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "新建版本" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "保存新版本" }),
    );
    await waitFor(() =>
      expect(createProductDecisionVersion).toHaveBeenCalledTimes(1),
    );
    expect(toast.success).toHaveBeenCalledWith("决策新版本已保存");
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledTimes(1));
    expect(scrollIntoView.mock.instances[0]).toBe(
      document.getElementById("project-decision-decision-1"),
    );
  });
});
