import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { api, queryString, write, type Entity, type Page } from "../api";
import { Button, Empty, Modal } from "./UI";
import "./FourAAccountPicker.css";

export interface FourAAccount {
  externalUserId: string;
  username: string;
  displayName: string;
  externalGroupName: string;
  available: boolean;
  unavailableReason: string;
  linked: boolean;
  userId?: string;
  businessAccessAssigned: boolean;
}

export default function FourAAccountPicker({
  onClose,
  onLinked,
}: {
  onClose: () => void;
  onLinked: (account: Entity) => void;
}) {
  const client = useQueryClient();
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const directory = useQuery({
    queryKey: ["4a-directory", query, page],
    queryFn: () =>
      api<Page<FourAAccount>>(
        `/users/4a-directory?${queryString({ page, pageSize: 20, query })}`,
      ),
    retry: false,
  });
  const data = directory.isError ? undefined : directory.data;
  const selected = data?.items.find(
    (account) => account.externalUserId === selectedId && account.available,
  );
  const pages = Math.max(1, Math.ceil((data?.total ?? 0) / 20));

  function changePage(next: number) {
    setSelectedId("");
    setError("");
    setPage(next);
  }

  async function linkAccount() {
    if (!selected || busy || directory.isFetching) return;
    setBusy(true);
    setError("");
    try {
      const account = await write<Entity>("/users/4a-link", {
        externalUserId: selected.externalUserId,
      });
      await client.invalidateQueries({ queryKey: ["catalog", "/users"] });
      onLinked(account);
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "关联失败，请重试。",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title="关联 4A 账号"
      wide
      className="four-a-account-picker"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <p className="muted">
        从 4A
        账号目录选择人员，关联后即可配置平台业务权限，无需对方先登录本平台。
        身份信息和应用登录权限由 4A 管理。
      </p>
      <form
        className="four-a-directory-search"
        onSubmit={(event) => {
          event.preventDefault();
          setSelectedId("");
          setError("");
          setPage(1);
          if (query === search.trim() && page === 1) void directory.refetch();
          else setQuery(search.trim());
        }}
      >
        <label className="search-box">
          <Search size={14} aria-hidden="true" />
          <input
            type="search"
            aria-label="搜索 4A 账号"
            placeholder="搜索姓名或登录账号"
            value={search}
            disabled={busy}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <Button type="submit" disabled={busy || directory.isFetching}>
          搜索
        </Button>
      </form>
      <div aria-live="polite" aria-busy={directory.isFetching}>
        {directory.isError ? (
          <div role="alert" className="four-a-directory-error">
            <h3>4A 账号目录暂不可用</h3>
            <p className="form-error">{directory.error.message}</p>
            <p className="muted">
              请检查 4A 目录接入配置或联系平台管理员后重试。
            </p>
            <Button
              disabled={directory.isFetching}
              onClick={() => void directory.refetch()}
            >
              重试加载 4A 目录
            </Button>
          </div>
        ) : directory.isPending ? (
          <Empty loading />
        ) : !data?.items.length ? (
          <Empty
            title={query ? "未找到匹配的 4A 账号" : "4A 目录暂无账号"}
            description={
              query
                ? "请尝试其他姓名或登录账号。"
                : "请在 4A 确认账号及目录可见范围后重试。"
            }
          />
        ) : (
          <div className="table-wrap four-a-directory-table">
            <table>
              <caption>4A 账号目录</caption>
              <thead>
                <tr>
                  <th scope="col">选择</th>
                  <th scope="col">姓名 / 登录账号</th>
                  <th scope="col">4A 组织</th>
                  <th scope="col">平台关联</th>
                  <th scope="col">可用状态</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((account, index) => (
                  <tr
                    key={account.externalUserId}
                    className={
                      selectedId === account.externalUserId ? "is-selected" : ""
                    }
                  >
                    <td>
                      <input
                        type="radio"
                        name="four-a-account"
                        aria-label={`选择 ${account.displayName}（${account.username}）`}
                        aria-describedby={`four-a-availability-${index}`}
                        checked={selectedId === account.externalUserId}
                        disabled={
                          !account.available || busy || directory.isFetching
                        }
                        onChange={() => {
                          setSelectedId(account.externalUserId);
                          setError("");
                        }}
                      />
                    </td>
                    <td>
                      <strong>{account.displayName || "未填写姓名"}</strong>
                      <small>{account.username}</small>
                    </td>
                    <td>{account.externalGroupName || "未设置组织"}</td>
                    <td>
                      <span>{account.linked ? "已关联" : "未关联"}</span>
                      {account.linked && (
                        <small>
                          {account.businessAccessAssigned
                            ? "已配置业务权限"
                            : "待配置业务权限"}
                        </small>
                      )}
                    </td>
                    <td id={`four-a-availability-${index}`}>
                      {account.available ? (
                        "可用"
                      ) : (
                        <span className="four-a-unavailable">
                          {account.unavailableReason || "账号不可用"}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {data && !directory.isError && (
        <nav
          className="four-a-directory-pagination"
          aria-label="4A 账号目录分页"
        >
          <span>
            共 {data.total} 个账号 · 第 {page} / {pages} 页
          </span>
          <div>
            <Button
              small
              disabled={page <= 1 || busy || directory.isFetching}
              onClick={() => changePage(page - 1)}
            >
              上一页
            </Button>
            <Button
              small
              disabled={page >= pages || busy || directory.isFetching}
              onClick={() => changePage(page + 1)}
            >
              下一页
            </Button>
          </div>
        </nav>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {busy && (
        <p className="muted" role="status">
          正在关联 4A 账号…
        </p>
      )}
      <footer className="form-footer">
        <Button disabled={busy} onClick={onClose}>
          取消
        </Button>
        <Button
          primary
          disabled={!selected || busy || directory.isFetching}
          onClick={() => void linkAccount()}
        >
          {busy
            ? "正在处理…"
            : selected?.linked
              ? "配置权限"
              : "关联并配置权限"}
        </Button>
      </footer>
    </Modal>
  );
}
