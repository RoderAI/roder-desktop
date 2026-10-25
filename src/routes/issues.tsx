import { createFileRoute } from "@tanstack/react-router";
import { IssuesPage } from "@/components/issues-page";

export const Route = createFileRoute("/issues")({ component: IssuesPage });
