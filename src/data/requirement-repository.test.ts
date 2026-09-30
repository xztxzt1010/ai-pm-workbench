// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest"

import { getRequirementRepository } from "@/data/requirement-repository"

const evidence = [{ paragraphId: "source:p1", quote: "Evidence", startOffset: 0, endOffset: 8 }]

describe("browser requirement repository", () => {
  beforeEach(() => localStorage.clear())

  it("creates an evidence-backed draft and confirms the immutable version", async () => {
    const repository = getRequirementRepository(false)
    const draft = await repository.createDraft({
      meetingId: "meeting-1",
      projectId: "project-1",
      title: "Offline search",
      content: { description: "Search meeting sources offline", targetUsers: "PM", scenario: "Review", painPoint: "Slow lookup", acceptanceCriteria: ["Results cite paragraphs"] },
      evidence: [{ paragraphId: "source-1:p1", quote: "Search must work offline", startOffset: 0, endOffset: 24 }],
    })

    expect(draft.card.status).toBe("draft")
    expect(draft.currentVersion.versionNumber).toBe(1)
    expect(draft.currentVersion.evidence[0].paragraphId).toBe("source-1:p1")

    const pending = await repository.submitForConfirmation(draft.card.id)
    expect(pending.card.status).toBe("pending_confirmation")
    const confirmed = await repository.confirm(draft.card.id)
    expect(confirmed.card.status).toBe("confirmed")
    expect(confirmed.currentVersion.isConfirmed).toBe(true)
    await expect(repository.confirm(draft.card.id)).rejects.toThrow("已确认")
  })

  it("preserves AI draft provenance until a human confirmation", async () => {
    const draft = await getRequirementRepository(false).createDraft({
      meetingId: "meeting-ai",
      projectId: "project-1",
      title: "AI candidate",
      content: { description: "Candidate description", targetUsers: "PM", scenario: "Review", painPoint: "Need clarity", acceptanceCriteria: [] },
      evidence,
      source: "ai",
    })
    expect(draft.currentVersion.source).toBe("ai")
    expect(draft.currentVersion.isConfirmed).toBe(false)
  })

  it("accepts explicit research evidence without pretending it is a meeting paragraph", async () => {
    const draft = await getRequirementRepository(false).createDraft({ meetingId: "meeting-research", projectId: "project-1", title: "Research candidate", content: { description: "Description", targetUsers: "PM", scenario: "Research", painPoint: "Need evidence", acceptanceCriteria: [] }, evidence: [{ paragraphId: "research:entry-1", sourceType: "research_entry", sourceId: "entry-1", quote: "Observed insight", startOffset: 0, endOffset: 15 }] })
    expect(draft.currentVersion.evidence[0].sourceType).toBe("research_entry")
  })

  it("does not allow a draft to skip the pending confirmation state", async () => {
    const repository = getRequirementRepository(false)
    const draft = await repository.createDraft({ meetingId: "meeting-state", title: "State", content: { description: "Description", targetUsers: "", scenario: "", painPoint: "", acceptanceCriteria: [] }, evidence })
    await expect(repository.confirm(draft.card.id)).rejects.toThrow("待确认")
  })

  it("rejects requirement versions without traceable evidence", async () => {
    const repository = getRequirementRepository(false)
    await expect(repository.createDraft({ meetingId: "meeting-no-evidence", title: "No evidence", content: { description: "Description", targetUsers: "", scenario: "", painPoint: "", acceptanceCriteria: [] }, evidence: [] })).rejects.toThrow("原文证据")
  })

  it("preserves multiple source paragraphs on drafts and revisions", async () => {
    const repository = getRequirementRepository(false)
    const multipleEvidence = [
      { paragraphId: "source-multi:p1", quote: "First decision", startOffset: 0, endOffset: 14 },
      { paragraphId: "source-multi:p3", quote: "Second constraint", startOffset: 40, endOffset: 57 },
    ]
    const draft = await repository.createDraft({
      meetingId: "meeting-multi",
      title: "Trace several decisions",
      content: { description: "Keep every supporting paragraph", targetUsers: "PM", scenario: "Review", painPoint: "Evidence is scattered", acceptanceCriteria: [] },
      evidence: multipleEvidence,
    })
    expect(draft.currentVersion.evidence.map((item) => item.paragraphId)).toEqual(["source-multi:p1", "source-multi:p3"])

    const revised = await repository.revise(draft.card.id, {
      title: draft.card.title,
      content: { ...draft.currentVersion.content, description: "Keep both supporting paragraphs" },
      evidence: multipleEvidence,
    })
    expect(revised.currentVersion.evidence).toEqual(multipleEvidence)
    expect(revised.versions[0].evidence).toEqual(multipleEvidence)
    expect(revised.currentVersion.title).toBe("Trace several decisions")
  })

  it("normalizes legacy browser records without a versions array", async () => {
    const legacy = {
      card: { id: "legacy-card", meetingId: "legacy-meeting", title: "Legacy", status: "draft", createdAt: "2026-07-14", updatedAt: "2026-07-14" },
      currentVersion: { id: "legacy-v1", requirementCardId: "legacy-card", versionNumber: 1, content: { description: "Old", targetUsers: "", scenario: "", painPoint: "", acceptanceCriteria: [] }, evidence: [], source: "user", isConfirmed: false, createdAt: "2026-07-14" },
    }
    localStorage.setItem("assistant-product-manager.requirements.v1", JSON.stringify([legacy]))
    const documents = await getRequirementRepository(false).listByMeeting("legacy-meeting")
    expect(documents[0].versions).toHaveLength(1)
    expect(documents[0].versions[0].id).toBe("legacy-v1")
    expect(documents[0].versions[0].title).toBe("Legacy")
  })

  it("deletes requirement cards with their meeting", async () => {
    const repository = getRequirementRepository(false)
    await repository.createDraft({
      meetingId: "meeting-delete",
      title: "Draft",
      content: { description: "Description", targetUsers: "", scenario: "", painPoint: "", acceptanceCriteria: [] },
      evidence,
    })
    await repository.deleteByMeeting("meeting-delete")
    expect(await repository.listByMeeting("meeting-delete")).toEqual([])
  })

  it("creates a new version without changing the confirmed version", async () => {
    const repository = getRequirementRepository(false)
    const draft = await repository.createDraft({ meetingId: "meeting-version", title: "First", content: { description: "One", targetUsers: "", scenario: "", painPoint: "", acceptanceCriteria: [] }, evidence })
    await repository.submitForConfirmation(draft.card.id)
    const confirmed = await repository.confirm(draft.card.id)
    const revised = await repository.revise(draft.card.id, { title: "Second", content: { ...confirmed.currentVersion.content, description: "Two" }, evidence })
    expect(revised.card.status).toBe("draft")
    expect(revised.currentVersion.versionNumber).toBe(2)
    expect(revised.currentVersion.title).toBe("Second")
    expect(revised.versions.find((version) => version.versionNumber === 1)?.title).toBe("First")
    expect(revised.versions.find((version) => version.versionNumber === 1)?.isConfirmed).toBe(true)
    const archived = await repository.archive(draft.card.id)
    expect(archived.card.status).toBe("archived")
    await expect(repository.revise(draft.card.id, { title: "Third", content: revised.currentVersion.content, evidence })).rejects.toThrow("归档")
  })
})
