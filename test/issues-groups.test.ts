import { expect, test } from "vitest";
import { groupIssues } from "../src/lib/issues-ipc";
import type { Issue } from "../src/types/issues";

const issues: Issue[] = [
  {
    id: "done",
    number: 1,
    projectId: "one",
    title: "Shipped fix",
    description: "",
    status: "done",
    threadId: "thread-one",
    createdAt: "",
    updatedAt: "",
  },
  {
    id: "todo",
    number: 2,
    projectId: "one",
    title: "Next fix",
    description: "",
    status: "todo",
    threadId: null,
    createdAt: "",
    updatedAt: "",
  },
  {
    id: "cancelled",
    number: 3,
    projectId: "two",
    title: "Old fix",
    description: "",
    status: "cancelled",
    threadId: null,
    createdAt: "",
    updatedAt: "",
  },
];

test("groups issues in status order, counts rows, and collapses terminal statuses by default", () => {
  const groups = groupIssues(issues);
  expect(groups.map(({ status, issues, expanded }) => ({ status, count: issues.length, expanded }))).toEqual([
    { status: "todo", count: 1, expanded: true },
    { status: "done", count: 1, expanded: false },
    { status: "cancelled", count: 1, expanded: false },
  ]);
  expect(groupIssues(issues, {}, ["todo"])[0].expanded).toBe(false);
  expect(groupIssues(issues, {}, ["todo"])[1].expanded).toBe(true);
});

test("explicit filters expose matching terminal rows without altering saved collapse preferences", () => {
  expect(groupIssues(issues, { status: "done" })).toMatchObject([
    { status: "done", expanded: true, issues: [{ id: "done" }] },
  ]);
  expect(groupIssues(issues, { query: "SHIPPED" })).toMatchObject([{ status: "done", expanded: true }]);
  expect(groupIssues(issues, { projectId: "two", assignment: "unassigned" })).toMatchObject([
    { status: "cancelled", expanded: true },
  ]);
  expect(groupIssues(issues, { assignment: "assigned" })).toMatchObject([{ status: "done", expanded: true }]);
  expect(groupIssues(issues, { query: "missing" })).toEqual([]);
  expect(groupIssues(issues).find((group) => group.status === "done")?.expanded).toBe(false);
});
