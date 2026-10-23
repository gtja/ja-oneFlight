import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError, write, type Entity } from "../../api";
import { useMutationFeedback } from "../../components/Workflow";

/** Keep a confirmed draft across submission failures within the open request form. */
export default function useTaskRequestSubmission() {
  const saved = useRef<{ id: string; body: string } | null>(null);
  const uncertainCreation = useRef(false);
  const pending = useRef(false);
  const [draftId, setDraftId] = useState("");
  const client = useQueryClient();
  const mutate = useMutationFeedback();
  async function submit(body: Record<string, unknown>) {
    if (pending.current) throw new Error("正在提交，请等待本次处理完成。");
    if (uncertainCreation.current)
      throw new Error(
        "创建结果尚未确认，请先关闭弹窗，在任务列表核对后再提报，避免重复创建。",
      );
    pending.current = true;
    try {
      return await mutate(async () => {
        const fingerprint = JSON.stringify(
          Object.fromEntries(
            Object.entries(body).sort(([a], [b]) => a.localeCompare(b)),
          ),
        );
        if (!saved.current) {
          let task: Entity;
          try {
            task = await write<Entity>("/tasks", body);
            if (!task?.id) throw new Error("未收到任务编号");
          } catch (error) {
            if (
              !(error instanceof ApiError) ||
              error.status >= 500 ||
              error.status < 400
            ) {
              uncertainCreation.current = true;
              throw new Error(
                "创建结果尚未确认，请先关闭弹窗，在任务列表核对后再提报，避免重复创建。",
              );
            }
            throw error;
          }
          saved.current = { id: task.id, body: fingerprint };
          setDraftId(task.id);
        } else if (saved.current.body !== fingerprint) {
          await write(`/tasks/${saved.current.id}`, body, "PUT");
          saved.current.body = fingerprint;
        }
        try {
          return await write(`/tasks/${saved.current.id}/actions`, {
            action: "SUBMIT",
          });
        } catch (error) {
          await client.invalidateQueries({
            predicate: (query) =>
              query.queryKey[0] === "/tasks" ||
              query.queryKey[0] === "/dashboard",
          });
          throw new Error(
            `草稿已保存，提交未完成：${error instanceof Error ? error.message : "请稍后重试"}。再次提交将继续使用该草稿。`,
          );
        }
      }, "需求已提交");
    } finally {
      pending.current = false;
    }
  }
  return { submit, draftId };
}
