import { useEffect, useRef, useState, type FormEvent } from "react";
import { WandSparkles } from "lucide-react";
import { entityName, type Entity } from "../../api";
import { useUser } from "../../context";
import { REGIONS, toInstant } from "../../domain";
import { Button, Modal, Select } from "../../components/UI";
import { requestDescription, requestTemplates } from "./requestTemplates";
import useTaskRequestSubmission from "./useTaskRequestSubmission";
import "./requestAssistant.css";

interface Draft {
  title: string;
  target: string;
  focus: string;
  deliverables: string;
  region: string;
  startAt: string;
  endAt: string;
  priority: string;
  organizationId: string;
}
export default function RequestAssistant({
  organizations,
  organizationsError,
  onClose,
}: {
  organizations: Entity[];
  organizationsError?: Error | null;
  onClose: () => void;
}) {
  const user = useUser();
  const manage = ["ADMIN", "DISPATCH"].includes(user.role);
  const [step, setStep] = useState(0);
  const [scene, setScene] = useState(requestTemplates[0].scene);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (step === 1) form.current?.querySelector("input")?.focus();
  }, [step]);
  const submission = useTaskRequestSubmission();
  const template = requestTemplates.find((item) => item.scene === scene)!;
  const draft: Draft = drafts[scene] || {
    title: `${scene}需求`,
    target: "",
    focus: template.focus,
    deliverables: template.deliverables,
    region: "",
    startAt: "",
    endAt: "",
    priority: "NORMAL",
    organizationId: user.organizationId,
  };
  function update(key: keyof Draft, value: string) {
    setDrafts((previous) => ({
      ...previous,
      [scene]: { ...draft, [key]: value },
    }));
  }
  function payload() {
    return {
      title: draft.title.trim(),
      scene,
      region: draft.region,
      startAt: toInstant(draft.startAt),
      endAt: toInstant(draft.endAt),
      priority: draft.priority,
      organizationId: draft.organizationId,
      description: requestDescription(
        draft.target,
        draft.focus,
        draft.deliverables,
      ),
    };
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError("");
    if (
      ![
        draft.title,
        draft.target,
        draft.focus,
        draft.deliverables,
        draft.region,
        draft.startAt,
        draft.endAt,
        draft.organizationId,
      ].every((value) => value.trim())
    ) {
      setError("请完善作业对象、检查重点、成果要求、区域和时间。");
      return;
    }
    if (draft.endAt <= draft.startAt) {
      setError("期望结束时间必须晚于开始时间。");
      return;
    }
    if (payload().description.length > 8000) {
      setError("作业要求过长，请缩减到8000字以内。");
      return;
    }
    if (
      manage &&
      !organizations.some((item) => item.id === draft.organizationId)
    ) {
      setError("请选择可用的需求部门。");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await submission.submit(payload());
      onClose();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "提交失败");
    } finally {
      setBusy(false);
    }
  }
  function changeStep(value: number) {
    setStep(value);
    setError("");
  }
  const textField = (
    key: keyof Draft,
    label: string,
    multiline = false,
    placeholder?: string,
  ) => (
    <label className={`field ${multiline || key === "title" ? "wide" : ""}`}>
      <span>
        {label}
        <em>*</em>
      </span>
      {multiline ? (
        <textarea
          required
          rows={3}
          value={draft[key]}
          placeholder={placeholder}
          onChange={(event) => update(key, event.target.value)}
        />
      ) : (
        <input
          required
          type={
            key === "startAt" || key === "endAt" ? "datetime-local" : "text"
          }
          maxLength={key === "title" ? 180 : undefined}
          value={draft[key]}
          onChange={(event) => update(key, event.target.value)}
        />
      )}
    </label>
  );
  return (
    <Modal
      title="需求助手"
      wide
      className="request-assistant"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <ol className="request-steps" aria-label="提报步骤">
        {["选择场景", "填写需求"].map((label, index) => (
          <li key={label} aria-current={step === index ? "step" : undefined}>
            <span>{index + 1}</span>
            {label}
          </li>
        ))}
      </ol>
      {step === 0 ? (
        <>
          <p className="muted">
            选择业务场景，带入可修改的检查重点和成果要求。
          </p>
          <div className="request-scenes">
            {requestTemplates.map((item) => (
              <button
                key={item.scene}
                className={scene === item.scene ? "selected" : ""}
                aria-pressed={scene === item.scene}
                onClick={() => setScene(item.scene)}
              >
                <WandSparkles size={20} />
                <strong>{item.scene}</strong>
                <small>{item.summary}</small>
              </button>
            ))}
          </div>
          <footer className="form-footer">
            <Button onClick={onClose}>取消</Button>
            <Button primary onClick={() => changeStep(1)}>
              下一步：填写需求
            </Button>
          </footer>
        </>
      ) : (
        <form ref={form} onSubmit={(event) => void submit(event)}>
          <p className="request-template-note">
            {scene} · 以下模板内容均可修改
          </p>
          <fieldset disabled={busy} className="request-fields">
            <div className="form-grid">
              {textField("title", "任务名称")}
              {textField(
                "target",
                "作业对象 / 具体位置",
                true,
                template.targetHint,
              )}
              {textField("focus", "检查重点", true)}
              {textField("deliverables", "成果要求", true)}
              <div className="field">
                <span>
                  作业区域<em>*</em>
                </span>
                <Select
                  label="作业区域"
                  value={draft.region}
                  onChange={(value) => update("region", value)}
                  options={[
                    { value: "", label: "请选择区域" },
                    ...REGIONS.map((value) => ({ value, label: value })),
                  ]}
                />
              </div>
              <div className="field">
                <span>紧急程度</span>
                <Select
                  label="紧急程度"
                  value={draft.priority}
                  onChange={(value) => update("priority", value)}
                  options={[
                    { value: "NORMAL", label: "常规" },
                    { value: "URGENT", label: "紧急" },
                  ]}
                />
              </div>
              {textField("startAt", "期望开始时间")}
              {textField("endAt", "期望结束时间")}
              {manage && (
                <div className="field wide">
                  <span>
                    需求部门<em>*</em>
                  </span>
                  <Select
                    label="需求部门"
                    value={draft.organizationId}
                    onChange={(value) => update("organizationId", value)}
                    options={[
                      { value: "", label: "请选择需求部门" },
                      ...organizations.map((item) => ({
                        value: item.id,
                        label: entityName(item),
                      })),
                    ]}
                  />
                  {organizationsError && (
                    <p className="form-error">
                      需求部门读取失败：{organizationsError.message}
                    </p>
                  )}
                </div>
              )}
            </div>
          </fieldset>
          <section className="request-preview" aria-label="作业要求预览">
            <h3>作业要求</h3>
            <p>{payload().description}</p>
          </section>
          {submission.draftId && (
            <p role="note">
              草稿编号：{submission.draftId}；重试将继续办理该草稿。
            </p>
          )}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <footer className="form-footer">
            <Button disabled={busy} onClick={() => changeStep(0)}>
              上一步
            </Button>
            <Button primary type="submit" disabled={busy}>
              {busy ? "正在提交…" : "提交需求"}
            </Button>
          </footer>
        </form>
      )}
    </Modal>
  );
}
