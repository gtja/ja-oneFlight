import {
  Cloud,
  RadioTower,
  Thermometer,
  Wind,
} from "lucide-react";
import type { WeatherOverview, WeatherObservation } from "../../api";
import { dateTime } from "../../domain";

function reading(value: number | null | undefined, unit: string) {
  return value === null || value === undefined || !Number.isFinite(value)
    ? "暂无数据"
    : `${value} ${unit}`;
}

function stationStatus(station: WeatherObservation) {
  if (station.status === "ONLINE" && station.observedAt) return "在线";
  if (station.observedAt) return "数据可能已过期";
  return station.status === "OFFLINE" ? "离线" : "暂无上报";
}

function sourceStatus(data?: WeatherOverview) {
  switch (data?.sourceHealth.state) {
    case "HEALTHY": return "机库遥测已连接";
    case "STALE": return "等待机巢上报";
    case "ERROR": return "遥测连接异常";
    case "UNCONFIGURED": return "遥测来源未配置";
    default: return "正在读取机库遥测";
  }
}

export default function WeatherResources({
  data,
  loading,
  error,
}: {
  data?: WeatherOverview;
  loading: boolean;
  error?: Error | null;
}) {
  const stations = data?.stations || [];
  const hasReadings = (station: WeatherObservation) =>
    [station.windSpeed, station.temperature, station.humidity].some(
        (value) => value !== null && value !== undefined && Number.isFinite(value),
    );
  const withReadings = stations.filter(hasReadings).length;
  const orderedStations = [...stations].sort(
    (left, right) => Number(hasReadings(right)) - Number(hasReadings(left)),
  );
  return (
    <main className="weather-resource-page" aria-label="气象资源">
      <div className="weather-resource-heading">
        <div>
          <h2>气象资源</h2>
          <p>机巢气象观测</p>
        </div>
        <span className={`weather-source-status ${data?.sourceHealth.state === "HEALTHY" ? "connected" : ""}`}>
          <RadioTower size={14} /> {sourceStatus(data)}
        </span>
      </div>

      <section className="weather-summary-cards" aria-label="气象概览">
        <article>
          <span><RadioTower size={15} /> 已授权机巢</span>
          <strong>{loading ? "—" : stations.length}<small> 台</small></strong>
        </article>
        <article>
          <span><Cloud size={15} /> 有实时观测</span>
          <strong>{loading ? "—" : withReadings}<small> 台</small></strong>
        </article>
        <article>
          <span><Wind size={15} /> 暂无实时观测</span>
          <strong>{loading ? "—" : Math.max(stations.length - withReadings, 0)}<small> 台</small></strong>
        </article>
      </section>

      {error ? (
        <p className="form-error" role="alert">
          机巢气象数据读取失败：{error.message}
        </p>
      ) : loading ? (
        <p className="muted" role="status">正在读取已授权机巢的气象观测…</p>
      ) : stations.length === 0 ? (
        <section className="weather-empty-state">
          <RadioTower size={22} />
          <strong>当前授权范围内没有机巢</strong>
          <p>接入机巢并收到遥测后，气象观测会显示在这里。</p>
        </section>
      ) : (
        <section className="weather-station-panel">
          <div className="weather-panel-title">
            <div>
              <h3>机巢观测</h3>
              <p>数据来自当前账号可见的机巢遥测</p>
            </div>
            <span>刷新间隔 10 秒</span>
          </div>
          <div className="weather-station-list">
            {orderedStations.map((station) => (
              <article className="weather-station-card" key={station.deviceId}>
                <div className="weather-station-name">
                  <div className="weather-station-icon"><RadioTower size={16} /></div>
                  <div>
                    <strong>{station.deviceName || station.deviceId}</strong>
                    <small>设备编号：{station.deviceId}</small>
                  </div>
                  <span className={`weather-state ${station.status === "ONLINE" ? "" : "warning"}`}>
                    {stationStatus(station)}
                  </span>
                </div>
                <div className="weather-station-values">
                  <div><Wind size={14} /><span>风速</span><strong>{reading(station.windSpeed, "米/秒")}</strong></div>
                  <div><Thermometer size={14} /><span>温度</span><strong>{reading(station.temperature, "℃")}</strong></div>
                  <div><Cloud size={14} /><span>湿度</span><strong>{reading(station.humidity, "%")}</strong></div>
                </div>
                <small className="weather-observed-time">
                  观测时间：{dateTime(station.observedAt)}
                </small>
              </article>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
