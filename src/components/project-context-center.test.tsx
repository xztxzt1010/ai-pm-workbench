// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";

import { ProjectContextCenter } from "@/components/project-context-center";
import type { Project } from "@/domain/models";
import { buildProjectContext } from "@/domain/project-context";
import { loadProjectContext } from "@/services/project-context-service";

vi.mock("@/services/project-context-service", () => ({
  loadProjectContext: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    info: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  },
}));

const project: Project = {
  id: "p1",
  name: "上下文中心",
  goal: "统一查看八类上下文",
  status: "active",
  startDate: "2026-07-01",
  endDate: "2026-08-01",
  progress: 50,
  updatedAt: "2026-07-18T00:00:00.000Z",
};

function snapshot(value = project) {
  return buildProjectContext({
    project: value,
    milestones: [],
    confirmations: [],
    requirements: [],
    documents: [],
    knowledgeItems: [],
    risks: [],
    decisions: [],
    releases: [],
    generatedAt: "2026-07-18T01:00:00.000Z",
  });
}

describe("ProjectContextCenter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadProjectContext).mockResolvedValue(snapshot());
  });

  afterEach(() => cleanup());

  it("shows all eight categories and keeps missing facts visible", async () => {
    render(
      <ProjectContextCenter
        project={project}
        milestones={[]}
        confirmations={[]}
        desktopRuntime={false}
      />,
    );
    await waitFor(() =>
      expect(screen.getByText("项目目标")).toBeInTheDocument(),
    );
    expect(screen.getByText("用户需求")).toBeInTheDocument();
    expect(screen.getByText("PRD")).toBeInTheDocument();
    expect(screen.getByText("技术方案")).toBeInTheDocument();
    expect(screen.getByText("开发状态")).toBeInTheDocument();
    expect(screen.getByText("测试状态")).toBeInTheDocument();
    expect(screen.getByText("风险列表")).toBeInTheDocument();
    expect(screen.getByText("决策历史")).toBeInTheDocument();
    expect(screen.getByText("浏览器上下文边界")).toBeInTheDocument();
    expect(screen.getAllByText("缺失").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "导出 Markdown" })).toBeEnabled();
  });

  it("labels archived projects as read-only", async () => {
    const archived = { ...project, archivedAt: "2026-07-18T02:00:00.000Z" };
    vi.mocked(loadProjectContext).mockResolvedValue(snapshot(archived));
    render(
      <ProjectContextCenter
        project={archived}
        milestones={[]}
        confirmations={[]}
        desktopRuntime
      />,
    );
    expect(await screen.findByText("归档项目只读")).toBeInTheDocument();
  });

  it("shows an atomic load error instead of a partial context snapshot", async () => {
    vi.mocked(loadProjectContext).mockRejectedValue(
      new Error("风险数据不可用"),
    );
    render(
      <ProjectContextCenter
        project={project}
        milestones={[]}
        confirmations={[]}
        desktopRuntime
      />,
    );
    expect(await screen.findByText("上下文加载失败")).toBeInTheDocument();
    expect(screen.getByText("风险数据不可用")).toBeInTheDocument();
    expect(screen.queryByText("项目目标")).not.toBeInTheDocument();
  });

  it("downloads Markdown from the already built snapshot without reloading sources", async () => {
    const createObjectUrl = vi.fn().mockReturnValue("blob:project-context");
    const revokeObjectUrl = vi.fn();
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectUrl,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: revokeObjectUrl,
    });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    render(
      <ProjectContextCenter
        project={project}
        milestones={[]}
        confirmations={[]}
        desktopRuntime
      />,
    );
    const exportButton = await screen.findByRole("button", {
      name: "导出 Markdown",
    });
    await waitFor(() => expect(exportButton).toBeEnabled());
    fireEvent.click(exportButton);
    expect(loadProjectContext).toHaveBeenCalledTimes(1);
    expect(createObjectUrl).toHaveBeenCalledWith(expect.any(Blob));
    expect(click).toHaveBeenCalledTimes(1);
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:project-context");
    click.mockRestore();
  });

  it("opens the exact product document record instead of only the document module", async () => {
    vi.mocked(loadProjectContext).mockResolvedValue(
      buildProjectContext({
        project,
        milestones: [],
        confirmations: [],
        requirements: [],
        documents: [
          {
            id: "prd-1",
            projectId: "p1",
            title: "真实 PRD",
            documentType: "prd",
            status: "confirmed",
            versionNumber: 3,
            contentMarkdown: "# PRD",
            updatedAt: "2026-07-18T00:30:00.000Z",
          },
        ],
        knowledgeItems: [],
        risks: [],
        decisions: [],
        releases: [],
        generatedAt: "2026-07-18T01:00:00.000Z",
      }),
    );
    const recordClick = vi.fn();
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });
    render(
      <>
        <ProjectContextCenter
          project={project}
          milestones={[]}
          confirmations={[]}
          desktopRuntime
        />
        <button id="project-document-prd-1" onClick={recordClick}>
          真实 PRD 记录
        </button>
      </>,
    );
    const sourceTitle = await screen.findByText("真实 PRD");
    const sourceRow = sourceTitle.parentElement?.parentElement;
    expect(sourceRow).not.toBeNull();
    fireEvent.click(
      within(sourceRow as HTMLElement).getByRole("button", {
        name: "打开来源",
      }),
    );
    expect(recordClick).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
  });

  it("scrolls to the risks module when the risks card blank area is clicked", async () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });
    render(
      <>
        <ProjectContextCenter
          project={project}
          milestones={[]}
          confirmations={[]}
          desktopRuntime={false}
        />
        <div id="project-risks" />
      </>,
    );
    const risksTitle = await screen.findByText("风险列表");
    const card = risksTitle.closest('[data-slot="card"]') as HTMLElement;
    fireEvent.click(card);
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledTimes(1));
    expect(scrollIntoView.mock.instances[0]).toBe(
      document.getElementById("project-risks"),
    );
    expect(scrollIntoView.mock.calls[0][0]).toEqual({
      behavior: "smooth",
      block: "start",
    });
  });

  it("activates module locating from the 前往模块 button with Enter and Space", async () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });
    const user = userEvent.setup();
    render(
      <>
        <ProjectContextCenter
          project={project}
          milestones={[]}
          confirmations={[]}
          desktopRuntime={false}
        />
        <div id="project-decisions" />
      </>,
    );
    const decisionsTitle = await screen.findByText("决策历史");
    const card = decisionsTitle.closest('[data-slot="card"]') as HTMLElement;
    expect(card).not.toHaveAttribute("role");
    const goButton = screen.getByRole("button", {
      name: "定位到决策历史模块",
    });
    goButton.focus();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledTimes(1));
    expect(scrollIntoView.mock.instances[0]).toBe(
      document.getElementById("project-decisions"),
    );
    await user.keyboard(" ");
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledTimes(2));
    expect(scrollIntoView.mock.instances[1]).toBe(
      document.getElementById("project-decisions"),
    );
  });

  it("locates the module exactly once when the 前往模块 button is clicked", async () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });
    render(
      <>
        <ProjectContextCenter
          project={project}
          milestones={[]}
          confirmations={[]}
          desktopRuntime={false}
        />
        <div id="project-knowledge" />
      </>,
    );
    await screen.findByText("技术方案");
    const goButton = screen.getByRole("button", {
      name: "定位到技术方案模块",
    });
    fireEvent.click(goButton);
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledTimes(1));
    expect(scrollIntoView.mock.instances[0]).toBe(
      document.getElementById("project-knowledge"),
    );
  });

  it("performs only the precise record scroll when opening a source", async () => {
    vi.mocked(loadProjectContext).mockResolvedValue(
      buildProjectContext({
        project,
        milestones: [],
        confirmations: [],
        requirements: [],
        documents: [
          {
            id: "prd-1",
            projectId: "p1",
            title: "真实 PRD",
            documentType: "prd",
            status: "confirmed",
            versionNumber: 3,
            contentMarkdown: "# PRD",
            updatedAt: "2026-07-18T00:30:00.000Z",
          },
        ],
        knowledgeItems: [],
        risks: [],
        decisions: [],
        releases: [],
        generatedAt: "2026-07-18T01:00:00.000Z",
      }),
    );
    const recordClick = vi.fn();
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });
    render(
      <>
        <ProjectContextCenter
          project={project}
          milestones={[]}
          confirmations={[]}
          desktopRuntime
        />
        <button id="project-document-prd-1" onClick={recordClick}>
          真实 PRD 记录
        </button>
      </>,
    );
    const sourceTitle = await screen.findByText("真实 PRD");
    const sourceRow = sourceTitle.parentElement?.parentElement as HTMLElement;
    fireEvent.click(
      within(sourceRow).getByRole("button", { name: "打开来源" }),
    );
    expect(recordClick).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledTimes(1));
    expect(scrollIntoView.mock.calls[0][0]).toEqual({
      behavior: "smooth",
      block: "center",
    });
  });

  it("still locates the decisions module from a missing decisions card", async () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });
    render(
      <>
        <ProjectContextCenter
          project={project}
          milestones={[]}
          confirmations={[]}
          desktopRuntime={false}
        />
        <div id="project-decisions" />
      </>,
    );
    const decisionsTitle = await screen.findByText("决策历史");
    const card = decisionsTitle.closest('[data-slot="card"]') as HTMLElement;
    fireEvent.click(card);
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledTimes(1));
    expect(scrollIntoView.mock.instances[0]).toBe(
      document.getElementById("project-decisions"),
    );
  });

  it("shows a non-destructive toast and no exception when the module target is missing", async () => {
    render(
      <ProjectContextCenter
        project={project}
        milestones={[]}
        confirmations={[]}
        desktopRuntime={false}
      />,
    );
    const risksTitle = await screen.findByText("风险列表");
    const card = risksTitle.closest('[data-slot="card"]') as HTMLElement;
    fireEvent.click(card);
    await waitFor(() =>
      expect(toast.info).toHaveBeenCalledWith("该模块尚未挂载，无法定位"),
    );
  });
});
