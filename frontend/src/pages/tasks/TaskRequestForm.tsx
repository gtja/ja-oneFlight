import { EntityForm, type Field } from "../../components/UI";
import { SCENES } from "../../domain";
import useTaskRequestSubmission from "./useTaskRequestSubmission";

export default function TaskRequestForm({
  fields,
  organizationId,
  onClose,
  onBusyChange,
}: {
  fields: Field[];
  organizationId: string;
  onClose: () => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const submission = useTaskRequestSubmission();
  return (
    <>
      {submission.draftId && (
        <p role="note">
          草稿编号：{submission.draftId}；重试将继续提交该草稿。
        </p>
      )}
      <EntityForm
        fields={fields}
        initial={{ priority: "NORMAL", scene: SCENES[0], organizationId }}
        submitLabel="提交需求"
        onCancel={onClose}
        onSubmit={async (body) => {
          onBusyChange(true);
          try {
            return await submission.submit(body);
          } finally {
            onBusyChange(false);
          }
        }}
      />
    </>
  );
}
