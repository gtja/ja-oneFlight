import { useEffect, useState } from "react";
import {
  Database,
  KeyRound,
  Plus,
  RefreshCw,
  ShieldCheck,
  Users,
} from "lucide-react";
import { api, useCatalog, useData, useList, write, type Entity } from "../api";
import { dateTime, REGIONS, ROLE_LABELS } from "../domain";
import { useUser } from "../context";
import { useMutationFeedback } from "../components/Workflow";
import {
  Button,
  DataTable,
  Details,
  Empty,
  EntityForm,
  Modal,
  Select,
  Status,
  Tabs,
  type Field,
} from "../components/UI";
export default function Settings({
  initialTab,
  userId,
}: {
  initialTab?: string;
  userId?: string;
}) {
  const user = useUser();
  const admin = user.role === "ADMIN";
  const operator = admin || user.role === "DISPATCH";
  const [tab, setTab] = useState(
    operator && initialTab === "users"
      ? "users"
      : admin
        ? "integrations"
        : operator
          ? "audit"
          : "permissions",
  );
  const [form, setForm] = useState<string | null>(null);
  const [editUser, setEditUser] = useState<Entity | null>(null);
  const accounts = useCatalog("/users", {}, tab === "users");
  const organizations = useCatalog("/organizations", {}, tab === "users");
  const integrations = useData<(Entity & { state: string; message: string })[]>(
    "/integrations/status",
    tab === "integrations" && admin,
    30_000,
  );
  const audits = useList("/audit", {}, tab === "audit");
  const settings = useList("/settings", {}, tab === "config" && admin);
  const resources = useCatalog(
    "/resources",
    { kind: "DEVICE" },
    tab === "users",
  );
  const mutate = useMutationFeedback();
  const [error, setError] = useState("");
  const [openedUserId, setOpenedUserId] = useState<string>();
  const targetUser = accounts.data?.items.find(
    (account) => account.id === userId,
  );
  useEffect(() => {
    if (!userId || openedUserId === userId || !accounts.data) return;
    setOpenedUserId(userId);
    const account = accounts.data.items.find((item) => item.id === userId);
    if (!account) {
      setError("该执行账号不存在或不在当前账号的可见范围内。");
      return;
    }
    if (admin) {
      setEditUser(account);
      setForm("user");
    }
  }, [accounts.data, admin, openedUserId, userId]);
  const [importing, setImporting] = useState(false);
  const coverage = useData<
    Record<string, { total: number | null; status: string; message: string }>
  >("/source-data/summary", tab === "integrations" && admin);

  const userFields: Field[] = [
    {
      key: "enabled",
      label: "账号状态",
      required: true,
      options: [
        { value: "true", label: "启用" },
        { value: "false", label: "停用" },
      ],
    },
    {
      key: "organizationIds",
      label: "运营可见组织ID（逗号分隔）",
      placeholder: "留空仅允许本组织；仅用于运营调度",
      wide: true,
    },
    { key: "username", label: "登录账号", required: true },
    { key: "displayName", label: "姓名", required: true },
    {
      key: "password",
      label: editUser ? "新密码（留空保留）" : "初始密码（至少12位）",
      type: "password",
      required: !editUser,
    },
    {
      key: "role",
      label: "岗位角色",
      required: true,
      options: Object.entries(ROLE_LABELS).map(([value, label]) => ({
        value,
        label,
      })),
    },
    {
      key: "organizationId",
      label: "所属组织",
      required: true,
      options: (organizations.data?.items || []).map((r) => ({
        value: r.id,
        label: String(r.title),
      })),
    },
    {
      key: "regions",
      label: "可见 / 执行区域（逗号分隔）",
      placeholder: REGIONS.join("，"),
      wide: true,
    },
    {
      key: "deviceIds",
      label: "授权设备 ID（逗号分隔）",
      placeholder: "飞手须包含对应本地或来源设备 ID",
      wide: true,
    },
  ];
  return (
    <div className="settings">
      <Tabs
        items={[
          ...(operator
            ? [
                { id: "users", label: "组织与权限" },
                { id: "audit", label: "安全审计" },
              ]
            : [{ id: "permissions", label: "当前权限" }]),
          ...(admin
            ? [
                { id: "integrations", label: "系统对接" },
                { id: "config", label: "平台配置" },
              ]
            : []),
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === "integrations" ? (
        <>
          <div className="table-toolbar">
            <div>
              <h2>真实数据接入</h2>
              <p>连接信息通过后端私有配置管理</p>
            </div>
            {admin && (
              <Button
                onClick={() => {
                  setError("");
                  void mutate(
                    () => api("/integrations/refresh", { method: "POST" }),
                    "已刷新来源状态",
                  ).catch((e) => setError(e.message));
                }}
              >
                <RefreshCw size={13} />
                刷新连接状态
              </Button>
            )}
          </div>
          {error && <p className="form-error">{error}</p>}
          <section className="section panel">
            <div className="section-title">
              <h3>来源业务目录</h3>
              <Button
                disabled={importing}
                onClick={() => {
                  setImporting(true);
                  setError("");
                  void mutate(
                    () =>
                      write("/source-data/import", {
                        kinds: [
                          "DEVICE",
                          "PERSON",
                          "ROUTE",
                          "AIRSPACE",
                          "ORGANIZATION",
                        ],
                        limitPerKind: 2000,
                      }),
                    "来源档案已导入，重复记录自动跳过",
                  )
                    .catch((e) => setError(e.message))
                    .finally(() => setImporting(false));
                }}
              >
                {importing ? "正在导入" : "导入来源档案"}
              </Button>
            </div>
            <DataTable
              rows={Object.entries(coverage.data || {}).map(([id, item]) => ({
                id,
                ...item,
              }))}
              loading={coverage.isLoading}
              error={coverage.error}
              columns={[
                {
                  key: "id",
                  label: "目录",
                  render: (r) =>
                    (
                      ({
                        people: "人员",
                        groups: "组织",
                        routes: "航线",
                        airspaces: "电子围栏",
                        plans: "来源计划",
                        tasks: "来源行动",
                        events: "识别观测",
                        media: "媒体索引",
                      }) as Record<string, string>
                    )[r.id] || r.id,
                },
                {
                  key: "total",
                  label: "可见记录",
                  render: (r) => (r.total == null ? "未知" : String(r.total)),
                },
                {
                  key: "status",
                  label: "连接状态",
                  render: (r) => <Status status={r.status} />,
                },
                { key: "message", label: "说明" },
              ]}
            />
            <p className="footnote">
              导入保留来源信息与原始状态。人员资质、设备可调度状态需本地确认，来源账号不会自动获得本平台登录权限。
            </p>
          </section>
          <div className="integration-grid">
            {integrations.data?.map((source, index) => (
              <section className="integration-card" key={source.name || index}>
                <Database size={20} />
                <div>
                  <h3>{String(source.name)}</h3>
                  <p>{source.message}</p>
                  <small>末次成功 {dateTime(source.lastSuccessAt)}</small>
                </div>
                <Status status={source.state} />
              </section>
            ))}
          </div>
          {!integrations.data?.length && (
            <Empty
              loading={integrations.isLoading}
              error={integrations.error}
              title={admin ? "暂无连接状态" : "管理员可查看接入详情"}
            />
          )}
          <div className="notice">
            <KeyRound size={15} />
            来源令牌、数据库和 MQTT
            凭据保存在后端私有环境中。详情与更新方式见部署文档。
          </div>
        </>
      ) : tab === "users" ? (
        <>
          <div className="table-toolbar">
            <div>
              <h2>组织与岗位权限</h2>
              <p>角色权限与组织、区域、设备范围共同生效</p>
            </div>
            {admin && (
              <>
                <Button onClick={() => setForm("organization")}>
                  <Plus size={13} />
                  新增组织
                </Button>
                <Button
                  primary
                  onClick={() => {
                    setEditUser(null);
                    setForm("user");
                  }}
                >
                  <Plus size={13} />
                  新增账号
                </Button>
              </>
            )}
          </div>
          {error && <p className="form-error">{error}</p>}
          {targetUser && (
            <p className="notice">
              {String(targetUser.displayName)} · 可见 / 执行区域：
              {Array.isArray(targetUser.regions) && targetUser.regions.length
                ? targetUser.regions.join("、")
                : "本组织范围"}
              ；授权设备：
              {Array.isArray(targetUser.deviceIds)
                ? targetUser.deviceIds.length
                : 0}{" "}
              台。
              {admin
                ? "修改范围后保存，返回任务重新核对可分配资源。"
                : "请由管理员维护账号授权范围。"}
            </p>
          )}
          <DataTable
            rows={accounts.data?.items || []}
            loading={accounts.isLoading}
            error={accounts.error}
            onRow={
              admin
                ? (r) => {
                    setEditUser(r);
                    setForm("user");
                  }
                : undefined
            }
            columns={[
              { key: "displayName", label: "姓名" },
              { key: "username", label: "登录账号" },
              {
                key: "role",
                label: "岗位",
                render: (r) => ROLE_LABELS[String(r.role)] || String(r.role),
              },
              {
                key: "organizationId",
                label: "组织",
                render: (r) =>
                  String(
                    organizations.data?.items.find(
                      (o) => o.id === r.organizationId,
                    )?.title || r.organizationId,
                  ),
              },
              {
                key: "regions",
                label: "可见区域",
                render: (r) =>
                  Array.isArray(r.regions)
                    ? r.regions.join("、")
                    : "按组织范围",
              },
              {
                key: "enabled",
                label: "账号状态",
                render: (r) => (
                  <Status status={r.enabled ? "ACTIVE" : "INACTIVE"} />
                ),
              },
            ]}
          />
          <div className="section">
            <h3>可分配设备</h3>
            <p className="muted">
              创建飞手账号时，将对应设备 ID 填入授权范围。
            </p>
            {resources.data?.items.map((r) => (
              <div className="device-permission" key={r.id}>
                <strong>{r.title}</strong>
                <code>{r.id}</code>
                <small>{r.region}</small>
              </div>
            ))}
          </div>
        </>
      ) : tab === "audit" ? (
        <>
          <div className="table-toolbar">
            <h2>操作审计</h2>
            <ShieldCheck size={18} />
          </div>
          <DataTable
            rows={audits.data?.items || []}
            loading={audits.isLoading}
            error={audits.error}
            columns={[
              {
                key: "createdAt",
                label: "操作时间",
                render: (r) => dateTime(r.createdAt),
              },
              { key: "actorName", label: "操作人" },
              { key: "entityType", label: "业务对象" },
              { key: "action", label: "动作" },
              { key: "note", label: "操作说明" },
            ]}
          />
        </>
      ) : (
        <>
          <div className="table-toolbar">
            <h2>平台基础配置</h2>
          </div>
          {admin ? (
            <>
              <div className="config-options">
                {[
                  { key: "platformName", label: "平台名称" },
                  { key: "contactPhone", label: "值守电话" },
                  { key: "defaultRegion", label: "默认区域" },
                  { key: "mapSatelliteUrl", label: "卫星瓦片地址" },
                  { key: "mapStyleUrl", label: "电子地图样式地址" },
                  { key: "mapTerrainUrl", label: "地形瓦片地址" },
                ].map((c) => (
                  <button key={c.key} onClick={() => setForm(c.key)}>
                    <span>{c.label}</span>
                    <code>
                      {String(
                        settings.data?.items.find((r) => r.id === c.key)
                          ?.value || "使用默认配置",
                      )}
                    </code>
                  </button>
                ))}
              </div>
              <p className="muted">
                地图地址设置为空时恢复默认来源；修改后刷新地图页面生效。
              </p>
            </>
          ) : (
            <Details
              items={[
                { label: "当前岗位", value: ROLE_LABELS[user.role] },
                { label: "所属组织", value: user.organizationId },
                {
                  label: "可见区域",
                  value: user.regions.join("、") || "本组织范围",
                },
                {
                  label: "设备范围",
                  value: user.deviceIds.length + " 台授权设备",
                },
              ]}
            />
          )}
        </>
      )}
      {form && (
        <Modal
          title={
            form === "user"
              ? editUser
                ? "编辑账号与范围"
                : "新增本地账号"
              : form === "organization"
                ? "新增组织"
                : "修改平台配置"
          }
          onClose={() => setForm(null)}
        >
          <EntityForm
            fields={
              form === "user"
                ? userFields
                : form === "organization"
                  ? [
                      {
                        key: "title",
                        label: "组织名称",
                        required: true,
                        wide: true,
                      },
                      {
                        key: "region",
                        label: "所属区域",
                        options: REGIONS.map((v) => ({ value: v, label: v })),
                      },
                      { key: "contact", label: "联系信息" },
                    ]
                  : [{ key: "value", label: "配置值", wide: true }]
            }
            initial={
              form === "user" && editUser
                ? {
                    ...editUser,
                    enabled: String(editUser.enabled ?? true),
                    organizationIds: (
                      (editUser.organizationIds as string[]) || []
                    ).join(","),
                    regions: ((editUser.regions as string[]) || []).join(","),
                    deviceIds: ((editUser.deviceIds as string[]) || []).join(
                      ",",
                    ),
                  }
                : form === "user"
                  ? {
                      role: "DEPARTMENT",
                      regions: REGIONS.join(","),
                      enabled: "true",
                    }
                  : {
                      value:
                        settings.data?.items.find((r) => r.id === form)
                          ?.value || "",
                    }
            }
            onCancel={() => setForm(null)}
            onSubmit={(body) => {
              if (form === "user") {
                const data: Record<string, unknown> = {
                  ...body,
                  regions: String(body.regions || "")
                    .split(/[,，]/)
                    .map((v) => v.trim())
                    .filter(Boolean),
                  deviceIds: String(body.deviceIds || "")
                    .split(/[,，]/)
                    .map((v) => v.trim())
                    .filter(Boolean),
                  enabled: body.enabled !== "false",
                  organizationIds: String(body.organizationIds || "")
                    .split(/[,，]/)
                    .map((v) => v.trim())
                    .filter(Boolean),
                };
                if (editUser && !data.password) delete data.password;
                return mutate(
                  () =>
                    write(
                      `/users${editUser ? `/${editUser.id}` : ""}`,
                      data,
                      editUser ? "PUT" : "POST",
                    ),
                  "账号权限已保存",
                );
              }
              if (form === "organization")
                return mutate(
                  () => write("/organizations", body),
                  "组织已创建",
                );
              return mutate(
                () => write(`/settings/${form}`, body, "PUT"),
                "平台配置已保存",
              );
            }}
          />
        </Modal>
      )}
    </div>
  );
}
