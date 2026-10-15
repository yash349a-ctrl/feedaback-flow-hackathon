import { Schema, model, models, Types, type InferSchemaType, type Model } from "mongoose";

const websiteContextSchema = new Schema({
  url: { type: String, default: "" },
  finalUrl: { type: String, default: "" },
  title: { type: String, default: "" },
  description: { type: String, default: "" },
  text: { type: String, default: "" },
  source: { type: String, enum: ["tinyfish", "demo"], default: "tinyfish" },
  fetchedAt: { type: Date, default: Date.now }
}, { _id: false });

const projectSchema = new Schema({
  name: { type: String, required: true, trim: true, maxlength: 120 },
  clientName: { type: String, default: "Client", trim: true, maxlength: 120 },
  websiteUrl: { type: String, default: "" },
  websiteContext: { type: websiteContextSchema, default: undefined }
}, { timestamps: true });

const commentSchema = new Schema({
  projectId: { type: Types.ObjectId, ref: "Project", required: true, index: true },
  source: { type: String, enum: ["chat", "email", "document", "screenshot", "web"], default: "chat" },
  rawText: { type: String, required: true, maxlength: 5000 },
  sourceUrl: { type: String, default: "", maxlength: 2000 },
  sourceTitle: { type: String, default: "", maxlength: 240 },
  sourceAuthor: { type: String, default: "", maxlength: 120 },
  sourceRating: { type: String, default: "", maxlength: 32 },
  sourceContext: { type: String, default: "", maxlength: 160 },
  sequence: { type: Number, required: true, default: 0 },
  receivedAt: { type: Date, default: Date.now },
  type: { type: String, enum: ["unanalyzed", "actionable", "question", "opinion"], default: "unanalyzed" },
  normalizedRequest: { type: String, default: "" },
  priority: { type: String, enum: ["low", "medium", "high"], default: "medium" },
  needsClarification: { type: Boolean, default: false },
  clarificationNote: { type: String, default: "" },
  groupId: { type: Types.ObjectId, ref: "Group", default: null },
  taskId: { type: Types.ObjectId, ref: "Task", default: null }
}, { timestamps: true });
commentSchema.index({ projectId: 1, sequence: 1 });

const groupSchema = new Schema({
  projectId: { type: Types.ObjectId, ref: "Project", required: true, index: true },
  commentIds: [{ type: Types.ObjectId, ref: "Comment", required: true }],
  reason: { type: String, required: true, maxlength: 500 },
  status: { type: String, enum: ["proposed", "merged", "rejected"], default: "proposed" },
  taskId: { type: Types.ObjectId, ref: "Task", default: null }
}, { timestamps: true });

const conflictSchema = new Schema({
  projectId: { type: Types.ObjectId, ref: "Project", required: true, index: true },
  commentIds: [{ type: Types.ObjectId, ref: "Comment", required: true }],
  explanation: { type: String, required: true, maxlength: 1000 },
  kind: { type: String, enum: ["contradiction", "change_of_mind"], default: "contradiction" },
  status: { type: String, enum: ["open", "resolved"], default: "open" },
  resolution: { type: String, default: "" },
  resolvedAt: { type: Date, default: null }
}, { timestamps: true });

const taskSchema = new Schema({
  projectId: { type: Types.ObjectId, ref: "Project", required: true, index: true },
  title: { type: String, required: true, maxlength: 180 },
  description: { type: String, default: "", maxlength: 4000 },
  priority: { type: String, enum: ["low", "medium", "high"], default: "medium" },
  status: { type: String, enum: ["todo", "in_progress", "in_review", "approved"], default: "todo" },
  sourceCommentIds: [{ type: Types.ObjectId, ref: "Comment", required: true }],
  needsClarification: { type: Boolean, default: false },
  clarificationNote: { type: String, default: "" },
  conflictIds: [{ type: Types.ObjectId, ref: "Conflict" }]
}, { timestamps: true });
taskSchema.index({ projectId: 1, status: 1 });

const approvalEventSchema = new Schema({
  taskId: { type: Types.ObjectId, ref: "Task", required: true, index: true },
  decision: { type: String, enum: ["approved", "changes_requested"], required: true },
  note: { type: String, default: "", maxlength: 2000 }
}, { timestamps: true });

// Explicitly type cached Mongoose models. Without these annotations, TypeScript can
// infer a union of Model overloads from `models.X || model(...)`, causing `.lean()`
// queries to appear as either a document or an array and hiding fields like `_id`.
type ProjectFields = InferSchemaType<typeof projectSchema>;
type CommentFields = InferSchemaType<typeof commentSchema>;
type GroupFields = InferSchemaType<typeof groupSchema>;
type ConflictFields = InferSchemaType<typeof conflictSchema>;
type TaskFields = InferSchemaType<typeof taskSchema>;
type ApprovalEventFields = InferSchemaType<typeof approvalEventSchema>;

export const Project: Model<ProjectFields> =
  (models.Project as Model<ProjectFields> | undefined) ?? model<ProjectFields>("Project", projectSchema);
export const Comment: Model<CommentFields> =
  (models.Comment as Model<CommentFields> | undefined) ?? model<CommentFields>("Comment", commentSchema);
export const Group: Model<GroupFields> =
  (models.Group as Model<GroupFields> | undefined) ?? model<GroupFields>("Group", groupSchema);
export const Conflict: Model<ConflictFields> =
  (models.Conflict as Model<ConflictFields> | undefined) ?? model<ConflictFields>("Conflict", conflictSchema);
export const Task: Model<TaskFields> =
  (models.Task as Model<TaskFields> | undefined) ?? model<TaskFields>("Task", taskSchema);
export const ApprovalEvent: Model<ApprovalEventFields> =
  (models.ApprovalEvent as Model<ApprovalEventFields> | undefined) ?? model<ApprovalEventFields>("ApprovalEvent", approvalEventSchema);

export type IdLike = Types.ObjectId | string;
