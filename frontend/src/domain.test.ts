import { describe, it, expect } from "vitest";
import {
  localInput,
  toInstant,
  dateTime,
  secondsLabel,
  metersLabel,
} from "./domain";
import { drawGeometry, geometryPoints } from "./geometry";
describe("来源数据与时区口径", () => {
  it("上海凌晨时间在表单往返中保持日期", () => {
    const input = "2026-10-14T00:30";
    expect(toInstant(input)).toBe("2026-10-13T16:30:00.000Z");
    expect(localInput(toInstant(input))).toBe(input);
    expect(dateTime(toInstant(input))).toContain("10/14");
  });
  it("完整与简短时间在上海跨日时保持原有文本", () => {
    const instant = "2026-10-13T16:30:00.000Z";
    expect(dateTime(instant)).toBe("2026/10/14 00:30");
    expect(dateTime(instant, true)).toBe("10/14 00:30");
    expect(dateTime("not-a-date")).toBe("not-a-date");
    expect(dateTime(null)).toBe("—");
    expect(dateTime(undefined, true)).toBe("—");
  });
  it("源值零与未知保持区别，秒米只在展示时换算", () => {
    expect(secondsLabel(0)).toBe("0.00 小时");
    expect(secondsLabel(null)).toBe("—");
    expect(secondsLabel(3600)).toBe("1.00 小时");
    expect(metersLabel(1500)).toBe("1.50 公里");
    expect(metersLabel(undefined)).toBe("—");
  });
  it("不足以构成航线或空域的绘制保持为空", () => {
    expect(drawGeometry([[120, 30]], "ROUTE")).toBeNull();
    expect(
      drawGeometry(
        [
          [120, 30],
          [121, 30],
        ],
        "AIRSPACE",
      ),
    ).toBeNull();
  });
  it("空域闭合保存后可以继续编辑，非法坐标不进入地图", () => {
    const points: [number, number][] = [
      [120, 30],
      [121, 30],
      [121, 31],
    ];
    const polygon = drawGeometry(points, "AIRSPACE");
    expect(geometryPoints(polygon, "AIRSPACE")).toEqual(points);
    expect(geometryPoints("{bad json", "ROUTE")).toEqual([]);
    expect(
      geometryPoints(
        {
          type: "LineString",
          coordinates: [
            [200, 30],
            [120, 30],
          ],
        },
        "ROUTE",
      ),
    ).toEqual([[120, 30]]);
  });
});
