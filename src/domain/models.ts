export type ProjectStatus = "planning" | "active" | "paused" | "completed"
export type ConfirmationStatus = "pending" | "confirmed" | "postponed" | "cancelled"
export type Priority = "high" | "medium" | "low"

export interface Project {
  id: string
  name: string
  goal: string
  status: ProjectStatus
  startDate: string
  endDate: string
  progress: number
  updatedAt: string
  archivedAt?: string
  background?: string
  phase?: string
  targetUsers?: string
  coreProblem?: string
  successMetrics?: string
  constraints?: string
  owner?: string
  roles?: string
}

export interface Milestone {
  id: string
  projectId: string
  title: string
  dueDate: string
  progress: number
}

export interface ConfirmationItem {
  id: string
  projectId: string
  milestoneId?: string
  title: string
  dueDate: string
  dueTime?: string
  priority: Priority
  status: ConfirmationStatus
  conclusion?: string
  notes?: string
  createdAt: string
  updatedAt: string
}

export interface Meeting {
  id: string
  projectId?: string
  title: string
  meetingDate: string
  sourceType: "paste" | "txt" | "md" | "docx"
  status: "pending_import" | "parsed" | "pending_analysis" | "analyzing" | "pending_confirmation" | "completed" | "failed"
  createdAt: string
  updatedAt: string
}

export type MeetingSourceType = Meeting["sourceType"]
export type MeetingParseStatus = "pending" | "parsed" | "failed"

export interface MeetingSource {
  id: string
  meetingId: string
  sourceType: MeetingSourceType
  fileName?: string
  filePath?: string
  contentHash: string
  parsedText: string
  mimeType: string
  byteSize: number
  parseStatus: MeetingParseStatus
  parseError?: string
  createdAt: string
  updatedAt: string
}

export interface MeetingParagraph {
  id: string
  meetingId: string
  sourceId: string
  ordinal: number
  text: string
  startOffset: number
  endOffset: number
  contentHash: string
  createdAt: string
}

export interface MeetingDocument {
  meeting: Meeting
  source: MeetingSource
  paragraphs: MeetingParagraph[]
}

export type RequirementStatus = "draft" | "pending_confirmation" | "confirmed" | "archived"

export interface RequirementEvidence {
  paragraphId: string
  quote: string
  startOffset: number
  endOffset: number
  sourceType?: "meeting_paragraph" | "research_entry"
  sourceId?: string
}

export interface RequirementContent {
  description: string
  targetUsers: string
  scenario: string
  painPoint: string
  acceptanceCriteria: string[]
}

export interface RequirementCard {
  id: string
  meetingId: string
  projectId?: string
  currentVersionId?: string
  title: string
  status: RequirementStatus
  createdAt: string
  updatedAt: string
}

export interface RequirementVersion {
  id: string
  requirementCardId: string
  versionNumber: number
  title: string
  content: RequirementContent
  evidence: RequirementEvidence[]
  source: "ai" | "user"
  isConfirmed: boolean
  createdAt: string
}

export interface RequirementDocument {
  card: RequirementCard
  currentVersion: RequirementVersion
  versions: RequirementVersion[]
}

export interface TextMeetingFileInspection {
  fileName: string
  sourceType: "txt" | "md" | "docx"
  mimeType: string
  byteSize: number
  contentHash: string
  text: string
  parseError?: string
}

export type NotificationStatus = "scheduled" | "delivered" | "skipped" | "failed"

export interface NotificationRecord {
  id: string
  confirmationItemId?: string
  itemTitle: string
  scheduledAt: string
  deliveredAt?: string
  status: NotificationStatus
  deduplicationKey: string
  errorSummary?: string
  createdAt: string
}

export interface WorkspaceData {
  projects: Project[]
  milestones: Milestone[]
  confirmationItems: ConfirmationItem[]
  meetings: Meeting[]
}
