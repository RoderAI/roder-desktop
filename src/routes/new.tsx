import { createFileRoute } from "@tanstack/react-router";
import { ChatPage } from "@/pages/chat/chat-page";

export const Route = createFileRoute("/new")({
  component: NewRoute,
});

function NewRoute(): React.JSX.Element {
  return <ChatPage route="new" />;
}
