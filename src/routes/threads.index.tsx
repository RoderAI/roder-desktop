import { createFileRoute } from "@tanstack/react-router";
import { ThreadsPage } from "@/components/threads-page";

export const Route = createFileRoute("/threads/")({ component: ThreadsPage });
