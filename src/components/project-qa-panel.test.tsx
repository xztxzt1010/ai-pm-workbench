// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/data/provider-settings", () => ({ loadProviderConfig: vi.fn() }));
vi.mock("@/services/structured-generation-service", () => ({
  generateProjectQuestion: vi.fn(),
}));

import { ProjectQaPanel } from "@/components/project-qa-panel";

describe("project Q&A panel states", () => {
  it("keeps browser preview offline", () => {
    render(<ProjectQaPanel projectId="p1" desktopRuntime={false} />);
    expect(screen.getByText("桌面模式功能")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("disables archived projects before any evidence reaches the model", () => {
    render(
      <ProjectQaPanel projectId="p1" desktopRuntime readOnly />,
    );
    expect(screen.getByText("归档项目只读")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "项目问题" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "提问" })).toBeDisabled();
  });
});
