import { Check, MessageSquare, ShieldQuestion, X } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { AgentWaitRequest, ApprovalWaitRequest, PlanExitWaitRequest, UserInputWaitRequest } from "@/types/roder";

type AgentWaitCardsProps = {
  requests: AgentWaitRequest[];
  onResolveApproval: (request: ApprovalWaitRequest, approved: boolean) => Promise<void>;
  onResolveUserInput: (request: UserInputWaitRequest, answers: Record<string, string>) => Promise<void>;
  onExitPlan: (request: PlanExitWaitRequest, approved: boolean) => Promise<void>;
};

export function AgentWaitCards({
  requests,
  onResolveApproval,
  onResolveUserInput,
  onExitPlan,
}: AgentWaitCardsProps): React.JSX.Element | null {
  if (requests.length === 0) {
    return null;
  }

  return (
    <div className="mx-auto mb-3 flex w-full max-w-[980px] flex-col gap-3 px-8">
      {requests.map((request) => {
        if (request.kind === "approval") {
          return (
            <ApprovalWaitCard
              key={request.id}
              request={request}
              onResolve={onResolveApproval}
            />
          );
        }
        if (request.kind === "userInput") {
          return (
            <UserInputWaitCard
              key={request.id}
              request={request}
              onResolve={onResolveUserInput}
            />
          );
        }
        return (
          <PlanExitWaitCard
            key={request.id}
            request={request}
            onResolve={onExitPlan}
          />
        );
      })}
    </div>
  );
}

function ApprovalWaitCard({
  request,
  onResolve,
}: {
  request: ApprovalWaitRequest;
  onResolve: (request: ApprovalWaitRequest, approved: boolean) => Promise<void>;
}): React.JSX.Element {
  return (
    <WaitCard
      icon={<ShieldQuestion className="size-4" />}
      title={`${request.toolName || "Tool"} approval`}
      description={request.reason || "This tool is waiting for approval."}
      error={request.error}
      actions={(
        <>
          <Button
            variant="outline"
            size="sm"
            disabled={request.resolving}
            onClick={() => void onResolve(request, false)}
          >
            <X className="size-4" />
            Reject
          </Button>
          <Button
            variant="accent"
            size="sm"
            disabled={request.resolving}
            onClick={() => void onResolve(request, true)}
          >
            <Check className="size-4" />
            Approve
          </Button>
        </>
      )}
    />
  );
}

function UserInputWaitCard({
  request,
  onResolve,
}: {
  request: UserInputWaitRequest;
  onResolve: (request: UserInputWaitRequest, answers: Record<string, string>) => Promise<void>;
}): React.JSX.Element {
  const initialAnswers = useMemo(
    () => Object.fromEntries(request.questions.map((question) => [question.id, question.options?.[0]?.label ?? ""])),
    [request.questions],
  );
  const [answers, setAnswers] = useState<Record<string, string>>(initialAnswers);
  const canSubmit = request.questions.every((question) => (answers[question.id] ?? "").trim()) || request.questions.length === 0;

  return (
    <WaitCard
      icon={<MessageSquare className="size-4" />}
      title="Input requested"
      description="The agent is waiting for your answer."
      error={request.error}
      body={(
        <div className="mt-3 flex flex-col gap-3">
          {request.questions.map((question) => {
            const options = question.options ?? [];
            return (
              <div key={question.id} className="flex flex-col gap-2">
                <label className="text-base font-medium text-foreground" htmlFor={`wait-input-${request.id}-${question.id}`}>
                  {question.question}
                </label>
                {options.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {options.map((option) => {
                      const selected = answers[question.id] === option.label;
                      return (
                        <button
                          key={option.label}
                          type="button"
                          className={cn(
                            "rounded-md border border-border px-3 py-2 text-left text-base transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                            selected && "border-ring bg-accent text-accent-foreground",
                          )}
                          disabled={request.resolving}
                          title={option.description}
                          onClick={() => setAnswers((current) => ({ ...current, [question.id]: option.label }))}
                        >
                          {option.label}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <Textarea
                    id={`wait-input-${request.id}-${question.id}`}
                    value={answers[question.id] ?? ""}
                    disabled={request.resolving}
                    rows={2}
                    onChange={(event) => setAnswers((current) => ({ ...current, [question.id]: event.target.value }))}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
      actions={(
        <Button
          variant="accent"
          size="sm"
          disabled={request.resolving || !canSubmit}
          onClick={() => void onResolve(request, normalizedAnswers(answers))}
        >
          <Check className="size-4" />
          Submit
        </Button>
      )}
    />
  );
}

function PlanExitWaitCard({
  request,
  onResolve,
}: {
  request: PlanExitWaitRequest;
  onResolve: (request: PlanExitWaitRequest, approved: boolean) => Promise<void>;
}): React.JSX.Element {
  const description = request.planSummary || `Switch to ${request.targetMode || "default"} mode.`;

  return (
    <WaitCard
      icon={<ShieldQuestion className="size-4" />}
      title="Exit plan mode"
      description={description}
      error={request.error}
      actions={(
        <>
          <Button
            variant="outline"
            size="sm"
            disabled={request.resolving}
            onClick={() => void onResolve(request, false)}
          >
            <X className="size-4" />
            Reject
          </Button>
          <Button
            variant="accent"
            size="sm"
            disabled={request.resolving}
            onClick={() => void onResolve(request, true)}
          >
            <Check className="size-4" />
            Approve
          </Button>
        </>
      )}
    />
  );
}

function WaitCard({
  icon,
  title,
  description,
  body,
  actions,
  error,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  body?: React.ReactNode;
  actions: React.ReactNode;
  error?: string;
}): React.JSX.Element {
  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate text-base font-semibold text-foreground">{title}</div>
              <div className="mt-1 text-base text-muted-foreground">{description}</div>
            </div>
            <div className="flex shrink-0 items-center gap-2">{actions}</div>
          </div>
          {body}
          {error && <div className="mt-2 text-base text-destructive">{error}</div>}
        </div>
      </div>
    </div>
  );
}

function normalizedAnswers(answers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(answers).map(([key, value]) => [key, value.trim()]));
}
