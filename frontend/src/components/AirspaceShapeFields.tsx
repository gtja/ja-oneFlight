import { type AirspaceShape } from "../airspaceShapes";
import { routeLengthMeters } from "../geometry";

export default function AirspaceShapeFields({
  shape,
  onChange,
}: {
  shape: AirspaceShape;
  onChange: (shape: AirspaceShape) => boolean;
}) {
  function field(
    label: string,
    value: number,
    change: (value: number) => AirspaceShape,
    min?: number,
    max?: number,
  ) {
    return (
      <label key={`${label}-${value}`}>
        {label}
        <input
          type="number"
          step="any"
          required
          min={min}
          max={max}
          defaultValue={value}
          onChange={(event) => event.currentTarget.setCustomValidity("")}
          onBlur={(event) => {
            const input = event.currentTarget;
            if (!input.checkValidity()) return;
            const next = Number(input.value);
            if (next !== value && !onChange(change(next)))
              input.setCustomValidity("范围无效，请检查坐标及尺寸");
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              event.currentTarget.blur();
            }
          }}
        />
      </label>
    );
  }
  return (
    <section className="airspace-shape-fields" aria-label="空域形状参数">
      <strong>{shape.type === "CIRCLE" ? "圆形范围" : "矩形范围"}</strong>
      {shape.type === "CIRCLE" ? (
        <>
          {field(
            "圆心经度",
            shape.center[0],
            (value) => ({ ...shape, center: [value, shape.center[1]] }),
            -180,
            180,
          )}
          {field(
            "圆心纬度",
            shape.center[1],
            (value) => ({ ...shape, center: [shape.center[0], value] }),
            -90,
            90,
          )}
          {field(
            "半径（米）",
            shape.radiusMeters,
            (radiusMeters) => ({ ...shape, radiusMeters }),
            0.01,
          )}
          <small>拖动圆心平移，拖动半径点调整大小。</small>
        </>
      ) : (
        <>
          {field(
            "西侧经度",
            shape.west,
            (west) => ({ ...shape, west }),
            -180,
            180,
          )}
          {field(
            "东侧经度",
            shape.east,
            (east) => ({ ...shape, east }),
            -180,
            180,
          )}
          {field(
            "南侧纬度",
            shape.south,
            (south) => ({ ...shape, south }),
            -90,
            90,
          )}
          {field(
            "北侧纬度",
            shape.north,
            (north) => ({ ...shape, north }),
            -90,
            90,
          )}
          <button
            type="button"
            onClick={() => {
              const sideMeters = routeLengthMeters([
                [shape.west, shape.south],
                [shape.east, shape.south],
              ]);
              onChange({
                ...shape,
                north:
                  shape.south + (sideMeters / 6_371_008.8) * (180 / Math.PI),
              });
            }}
          >
            设为正方形
          </button>
          <small>拖动两个对角点调整范围，可将矩形设为正方形。</small>
        </>
      )}
    </section>
  );
}
