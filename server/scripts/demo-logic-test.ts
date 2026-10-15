import { analyzeComments, findConflicts, findDuplicateGroups } from "../src/services/ai";

type DemoComment = {
  _id: string;
  rawText: string;
  type: "unanalyzed" | "actionable" | "question" | "opinion";
  sequence: number;
  source: "chat" | "email";
  normalizedRequest?: string;
  priority?: "low" | "medium" | "high";
  needsClarification?: boolean;
  clarificationNote?: string;
  taskId?: string | null;
  groupId?: string | null;
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main() {
  const previousKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY; // Explicitly exercise the credential-free hackathon fallback.
  try {
    const comments: DemoComment[] = [
      { _id: "a", rawText: "Make the header smaller on all screens.", type: "unanalyzed", sequence: 1, source: "chat" },
      { _id: "b", rawText: "The navigation takes up too much space at the top.", type: "unanalyzed", sequence: 2, source: "email" },
      { _id: "c", rawText: "Increase the header height on all screens.", type: "unanalyzed", sequence: 3, source: "chat" },
      { _id: "d", rawText: "Increase the logo size to improve visibility.", type: "unanalyzed", sequence: 4, source: "email" },
      { _id: "e", rawText: "Actually, keep the logo size unchanged.", type: "unanalyzed", sequence: 5, source: "chat" },
      { _id: "f", rawText: "Change the button color to green.", type: "unanalyzed", sequence: 6, source: "email" },
      { _id: "g", rawText: "Can we make the buttons green?", type: "unanalyzed", sequence: 7, source: "chat" },
      { _id: "h", rawText: "Do you think blue works better?", type: "unanalyzed", sequence: 8, source: "chat" },
      { _id: "i", rawText: "I love the new layout!", type: "unanalyzed", sequence: 9, source: "email" },
      { _id: "j", rawText: "Make it pop.", type: "unanalyzed", sequence: 10, source: "chat" },
    ];

    const extraction = await analyzeComments(comments as any[]);
    assert(extraction.mode === "demo-fallback", "Expected deterministic demo-fallback mode without an OpenAI key.");
    assert(extraction.results.length === comments.length, "Every imported comment should receive one classification.");
    const byId = new Map(extraction.results.map((item) => [item.commentId, item]));
    assert(byId.get("h")?.type === "question", "A client question must not become a task.");
    assert(byId.get("i")?.type === "opinion", "Plain praise must not become a task.");
    assert(byId.get("j")?.needsClarification === true, "Vague feedback should be flagged for clarification.");

    const analyzedComments = comments.map((comment) => ({ ...comment, ...byId.get(comment._id) }));
    const groups = await findDuplicateGroups(analyzedComments as any[], new Set<string>());
    assert(groups.some((group) => group.commentIds.includes("a") && group.commentIds.includes("b")), "Equivalent header comments should be grouped as a duplicate suggestion.");
    assert(groups.some((group) => group.commentIds.includes("f") && group.commentIds.includes("g")), "Equivalent green-button comments should be grouped as a duplicate suggestion.");

    const conflicts = await findConflicts(analyzedComments as any[]);
    assert(conflicts.some((item) => item.commentIds.includes("a") && item.commentIds.includes("c") && item.kind === "contradiction"), "Opposite header instructions should be flagged as a conflict.");
    assert(conflicts.some((item) => item.commentIds.includes("d") && item.commentIds.includes("e") && item.kind === "change_of_mind"), "A later 'actually, keep it unchanged' request should be flagged as a change of mind.");

    console.log("PASS: actionable/question/opinion classification");
    console.log("PASS: vague feedback clarification");
    console.log("PASS: duplicate suggestions for header and button feedback");
    console.log("PASS: contradictory header instructions");
    console.log("PASS: later change-of-mind detection");
  } finally {
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
  }
}

main().catch((error) => {
  console.error("Hackathon demo logic test failed:", error);
  process.exitCode = 1;
});
