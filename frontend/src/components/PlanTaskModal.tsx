import { useState } from "react";
import { AlertCircle, Check, LoaderCircle } from "lucide-react";
import { entityName, write, type Entity } from "../api";
import { dateTime, localInput, SCENES, toInstant } from "../domain";
import {
  defaultPlanTaskWindow,
  planTaskRequestId,
  planTaskValidation,
  type PlanTaskInput,
} from "../planTask";
import { Button, Details, Modal } from "./UI";
import { useMutationFeedback } from "./Workflow";
import { SelectControl } from "./SelectControl";

export default function PlanTaskModal({
  plan,
  organizationName,
  onClose,
  onCreated,
}: {
  plan: Entity;
  organizationName: string;
  onClose: () => void;
  onCreated: (task: Entity) => void;
}) {
  const mutate = useMutationFeedback();
  const [submitting, setSubmitting] = useState(false);
  return (
    <Modal
      title="安排执行任务"
      onClose={() => {
        if (!submitting) onClose();
      }}
      wide
    >
      <PlanTaskForm
        plan={plan}
        organizationName={organizationName}
        onClose={onClose}
        onSubmit={async (body) => {
          setSubmitting(true);
          try {
            const task = (await mutate(
              () => write(`/plans/${plan.id}/tasks`, body),
              "执行任务已安排，进入任务调度分配资源",
            )) as Entity;
            onCreated(task);
          } finally {
            setSubmitting(false);
          }
        }}
      />
    </Modal>
  );
}

export function PlanTaskForm({
  plan,
  organizationName,
  onClose,
  onSubmit,
}: {
  plan: Entity;
  organizationName: string;
  onClose: () => void;
  onSubmit: (body: PlanTaskInput) => Promise<unknown>;
}) {
  const [values, setValues] = useState(() => {
    const window = defaultPlanTaskWindow(plan);
    return {
      title: `${entityName(plan)} · 执行任务`.slice(0, 180),
      scene: SCENES[0],
      description: String(plan.scope || ""),
      priority: "NORMAL",
      startAt: localInput(window.startAt),
      endAt: localInput(window.endAt),
    };
  });
  const [requestId] = useState(planTaskRequestId);
  const bound = (value: unknown) =>
    Number.isFinite(Date.parse(String(value || ""))) ? localInput(value) : "";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const update = (key: keyof typeof values, value: string) => {
    setValues((previous) => ({ ...previous, [key]: value }));
    setError("");
  };
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError("");
    try {
      const body: PlanTaskInput = {
        ...values,
        startAt: toInstant(values.startAt) || "",
        endAt: toInstant(values.endAt) || "",
        requestId,
      };
      const invalid = planTaskValidation(plan, body);
      if (invalid) throw new Error(invalid);
      setBusy(true);
      await onSubmit(body);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "安排失败，请重试。");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      data-testid="plan-task-form"
      className="plan-task-form"
      onSubmit={submit}
    >
      <div className="notice">
        已批计划沿用审批结果，每次安排生成一张待分配任务单。长期计划可安排多次作业，无需重复审批。
      </div>
      <Details
        items={[
          { label: "所属计划", value: entityName(plan) },
          { label: "需求部门（继承计划）", value: organizationName },
          { label: "作业区域（继承计划）", value: plan.region || "未设置" },
          {
            label: "计划有效期",
            value: `${dateTime(plan.startAt)} — ${dateTime(plan.endAt)}`,
          },
        ]}
      />
      <div className="form-grid">
        <div className="field wide">
          <label htmlFor="plan-task-title">
            任务名称<em>*</em>
          </label>
          <input
            id="plan-task-title"
            required
            maxLength={180}
            disabled={busy}
            value={values.title}
            onChange={(event) => update("title", event.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="plan-task-scene">
            应用场景<em>*</em>
          </label>
          <SelectControl
            id="plan-task-scene"
            required
            disabled={busy}
            value={values.scene}
            onChange={(value) => update("scene", value)}
            options={SCENES.map((scene) => ({ value: scene, label: scene }))}
          />
        </div>
        <div className="field">
          <label htmlFor="plan-task-priority">紧急程度</label>
          <SelectControl
            id="plan-task-priority"
            disabled={busy}
            value={values.priority}
            onChange={(value) => update("priority", value)}
            options={[
              { value: "NORMAL", label: "常规" },
              { value: "URGENT", label: "紧急" },
            ]}
          />
        </div>
        {(["startAt", "endAt"] as const).map((key) => (
          <div className="field" key={key}>
            <label htmlFor={`plan-task-${key}`}>
              {key === "startAt" ? "作业开始时间" : "作业结束时间"}
              <em>*</em>
            </label>
            <input
              id={`plan-task-${key}`}
              type="datetime-local"
              required
              disabled={busy}
              min={bound(plan.startAt)}
              max={bound(plan.endAt)}
              value={values[key]}
              onChange={(event) => update(key, event.target.value)}
            />
          </div>
        ))}
        <div className="field wide">
          <span>
            一次任务填写一次作业时段；开始、结束时间须完整包含在计划有效期内。
          </span>
          <label htmlFor="plan-task-description">
            作业要求<em>*</em>
          </label>
          <textarea
            id="plan-task-description"
            required
            rows={4}
            disabled={busy}
            value={values.description}
            onChange={(event) => update("description", event.target.value)}
          />
        </div>
      </div>
      {error && (
        <p className="form-error" role="alert">
          <AlertCircle size={14} />
          {error}
        </p>
      )}
      <footer className="form-footer">
        <Button disabled={busy} onClick={onClose}>
          取消
        </Button>
        <Button primary type="submit" disabled={busy}>
          {busy ? (
            <LoaderCircle size={14} className="spin" />
          ) : (
            <Check size={14} />
          )}{" "}
          创建并进入任务调度
        </Button>
      </footer>
    </form>
  );
}
