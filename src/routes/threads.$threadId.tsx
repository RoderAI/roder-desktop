import { createFileRoute } from "@tanstack/react-router";
import { ChatPage } from "@/pages/chat/chat-page";

export const Route = createFileRoute("/threads/$threadId")({
  component: ThreadRoute,
});

export function ThreadRoute(): React.JSX.Element {
  const { threadId } = Route.useParams();
  return <ChatPage route="thread" threadId={threadId} />;
}
